import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import appStoreConnect from './appStoreConnect.js'
import { countCreativePlacements, placeCreativeImage, uploadCreativeImage } from './creativeAssets.js'
import { sortLocales } from './localeOrder.js'

// Reads the zip the screenshot editor exports and uploads it to an App Store
// version, a Product Page Optimization treatment or a Custom Product Page.
// Paths inside the zip are <platform>/<device>/<width>x<height>/<locale>/NN-name.png.
// The creative-header and creative-search devices hold creative assets, which
// go to the App Asset Library instead of a screenshot set.

const run = promisify(execFile)
const BUNDLE_ROOT = path.join(os.tmpdir(), 'appstore-screenshot-bundles')
const MAX_PER_SET = 10

// Editor device + pixel size -> the App Store Connect slot. Sizes the editor
// exports that share a slot with a larger one (e.g. iPad 2048x2732) are left
// out, since a slot takes one size.
const DISPLAY_TYPES = {
  iphone: { '1320x2868': 'APP_IPHONE_67', '1284x2778': 'APP_IPHONE_65' },
  ipad: { '2064x2752': 'APP_IPAD_PRO_3GEN_129' },
  'duo-outer': { '1398x2034': 'APP_IPHONE_DUO' },
  watchos: {
    '422x514': 'APP_WATCH_ULTRA',
  },
}

// Editor device -> asset library placement type. A placement takes one image,
// so only the largest size exported per locale is used.
const CREATIVE_DEVICES = {
  'creative-header': 'PRODUCT_PAGE_HEADER_ASSET',
  'creative-search': 'APP_STORE_SEARCH_RESULTS_ASSET',
}

const OWNERS = {
  version: 'appStoreVersionLocalizations',
  experiment: 'appStoreVersionExperimentTreatmentLocalizations',
  customProductPage: 'appCustomProductPageLocalizations',
}

function bundleDir(bundleId) {
  if (!/^[a-f0-9]{16}$/.test(String(bundleId))) throw new Error('Unknown screenshot bundle')
  return path.join(BUNDLE_ROOT, bundleId)
}

// Accepts the export zip or an already-unzipped folder.
export async function openBundle(source) {
  const bundleId = crypto.randomBytes(8).toString('hex')
  const dir = bundleDir(bundleId)
  fs.mkdirSync(dir, { recursive: true })

  if (fs.statSync(source).isDirectory()) {
    fs.cpSync(source, dir, { recursive: true })
  } else {
    await run('unzip', ['-q', '-o', source, '-d', dir])
  }

  return { bundleId, ...readBundle(bundleId) }
}

export async function openBundleFromBuffer(buffer) {
  fs.mkdirSync(BUNDLE_ROOT, { recursive: true })
  const zipPath = path.join(BUNDLE_ROOT, `${crypto.randomBytes(8).toString('hex')}.zip`)
  fs.writeFileSync(zipPath, buffer)
  try {
    return await openBundle(zipPath)
  } finally {
    fs.rmSync(zipPath, { force: true })
  }
}

// Every device/size/locale folder in the bundle, with the slot it maps to.
export function readBundle(bundleId) {
  const dir = bundleDir(bundleId)
  if (!fs.existsSync(dir)) throw new Error('Screenshot bundle expired. Choose the zip again.')

  const sets = []
  const list = (folder) => fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)

  for (const platform of list(dir)) {
    for (const device of list(path.join(dir, platform))) {
      for (const size of list(path.join(dir, platform, device))) {
        for (const locale of list(path.join(dir, platform, device, size))) {
          const folder = path.join(dir, platform, device, size, locale)
          const files = fs.readdirSync(folder).filter((name) => /\.(png|jpe?g)$/i.test(name)).sort()
          if (files.length === 0) continue
          sets.push({ device, size, locale, displayType: DISPLAY_TYPES[device]?.[size] || CREATIVE_DEVICES[device] || null, creative: Boolean(CREATIVE_DEVICES[device]), files, folder })
        }
      }
    }
  }

  const area = (size) => size.split('x').reduce((product, side) => product * Number(side), 1)
  for (const set of sets) {
    if (set.creative && sets.some((other) => other.creative && other.device === set.device && other.locale === set.locale && area(other.size) > area(set.size))) {
      set.displayType = null
    }
  }

  if (sets.length === 0) throw new Error('No screenshots found. Expected <platform>/<device>/<size>/<locale>/*.png or *.jpg inside the zip.')

  return {
    sets: sets.map(({ folder, ...set }) => set),
    locales: sortLocales(new Set(sets.map((set) => set.locale))),
    folders: Object.fromEntries(sets.map((set) => [`${set.device}/${set.size}/${set.locale}`, set.folder])),
  }
}

