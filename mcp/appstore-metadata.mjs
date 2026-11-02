#!/usr/bin/env node
// Stdio MCP server that lets an agent read, count and fill App Store Connect metadata.
// Registered in .mcp.json; run by hand with: node mcp/appstore-metadata.mjs
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

// stdout carries the JSON-RPC stream, so nothing else may write to it.
console.log = console.error

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
dotenv.config({ path: path.join(root, '.env'), quiet: true })

const { default: appStoreConnect } = await import('../src/lib/appStoreConnect.js')
const { METADATA_LIMITS, checkMetadata, describeViolations, normalizeKeywords } = await import('../src/lib/metadataLimits.js')
const { applyUpload, discardBundle, openBundle, planUpload } = await import('../src/lib/screenshotBundle.js')
const { sortByLocale, sortLocaleEntries } = await import('../src/lib/localeOrder.js')

const SCOPES = Object.keys(METADATA_LIMITS)
const APP_FIELDS = Object.keys(METADATA_LIMITS.app)

const fieldsSchema = (scope) => ({
  type: 'object',
  description: `Fields to write. Only the fields present are changed. Allowed: ${Object.entries(METADATA_LIMITS[scope])
    .map(([field, limit]) => `${field} (max ${limit.max})`)
    .join(', ')}.`,
  properties: Object.fromEntries(Object.keys(METADATA_LIMITS[scope]).map((field) => [field, { type: 'string' }])),
  additionalProperties: false,
})

// Portrait or landscape pixel size -> the App Store Connect slot that accepts it.
const SCREENSHOT_DISPLAY_TYPES = {
  '1320x2868': 'APP_IPHONE_67',
  '1290x2796': 'APP_IPHONE_67',
  '1260x2736': 'APP_IPHONE_67',
  '1284x2778': 'APP_IPHONE_65',
  '1242x2688': 'APP_IPHONE_65',
  '1206x2622': 'APP_IPHONE_61',
  '1179x2556': 'APP_IPHONE_61',
  '1242x2208': 'APP_IPHONE_55',
  '2064x2752': 'APP_IPAD_PRO_3GEN_129',
  '2048x2732': 'APP_IPAD_PRO_3GEN_129',
  '422x514': 'APP_WATCH_ULTRA',
  '410x502': 'APP_WATCH_ULTRA',
}

function readScreenshot(filePath) {
  const buffer = fs.readFileSync(filePath)
  const isPng = buffer.subarray(1, 4).toString('latin1') === 'PNG'
  const size = isPng ? [buffer.readUInt32BE(16), buffer.readUInt32BE(20)] : null
  const key = size ? `${Math.min(...size)}x${Math.max(...size)}` : null
  return { fileName: path.basename(filePath), buffer, size: size ? `${size[0]}x${size[1]}` : null, displayType: SCREENSHOT_DISPLAY_TYPES[key] || null }
}

const dryRunSchema = { type: 'boolean', description: 'Validate and return what would be sent without writing to App Store Connect.' }

function assertWritable(scope, fields) {
  if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
    throw new Error('fields is required and must contain at least one field')
  }

  const check = checkMetadata(fields, scope)
  if (check.unknownFields.length > 0) {
    throw new Error(`Unknown ${scope} fields: ${check.unknownFields.join(', ')}. Allowed: ${Object.keys(METADATA_LIMITS[scope]).join(', ')}`)
  }

  if (!check.ok) {
    throw new Error(`Not written, over the App Store limit: ${describeViolations(check).join('; ')}. Shorten and call count_metadata to confirm.`)
  }

  return check
}

function withCounts(scope, attributes, onlyFields) {
  const fields = {}
  for (const field of Object.keys(METADATA_LIMITS[scope])) {
    if (onlyFields && !onlyFields.includes(field)) {
      continue
    }

    const value = attributes?.[field] ?? ''
    const { count, max } = checkMetadata({ [field]: value }, scope).fields[field]
    fields[field] = { value, count, max }
  }

  return fields
}

