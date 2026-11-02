import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import jwt from 'jsonwebtoken'

const API_BASE = 'https://api.appstoreconnect.apple.com/v1'
// Sales report Product Type Identifiers: first-time app downloads vs. redownloads (updates and IAPs are excluded).
const DOWNLOAD_PRODUCT_TYPES = new Set(['1', '1F', '1T', 'F1', '1E', '1EP', '1EU'])
const REDOWNLOAD_PRODUCT_TYPES = new Set(['3', '3F', '3T', 'F3'])
const REFERRER_SOURCE_TYPES = new Set(['app referrer', 'web referrer'])
const EDITABLE_APP_STORE_STATES = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'WAITING_FOR_REVIEW', 'INVALID_BINARY']
const EDITABLE_CPP_STATES = new Set(['PREPARE_FOR_SUBMISSION', 'REJECTED'])
const APP_CLIP_LOCALIZATION_CREATE_STATES =['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY']

function secondsToPreviewFrameTimeCode(value) {
  const seconds = Number(value || 0)
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const totalFrames = Math.round(safeSeconds * 30)
  const totalSeconds = Math.floor(totalFrames / 30)
  const frames = totalFrames % 30
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60

  return [hours, minutes, remainingSeconds, frames]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

function normalizePreviewFrameTimeCode(value) {
  const rawValue = String(value || '').trim()
  if (!rawValue) {
    return ''
  }

  if (/^\d+(\.\d+)?$/.test(rawValue)) {
    return secondsToPreviewFrameTimeCode(rawValue)
  }

  const parts = rawValue.split(':')
  if (parts.length === 2) {
    return `00:${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`
  }

  if (parts.length === 3) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}:00`
  }

  if (parts.length === 4) {
    return parts.map((part) => part.padStart(2, '0')).join(':')
  }

  return rawValue
}

function getLocalizationExperienceId(localization) {
  return localization?.relationships?.appClipDefaultExperience?.data?.id || localization?.appClipDefaultExperience?.id || ''
}

function getExperienceCreatedAt(defaultExperience) {
  const value = defaultExperience?.releaseWithAppStoreVersion?.attributes?.createdDate
  const timestamp = value ? new Date(value).getTime() : 0
  return Number.isFinite(timestamp) ? timestamp : 0
}

function buildRegionNameToCode() {
  const names = new Map()
  const displayNames = new Intl.DisplayNames(['en'], { type: 'region' })
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second)
      try {
        const name = displayNames.of(code)
        if (name && name !== code) {
          names.set(name.toLowerCase(), code)
        }
      } catch {
        // Not a valid region code.
      }
    }
  }
  return names
}

let regionNameToCode = null

// Analytics reports label territories by name or code depending on the report; normalize to ISO codes to match other sources.
function toTerritoryCode(territory) {
  const value = String(territory || '').trim()
  if (/^[A-Z]{2}$/.test(value)) {
    return value
  }
  regionNameToCode = regionNameToCode || buildRegionNameToCode()
  return regionNameToCode.get(value.toLowerCase()) || value || 'Unknown'
}

function parseDelimited(text) {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  const delimiter = firstLine.includes('\t') ? '\t' : ','
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
    } else if (char === '"' && field === '') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1
      }
      row.push(field)
      field = ''
      if (row.some((value) => value !== '')) {
        rows.push(row)
      }
      row = []
    } else {
      field += char
    }
  }

  row.push(field)
  if (row.some((value) => value !== '')) {
    rows.push(row)
  }

  const [headers = [], ...records] = rows
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header.trim(), (record[index] || '').trim()])))
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().split('T')[0]
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = []
  for (let index = 0; index < items.length; index += concurrency) {
    results.push(...(await Promise.all(items.slice(index, index + concurrency).map(mapper))))
  }
  return results
}

class AppStoreConnectClient {
  constructor() {
    this.issuerId = process.env.APP_STORE_ISSUER_ID
    this.keyId = process.env.APP_STORE_KEY_ID
    this.privateKeyPath = process.env.APP_STORE_PRIVATE_KEY_PATH
    this.debug = String(process.env.APP_STORE_CONNECT_DEBUG || '').toLowerCase() === 'true'
    this.debugMaxChars = Number(process.env.APP_STORE_CONNECT_DEBUG_MAX_CHARS || 4000)
    this.token = null
    this.tokenExpiry = null
    this.salesReportCache = new Map()
    this.analyticsInstanceCache = new Map()
    this.analyticsListCache = new Map()
  }

  debugLog(label, payload) {
    if (!this.debug) {
      return
    }

    try {
      const serialized = JSON.stringify(payload)
      const limited = serialized.length > this.debugMaxChars ? `${serialized.slice(0, this.debugMaxChars)}...<truncated>` : serialized
      console.log(`[ASC DEBUG] ${label}: ${limited}`)
    } catch {
      console.log(`[ASC DEBUG] ${label}: <unserializable payload>`)
    }
  }

  loadPrivateKey() {
    const keyPath = path.resolve(this.privateKeyPath || '')
    if (!fs.existsSync(keyPath)) {
      throw new Error(`App Store private key not found: ${keyPath}`)
    }
    return fs.readFileSync(keyPath, 'utf8')
  }

  generateJWT() {
    const privateKey = this.loadPrivateKey()
    const now = Math.floor(Date.now() / 1000)
    const exp = now + 10 * 60 // 10 minutes

    const payload = {
      iss: this.issuerId,
      iat: now,
      exp,
      aud: 'appstoreconnect-v1',
    }

    const token = jwt.sign(payload, privateKey, {
      algorithm: 'ES256',
      header: { alg: 'ES256', kid: this.keyId },
    })

    this.token = token
    this.tokenExpiry = new Date(exp * 1000)
    return token
  }

  getToken() {
    if (this.token && this.tokenExpiry && this.tokenExpiry > new Date(Date.now() + 60 * 1000)) {
      return this.token
    }
    return this.generateJWT()
  }

  async request(method, endpoint, data = null) {
    const token = this.getToken()
    const url = String(endpoint || '').startsWith('http') ? endpoint : `${API_BASE}${endpoint}`
    this.debugLog('request', {
      method,
      endpoint,
      url,
      hasBody: Boolean(data),
      body: data,
    })

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: data ? JSON.stringify(data) : undefined,
    })

    const responseData = await res.json().catch(() => null)
    this.debugLog('response', {
      method,
      endpoint,
      status: res.status,
      ok: res.ok,
      data: responseData,
    })

    if (!res.ok) {
      throw new Error(`App Store Connect API Error: ${res.status} - ${JSON.stringify(responseData)}`)
    }

    return responseData
  }

  async requestAllWithOffset(endpointBuilder, pageLimit = 200) {
    const allItems = []
    const seenIds = new Set()
    let endpoint = endpointBuilder({ limit: pageLimit })
    let page = 0

    while (endpoint && page < 100) {
      const response = await this.request('GET', endpoint)
      const items = Array.isArray(response?.data) ? response.data : []

      if (items.length === 0) {
        break
      }

      let newItemsCount = 0
      for (const item of items) {
        const itemId = item?.id
        if (itemId && seenIds.has(itemId)) {
          continue
        }

        if (itemId) {
          seenIds.add(itemId)
        }

        allItems.push(item)
        newItemsCount += 1
      }

      if (items.length < pageLimit || newItemsCount === 0) {
        endpoint = response?.links?.next || null
        if (!endpoint) {
          break
        }
        page += 1
        continue
      }

      endpoint = response?.links?.next || null
      page += 1
    }

    return allItems
  }

  async listApps() {
    return this.requestAllWithOffset(({ limit }) => `/apps?fields[apps]=name,bundleId&limit=${limit}`, 200)
  }

  async getAppInfo(appId) {
    const infos = await this.requestAllWithOffset(({ limit }) => `/apps/${appId}/appInfos?fields[appInfos]=appStoreState&limit=${limit}`, 50)
    if (infos.length === 0) {
      return null
    }

    return infos.find((info) => EDITABLE_APP_STORE_STATES.includes(info?.attributes?.appStoreState)) || infos[0]
  }

  // Returns the most recent version that is still editable (metadata can be changed)
  async getEditableVersion(appId, platform = null, states = EDITABLE_APP_STORE_STATES) {
    const stateFilter = encodeURIComponent(states.join(','))
    const platformFilter = platform ? `&filter[platform]=${encodeURIComponent(platform)}` : ''
    const versions = await this.requestAllWithOffset(
      ({ limit }) =>
        `/apps/${appId}/appStoreVersions?filter[appStoreState]=${stateFilter}${platformFilter}&fields[appStoreVersions]=platform,appStoreState,versionString,createdDate&limit=${limit}`,
      200
    )
    if (versions.length === 0) {
      return null
    }

    versions.sort((a, b) => {
      const aDate = new Date(a?.attributes?.createdDate || 0).getTime()
      const bDate = new Date(b?.attributes?.createdDate || 0).getTime()
      return bDate - aDate
    })

    return versions[0]
  }

  async getAppClipLocalizationVersion(appId, platform = null) {
    return this.getEditableVersion(appId, platform, APP_CLIP_LOCALIZATION_CREATE_STATES)
  }

  async getLatestVersion(appId, platform = null) {
    const platformFilter = platform ? `&filter[platform]=${encodeURIComponent(platform)}` : ''
    const versions = await this.requestAllWithOffset(
      ({ limit }) =>
        `/apps/${appId}/appStoreVersions?fields[appStoreVersions]=platform,appStoreState,versionString,createdDate${platformFilter}&limit=${limit}`,
      200
    )
    if (versions.length === 0) {
      return null
    }

    versions.sort((a, b) => {
      const aDate = new Date(a?.attributes?.createdDate || 0).getTime()
      const bDate = new Date(b?.attributes?.createdDate || 0).getTime()
      return bDate - aDate
    })

    return versions[0]
  }

  // Returns { versionId, versionString, appStoreState, localizations[] }
  async getAppLocalizations(appId, platform = null) {
    if (!appId) throw new Error('appId is required')

    const editableVersion = await this.getEditableVersion(appId, platform)
    const version = editableVersion || (await this.getLatestVersion(appId, platform))
    if (!version) {
      return { versionId: null, versionString: null, appStoreState: null, platform: platform || null, localizations: [] }
    }

    const localizations = await this.requestAllWithOffset(
      ({ limit }) =>
        `/appStoreVersions/${version.id}/appStoreVersionLocalizations?fields[appStoreVersionLocalizations]=locale,keywords,description,promotionalText,whatsNew,supportUrl,marketingUrl&limit=${limit}`,
      50
    )

    return {
      versionId: editableVersion?.id || null,
      versionString: version.attributes?.versionString || null,
      appStoreState: version.attributes?.appStoreState || null,
      platform: version.attributes?.platform || platform || null,
      localizations,
    }
  }

  async getAppStoreVersionLocalizations(versionId) {
    if (!versionId) throw new Error('versionId is required')

    return this.requestAllWithOffset(
      ({ limit }) => `/appStoreVersions/${versionId}/appStoreVersionLocalizations?fields[appStoreVersionLocalizations]=locale&limit=${limit}`,
      200
    )
  }

  async getAppPreviewSetsForLocalization(localizationId) {
    if (!localizationId) throw new Error('localizationId is required')

    const response = await this.request(
      'GET',
      `/appStoreVersionLocalizations/${localizationId}/appPreviewSets?include=appPreviews&limit=200&limit[appPreviews]=50`
    )
    const includedPreviewsById = new Map((response?.included || []).filter((item) => item?.type === 'appPreviews' && item?.id).map((item) => [item.id, item]))

    const previewSets = []
    for (const previewSet of response?.data || []) {
      const relationshipPreviewIds = (previewSet?.relationships?.appPreviews?.data || []).map((item) => item?.id).filter(Boolean)
      let appPreviews = relationshipPreviewIds.map((previewId) => includedPreviewsById.get(previewId)).filter(Boolean)

      if (relationshipPreviewIds.length > 0 && appPreviews.length !== relationshipPreviewIds.length) {
        appPreviews = await this.getAppPreviewsForSet(previewSet.id)
      }

      previewSets.push({
        ...previewSet,
        appPreviews,
      })
    }

    return previewSets
  }

  async getAppPreviewsForSet(appPreviewSetId) {
    if (!appPreviewSetId) throw new Error('appPreviewSetId is required')

    return this.requestAllWithOffset(({ limit }) => `/appPreviewSets/${appPreviewSetId}/appPreviews?limit=${limit}`, 50)
  }

  async getAppPreviews(appId, platform = null) {
    if (!appId) throw new Error('appId is required')

    const editableVersion = await this.getEditableVersion(appId, platform)
    const version = editableVersion || (await this.getLatestVersion(appId, platform))
    if (!version) {
      return { versionId: null, sourceVersionId: null, versionString: null, appStoreState: null, platform: platform || null, localizations: [] }
    }

    const localizations = await this.getAppStoreVersionLocalizations(version.id)
    const localizationsWithPreviews = []

    for (const localization of localizations) {
      const appPreviewSets = await this.getAppPreviewSetsForLocalization(localization.id)
      localizationsWithPreviews.push({
        ...localization,
        appPreviewSets,
      })
    }

    return {
      versionId: editableVersion?.id || null,
      sourceVersionId: version.id,
      versionString: version.attributes?.versionString || null,
      appStoreState: version.attributes?.appStoreState || null,
      platform: version.attributes?.platform || platform || null,
      localizations: localizationsWithPreviews,
    }
  }

  async getOrCreateAppPreviewSet(localizationId, previewType) {
    if (!localizationId) throw new Error('localizationId is required')
    if (!previewType) throw new Error('previewType is required')

    const previewSets = await this.getAppPreviewSetsForLocalization(localizationId)
    const existingPreviewSet = previewSets.find((previewSet) => previewSet?.attributes?.previewType === previewType)
    if (existingPreviewSet) {
      return existingPreviewSet
    }

    const response = await this.request('POST', '/appPreviewSets', {
      data: {
        type: 'appPreviewSets',
        attributes: {
          previewType,
        },
        relationships: {
          appStoreVersionLocalization: {
            data: {
              type: 'appStoreVersionLocalizations',
              id: localizationId,
            },
          },
        },
      },
    })

    return response?.data || null
  }

  async createAppPreview(appPreviewSetId, { fileName, fileSize, previewFrameTimeCode }) {
    if (!appPreviewSetId) throw new Error('appPreviewSetId is required')
    if (!fileName || !fileSize) throw new Error('fileName and fileSize are required')

    const attributes = {
      fileName,
      fileSize,
    }
    const normalizedFrameTimeCode = normalizePreviewFrameTimeCode(previewFrameTimeCode)
    if (normalizedFrameTimeCode) {
      attributes.previewFrameTimeCode = normalizedFrameTimeCode
    }

    return this.request('POST', '/appPreviews', {
      data: {
        type: 'appPreviews',
        attributes,
        relationships: {
          appPreviewSet: {
            data: {
              type: 'appPreviewSets',
              id: appPreviewSetId,
            },
          },
        },
      },
    })
  }

  async uploadAppPreview(appPreview, videoBuffer) {
    const uploadOperations = appPreview?.attributes?.uploadOperations || []
    if (uploadOperations.length === 0) {
      throw new Error('App preview upload operation is unavailable')
    }

    for (const operation of uploadOperations) {
      const offset = Number(operation.offset || 0)
      const length = Number(operation.length || videoBuffer.byteLength)
      const chunk = videoBuffer.slice(offset, offset + length)
      const headers = {}

      for (const header of operation.requestHeaders || []) {
        if (header?.name && header?.value !== undefined) {
          headers[header.name] = header.value
        }
      }

      const response = await fetch(operation.url, {
        method: operation.method || 'PUT',
        headers,
        body: chunk,
      })

      if (!response.ok) {
        throw new Error(`App preview upload failed: ${response.status}`)
      }
    }

    return this.request('PATCH', `/appPreviews/${appPreview.id}`, {
      data: {
        type: 'appPreviews',
        id: appPreview.id,
        attributes: {
          uploaded: true,
        },
      },
    })
  }

  async updateAppPreviewCoverFrame(appPreviewId, previewFrameTimeCode) {
    if (!appPreviewId) throw new Error('appPreviewId is required')

    const normalizedFrameTimeCode = normalizePreviewFrameTimeCode(previewFrameTimeCode)
    if (!normalizedFrameTimeCode) {
      throw new Error('previewFrameTimeCode is required')
    }

    return this.request('PATCH', `/appPreviews/${appPreviewId}`, {
      data: {
        type: 'appPreviews',
        id: appPreviewId,
        attributes: {
          previewFrameTimeCode: normalizedFrameTimeCode,
        },
      },
    })
  }

  async uploadAppPreviewForLocale(appId, locale, previewType, videoBuffer, options = {}) {
    if (!appId) throw new Error('appId is required')
    if (!locale) throw new Error('locale is required')
    if (!previewType) throw new Error('previewType is required')
    if (!videoBuffer?.byteLength) throw new Error('video file is required')

    const { platform = null, fileName = 'app-preview.mov', fileSize = videoBuffer.byteLength, previewFrameTimeCode = '' } = options
    const editableVersion = await this.getEditableVersion(appId, platform)

    if (!editableVersion?.id) {
      const platformLabel = platform ? ` for platform ${platform}` : ''
      throw new Error(`No editable App Store version found${platformLabel}. Create or open a version in Prepare for Submission before uploading app previews.`)
    }

    let localizations = await this.getAppStoreVersionLocalizations(editableVersion.id)
    let localization = localizations.find((item) => item?.attributes?.locale === locale)

    if (!localization) {
      localization = (await this.createVersionLocalization(editableVersion.id, locale, {}))?.data || null
      localizations = localization ? [...localizations, localization] : localizations
    }

    if (!localization?.id) {
      throw new Error(`No App Store version localization found for ${locale}.`)
    }

    const appPreviewSet = await this.getOrCreateAppPreviewSet(localization.id, previewType)
    if (!appPreviewSet?.id) {
      throw new Error(`Could not create app preview set for ${locale} (${previewType}).`)
    }

    const reservedPreview = await this.createAppPreview(appPreviewSet.id, {
      fileName,
      fileSize,
      previewFrameTimeCode,
    })
    const uploadedPreview = await this.uploadAppPreview(reservedPreview?.data, videoBuffer)

    return {
      appStoreVersion: editableVersion,
      localization,
      appPreviewSet,
      appPreview: uploadedPreview?.data || reservedPreview?.data || null,
    }
  }

  // `owner` is the resource the sets hang off: a version localization, or a
  // Product Page Optimization treatment localization.
  async getAppScreenshotSetsForLocalization(localizationId, owner = 'appStoreVersionLocalizations') {
    if (!localizationId) throw new Error('localizationId is required')

    const screenshotSets = await this.requestAllWithOffset(
      ({ limit }) => `/${owner}/${localizationId}/appScreenshotSets?fields[appScreenshotSets]=screenshotDisplayType&limit=${limit}`,
      50
    )

    return Promise.all(
      screenshotSets.map(async (screenshotSet) => ({
        ...screenshotSet,
        appScreenshots: await this.getAppScreenshotsForSet(screenshotSet.id),
      }))
    )
  }

  // Returned in display order.
  async getAppScreenshotsForSet(appScreenshotSetId) {
    if (!appScreenshotSetId) throw new Error('appScreenshotSetId is required')

    return this.requestAllWithOffset(
      ({ limit }) => `/appScreenshotSets/${appScreenshotSetId}/appScreenshots?fields[appScreenshots]=fileName,fileSize,imageAsset,assetDeliveryState&limit=${limit}`,
      50
    )
  }

  async getAppScreenshots(appId, platform = null) {
    if (!appId) throw new Error('appId is required')

    const editableVersion = await this.getEditableVersion(appId, platform)
    const version = editableVersion || (await this.getLatestVersion(appId, platform))
    if (!version) {
      return { versionId: null, sourceVersionId: null, versionString: null, appStoreState: null, platform: platform || null, localizations: [] }
    }

    const localizations = await this.getAppStoreVersionLocalizations(version.id)
    const localizationsWithScreenshots = await mapWithConcurrency(localizations, 4, async (localization) => ({
      ...localization,
      appScreenshotSets: await this.getAppScreenshotSetsForLocalization(localization.id),
    }))

    return {
      versionId: editableVersion?.id || null,
      sourceVersionId: version.id,
      versionString: version.attributes?.versionString || null,
      appStoreState: version.attributes?.appStoreState || null,
      platform: version.attributes?.platform || platform || null,
      localizations: localizationsWithScreenshots,
    }
  }

  async getOrCreateAppScreenshotSet(localizationId, screenshotDisplayType, owner = 'appStoreVersionLocalizations') {
    if (!localizationId) throw new Error('localizationId is required')
    if (!screenshotDisplayType) throw new Error('screenshotDisplayType is required')

    const screenshotSets = await this.getAppScreenshotSetsForLocalization(localizationId, owner)
    const existingScreenshotSet = screenshotSets.find((screenshotSet) => screenshotSet?.attributes?.screenshotDisplayType === screenshotDisplayType)
    if (existingScreenshotSet) {
      return existingScreenshotSet
    }

    const response = await this.request('POST', '/appScreenshotSets', {
      data: {
        type: 'appScreenshotSets',
        attributes: {
          screenshotDisplayType,
        },
        relationships: {
          // The relationship is the singular of the owner's resource type.
          [owner.slice(0, -1)]: {
            data: {
              type: owner,
              id: localizationId,
            },
          },
        },
      },
    })

    return response?.data ? { ...response.data, appScreenshots: [] } : null
  }

  async createAppScreenshot(appScreenshotSetId, { fileName, fileSize }) {
    if (!appScreenshotSetId) throw new Error('appScreenshotSetId is required')
    if (!fileName || !fileSize) throw new Error('fileName and fileSize are required')

    return this.request('POST', '/appScreenshots', {
      data: {
        type: 'appScreenshots',
        attributes: {
          fileName,
          fileSize,
        },
        relationships: {
          appScreenshotSet: {
            data: {
              type: 'appScreenshotSets',
              id: appScreenshotSetId,
            },
          },
        },
      },
    })
  }

  async uploadAppScreenshot(appScreenshot, imageBuffer) {
    const uploadOperations = appScreenshot?.attributes?.uploadOperations || []
    if (uploadOperations.length === 0) {
      throw new Error('App screenshot upload operation is unavailable')
    }

    for (const operation of uploadOperations) {
      const offset = Number(operation.offset || 0)
      const length = Number(operation.length || imageBuffer.byteLength)
      const chunk = imageBuffer.slice(offset, offset + length)
      const headers = {}

      for (const header of operation.requestHeaders || []) {
        if (header?.name && header?.value !== undefined) {
          headers[header.name] = header.value
        }
      }

      const response = await fetch(operation.url, {
        method: operation.method || 'PUT',
        headers,
        body: chunk,
      })

      if (!response.ok) {
        throw new Error(`App screenshot upload failed: ${response.status}`)
      }
    }

    return this.request('PATCH', `/appScreenshots/${appScreenshot.id}`, {
      data: {
        type: 'appScreenshots',
        id: appScreenshot.id,
        attributes: {
          uploaded: true,
          sourceFileChecksum: crypto.createHash('md5').update(imageBuffer).digest('hex'),
        },
      },
    })
  }

  async deleteAppScreenshot(appScreenshotId) {
    if (!appScreenshotId) throw new Error('appScreenshotId is required')
    return this.request('DELETE', `/appScreenshots/${appScreenshotId}`)
  }

  // Uploads files in order into one locale's screenshot set, optionally
  // clearing the set first. files: [{ fileName, buffer }]
  async uploadAppScreenshotsForLocale(appId, locale, screenshotDisplayType, files, options = {}) {
    if (!appId) throw new Error('appId is required')
    if (!locale) throw new Error('locale is required')
    if (!screenshotDisplayType) throw new Error('screenshotDisplayType is required')
    if (!Array.isArray(files) || files.length === 0) throw new Error('at least one screenshot file is required')

    const { platform = null, replace = false } = options
    const editableVersion = await this.getEditableVersion(appId, platform)

    if (!editableVersion?.id) {
      const platformLabel = platform ? ` for platform ${platform}` : ''
      throw new Error(`No editable App Store version found${platformLabel}. Create or open a version in Prepare for Submission before uploading screenshots.`)
    }

    const localizations = await this.getAppStoreVersionLocalizations(editableVersion.id)
    let localization = localizations.find((item) => item?.attributes?.locale === locale)

    if (!localization) {
      localization = (await this.createVersionLocalization(editableVersion.id, locale, {}))?.data || null
    }

    if (!localization?.id) {
      throw new Error(`No App Store version localization found for ${locale}.`)
    }

    const result = await this.uploadScreenshotsToLocalization(localization.id, screenshotDisplayType, files, { replace })

    return { appStoreVersion: editableVersion, localization, ...result }
  }

  // Uploads files in order into one screenshot set of a version or treatment
  // localization, optionally clearing the set first. files: [{ fileName, buffer }]
  async uploadScreenshotsToLocalization(localizationId, screenshotDisplayType, files, options = {}) {
    const { replace = false, owner = 'appStoreVersionLocalizations' } = options
    const appScreenshotSet = await this.getOrCreateAppScreenshotSet(localizationId, screenshotDisplayType, owner)
    if (!appScreenshotSet?.id) {
      throw new Error(`Could not create app screenshot set (${screenshotDisplayType}).`)
    }

    const existing = appScreenshotSet.appScreenshots || []
    if (replace) {
      for (const appScreenshot of existing) {
        await this.deleteAppScreenshot(appScreenshot.id)
      }
    } else if (existing.length + files.length > 10) {
      throw new Error(`${screenshotDisplayType} already has ${existing.length} screenshots; a set holds at most 10. Pass replace to clear it first.`)
    }

    const appScreenshots = []
    for (const file of files) {
      const reserved = await this.createAppScreenshot(appScreenshotSet.id, { fileName: file.fileName, fileSize: file.buffer.byteLength })
      const uploaded = await this.uploadAppScreenshot(reserved?.data, file.buffer)
      appScreenshots.push(uploaded?.data || reserved?.data)
    }

    // Uploads finish processing out of order; pin the order we were given.
    const orderedIds = [...(replace ? [] : existing.map((item) => item.id)), ...appScreenshots.map((item) => item.id)]
    await this.request('PATCH', `/appScreenshotSets/${appScreenshotSet.id}/relationships/appScreenshots`, {
      data: orderedIds.map((id) => ({ type: 'appScreenshots', id })),
    })

    return { appScreenshotSet, deleted: replace ? existing.length : 0, appScreenshots }
  }

  // MARK: Product Page Optimization

  async listProductPageExperiments(appId) {
    if (!appId) throw new Error('appId is required')
    return this.requestAllWithOffset(({ limit }) => `/apps/${appId}/appStoreVersionExperimentsV2?limit=${limit}`, 50)
  }

  // Treatments of one experiment, each with its localizations.
  async getProductPageTreatments(experimentId) {
    if (!experimentId) throw new Error('experimentId is required')

    const treatments = await this.requestAllWithOffset(
      ({ limit }) => `/appStoreVersionExperiments/${experimentId}/appStoreVersionExperimentTreatments?limit=${limit}`,
      50
    )

    return Promise.all(
      treatments.map(async (treatment) => ({
        ...treatment,
        localizations: await this.getProductPageTreatmentLocalizations(treatment.id),
      }))
    )
  }

  async getProductPageTreatmentLocalizations(treatmentId) {
    if (!treatmentId) throw new Error('treatmentId is required')
    return this.requestAllWithOffset(
      ({ limit }) => `/appStoreVersionExperimentTreatments/${treatmentId}/appStoreVersionExperimentTreatmentLocalizations?limit=${limit}`,
      50
    )
  }

  async createProductPageTreatmentLocalization(treatmentId, locale) {
    const response = await this.request('POST', '/appStoreVersionExperimentTreatmentLocalizations', {
      data: {
        type: 'appStoreVersionExperimentTreatmentLocalizations',
        attributes: { locale },
        relationships: {
          appStoreVersionExperimentTreatment: {
            data: { type: 'appStoreVersionExperimentTreatments', id: treatmentId },
          },
        },
      },
    })

    return response?.data || null
  }

  // MARK: Custom Product Pages

  // Each page with its editable version (or null) and that version's locales.
  async listCustomProductPages(appId) {
    if (!appId) throw new Error('appId is required')

    const pages = await this.requestAllWithOffset(({ limit }) => `/apps/${appId}/appCustomProductPages?limit=${limit}`, 50)
    return Promise.all(
      pages.map(async (page) => {
        const versions = await this.requestAllWithOffset(
          ({ limit }) => `/appCustomProductPages/${page.id}/appCustomProductPageVersions?limit=${limit}`,
          50
        )
        const editable = versions.find((version) => EDITABLE_CPP_STATES.has(version.attributes?.state)) || null
        return {
          ...page,
          versions,
          latestVersion: versions.find((version) => version.attributes?.state !== 'REPLACED_WITH_NEW_VERSION') || versions.at(-1) || null,
          editableVersion: editable,
          localizations: editable ? await this.getCustomProductPageLocalizations(editable.id) : [],
        }
      })
    )
  }

  async getCustomProductPageLocalizations(versionId) {
    if (!versionId) throw new Error('versionId is required')
    return this.requestAllWithOffset(
      ({ limit }) => `/appCustomProductPageVersions/${versionId}/appCustomProductPageLocalizations?limit=${limit}`,
      50
    )
  }

  async getEditableCustomProductPageVersion(pageId) {
    if (!pageId) throw new Error('customProductPageId is required')
    const versions = await this.requestAllWithOffset(
      ({ limit }) => `/appCustomProductPages/${pageId}/appCustomProductPageVersions?limit=${limit}`,
      50
    )
    const editable = versions.find((version) => EDITABLE_CPP_STATES.has(version.attributes?.state))
    if (!editable) throw new Error('This Custom Product Page has no editable version (it is in review or live).')
    return editable
  }

  // Creates the page with its first version and locales in one request.
  // `template`: { versionId } copies that App Store version's product page,
  // { pageId } copies another Custom Product Page.
  async createCustomProductPage(appId, { name, deepLink, localizations = [], template } = {}) {
    if (!appId) throw new Error('appId is required')
    if (!name?.trim()) throw new Error('A page name is required')

    const versionRef = { type: 'appCustomProductPageVersions', id: '${version}' }
    const localizationRefs = localizations.map((_, index) => ({ type: 'appCustomProductPageLocalizations', id: `\${locale-${index}}` }))
    const relationships = {
      app: { data: { type: 'apps', id: appId } },
      appCustomProductPageVersions: { data: [versionRef] },
    }
    if (template?.versionId) relationships.appStoreVersionTemplate = { data: { type: 'appStoreVersions', id: template.versionId } }
    if (template?.pageId) relationships.customProductPageTemplate = { data: { type: 'appCustomProductPages', id: template.pageId } }

    const response = await this.request('POST', '/appCustomProductPages', {
      data: { type: 'appCustomProductPages', attributes: { name: name.trim() }, relationships },
      included: [
        {
          ...versionRef,
          ...(deepLink ? { attributes: { deepLink } } : {}),
          relationships: { appCustomProductPageLocalizations: { data: localizationRefs } },
        },
        ...localizations.map(({ locale, promotionalText }, index) => ({
          ...localizationRefs[index],
          attributes: { locale, ...(promotionalText ? { promotionalText } : {}) },
        })),
      ],
    })

    return response?.data || null
  }

  // A new editable version of a page that is live or in review; App Store
  // Connect copies the current version's content into it.
  async createCustomProductPageVersion(pageId, deepLink) {
    if (!pageId) throw new Error('customProductPageId is required')
    const response = await this.request('POST', '/appCustomProductPageVersions', {
      data: {
        type: 'appCustomProductPageVersions',
        ...(deepLink ? { attributes: { deepLink } } : {}),
        relationships: { appCustomProductPage: { data: { type: 'appCustomProductPages', id: pageId } } },
      },
    })
    return response?.data || null
  }

  async createCustomProductPageLocalization(versionId, locale, promotionalText) {
    const response = await this.request('POST', '/appCustomProductPageLocalizations', {
      data: {
        type: 'appCustomProductPageLocalizations',
        attributes: { locale, ...(promotionalText ? { promotionalText } : {}) },
        relationships: {
          appCustomProductPageVersion: { data: { type: 'appCustomProductPageVersions', id: versionId } },
        },
      },
    })

    return response?.data || null
  }

  // MARK: App Asset Library

  async getAppAssetLibrary(appId) {
    if (!appId) throw new Error('appId is required')
    const response = await this.request('GET', `/apps/${appId}/assetLibrary`)
    if (!response?.data?.id) throw new Error('This app has no App Asset Library.')
    return response.data
  }

  // The catalog of placement types, groups and file specs. It changes as
  // Apple adds devices, so it is read at runtime and cached for an hour.
  async getAssetLibraryRefData() {
    return this.getCachedList('assetLibraryRefData', async () => {
      const response = await this.request('GET', '/appAssetLibraryRefData')
      return response?.data?.[0]?.attributes || {}
    })
  }

  async getAssetLibraryImage(imageId) {
    const response = await this.request('GET', `/appAssetLibraryImages/${imageId}`)
    return response?.data || null
  }

  // Reserves, uploads and commits one image, then waits until App Store
  // Connect has processed it and matched it to a spec (attributes.specId).
  async uploadAssetLibraryImage(libraryId, { fileName, buffer, category, referenceName }) {
    if (!libraryId) throw new Error('libraryId is required')
    if (!fileName || !buffer?.byteLength) throw new Error('fileName and buffer are required')

    const reserved = await this.request('POST', '/appAssetLibraryImages', {
      data: {
        type: 'appAssetLibraryImages',
        attributes: { fileName, fileSize: buffer.byteLength, category, ...(referenceName ? { referenceName } : {}) },
        relationships: { assetLibrary: { data: { type: 'appAssetLibraries', id: libraryId } } },
      },
    })
    const image = reserved?.data
    const uploadOperations = image?.attributes?.uploadOperations || []
    if (!image?.id || uploadOperations.length === 0) throw new Error('Asset library image upload operation is unavailable')

    await Promise.all(
      uploadOperations.map(async (operation) => {
        const offset = Number(operation.offset || 0)
        const length = Number(operation.length || buffer.byteLength)
        const headers = Object.fromEntries((operation.requestHeaders || []).filter((header) => header?.name).map((header) => [header.name, header.value]))
        const response = await fetch(operation.url, { method: operation.method || 'PUT', headers, body: buffer.slice(offset, offset + length) })
        if (!response.ok) throw new Error(`Asset library image upload failed: ${response.status}`)
      })
    )

    // Unlike appScreenshots, the commit takes no checksum.
    await this.request('PATCH', `/appAssetLibraryImages/${image.id}`, {
      data: { type: 'appAssetLibraryImages', id: image.id, attributes: { uploaded: true } },
    })

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const current = await this.getAssetLibraryImage(image.id)
      const state = current?.attributes?.state
      if (state === 'FAILED') {
        throw new Error(`App Store Connect could not process ${fileName}: ${JSON.stringify(current.attributes.stateDetails || 'no details')}`)
      }
      if (state && state !== 'AWAITING_UPLOAD' && state !== 'UPLOAD_COMPLETE') return current
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }

    throw new Error(`${fileName} is still processing after 3 minutes. Try again later.`)
  }

  async deleteAssetLibraryImage(imageId) {
    return this.request('DELETE', `/appAssetLibraryImages/${imageId}`)
  }

  // owner: appStoreVersionLocalizations, appCustomProductPageLocalizations or
  // appStoreVersionExperimentTreatmentLocalizations. Each placement carries
  // its image (with imageAsset for a thumbnail) as `image`.
  async getLocalizationPlacements(owner, localizationId, placementTypes = []) {
    const typeFilter = placementTypes.length ? `&filter[placementType]=${placementTypes.join(',')}` : ''
    const response = await this.request('GET', `/${owner}/${localizationId}/placements?include=image&sort=placementGroupPosition&limit=200${typeFilter}`)
    const images = new Map((response?.included || []).filter((item) => item.type === 'appAssetLibraryImages').map((item) => [item.id, item]))
    return (response?.data || []).map((placement) => ({ ...placement, image: images.get(placement.relationships?.image?.data?.id) || null }))
  }

  async createAssetLibraryPlacement({ owner, localizationId, imageId, placementType, placementGroup }) {
    // appStoreVersionLocalizations -> appStoreVersionLocalization
    const ownerRelationship = owner.replace(/s$/, '')
    const response = await this.request('POST', '/appAssetLibraryPlacements', {
      data: {
        type: 'appAssetLibraryPlacements',
        attributes: { placementType, placementGroup },
        relationships: {
          image: { data: { type: 'appAssetLibraryImages', id: imageId } },
          [ownerRelationship]: { data: { type: owner, id: localizationId } },
        },
      },
    })
    return response?.data || null
  }

  async deleteAssetLibraryPlacement(placementId) {
    return this.request('DELETE', `/appAssetLibraryPlacements/${placementId}`)
  }

  async getAppInfoLocalizations(appId) {
    if (!appId) throw new Error('appId is required')

    const appInfo = await this.getAppInfo(appId)
    if (!appInfo) {
      return { appInfoId: null, localizations: [] }
    }

    const localizations = await this.requestAllWithOffset(
      ({ limit }) => `/appInfos/${appInfo.id}/appInfoLocalizations?fields[appInfoLocalizations]=locale,name,subtitle&limit=${limit}`,
      200
    )

    return {
      appInfoId: appInfo.id,
      localizations,
    }
  }

  async listAppSubscriptions(appId) {
    if (!appId) throw new Error('appId is required')

    const subscriptionGroups = await this.requestAllWithOffset(
      ({ limit }) => `/apps/${appId}/subscriptionGroups?fields[subscriptionGroups]=referenceName&limit=${limit}`,
      200
    )

    const subscriptions = []

    for (const group of subscriptionGroups) {
      const groupSubscriptions = await this.requestAllWithOffset(
        ({ limit }) => `/subscriptionGroups/${group.id}/subscriptions?fields[subscriptions]=name,productId,subscriptionPeriod,state&limit=${limit}`,
        200
      )

      for (const subscription of groupSubscriptions) {
        subscriptions.push({
          ...subscription,
          subscriptionGroup: {
            id: group.id,
            referenceName: group?.attributes?.referenceName || '',
          },
        })
      }
    }

    return subscriptions
  }

  async getSubscriptionLocalizations(subscriptionId) {
    if (!subscriptionId) throw new Error('subscriptionId is required')

    return this.requestAllWithOffset(
      ({ limit }) => `/subscriptions/${subscriptionId}/subscriptionLocalizations?fields[subscriptionLocalizations]=locale,name,description&limit=${limit}`,
      200
    )
  }

  async getSubscriptionGroupLocalizations(subscriptionGroupId) {
    if (!subscriptionGroupId) throw new Error('subscriptionGroupId is required')

    return this.requestAllWithOffset(
      ({ limit }) =>
        `/subscriptionGroups/${subscriptionGroupId}/subscriptionGroupLocalizations?fields[subscriptionGroupLocalizations]=locale,name,customAppName&limit=${limit}`,
      200
    )
  }

  buildLocalizationAttributes(metadata = {}) {
    const attributes = {}

    if (Object.prototype.hasOwnProperty.call(metadata, 'keywords')) {
      attributes.keywords = Array.isArray(metadata.keywords) ? metadata.keywords.join(',') : metadata.keywords || ''
    }

    if (Object.prototype.hasOwnProperty.call(metadata, 'promotionalText')) {
      attributes.promotionalText = metadata.promotionalText || ''
    }

    if (Object.prototype.hasOwnProperty.call(metadata, 'description')) {
      attributes.description = metadata.description || ''
    }

    if (Object.prototype.hasOwnProperty.call(metadata, 'whatsNew')) {
      attributes.whatsNew = metadata.whatsNew || ''
    }

    if (Object.prototype.hasOwnProperty.call(metadata, 'supportUrl')) {
      attributes.supportUrl = metadata.supportUrl || ''
    }

    if (Object.prototype.hasOwnProperty.call(metadata, 'marketingUrl')) {
      attributes.marketingUrl = metadata.marketingUrl || ''
    }

    return attributes
  }

  buildAppInfoLocalizationAttributes(metadata = {}) {
    const attributes = {}

    if (Object.prototype.hasOwnProperty.call(metadata, 'name')) {
      attributes.name = metadata.name || ''
    }

    if (Object.prototype.hasOwnProperty.call(metadata, 'subtitle')) {
      attributes.subtitle = metadata.subtitle || ''
    }

    return attributes
  }

  buildSubscriptionLocalizationAttributes(metadata = {}) {
    const attributes = {}

    if (Object.prototype.hasOwnProperty.call(metadata, 'name')) {
      attributes.name = metadata.name || ''
    }

    if (Object.prototype.hasOwnProperty.call(metadata, 'description')) {
      attributes.description = metadata.description || ''
    }

    return attributes
  }

  buildSubscriptionGroupLocalizationAttributes(metadata = {}) {
    const attributes = {}

    if (Object.prototype.hasOwnProperty.call(metadata, 'name')) {
      attributes.name = metadata.name || ''
    }

    if (Object.prototype.hasOwnProperty.call(metadata, 'customAppName')) {
      attributes.customAppName = metadata.customAppName || ''
    }

    return attributes
  }

  async updateVersionLocalization(localizationId, metadata) {
    const payload = {
      data: {
        type: 'appStoreVersionLocalizations',
        id: localizationId,
        attributes: this.buildLocalizationAttributes(metadata),
      },
    }
    return this.request('PATCH', `/appStoreVersionLocalizations/${localizationId}`, payload)
  }

  async createVersionLocalization(versionId, locale, metadata) {
    const payload = {
      data: {
        type: 'appStoreVersionLocalizations',
        attributes: {
          locale,
          ...this.buildLocalizationAttributes(metadata),
        },
        relationships: {
          appStoreVersion: {
            data: {
              type: 'appStoreVersions',
              id: versionId,
            },
          },
        },
      },
    }
    return this.request('POST', '/appStoreVersionLocalizations', payload)
  }

  async deleteVersionLocalization(localizationId) {
    if (!localizationId) throw new Error('localizationId is required')
    return this.request('DELETE', `/appStoreVersionLocalizations/${localizationId}`)
  }

  async updateAppInfoLocalization(localizationId, metadata) {
    const payload = {
      data: {
        type: 'appInfoLocalizations',
        id: localizationId,
        attributes: this.buildAppInfoLocalizationAttributes(metadata),
      },
    }
    return this.request('PATCH', `/appInfoLocalizations/${localizationId}`, payload)
  }

  async createAppInfoLocalization(appInfoId, locale, metadata) {
    const payload = {
      data: {
        type: 'appInfoLocalizations',
        attributes: {
          locale,
          ...this.buildAppInfoLocalizationAttributes(metadata),
        },
        relationships: {
          appInfo: {
            data: {
              type: 'appInfos',
              id: appInfoId,
            },
          },
        },
      },
    }
    return this.request('POST', '/appInfoLocalizations', payload)
  }

  async deleteAppInfoLocalization(localizationId) {
    if (!localizationId) throw new Error('localizationId is required')
    return this.request('DELETE', `/appInfoLocalizations/${localizationId}`)
  }

  async updateSubscriptionLocalization(localizationId, metadata) {
    const payload = {
      data: {
        type: 'subscriptionLocalizations',
        id: localizationId,
        attributes: this.buildSubscriptionLocalizationAttributes(metadata),
      },
    }

    return this.request('PATCH', `/subscriptionLocalizations/${localizationId}`, payload)
  }

  async createSubscriptionLocalization(subscriptionId, locale, metadata) {
    const payload = {
      data: {
        type: 'subscriptionLocalizations',
        attributes: {
          locale,
          ...this.buildSubscriptionLocalizationAttributes(metadata),
        },
        relationships: {
          subscription: {
            data: {
              type: 'subscriptions',
              id: subscriptionId,
            },
          },
        },
      },
    }

    return this.request('POST', '/subscriptionLocalizations', payload)
  }

  async deleteSubscriptionLocalization(localizationId) {
    if (!localizationId) throw new Error('localizationId is required')
    return this.request('DELETE', `/subscriptionLocalizations/${localizationId}`)
  }

  async updateSubscriptionGroupLocalization(localizationId, metadata) {
    const payload = {
      data: {
        type: 'subscriptionGroupLocalizations',
        id: localizationId,
        attributes: this.buildSubscriptionGroupLocalizationAttributes(metadata),
      },
    }

    return this.request('PATCH', `/subscriptionGroupLocalizations/${localizationId}`, payload)
  }

  async createSubscriptionGroupLocalization(subscriptionGroupId, locale, metadata) {
    const payload = {
      data: {
        type: 'subscriptionGroupLocalizations',
        attributes: {
          locale,
          ...this.buildSubscriptionGroupLocalizationAttributes(metadata),
        },
        relationships: {
          subscriptionGroup: {
            data: {
              type: 'subscriptionGroups',
              id: subscriptionGroupId,
            },
          },
        },
      },
    }

    return this.request('POST', '/subscriptionGroupLocalizations', payload)
  }

  async deleteSubscriptionGroupLocalization(localizationId) {
    if (!localizationId) throw new Error('localizationId is required')
    return this.request('DELETE', `/subscriptionGroupLocalizations/${localizationId}`)
  }

  async updateAppKeywords(appId, locale, metadata) {
    return this.updateAppMetadata(appId, locale, metadata)
  }

  async updateSubscriptionMetadata(subscriptionId, locale, metadata) {
    if (!subscriptionId) throw new Error('subscriptionId is required')
    if (!locale) throw new Error('locale is required')

    const hasSubscriptionFields = ['name', 'description'].some((key) => Object.prototype.hasOwnProperty.call(metadata, key))

    if (!hasSubscriptionFields) {
      throw new Error('No subscription localization fields provided for update')
    }

    const localizations = await this.getSubscriptionLocalizations(subscriptionId)
    const existingLocalization = localizations.find((loc) => loc.attributes?.locale === locale)
    const nextMetadata = { ...metadata }
    const hasProvidedName = Object.prototype.hasOwnProperty.call(nextMetadata, 'name') && String(nextMetadata.name || '').trim().length > 0

    if (!hasProvidedName) {
      const fallbackFromCurrentLocale = existingLocalization?.attributes?.name || ''
      const fallbackFromEnglishLocale = localizations.find((loc) => /^en([_-]|$)/i.test(String(loc?.attributes?.locale || '')))?.attributes?.name || ''
      const fallbackFromAnyLocale = localizations.find((loc) => String(loc?.attributes?.name || '').trim().length > 0)?.attributes?.name || ''

      const fallbackFromExistingLocales = fallbackFromCurrentLocale || fallbackFromEnglishLocale || fallbackFromAnyLocale

      if (fallbackFromExistingLocales) {
        nextMetadata.name = fallbackFromExistingLocales
      } else {
        const subscriptionResponse = await this.request('GET', `/subscriptions/${subscriptionId}?fields[subscriptions]=name,productId`)
        const fallbackName = subscriptionResponse?.data?.attributes?.name || subscriptionResponse?.data?.attributes?.productId || ''

        if (String(fallbackName).trim().length > 0) {
          nextMetadata.name = fallbackName
        }
      }
    }

    if (String(nextMetadata.name || '').trim().length === 0) {
      throw new Error(`Cannot update subscription localization for ${locale}: name is required. Provide a subscription name first.`)
    }

    if (existingLocalization) {
      return this.updateSubscriptionLocalization(existingLocalization.id, nextMetadata)
    }

    return this.createSubscriptionLocalization(subscriptionId, locale, nextMetadata)
  }

  async updateSubscriptionGroupMetadata(subscriptionGroupId, locale, metadata) {
    if (!subscriptionGroupId) throw new Error('subscriptionGroupId is required')
    if (!locale) throw new Error('locale is required')

    const hasSubscriptionGroupFields = ['name', 'customAppName'].some((key) => Object.prototype.hasOwnProperty.call(metadata, key))

    if (!hasSubscriptionGroupFields) {
      throw new Error('No subscription group localization fields provided for update')
    }

    const localizations = await this.getSubscriptionGroupLocalizations(subscriptionGroupId)
    const existingLocalization = localizations.find((loc) => loc.attributes?.locale === locale)
    const nextMetadata = { ...metadata }
    const hasProvidedName = Object.prototype.hasOwnProperty.call(nextMetadata, 'name') && String(nextMetadata.name || '').trim().length > 0

    if (!hasProvidedName) {
      const fallbackFromCurrentLocale = existingLocalization?.attributes?.name || ''
      const fallbackFromEnglishLocale = localizations.find((loc) => /^en([_-]|$)/i.test(String(loc?.attributes?.locale || '')))?.attributes?.name || ''
      const fallbackFromAnyLocale = localizations.find((loc) => String(loc?.attributes?.name || '').trim().length > 0)?.attributes?.name || ''

      const fallbackFromExistingLocales = fallbackFromCurrentLocale || fallbackFromEnglishLocale || fallbackFromAnyLocale

      if (fallbackFromExistingLocales) {
        nextMetadata.name = fallbackFromExistingLocales
      } else {
        const subscriptionGroupResponse = await this.request('GET', `/subscriptionGroups/${subscriptionGroupId}?fields[subscriptionGroups]=referenceName`)
        const fallbackName = subscriptionGroupResponse?.data?.attributes?.referenceName || ''

        if (String(fallbackName).trim().length > 0) {
          nextMetadata.name = fallbackName
        }
      }
    }

    if (String(nextMetadata.name || '').trim().length === 0) {
      throw new Error(`Cannot update subscription group localization for ${locale}: name is required. Provide a group name first.`)
    }

    if (existingLocalization) {
      return this.updateSubscriptionGroupLocalization(existingLocalization.id, nextMetadata)
    }

    return this.createSubscriptionGroupLocalization(subscriptionGroupId, locale, nextMetadata)
  }

  // Follows links.next and resolves each price point's territory currency from `included`.
  async requestSubscriptionPricePoints(endpoint) {
    const pricePoints = []
    let nextEndpoint = endpoint
    let page = 0

    while (nextEndpoint && page < 100) {
      const response = await this.request('GET', nextEndpoint)
      const currencyByTerritory = new Map(
        (response?.included || []).filter((item) => item.type === 'territories').map((item) => [item.id, item.attributes?.currency || ''])
      )

      for (const item of response?.data || []) {
        const territoryId = item.relationships?.territory?.data?.id || ''
        pricePoints.push({
          id: item.id,
          territoryId,
          currency: currencyByTerritory.get(territoryId) || '',
          customerPrice: item.attributes?.customerPrice ?? null,
          proceeds: item.attributes?.proceeds ?? null,
        })
      }

      nextEndpoint = response?.links?.next || null
      page += 1
    }

    return pricePoints
  }

  async listSubscriptionPricePoints(subscriptionId, territoryIds = []) {
    if (!subscriptionId) throw new Error('subscriptionId is required')

    const fields = 'fields[subscriptionPricePoints]=customerPrice,proceeds,territory&fields[territories]=currency&include=territory&limit=8000'
    if (territoryIds.length === 0) {
      return this.requestSubscriptionPricePoints(`/subscriptions/${subscriptionId}/pricePoints?${fields}`)
    }

    // Each territory has ~800 price points, so batch territories to keep responses to a couple of pages.
    const pricePoints = []
    for (let index = 0; index < territoryIds.length; index += 20) {
      const chunk = territoryIds.slice(index, index + 20)
      const points = await this.requestSubscriptionPricePoints(
        `/subscriptions/${subscriptionId}/pricePoints?filter[territory]=${chunk.join(',')}&${fields}`
      )
      pricePoints.push(...points)
    }
    return pricePoints
  }

  // Apple's equivalent price point in every other territory for one price point (FX- and tax-adjusted).
  async getSubscriptionPricePointEqualizations(pricePointId) {
    if (!pricePointId) throw new Error('pricePointId is required')

    return this.requestSubscriptionPricePoints(
      `/subscriptionPricePoints/${pricePointId}/equalizations?fields[subscriptionPricePoints]=customerPrice,proceeds,territory&fields[territories]=currency&include=territory&limit=8000`
    )
  }

  async listWinBackOffers(subscriptionId) {
    if (!subscriptionId) throw new Error('subscriptionId is required')

    return this.requestAllWithOffset(
      ({ limit }) =>
        `/subscriptions/${subscriptionId}/winBackOffers?fields[winBackOffers]=referenceName,offerId,duration,offerMode,periodCount,customerEligibilityPaidSubscriptionDurationInMonths,customerEligibilityTimeSinceLastSubscribedInMonths,customerEligibilityWaitBetweenOffersInMonths,startDate,endDate,priority,promotionIntent&limit=${limit}`,
      200
    )
  }

  /**
   * prices: [{ territoryId, pricePointId }]. FREE_TRIAL offers have no price, so their entries only carry a territory.
   */
  async createWinBackOffer(subscriptionId, offer = {}, prices = []) {
    if (!subscriptionId) throw new Error('subscriptionId is required')
    if (prices.length === 0) throw new Error('At least one territory price is required')

    const isFreeTrial = offer.offerMode === 'FREE_TRIAL'
    const included = prices.map((price, index) => ({
      type: 'winBackOfferPrices',
      id: `\${price-${index}}`,
      relationships: {
        territory: { data: { type: 'territories', id: price.territoryId } },
        ...(isFreeTrial ? {} : { subscriptionPricePoint: { data: { type: 'subscriptionPricePoints', id: price.pricePointId } } }),
      },
    }))

    const attributes = {
      referenceName: offer.referenceName,
      offerId: offer.offerId,
      duration: offer.duration,
      offerMode: offer.offerMode,
      periodCount: Number(offer.periodCount),
      customerEligibilityPaidSubscriptionDurationInMonths: Number(offer.customerEligibilityPaidSubscriptionDurationInMonths),
      customerEligibilityTimeSinceLastSubscribedInMonths: {
        minimum: Number(offer.customerEligibilityTimeSinceLastSubscribedInMonths?.minimum),
        maximum: Number(offer.customerEligibilityTimeSinceLastSubscribedInMonths?.maximum),
      },
      startDate: offer.startDate,
      priority: offer.priority || 'NORMAL',
      promotionIntent: offer.promotionIntent || 'NOT_PROMOTED',
    }
    if (offer.customerEligibilityWaitBetweenOffersInMonths !== undefined && offer.customerEligibilityWaitBetweenOffersInMonths !== '') {
      attributes.customerEligibilityWaitBetweenOffersInMonths = Number(offer.customerEligibilityWaitBetweenOffersInMonths)
    }
    if (offer.endDate) {
      attributes.endDate = offer.endDate
    }

    return this.request('POST', '/winBackOffers', {
      data: {
        type: 'winBackOffers',
        attributes,
        relationships: {
          subscription: { data: { type: 'subscriptions', id: subscriptionId } },
          prices: { data: included.map(({ type, id }) => ({ type, id })) },
        },
      },
      included,
    })
  }

  async updateWinBackOffer(winBackOfferId, attributes = {}) {
    if (!winBackOfferId) throw new Error('winBackOfferId is required')

    const allowed = [
      'customerEligibilityPaidSubscriptionDurationInMonths',
      'customerEligibilityTimeSinceLastSubscribedInMonths',
      'customerEligibilityWaitBetweenOffersInMonths',
      'startDate',
      'endDate',
      'priority',
      'promotionIntent',
    ]
    const nextAttributes = Object.fromEntries(Object.entries(attributes).filter(([key]) => allowed.includes(key)))

    return this.request('PATCH', `/winBackOffers/${winBackOfferId}`, {
      data: { type: 'winBackOffers', id: winBackOfferId, attributes: nextAttributes },
    })
  }

  async deleteWinBackOffer(winBackOfferId) {
    if (!winBackOfferId) throw new Error('winBackOfferId is required')
    return this.request('DELETE', `/winBackOffers/${winBackOfferId}`)
  }

  async updateAppMetadata(appId, locale, metadata, options = {}) {
    if (!appId) throw new Error('appId is required')
    if (!locale) throw new Error('locale is required')

    const { platform = null } = options

    const hasVersionFields = ['keywords', 'promotionalText', 'description', 'whatsNew', 'supportUrl', 'marketingUrl'].some((key) =>
      Object.prototype.hasOwnProperty.call(metadata, key)
    )
    const hasAppInfoFields = ['name', 'subtitle'].some((key) => Object.prototype.hasOwnProperty.call(metadata, key))

    if (!hasVersionFields && !hasAppInfoFields) {
      throw new Error('No metadata fields provided for update')
    }

    const result = {}

    if (hasVersionFields) {
      const { versionId, localizations } = await this.getAppLocalizations(appId, platform)
      if (!versionId) {
        const platformLabel = platform ? ` for platform ${platform}` : ''
        throw new Error(`No editable App Store version found${platformLabel}. Make sure the app has a version in "Prepare for Submission" or a rejected state.`)
      }

      const existingVersionLocalization = localizations.find((loc) => loc.attributes?.locale === locale)
      if (existingVersionLocalization) {
        result.versionLocalization = await this.updateVersionLocalization(existingVersionLocalization.id, metadata)
      } else {
        result.versionLocalization = await this.createVersionLocalization(versionId, locale, metadata)
      }
    }

    if (hasAppInfoFields) {
      const { appInfoId, localizations } = await this.getAppInfoLocalizations(appId)
      if (!appInfoId) {
        throw new Error('No app info record found for this app.')
      }

      const existingAppInfoLocalization = localizations.find((loc) => loc.attributes?.locale === locale)
      if (existingAppInfoLocalization) {
        result.appInfoLocalization = await this.updateAppInfoLocalization(existingAppInfoLocalization.id, metadata)
      } else {
        try {
          result.appInfoLocalization = await this.createAppInfoLocalization(appInfoId, locale, metadata)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (message.includes('ENTITY_ERROR.RELATIONSHIP.INVALID')) {
            throw new Error(
              `App Name/Subtitle cannot be created for locale ${locale} in the current App Store Connect state. Create that App Information localization in App Store Connect first, then update it here.`
            )
          }

          throw error
        }
      }
    }

    return result
  }

  async listAppClips(appId) {
    if (!appId) throw new Error('appId is required')

    const attemptErrors = []

    // Preferred relationship endpoint.
    try {
      const appClips = await this.requestAllWithOffset(({ limit }) => `/apps/${appId}/appClips?fields[appClips]=bundleId&limit=${limit}`, 200)
      if (appClips.length > 0) {
        return appClips
      }
    } catch (error) {
      attemptErrors.push(error instanceof Error ? error.message : String(error))
    }

    // Fallback: fetch app with included appClips relationship.
    try {
      const appWithIncludes = await this.request('GET', `/apps/${appId}?fields[apps]=name&include=appClips&fields[appClips]=bundleId&limit[appClips]=200`)
      const includedAppClips = (appWithIncludes?.included || []).filter((item) => item?.type === 'appClips')
      if (includedAppClips.length > 0) {
        return includedAppClips
      }
    } catch (error) {
      attemptErrors.push(error instanceof Error ? error.message : String(error))
    }

    // Fallback: read relationship IDs then hydrate each appClip.
    try {
      const relationships = await this.requestAllWithOffset(({ limit }) => `/apps/${appId}/relationships/appClips?limit=${limit}`, 200)
      const appClipIds = relationships.map((item) => item?.id).filter(Boolean)

      if (appClipIds.length === 0) {
        return []
      }

      const appClips = []
      for (const appClipId of appClipIds) {
        const appClip = await this.request('GET', `/appClips/${appClipId}?fields[appClips]=bundleId`)
        if (appClip?.data) {
          appClips.push(appClip.data)
        }
      }

      return appClips
    } catch (error) {
      attemptErrors.push(error instanceof Error ? error.message : String(error))
    }

    throw new Error(`Failed to load app clips for app ${appId}. ${attemptErrors.join(' | ')}`)
  }

  async getAppClipDefaultExperiences(appClipId) {
    if (!appClipId) throw new Error('appClipId is required')

    const response = await this.request(
      'GET',
      `/appClips/${appClipId}/appClipDefaultExperiences?include=releaseWithAppStoreVersion&fields[appClipDefaultExperiences]=action&fields[appStoreVersions]=appStoreState,createdDate,versionString&limit=200`
    )

    const includedVersions = new Map((response?.included || []).filter((item) => item?.type === 'appStoreVersions' && item?.id).map((item) => [item.id, item]))

    return (response?.data || []).map((defaultExperience) => {
      const releaseVersionId = defaultExperience?.relationships?.releaseWithAppStoreVersion?.data?.id

      return {
        ...defaultExperience,
        releaseWithAppStoreVersion: releaseVersionId ? includedVersions.get(releaseVersionId) || null : null,
      }
    })
  }

  getRenderedImageAssetUrl(imageAsset = {}) {
    const templateUrl = imageAsset?.templateUrl
    if (!templateUrl) {
      return ''
    }

    const width = imageAsset.width || 1200
    const height = imageAsset.height || 900

    return templateUrl
      .replace(/\{w\}/g, String(width))
      .replace(/\{h\}/g, String(height))
      .replace(/\{c\}/g, 'bb')
      .replace(/\{f\}/g, 'png')
      .replace(/\{scale\}/g, '1')
  }

  async updateAppClipDefaultExperience(defaultExperienceId, metadata = {}) {
    if (!defaultExperienceId) throw new Error('defaultExperienceId is required')

    const attributes = {}
    if (Object.prototype.hasOwnProperty.call(metadata, 'action')) {
      attributes.action = metadata.action || ''
    }

    if (Object.keys(attributes).length === 0) {
      throw new Error('No App Clip default experience fields provided for update')
    }

    return this.request('PATCH', `/appClipDefaultExperiences/${defaultExperienceId}`, {
      data: {
        type: 'appClipDefaultExperiences',
        id: defaultExperienceId,
        attributes,
      },
    })
  }

  pickWritableAppClipDefaultExperience(defaultExperiences = []) {
    if (!Array.isArray(defaultExperiences) || defaultExperiences.length === 0) {
      return null
    }

    const editableExperience = defaultExperiences.find((defaultExperience) => {
      const appStoreState = defaultExperience?.releaseWithAppStoreVersion?.attributes?.appStoreState
      return appStoreState && APP_CLIP_LOCALIZATION_CREATE_STATES.includes(appStoreState)
    })

    if (editableExperience) {
      return editableExperience
    }

    return defaultExperiences.find((defaultExperience) => !defaultExperience?.releaseWithAppStoreVersion) || null
  }

  async getAppClipLocalizations(appClipId) {
    if (!appClipId) throw new Error('appClipId is required')

    const defaultExperiences = await this.getAppClipDefaultExperiences(appClipId)
    const localizations = []

    for (const defaultExperience of defaultExperiences) {
      const experienceLocalizations = await this.requestAllWithOffset(
        ({ limit }) =>
          `/appClipDefaultExperiences/${defaultExperience.id}/appClipDefaultExperienceLocalizations?fields[appClipDefaultExperienceLocalizations]=locale,subtitle,appClipHeaderImage&fields[appClipHeaderImages]=fileSize,fileName,sourceFileChecksum,imageAsset,assetDeliveryState&include=appClipHeaderImage&limit=${limit}`,
        200
      )

      for (const localization of experienceLocalizations) {
        localizations.push({
          ...localization,
          appClipDefaultExperience: defaultExperience,
          relationships: {
            ...(localization?.relationships || {}),
            appClipDefaultExperience: {
              data: {
                type: 'appClipDefaultExperiences',
                id: defaultExperience.id,
              },
            },
          },
        })
      }
    }

    return {
      appClipId,
      defaultExperiences,
      localizations,
    }
  }

  async getAppClipHeaderImage(localizationId) {
    if (!localizationId) throw new Error('localizationId is required')

    const response = await this.request(
      'GET',
      `/appClipDefaultExperienceLocalizations/${localizationId}/appClipHeaderImage?fields[appClipHeaderImages]=fileSize,fileName,sourceFileChecksum,imageAsset,assetDeliveryState`
    )

    return response?.data || null
  }

  async createAppClipHeaderImage(localizationId, { fileName, fileSize }) {
    if (!localizationId) throw new Error('localizationId is required')
    if (!fileName || !fileSize) throw new Error('fileName and fileSize are required')

    return this.request('POST', '/appClipHeaderImages', {
      data: {
        type: 'appClipHeaderImages',
        attributes: {
          fileName,
          fileSize,
        },
        relationships: {
          appClipDefaultExperienceLocalization: {
            data: {
              type: 'appClipDefaultExperienceLocalizations',
              id: localizationId,
            },
          },
        },
      },
    })
  }

  async deleteAppClipHeaderImage(headerImageId) {
    if (!headerImageId) return null
    return this.request('DELETE', `/appClipHeaderImages/${headerImageId}`)
  }

  async uploadAppClipHeaderImage(headerImage, imageBuffer) {
    const uploadOperations = headerImage?.attributes?.uploadOperations || []
    if (uploadOperations.length === 0) {
      throw new Error('App Clip header image upload operation is unavailable')
    }

    for (const operation of uploadOperations) {
      const offset = Number(operation.offset || 0)
      const length = Number(operation.length || imageBuffer.byteLength)
      const chunk = imageBuffer.slice(offset, offset + length)
      const headers = {}

      for (const header of operation.requestHeaders || []) {
        if (header?.name && header?.value !== undefined) {
          headers[header.name] = header.value
        }
      }

      const response = await fetch(operation.url, {
        method: operation.method || 'PUT',
        headers,
        body: chunk,
      })

      if (!response.ok) {
        throw new Error(`App Clip header image upload failed: ${response.status}`)
      }
    }

    return this.request('PATCH', `/appClipHeaderImages/${headerImage.id}`, {
      data: {
        type: 'appClipHeaderImages',
        id: headerImage.id,
        attributes: {
          uploaded: true,
        },
      },
    })
  }

  async copyAppClipHeaderImage(sourceLocalization, targetLocalization) {
    const sourceImage = await this.getAppClipHeaderImage(sourceLocalization.id).catch(() => null)
    if (!sourceImage?.id) {
      return { copied: false, reason: 'No US App Clip image found to copy.' }
    }

    const imageUrl = this.getRenderedImageAssetUrl(sourceImage.attributes?.imageAsset)
    if (!imageUrl) {
      return { copied: false, reason: 'US App Clip image URL is unavailable from App Store Connect.' }
    }

    const imageResponse = await fetch(imageUrl)
    if (!imageResponse.ok) {
      return { copied: false, reason: `Could not download US App Clip image (${imageResponse.status}).` }
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
    const fileName = sourceImage.attributes?.fileName || 'app-clip-header.png'
    const fileSize = sourceImage.attributes?.fileSize || imageBuffer.byteLength
    const existingTargetImage = await this.getAppClipHeaderImage(targetLocalization.id).catch(() => null)
    if (existingTargetImage?.id) {
      await this.deleteAppClipHeaderImage(existingTargetImage.id)
    }

    const reservedImage = await this.createAppClipHeaderImage(targetLocalization.id, { fileName, fileSize })
    await this.uploadAppClipHeaderImage(reservedImage?.data, imageBuffer)

    return { copied: true, sourceImageId: sourceImage.id, targetImageId: reservedImage?.data?.id || null }
  }

  buildAppClipLocalizationAttributes(metadata = {}) {
    const attributes = {}

    if (Object.prototype.hasOwnProperty.call(metadata, 'subtitle')) {
      attributes.subtitle = metadata.subtitle || ''
    }

    return attributes
  }

  async updateAppClipLocalization(localizationId, metadata) {
    if (!localizationId) throw new Error('localizationId is required')

    return this.request('PATCH', `/appClipDefaultExperienceLocalizations/${localizationId}`, {
      data: {
        type: 'appClipDefaultExperienceLocalizations',
        id: localizationId,
        attributes: this.buildAppClipLocalizationAttributes(metadata),
      },
    })
  }

  async createAppClipLocalization(defaultExperienceId, locale, metadata) {
    if (!defaultExperienceId || !locale) throw new Error('defaultExperienceId and locale are required')

    return this.request('POST', '/appClipDefaultExperienceLocalizations', {
      data: {
        type: 'appClipDefaultExperienceLocalizations',
        attributes: {
          locale,
          ...this.buildAppClipLocalizationAttributes(metadata),
        },
        relationships: {
          appClipDefaultExperience: {
            data: {
              type: 'appClipDefaultExperiences',
              id: defaultExperienceId,
            },
          },
        },
      },
    })
  }

  async deleteAppClipLocalization(localizationId) {
    if (!localizationId) throw new Error('localizationId is required')
    return this.request('DELETE', `/appClipDefaultExperienceLocalizations/${localizationId}`)
  }

  async updateAppClipDefaultExperienceReleaseVersion(defaultExperienceId, versionId) {
    if (!defaultExperienceId || !versionId) {
      throw new Error('defaultExperienceId and versionId are required')
    }

    return this.request('PATCH', `/appClipDefaultExperiences/${defaultExperienceId}/relationships/releaseWithAppStoreVersion`, {
      data: {
        type: 'appStoreVersions',
        id: versionId,
      },
    })
  }

  async updateAppClipMetadata(appClipId, locale, metadata, options = {}) {
    if (!appClipId || !locale) throw new Error('appClipId and locale are required')

    const { appId, defaultExperienceId } = options
    const { defaultExperiences, localizations } = await this.getAppClipLocalizations(appClipId)
    let defaultExperience = defaultExperienceId
      ? defaultExperiences.find((experience) => experience?.id === defaultExperienceId)
      : this.pickWritableAppClipDefaultExperience(defaultExperiences)
    const editableVersion = appId ? await this.getAppClipLocalizationVersion(appId) : null

    if (defaultExperienceId && !defaultExperience) {
      throw new Error(`App Clip default experience ${defaultExperienceId} was not found for app clip ${appClipId}. Refresh App Clips and retry.`)
    }

    if (editableVersion?.id) {
      const experienceForEditableVersion = defaultExperiences.find((experience) => experience?.releaseWithAppStoreVersion?.id === editableVersion.id)

      if (experienceForEditableVersion && !defaultExperienceId) {
        defaultExperience = experienceForEditableVersion
      }
    }

    const existingLocalization = localizations.find((loc) => {
      const localizationExperienceId = loc?.relationships?.appClipDefaultExperience?.data?.id
      return loc.attributes?.locale === locale && localizationExperienceId && localizationExperienceId === defaultExperience?.id
    })

    if (existingLocalization) {
      return this.updateAppClipLocalization(existingLocalization.id, metadata)
    }

    if (!defaultExperience?.id) {
      throw new Error(
        `No writable App Clip default experience found for app clip ${appClipId}. Open the App Clip in an editable App Store version before creating a new localization.`
      )
    }

    if (editableVersion?.id && defaultExperience?.releaseWithAppStoreVersion?.id !== editableVersion.id) {
      try {
        await this.updateAppClipDefaultExperienceReleaseVersion(defaultExperience.id, editableVersion.id)
        defaultExperience = {
          ...defaultExperience,
          releaseWithAppStoreVersion: editableVersion,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('STATE_ERROR')) {
          const state = editableVersion?.attributes?.appStoreState
          const versionString = editableVersion?.attributes?.versionString
          const versionLabel = versionString ? ` version ${versionString}` : ' the editable version'
          const stateLabel = state ? ` (${state})` : ''

          throw new Error(`App Clip cannot be attached to${versionLabel}${stateLabel}. Open the App Clip in that version in App Store Connect, then refresh and paste again.`)
        }

        throw error
      }
    }

    const appStoreState = defaultExperience?.releaseWithAppStoreVersion?.attributes?.appStoreState
    if (appStoreState && !APP_CLIP_LOCALIZATION_CREATE_STATES.includes(appStoreState)) {
      throw new Error(
        `App Clip localization cannot be created for locale ${locale} while the target version is ${appStoreState}. Create or select an editable App Store version, then refresh App Clips and paste again.`
      )
    }

    try {
      return this.createAppClipLocalization(defaultExperience.id, locale, metadata)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('ENTITY_ERROR.RELATIONSHIP.INVALID')) {
        const appStoreState = editableVersion?.attributes?.appStoreState || defaultExperience?.releaseWithAppStoreVersion?.attributes?.appStoreState
        const versionString = editableVersion?.attributes?.versionString || defaultExperience?.releaseWithAppStoreVersion?.attributes?.versionString
        const versionLabel = versionString ? ` version ${versionString}` : ' current submission'
        const stateLabel = appStoreState ? ` (${appStoreState})` : ''

        throw new Error(
          `App Clip localization cannot be created for locale ${locale} on${versionLabel}${stateLabel}. Make sure the current App Clip submission is editable in App Store Connect.`
        )
      }

      throw error
    }
  }

  async copyUsAppClipActionAndImage(appClipId, options = {}) {
    if (!appClipId) throw new Error('appClipId is required')

    const { targetDefaultExperienceId } = options
    const { defaultExperiences, localizations } = await this.getAppClipLocalizations(appClipId)
    const targetExperience = targetDefaultExperienceId
      ? defaultExperiences.find((experience) => experience?.id === targetDefaultExperienceId)
      : this.pickWritableAppClipDefaultExperience(defaultExperiences)

    if (!targetExperience?.id) {
      throw new Error('No target App Clip default experience found. Refresh App Clips and retry.')
    }

    const sourceLocalization = [...localizations]
      .filter((localization) => /^en[-_]US$/i.test(localization?.attributes?.locale || '') && getLocalizationExperienceId(localization) !== targetExperience.id)
      .sort((left, right) => getExperienceCreatedAt(right.appClipDefaultExperience) - getExperienceCreatedAt(left.appClipDefaultExperience))[0]

    if (!sourceLocalization) {
      throw new Error('No previous en-US App Clip localization found to copy from.')
    }

    const sourceExperience = sourceLocalization.appClipDefaultExperience
    const sourceAction = sourceExperience?.attributes?.action || ''
    const result = {
      actionCopied: false,
      imageCopied: false,
      imageMessage: '',
      sourceExperienceId: sourceExperience?.id || null,
      targetExperienceId: targetExperience.id,
    }

    if (sourceAction) {
      await this.updateAppClipDefaultExperience(targetExperience.id, { action: sourceAction })
      result.actionCopied = true
      result.action = sourceAction
    }

    const targetLocalization =
      localizations.find(
        (localization) => /^en[-_]US$/i.test(localization?.attributes?.locale || '') && getLocalizationExperienceId(localization) === targetExperience.id
      ) || (await this.createAppClipLocalization(targetExperience.id, 'en-US', { subtitle: sourceLocalization?.attributes?.subtitle || '' })).data

    const imageResult = await this.copyAppClipHeaderImage(sourceLocalization, targetLocalization)
    result.imageCopied = Boolean(imageResult.copied)
    result.imageMessage = imageResult.reason || (imageResult.copied ? 'US image copied.' : '')

    return result
  }
  async getDailySalesReportRows(reportDate) {
    if (this.salesReportCache.has(reportDate)) {
      return this.salesReportCache.get(reportDate)
    }

    const vendorNumber = process.env.APP_STORE_VENDOR_NUMBER
    if (!vendorNumber) {
      throw new Error('APP_STORE_VENDOR_NUMBER is not set. Find it in App Store Connect under Payments and Financial Reports.')
    }

    const params = new URLSearchParams({
      'filter[frequency]': 'DAILY',
      'filter[reportType]': 'SALES',
      'filter[reportSubType]': 'SUMMARY',
      'filter[vendorNumber]': vendorNumber,
      'filter[reportDate]': reportDate,
      'filter[version]': '1_1',
    })
    const res = await fetch(`${API_BASE}/salesReports?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
        Accept: 'application/a-gzip',
      },
    })

    // 404 means no sales for that day, or the report has not been published yet.
    if (res.status === 404) {
      return []
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`App Store Connect Sales Report Error: ${res.status} - ${body}`)
    }

    const tsv = zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8')
    const [headerLine, ...lines] = tsv.split('\n').filter((line) => line.trim())
    const headers = (headerLine || '').split('\t').map((header) => header.trim())
    const rows = lines.map((line) => {
      const values = line.split('\t')
      return Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()]))
    })

    // Only cache days that are safely final; recent days can still be published later.
    const ageDays = (Date.now() - new Date(`${reportDate}T00:00:00Z`).getTime()) / 86400000
    if (ageDays > 3) {
      this.salesReportCache.set(reportDate, rows)
    }

    return rows
  }

  async getDownloadsByCountry({ startDate, endDate, appId = null }) {
    const dates = []
    for (let day = new Date(`${startDate}T00:00:00Z`); day <= new Date(`${endDate}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
      dates.push(day.toISOString().split('T')[0])
    }

    if (dates.length > 366) {
      throw new Error('Sales reports are limited to a 366-day range.')
    }

    const dailyRows = []
    const concurrency = 6
    for (let index = 0; index < dates.length; index += concurrency) {
      const batch = await Promise.all(dates.slice(index, index + concurrency).map((date) => this.getDailySalesReportRows(date)))
      dailyRows.push(...batch)
    }

    const countries = new Map()
    const apps = new Map()
    let reportedDays = 0

    for (const rows of dailyRows) {
      if (rows.length > 0) {
        reportedDays += 1
      }

      for (const row of rows) {
        const productType = row['Product Type Identifier']
        const isDownload = DOWNLOAD_PRODUCT_TYPES.has(productType)
        const isRedownload = REDOWNLOAD_PRODUCT_TYPES.has(productType)
        if (!isDownload && !isRedownload) {
          continue
        }

        const appleId = row['Apple Identifier']
        if (appleId && !apps.has(appleId)) {
          apps.set(appleId, { appId: appleId, name: row.Title || appleId })
        }

        if (appId && String(appleId) !== String(appId)) {
          continue
        }

        const countryCode = row['Country Code'] || 'Unknown'
        const units = Number(row.Units || 0)
        const entry = countries.get(countryCode) || { countryCode, downloads: 0, redownloads: 0 }
        if (isDownload) {
          entry.downloads += units
        } else {
          entry.redownloads += units
        }
        countries.set(countryCode, entry)
      }
    }

    return {
      startDate,
      endDate,
      requestedDays: dates.length,
      reportedDays,
      apps: Array.from(apps.values()).sort((left, right) => left.name.localeCompare(right.name)),
      countries: Array.from(countries.values()).sort((left, right) => right.downloads - left.downloads),
    }
  }
  async getCachedList(key, loader, ttlMs = 60 * 60 * 1000) {
    const cached = this.analyticsListCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }
    const value = await loader()
    this.analyticsListCache.set(key, { value, expiresAt: Date.now() + ttlMs })
    return value
  }

  async listAnalyticsReportRequests(appId) {
    return this.requestAllWithOffset(({ limit }) => `/apps/${appId}/analyticsReportRequests?limit=${limit}`, 50)
  }

  getActiveOngoingRequest(requests = []) {
    return requests.find((request) => request?.attributes?.accessType === 'ONGOING' && !request?.attributes?.stoppedDueToInactivity) || null
  }

  async enableAnalyticsReports(appId) {
    const existing = this.getActiveOngoingRequest(await this.listAnalyticsReportRequests(appId))
    if (existing) {
      return { appId, requestId: existing.id, created: false }
    }

    const response = await this.request('POST', '/analyticsReportRequests', {
      data: {
        type: 'analyticsReportRequests',
        attributes: { accessType: 'ONGOING' },
        relationships: { app: { data: { type: 'apps', id: String(appId) } } },
      },
    })
    this.analyticsListCache.delete(`requests:${appId}`)
    return { appId, requestId: response?.data?.id, created: true }
  }

  // Parses one report instance into compact per-day/per-territory totals; instances never change, so they are cached.
  async getAnalyticsInstanceTotals(instanceId, kind) {
    const cacheKey = `${kind}:${instanceId}`
    if (this.analyticsInstanceCache.has(cacheKey)) {
      return this.analyticsInstanceCache.get(cacheKey)
    }

    const segments = await this.requestAllWithOffset(({ limit }) => `/analyticsReportInstances/${instanceId}/segments?limit=${limit}`, 50)
    const totals = new Map()
    const sourceTotals = new Map()
    const referrerTotals = new Map()

    for (const segment of segments) {
      const url = segment?.attributes?.url
      if (!url) {
        continue
      }

      // Segment URLs are pre-signed, so they must be fetched without the API bearer token.
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Analytics report segment download failed: ${res.status}`)
      }
      const buffer = Buffer.from(await res.arrayBuffer())
      const text = (buffer[0] === 0x1f && buffer[1] === 0x8b ? zlib.gunzipSync(buffer) : buffer).toString('utf8')

      for (const row of parseDelimited(text)) {
        const date = String(row.Date || '').slice(0, 10)
        const appId = String(row['App Apple Identifier'] || '')

        // The detailed report is read only for referrer names; totals come from the standard reports.
        if (kind === 'referrers') {
          const sourceType = String(row['Source Type'] || '')
          const downloadType = String(row['Download Type'] || '').toLowerCase()
          if (!REFERRER_SOURCE_TYPES.has(sourceType.toLowerCase()) || !['first-time download', 'redownload'].includes(downloadType)) {
            continue
          }
          const sourceInfo = row['Source Info'] || 'Unknown'
          const territory = toTerritoryCode(row.Territory)
          const referrerKey = `${date}|${appId}|${territory}|${sourceType}|${sourceInfo}`
          const referrer = referrerTotals.get(referrerKey) || { date, appId, territory, sourceType, sourceInfo, downloads: 0, firstDownloads: 0 }
          const units = Number(row.Counts || 0)
          referrer.downloads += units
          if (downloadType === 'first-time download') {
            referrer.firstDownloads += units
          }
          referrerTotals.set(referrerKey, referrer)
          continue
        }

        const territory = toTerritoryCode(row.Territory)
        const key = `${date}|${appId}|${territory}`
        const entry = totals.get(key) || { date, appId, territory, impressions: 0, pageViews: 0, firstDownloads: 0, redownloads: 0 }
        const counts = Number(row.Counts || 0)
        const uniqueCounts = Number(row['Unique Counts'] || 0)

        if (kind === 'engagement') {
          const event = String(row.Event || '').toLowerCase()
          if (event === 'impression') {
            entry.impressions += uniqueCounts
          } else if (event === 'page view') {
            entry.pageViews += uniqueCounts
          } else {
            continue
          }
        } else {
          const downloadType = String(row['Download Type'] || '').toLowerCase()
          if (downloadType === 'first-time download') {
            entry.firstDownloads += counts
          } else if (downloadType === 'redownload') {
            entry.redownloads += counts
          } else {
            continue
          }

          const sourceType = row['Source Type'] || 'Unavailable'
          const sourceKey = `${date}|${appId}|${territory}|${sourceType}`
          const sourceEntry = sourceTotals.get(sourceKey) || { date, appId, territory, sourceType, downloads: 0 }
          sourceEntry.downloads += counts
          sourceTotals.set(sourceKey, sourceEntry)
        }

        totals.set(key, entry)
      }
    }

    const result = {
      territoryRows: Array.from(totals.values()),
      sourceRows: Array.from(sourceTotals.values()),
      referrerRows: Array.from(referrerTotals.values()),
    }
    this.analyticsInstanceCache.set(cacheKey, result)
    return result
  }

  async getAppStoreAnalyticsRows(appId, { startDate, endDate }) {
    const requests = await this.getCachedList(`requests:${appId}`, () => this.listAnalyticsReportRequests(appId), 10 * 60 * 1000)
    const request = this.getActiveOngoingRequest(requests)
    if (!request) {
      const stopped = requests.some((item) => item?.attributes?.accessType === 'ONGOING')
      return { status: stopped ? 'stopped' : 'not_enabled', rows: [], sourceRows: [], referrerRows: [] }
    }

    const reports = await this.getCachedList(`reports:${request.id}`, () =>
      this.requestAllWithOffset(({ limit }) => `/analyticsReportRequests/${request.id}/reports?limit=${limit}`, 200)
    )
    const findReport = (pattern) =>
      reports.find((report) => pattern.test(report?.attributes?.name || '') && /standard/i.test(report?.attributes?.name || ''))
    const reportsByKind = [
      ['engagement', findReport(/discovery and engagement/i)],
      ['downloads', findReport(/download/i)],
      ['referrers', reports.find((report) => /download/i.test(report?.attributes?.name || '') && /detailed/i.test(report?.attributes?.name || ''))],
    ].filter(([, report]) => report)

    if (reportsByKind.length === 0) {
      return { status: 'pending', rows: [], sourceRows: [], referrerRows: [] }
    }

    // Late-arriving events land in instances processed a few days after the event date.
    const lastProcessingDate = addDays(endDate, 5)
    const rows = []
    const sourceRows = []
    const referrerRows = []
    let instanceCount = 0

    for (const [kind, report] of reportsByKind) {
      const instances = await this.getCachedList(`instances:${report.id}`, () =>
        this.requestAllWithOffset(({ limit }) => `/analyticsReports/${report.id}/instances?filter[granularity]=DAILY&limit=${limit}`, 200)
      )
      const relevant = instances.filter((instance) => {
        const processingDate = instance?.attributes?.processingDate || ''
        return processingDate >= startDate && processingDate <= lastProcessingDate
      })
      instanceCount += instances.length

      const instanceTotals = await mapWithConcurrency(relevant, 4, (instance) => this.getAnalyticsInstanceTotals(instance.id, kind))
      const inRange = (row) => row.date >= startDate && row.date <= endDate && (!row.appId || row.appId === String(appId))
      for (const totals of instanceTotals) {
        rows.push(...totals.territoryRows.filter(inRange))
        sourceRows.push(...totals.sourceRows.filter(inRange))
        referrerRows.push(...totals.referrerRows.filter(inRange))
      }
    }

    return { status: instanceCount > 0 ? 'ready' : 'pending', rows, sourceRows, referrerRows }
  }

  async getAppStoreConversionByCountry({ startDate, endDate, appIds }) {
    const results = await mapWithConcurrency(appIds, 3, async (appId) => ({ appId, ...(await this.getAppStoreAnalyticsRows(appId, { startDate, endDate })) }))
    const countries = new Map()

    for (const result of results) {
      for (const row of result.rows) {
        const entry = countries.get(row.territory) || { countryCode: row.territory, impressions: 0, pageViews: 0, firstDownloads: 0, redownloads: 0 }
        entry.impressions += row.impressions
        entry.pageViews += row.pageViews
        entry.firstDownloads += row.firstDownloads
        entry.redownloads += row.redownloads
        countries.set(row.territory, entry)
      }
    }

    // Per-day source counts stay split by country so the dashboard can filter countries without refetching.
    const sourcesByDate = new Map()
    for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
      sourcesByDate.set(date, { date, countries: {} })
    }
    for (const result of results) {
      for (const row of result.sourceRows) {
        const day = sourcesByDate.get(row.date)
        if (day) {
          const country = (day.countries[row.territory] ||= {})
          country[row.sourceType] = (country[row.sourceType] || 0) + row.downloads
        }
      }
    }

    const referrers = new Map()
    for (const result of results) {
      for (const row of result.referrerRows) {
        const key = `${row.sourceType.toLowerCase()}|${row.sourceInfo}`
        const entry = referrers.get(key) || { sourceType: row.sourceType, name: row.sourceInfo, downloads: 0, countries: {} }
        const country = (entry.countries[row.territory] ||= { downloads: 0, firstDownloads: 0 })
        entry.downloads += row.downloads
        country.downloads += row.downloads
        country.firstDownloads += row.firstDownloads
        referrers.set(key, entry)
      }
    }
    const referrerList = Array.from(referrers.values()).sort((left, right) => right.downloads - left.downloads)

    return {
      statuses: results.map(({ appId, status }) => ({ appId, status })),
      countries: Array.from(countries.values()),
      downloadSourcesByDay: Array.from(sourcesByDate.values()),
      referrers: {
        apps: referrerList.filter((entry) => entry.sourceType.toLowerCase() === 'app referrer'),
        websites: referrerList.filter((entry) => entry.sourceType.toLowerCase() === 'web referrer'),
      },
    }
  }
}

const appStoreConnect = new AppStoreConnectClient()
export default appStoreConnect