// Store locales an editor locale goes to by default: an exact match, else
// every store locale of that language ("en" -> en-US and en-GB).
export function defaultLocaleMap(bundleLocales, storeLocales) {
  return Object.fromEntries(
    bundleLocales.map((locale) => {
      const exact = storeLocales.filter((storeLocale) => storeLocale === locale)
      const sameLanguage = storeLocales.filter((storeLocale) => storeLocale.split('-')[0] === locale.split('-')[0])
      return [locale, exact.length ? exact : locale.includes('-') ? [] : sameLanguage]
    })
  )
}

// The store localizations of the target: { locale: localizationId }.
export async function targetLocalizations(target) {
  if (target.kind === 'experiment') {
    if (!target.treatmentId) throw new Error('treatmentId is required for an experiment target')
    const localizations = await appStoreConnect.getProductPageTreatmentLocalizations(target.treatmentId)
    return Object.fromEntries(localizations.map((item) => [item.attributes?.locale, item.id]))
  }

  if (target.kind === 'customProductPage') {
    const version = await appStoreConnect.getEditableCustomProductPageVersion(target.customProductPageId)
    const localizations = await appStoreConnect.getCustomProductPageLocalizations(version.id)
    return Object.fromEntries(localizations.map((item) => [item.attributes?.locale, item.id]))
  }

  const version = await appStoreConnect.getEditableVersion(target.appId, target.platform || 'IOS')
  if (!version?.id) throw new Error('No editable App Store version. Open a version in Prepare for Submission first.')
  const localizations = await appStoreConnect.getAppStoreVersionLocalizations(version.id)
  return Object.fromEntries(localizations.map((item) => [item.attributes?.locale, item.id]))
}

// One row per store locale and slot: what would be uploaded and what is there now.
export async function planUpload(bundleId, target, options = {}) {
  const bundle = readBundle(bundleId)
  const localizations = await targetLocalizations(target)
  const storeLocales = sortLocales(Object.keys(localizations))
  const localeMap = options.localeMap || defaultLocaleMap(bundle.locales, storeLocales)
  const displayTypes = options.displayTypes ? new Set(options.displayTypes) : null
  const owner = OWNERS[target.kind] || OWNERS.version

  const rows = []
  for (const set of bundle.sets) {
    if (!set.displayType || (displayTypes && !displayTypes.has(set.displayType))) continue
    for (const storeLocale of localeMap[set.locale] || []) {
      rows.push({ storeLocale, displayType: set.displayType, creative: set.creative, bundleKey: `${set.device}/${set.size}/${set.locale}`, files: set.files, localizationId: localizations[storeLocale] || null })
    }
  }

  const existingByLocalization = new Map()
  for (const localizationId of new Set(rows.map((row) => row.localizationId).filter(Boolean))) {
    const forLocalization = rows.filter((row) => row.localizationId === localizationId)
    const [sets, creative] = await Promise.all([
      forLocalization.some((row) => !row.creative) ? appStoreConnect.getAppScreenshotSetsForLocalization(localizationId, owner) : [],
      forLocalization.some((row) => row.creative) ? countCreativePlacements(owner, localizationId) : {},
    ])
    existingByLocalization.set(localizationId, { ...Object.fromEntries(sets.map((item) => [item.attributes?.screenshotDisplayType, item.appScreenshots.length])), ...creative })
  }

  return {
    storeLocales,
    localeMap,
    unmapped: bundle.sets.filter((set) => !set.displayType).map((set) => `${set.device} ${set.size}`).filter((value, index, all) => all.indexOf(value) === index),
    rows: rows.map((row) => ({ ...row, existing: existingByLocalization.get(row.localizationId)?.[row.displayType] || 0 })),
    folders: bundle.folders,
  }
}