const tools = [
  {
    name: 'count_metadata',
    description:
      'Count characters of App Store metadata exactly the way App Store Connect does and compare against each field limit. Never estimate lengths yourself: call this for every draft before writing. Returns count, max, remaining and ok per field; keywords are normalized first (returned as value) and get warnings for repeated words and words already in name/subtitle. No network call.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: SCOPES, description: 'Which limits apply. Default: app.' },
        fields: { type: 'object', description: 'One locale: { name, subtitle, keywords, promotionalText, description, whatsNew }.', additionalProperties: { type: 'string' } },
        locales: { type: 'object', description: 'Many locales at once: { "en-US": { name, ... }, "ja": { ... } }.', additionalProperties: { type: 'object' } },
      },
    },
    async handler({ scope = 'app', fields, locales }) {
      if (locales) {
        const checked = Object.fromEntries(Object.entries(locales).map(([locale, localeFields]) => [locale, checkMetadata(localeFields, scope)]))
        return { scope, ok: Object.values(checked).every((result) => result.ok), locales: checked }
      }

      if (!fields) {
        throw new Error('fields or locales is required')
      }

      return checkMetadata(fields, scope)
    },
  },
  {
    name: 'list_apps',
    description: 'List the apps in the App Store Connect account with their appId, name and bundleId.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const apps = await appStoreConnect.listApps()
      return apps.map((app) => ({ appId: app.id, name: app.attributes?.name, bundleId: app.attributes?.bundleId }))
    },
  },
  {
    name: 'get_app_metadata',
    description:
      'Read the current App Store metadata of an app for every locale, with the character count and limit of each field. meta.editable is false when there is no version in an editable state, in which case only name/subtitle may be writable.',
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string' },
        platform: { type: 'string', enum: ['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS'], description: 'Default: IOS.' },
        locales: { type: 'array', items: { type: 'string' }, description: 'Only return these locales, e.g. ["en-US","ja"]. Default: all.' },
        fields: { type: 'array', items: { type: 'string', enum: APP_FIELDS }, description: 'Only return these fields. Default: all. Descriptions are long, so narrow this when reading many locales.' },
      },
      required: ['appId'],
    },
    async handler({ appId, platform = 'IOS', locales, fields }) {
      const [version, appInfo] = await Promise.all([appStoreConnect.getAppLocalizations(appId, platform), appStoreConnect.getAppInfoLocalizations(appId)])
      const attributesByLocale = {}

      for (const localization of [...version.localizations, ...appInfo.localizations]) {
        const locale = localization?.attributes?.locale
        if (!locale || (locales && !locales.includes(locale))) {
          continue
        }

        attributesByLocale[locale] = { ...attributesByLocale[locale], ...localization.attributes }
      }

      return {
        meta: {
          platform: version.platform,
          versionString: version.versionString,
          appStoreState: version.appStoreState,
          editable: Boolean(version.versionId),
        },
        locales: sortLocaleEntries(Object.fromEntries(Object.entries(attributesByLocale).map(([locale, attributes]) => [locale, withCounts('app', attributes, fields)]))),
      }
    },
  },
  {
    name: 'update_app_metadata',
    description:
      'Write App Store metadata for one locale of an app. Validates every field against its limit first and writes nothing if any field is over. The locale is created if it does not exist yet. This changes the live App Store Connect record, so confirm the final text with the user before calling it without dryRun.',
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string' },
        locale: { type: 'string', description: 'App Store locale code, e.g. en-US, ja, zh-Hans, pt-BR.' },
        platform: { type: 'string', enum: ['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS'], description: 'Default: IOS.' },
        fields: fieldsSchema('app'),
        dryRun: dryRunSchema,
      },
      required: ['appId', 'locale', 'fields'],
    },
    async handler({ appId, locale, platform = 'IOS', fields, dryRun = false }) {
      const check = assertWritable('app', fields)
      const metadata = { ...fields }
      if ('keywords' in metadata) {
        metadata.keywords = normalizeKeywords(metadata.keywords)
      }

      if (!dryRun) {
        await appStoreConnect.updateAppMetadata(appId, locale, metadata, { platform })
      }

      return { written: !dryRun, appId, locale, sent: metadata, counts: check.fields }
    },
  },
  {
    name: 'list_subscriptions',
    description: 'List the auto-renewable subscriptions of an app with their subscriptionId, productId, state and subscription group.',
    inputSchema: { type: 'object', properties: { appId: { type: 'string' } }, required: ['appId'] },
    async handler({ appId }) {
      const subscriptions = await appStoreConnect.listAppSubscriptions(appId)
      return subscriptions.map((subscription) => ({
        subscriptionId: subscription.id,
        ...subscription.attributes,
        subscriptionGroupId: subscription.subscriptionGroup.id,
        subscriptionGroupName: subscription.subscriptionGroup.referenceName,
      }))
    },
  },
  {
    name: 'get_subscription_metadata',
    description: 'Read the localized display name/description of a subscription, or the localized name/customAppName of a subscription group, with character counts and limits.',
    inputSchema: {
      type: 'object',
      properties: {
        subscriptionId: { type: 'string' },
        subscriptionGroupId: { type: 'string', description: 'Pass this instead of subscriptionId to read the group localizations.' },
      },
    },
    async handler({ subscriptionId, subscriptionGroupId }) {
      if (!subscriptionId && !subscriptionGroupId) {
        throw new Error('subscriptionId or subscriptionGroupId is required')
      }

      const scope = subscriptionId ? 'subscription' : 'subscriptionGroup'
      const localizations = subscriptionId
        ? await appStoreConnect.getSubscriptionLocalizations(subscriptionId)
        : await appStoreConnect.getSubscriptionGroupLocalizations(subscriptionGroupId)

      return {
        scope,
        locales: Object.fromEntries(sortByLocale(localizations).map((localization) => [localization.attributes?.locale, withCounts(scope, localization.attributes)])),
      }
    },
  },
  {
    name: 'update_subscription_metadata',
    description:
      'Write the localized display name/description of one subscription for one locale. Validated against the limits first; nothing is written if a field is over. Changes the live App Store Connect record, so confirm with the user first.',
    inputSchema: {
      type: 'object',
      properties: { subscriptionId: { type: 'string' }, locale: { type: 'string' }, fields: fieldsSchema('subscription'), dryRun: dryRunSchema },
      required: ['subscriptionId', 'locale', 'fields'],
    },
    async handler({ subscriptionId, locale, fields, dryRun = false }) {
      const check = assertWritable('subscription', fields)
      if (!dryRun) {
        await appStoreConnect.updateSubscriptionMetadata(subscriptionId, locale, fields)
      }

      return { written: !dryRun, subscriptionId, locale, sent: fields, counts: check.fields }
    },
  },
  {
    name: 'update_subscription_group_metadata',
    description:
      'Write the localized name/customAppName of one subscription group for one locale. Validated against the limits first; nothing is written if a field is over. Changes the live App Store Connect record, so confirm with the user first.',
    inputSchema: {
      type: 'object',
      properties: { subscriptionGroupId: { type: 'string' }, locale: { type: 'string' }, fields: fieldsSchema('subscriptionGroup'), dryRun: dryRunSchema },
      required: ['subscriptionGroupId', 'locale', 'fields'],
    },
    async handler({ subscriptionGroupId, locale, fields, dryRun = false }) {
      const check = assertWritable('subscriptionGroup', fields)
      if (!dryRun) {
        await appStoreConnect.updateSubscriptionGroupMetadata(subscriptionGroupId, locale, fields)
      }

      return { written: !dryRun, subscriptionGroupId, locale, sent: fields, counts: check.fields }
    },
  },
  {
    name: 'get_app_screenshots',
    description:
      'List the screenshots of an app per locale and display type (e.g. APP_IPHONE_67), in display order, with each file name and delivery state. meta.editable is false when there is no version in an editable state.',
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string' },
        platform: { type: 'string', enum: ['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS'], description: 'Default: IOS.' },
        locales: { type: 'array', items: { type: 'string' }, description: 'Only return these locales. Default: all.' },
      },
      required: ['appId'],
    },
    async handler({ appId, platform = 'IOS', locales }) {
      const result = await appStoreConnect.getAppScreenshots(appId, platform)
      const byLocale = {}

      for (const localization of result.localizations) {
        const locale = localization?.attributes?.locale
        if (!locale || (locales && !locales.includes(locale))) {
          continue
        }

        byLocale[locale] = Object.fromEntries(
          localization.appScreenshotSets.map((screenshotSet) => [
            screenshotSet.attributes?.screenshotDisplayType,
            screenshotSet.appScreenshots.map((screenshot) => ({
              id: screenshot.id,
              fileName: screenshot.attributes?.fileName,
              size: `${screenshot.attributes?.imageAsset?.width}x${screenshot.attributes?.imageAsset?.height}`,
              state: screenshot.attributes?.assetDeliveryState?.state,
            })),
          ])
        )
      }

      return {
        meta: { platform: result.platform, versionString: result.versionString, appStoreState: result.appStoreState, editable: Boolean(result.versionId) },
        locales: sortLocaleEntries(byLocale),
      }
    },
  },
  {
    name: 'upload_app_screenshots',
    description:
      'Upload screenshot files, in the order given, to one locale and display type of the editable app version. displayType is inferred from the PNG pixel size when omitted. With replace the existing screenshots of that set are deleted first; without it the files are appended. This changes the live App Store Connect record, so run with dryRun first and confirm with the user before replacing.',
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string' },
        locale: { type: 'string', description: 'App Store locale code, e.g. en-US, ja, zh-Hans, pt-BR.' },
        files: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of the screenshots, in display order (max 10 per set).' },
        displayType: { type: 'string', description: 'App Store Connect screenshotDisplayType, e.g. APP_IPHONE_67 (6.9"), APP_IPHONE_65 (6.5"). Default: inferred from the image size.' },
        platform: { type: 'string', enum: ['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS'], description: 'Default: IOS.' },
        replace: { type: 'boolean', description: 'Delete the screenshots already in this set before uploading. Default: false.' },
        dryRun: dryRunSchema,
      },
      required: ['appId', 'locale', 'files'],
    },
    async handler({ appId, locale, files, displayType, platform = 'IOS', replace = false, dryRun = false }) {
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error('files is required and must contain at least one path')
      }
      if (files.length > 10) {
        throw new Error(`A screenshot set holds at most 10 screenshots, got ${files.length}`)
      }

      const screenshots = files.map(readScreenshot)
      const inferred = [...new Set(screenshots.map((screenshot) => screenshot.displayType))]
      const screenshotDisplayType = displayType || (inferred.length === 1 ? inferred[0] : null)
      if (!screenshotDisplayType) {
        throw new Error(`Could not infer one displayType from the image sizes (${screenshots.map((screenshot) => screenshot.size).join(', ')}). Pass displayType.`)
      }

      const summary = { appId, locale, displayType: screenshotDisplayType, replace, files: screenshots.map(({ fileName, size }) => ({ fileName, size })) }
      if (dryRun) {
        return { written: false, ...summary }
      }

      const result = await appStoreConnect.uploadAppScreenshotsForLocale(appId, locale, screenshotDisplayType, screenshots, { platform, replace })
      return {
        written: true,
        ...summary,
        versionString: result.appStoreVersion?.attributes?.versionString,
        deleted: result.deleted,
        uploaded: result.appScreenshots.map((screenshot) => ({ id: screenshot.id, fileName: screenshot.attributes?.fileName, state: screenshot.attributes?.assetDeliveryState?.state })),
      }
    },
  },
  {
    name: 'list_product_page_experiments',
    description: 'List the Product Page Optimization tests of an app with their state. Pass experimentId to list that test\'s treatments and the locales each already has.',
    inputSchema: { type: 'object', properties: { appId: { type: 'string' }, experimentId: { type: 'string' } }, required: ['appId'] },
    async handler({ appId, experimentId }) {
      if (experimentId) {
        const treatments = await appStoreConnect.getProductPageTreatments(experimentId)
        return treatments.map((treatment) => ({ treatmentId: treatment.id, name: treatment.attributes?.name, locales: sortByLocale(treatment.localizations).map((item) => item.attributes?.locale) }))
      }

      const experiments = await appStoreConnect.listProductPageExperiments(appId)
      return experiments.map((experiment) => ({ experimentId: experiment.id, ...experiment.attributes }))
    },
  },
  {
    name: 'list_custom_product_pages',
    description: 'List the Custom Product Pages of an app: name, URL, visibility, the state of the latest version, whether a version is editable, and the locales the editable version has.',
    inputSchema: { type: 'object', properties: { appId: { type: 'string' } }, required: ['appId'] },
    async handler({ appId }) {
      const pages = await appStoreConnect.listCustomProductPages(appId)
      return pages.map((page) => ({
        customProductPageId: page.id,
        name: page.attributes?.name,
        url: page.attributes?.url,
        visible: page.attributes?.visible,
        state: page.editableVersion?.attributes?.state || page.latestVersion?.attributes?.state || null,
        editable: Boolean(page.editableVersion),
        deepLink: page.editableVersion?.attributes?.deepLink || null,
        locales: sortByLocale(page.localizations).map((item) => ({ locale: item.attributes?.locale, promotionalText: item.attributes?.promotionalText || null })),
      }))
    },
  },
  {
    name: 'create_custom_product_page',
    description:
      'Create a Custom Product Page (name up to 50 characters) with its first version. copyFromVersion starts it from the editable App Store version\'s product page; templatePageId copies another Custom Product Page. Then upload screenshots with upload_screenshot_bundle and customProductPageId. Creates a record in App Store Connect: confirm the name with the user first.',
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string' },
        name: { type: 'string' },
        deepLink: { type: 'string', description: 'Optional URL the page opens in the app.' },
        localizations: {
          type: 'array',
          description: 'Optional locales to create now, e.g. [{ "locale": "en-US", "promotionalText": "…" }]. Uploads create missing locales on their own.',
          items: { type: 'object', properties: { locale: { type: 'string' }, promotionalText: { type: 'string' } }, required: ['locale'] },
        },
        copyFromVersion: { type: 'boolean', description: 'Start from the current product page. Default false.' },
        templatePageId: { type: 'string', description: 'Start from this Custom Product Page instead.' },
        dryRun: dryRunSchema,
      },
      required: ['appId', 'name'],
    },
    async handler({ appId, name, deepLink, localizations = [], copyFromVersion = false, templatePageId, dryRun = false }) {
      if (!name?.trim() || name.trim().length > 50) throw new Error('name must be 1–50 characters')
      let template
      if (templatePageId) template = { pageId: templatePageId }
      else if (copyFromVersion) {
        const version = await appStoreConnect.getEditableVersion(appId, 'IOS')
        if (!version?.id) throw new Error('No App Store version to copy from')
        template = { versionId: version.id }
      }
      if (dryRun) return { written: false, name: name.trim(), deepLink: deepLink || null, localizations, template: template || null }
      const page = await appStoreConnect.createCustomProductPage(appId, { name, deepLink, localizations, template })
      return { written: true, customProductPageId: page?.id, name: page?.attributes?.name }
    },
  },
  {
    name: 'create_custom_product_page_version',
    description: 'Start a new editable version of a Custom Product Page that is live, approved or in review, so its screenshots can be changed. App Store Connect copies the current content into it. Creates a record: confirm first.',
    inputSchema: {
      type: 'object',
      properties: { customProductPageId: { type: 'string' }, deepLink: { type: 'string' }, dryRun: dryRunSchema },
      required: ['customProductPageId'],
    },
    async handler({ customProductPageId, deepLink, dryRun = false }) {
      if (dryRun) return { written: false, customProductPageId, deepLink: deepLink || null }
      const version = await appStoreConnect.createCustomProductPageVersion(customProductPageId, deepLink)
      return { written: true, customProductPageId, versionId: version?.id, state: version?.attributes?.state }
    },
  },
  {
    name: 'upload_screenshot_bundle',
    description:
      'Upload the screenshot editor\'s export (the zip, or its unzipped folder: <platform>/<device>/<size>/<locale>/*.png) to the editable App Store version, to a Product Page Optimization treatment when treatmentId is given, or to a Custom Product Page\'s editable version when customProductPageId is given. Slots are inferred from device and size; the creative-header and creative-search folders become the iOS 27 product page header and search results creative assets (one image per locale, placed through the App Asset Library). Each exported language goes to the matching store locales unless localeMap overrides it. Slots that already hold screenshots are skipped unless replace is true, which deletes them first. Changes the live App Store Connect record: call with dryRun first, show the plan, and confirm before replacing.',
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string' },
        path: { type: 'string', description: 'Absolute path of the export zip or unzipped folder.' },
        treatmentId: { type: 'string', description: 'Upload to this Product Page Optimization treatment instead of the app version.' },
        customProductPageId: { type: 'string', description: 'Upload to this Custom Product Page instead of the app version.' },
        localeMap: { type: 'object', description: 'Exported language -> store locales, e.g. { "en": ["en-US","en-GB"], "es": ["es-MX"] }. Default: matched by language.', additionalProperties: { type: 'array', items: { type: 'string' } } },
        displayTypes: { type: 'array', items: { type: 'string' }, description: 'Only these slots, e.g. ["APP_IPHONE_67","APP_IPHONE_65"]. Default: every slot in the bundle.' },
        replace: { type: 'boolean', description: 'Delete the screenshots already in a slot before uploading. Default: false (such slots are skipped).' },
        dryRun: dryRunSchema,
      },
      required: ['appId', 'path'],
    },
    async handler({ appId, path: bundlePath, treatmentId, customProductPageId, localeMap, displayTypes, replace = false, dryRun = false }) {
      const target = treatmentId
        ? { kind: 'experiment', appId, treatmentId }
        : customProductPageId
          ? { kind: 'customProductPage', appId, customProductPageId }
          : { kind: 'version', appId }
      const { bundleId } = await openBundle(bundlePath)
      try {
        if (dryRun) {
          const plan = await planUpload(bundleId, target, { localeMap, displayTypes })
          return {
            written: false,
            localeMap: plan.localeMap,
            unmapped: plan.unmapped,
            rows: plan.rows.map((row) => ({ storeLocale: row.storeLocale, displayType: row.displayType, files: row.files.length, existing: row.existing, newLocale: !row.localizationId })),
          }
        }

        return { written: true, ...(await applyUpload(bundleId, target, { localeMap, displayTypes, replace })) }
      } finally {
        discardBundle(bundleId)
      }
    },
  },
]

