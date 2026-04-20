import fs from 'node:fs'
import path from 'node:path'
import jwt from 'jsonwebtoken'

const API_BASE = 'https://api.appstoreconnect.apple.com/v1'
const EDITABLE_APP_STORE_STATES = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'WAITING_FOR_REVIEW', 'INVALID_BINARY']

class AppStoreConnectClient {
  constructor() {
    this.issuerId = process.env.APP_STORE_ISSUER_ID
    this.keyId = process.env.APP_STORE_KEY_ID
    this.privateKeyPath = process.env.APP_STORE_PRIVATE_KEY_PATH
    this.debug = String(process.env.APP_STORE_CONNECT_DEBUG || '').toLowerCase() === 'true'
    this.debugMaxChars = Number(process.env.APP_STORE_CONNECT_DEBUG_MAX_CHARS || 4000)
    this.token = null
    this.tokenExpiry = null
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
  async getEditableVersion(appId, platform = null) {
    const stateFilter = encodeURIComponent(EDITABLE_APP_STORE_STATES.join(','))
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
        `/appStoreVersions/${version.id}/appStoreVersionLocalizations?fields[appStoreVersionLocalizations]=locale,keywords,description,promotionalText,whatsNew&limit=${limit}`,
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

  async updateAppMetadata(appId, locale, metadata, options = {}) {
    if (!appId) throw new Error('appId is required')
    if (!locale) throw new Error('locale is required')

    const { platform = null } = options

    const hasVersionFields = ['keywords', 'promotionalText', 'description', 'whatsNew'].some((key) => Object.prototype.hasOwnProperty.call(metadata, key))
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

  pickWritableAppClipDefaultExperience(defaultExperiences = []) {
    if (!Array.isArray(defaultExperiences) || defaultExperiences.length === 0) {
      return null
    }

    const editableExperience = defaultExperiences.find((defaultExperience) => {
      const appStoreState = defaultExperience?.releaseWithAppStoreVersion?.attributes?.appStoreState
      return appStoreState && EDITABLE_APP_STORE_STATES.includes(appStoreState)
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
          `/appClipDefaultExperiences/${defaultExperience.id}/appClipDefaultExperienceLocalizations?fields[appClipDefaultExperienceLocalizations]=locale,subtitle&limit=${limit}`,
        200
      )

      for (const localization of experienceLocalizations) {
        localizations.push({
          ...localization,
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

    const { appId } = options
    const { defaultExperiences, localizations } = await this.getAppClipLocalizations(appClipId)
    const existingLocalization = localizations.find((loc) => loc.attributes?.locale === locale)

    if (existingLocalization) {
      return this.updateAppClipLocalization(existingLocalization.id, metadata)
    }

    let defaultExperience = this.pickWritableAppClipDefaultExperience(defaultExperiences)
    const editableVersion = appId ? await this.getEditableVersion(appId) : null

    if (editableVersion?.id) {
      const experienceForEditableVersion = defaultExperiences.find((experience) => experience?.releaseWithAppStoreVersion?.id === editableVersion.id)

      if (experienceForEditableVersion) {
        defaultExperience = experienceForEditableVersion
      }
    }

    if (!defaultExperience?.id) {
      throw new Error(
        `No writable App Clip default experience found for app clip ${appClipId}. Open the App Clip in an editable App Store version before creating a new localization.`
      )
    }

    if (editableVersion?.id && defaultExperience?.releaseWithAppStoreVersion?.id !== editableVersion.id) {
      await this.updateAppClipDefaultExperienceReleaseVersion(defaultExperience.id, editableVersion.id)
      defaultExperience = {
        ...defaultExperience,
        releaseWithAppStoreVersion: editableVersion,
      }
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
}

const appStoreConnect = new AppStoreConnectClient()
export default appStoreConnect