// Runs the plan. Without `replace`, sets that already hold screenshots are
// skipped rather than mixed with the new ones. `only` limits it to some rows,
// as [{ storeLocale, displayType }], to retry the ones that failed.
export async function applyUpload(bundleId, target, options = {}) {
  const { replace = false, onProgress, only } = options
  const plan = await planUpload(bundleId, target, options)
  const onlyKeys = only ? new Set(only.map((row) => `${row.storeLocale}|${row.displayType}`)) : null
  const owner = OWNERS[target.kind] || OWNERS.version
  const results = []
  const creativeImages = new Map() // bundleKey -> upload, so one image backs every locale it goes to
  const placedKeys = new Set()

  for (const row of plan.rows) {
    if (onlyKeys && !onlyKeys.has(`${row.storeLocale}|${row.displayType}`)) continue
    const label = `${row.storeLocale} ${row.displayType}`
    try {
      if (row.creative && row.files.length > 1) throw new Error(`${row.files.length} images; a creative asset takes 1`)
      if (row.files.length > MAX_PER_SET) throw new Error(`${row.files.length} screenshots; a set holds at most ${MAX_PER_SET}`)
      if (row.existing > 0 && !replace) {
        results.push({ ...summary(row), status: 'skipped', message: `already has ${row.existing}; turn on Replace to overwrite` })
        continue
      }

      let localizationId = row.localizationId
      if (!localizationId) {
        const created = await createTargetLocalization(target, row.storeLocale)
        localizationId = created?.id
        if (!localizationId) throw new Error('could not create the locale')
        for (const other of plan.rows) {
          if (other.storeLocale === row.storeLocale) other.localizationId = localizationId
        }
      }

      const files = row.files.map((fileName) => ({ fileName, buffer: fs.readFileSync(path.join(plan.folders[row.bundleKey], fileName)) }))
      onProgress?.(label)
      if (row.creative) {
        if (!creativeImages.has(row.bundleKey)) creativeImages.set(row.bundleKey, uploadCreativeImage(target, row.displayType, files[0]))
        const { imageId, groups } = await creativeImages.get(row.bundleKey)
        const placed = await placeCreativeImage({ owner, localizationId, imageId, placementType: row.displayType, groups, replace })
        placedKeys.add(row.bundleKey)
        results.push({ ...summary(row), status: 'uploaded', deleted: placed.deleted, uploaded: 1 })
        continue
      }
      const uploaded = await appStoreConnect.uploadScreenshotsToLocalization(localizationId, row.displayType, files, { replace, owner })
      results.push({ ...summary(row), status: 'uploaded', deleted: uploaded.deleted, uploaded: uploaded.appScreenshots.length })
    } catch (error) {
      results.push({ ...summary(row), status: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  // Don't leave an image in the library that nothing shows.
  for (const [bundleKey, upload] of creativeImages) {
    if (placedKeys.has(bundleKey)) continue
    const uploaded = await upload.catch(() => null)
    if (uploaded) await appStoreConnect.deleteAssetLibraryImage(uploaded.imageId).catch(() => {})
  }

  return { results, unmapped: plan.unmapped }
}

async function createTargetLocalization(target, locale) {
  if (target.kind === 'experiment') return appStoreConnect.createProductPageTreatmentLocalization(target.treatmentId, locale)
  if (target.kind === 'customProductPage') {
    const version = await appStoreConnect.getEditableCustomProductPageVersion(target.customProductPageId)
    return appStoreConnect.createCustomProductPageLocalization(version.id, locale)
  }
  const version = await appStoreConnect.getEditableVersion(target.appId, target.platform || 'IOS')
  return (await appStoreConnect.createVersionLocalization(version.id, locale, {}))?.data
}

function summary(row) {
  return { storeLocale: row.storeLocale, displayType: row.displayType, files: row.files.length }
}

export function discardBundle(bundleId) {
  fs.rmSync(bundleDir(bundleId), { recursive: true, force: true })
}