async function callTool({ name, arguments: args = {} }) {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }

  try {
    const result = await tool.handler(args)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }
  }
}

async function handle(message) {
  switch (message.method) {
    case 'initialize':
      return {
        protocolVersion: message.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'appstore-metadata', version: '1.0.0' },
        instructions:
          'Fill App Store Connect metadata. Read with get_app_metadata, draft, check every draft with count_metadata, then write with update_app_metadata. Never count characters yourself. Screenshots: read with get_app_screenshots, write single sets with upload_app_screenshots or a whole editor export with upload_screenshot_bundle (dryRun first). Custom Product Pages: list_custom_product_pages, create_custom_product_page, then upload_screenshot_bundle with customProductPageId.',
      }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }
    case 'tools/call':
      return callTool(message.params || {})
    default:
      throw Object.assign(new Error(`Method not found: ${message.method}`), { code: -32601 })
  }
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

const pending = new Set()

readline
  .createInterface({ input: process.stdin })
  .on('line', (line) => {
    if (!line.trim()) {
      return
    }

    let message
    try {
      message = JSON.parse(line)
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }

    // Notifications carry no id and get no reply.
    if (message.id === undefined || message.id === null) {
      return
    }

    const task = handle(message)
      .then((result) => send({ jsonrpc: '2.0', id: message.id, result }))
      .catch((error) => send({ jsonrpc: '2.0', id: message.id, error: { code: error.code || -32603, message: error.message } }))
      .finally(() => pending.delete(task))
    pending.add(task)
  })
  .on('close', async () => {
    await Promise.allSettled(pending)
    process.exit(0)
  })
