'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

function localeHasExplicitRegion(locale) {
  if (!locale) {
    return false
  }

  const normalizedLocale = locale.replace('_', '-')
  return normalizedLocale.split('-').some((part) => /^[A-Z]{2}$/i.test(part))
}

function getLocaleScript(locale) {
  if (!locale) {
    return ''
  }

  const normalizedLocale = locale.replace('_', '-')
  return normalizedLocale.split('-').find((part) => /^[A-Za-z]{4}$/.test(part)) || ''
}

function formatLocaleLabel(locale) {
  if (!locale) {
    return 'Global'
  }

  try {
    const normalizedLocale = locale.replace('_', '-')
    const languageDisplayName = new Intl.DisplayNames(['en'], { type: 'language' })
    const regionDisplayName = new Intl.DisplayNames(['en'], { type: 'region' })
    const scriptDisplayName = new Intl.DisplayNames(['en'], { type: 'script' })
    const languageCode = normalizedLocale.split('-')[0]
    const languageName = languageDisplayName.of(languageCode) || languageCode.toUpperCase()
    const scriptCode = getLocaleScript(normalizedLocale)
    const scriptName = scriptCode ? scriptDisplayName.of(scriptCode) || scriptCode : ''

    if (scriptName && localeHasExplicitRegion(normalizedLocale)) {
      const regionCode = normalizedLocale
        .split('-')
        .find((part) => /^[A-Z]{2}$/i.test(part))
        ?.toUpperCase()
      const regionName = regionCode ? regionDisplayName.of(regionCode) : ''

      if (regionName) {
        return `${languageName} (${scriptName}, ${regionName})`
      }
    }

    if (scriptName) {
      return `${languageName} (${scriptName})`
    }

    if (localeHasExplicitRegion(normalizedLocale)) {
      const regionCode = normalizedLocale
        .split('-')
        .find((part) => /^[A-Z]{2}$/i.test(part))
        ?.toUpperCase()
      const regionName = regionCode ? regionDisplayName.of(regionCode) : ''

      if (regionName) {
        return `${languageName} (${regionName})`
      }
    }

    return languageName
  } catch {
    return locale
  }
}

function isEnglishLocale(locale) {
  return /^en([_-]|$)/i.test(String(locale || ''))
}

function mergeLocalizationsByLocale(localizations) {
  const merged = new Map()

  for (const localization of localizations || []) {
    const locale = localization?.attributes?.locale
    if (!locale) {
      continue
    }

    const existing = merged.get(locale)
    if (!existing) {
      merged.set(locale, {
        ...localization,
        attributes: {
          ...localization.attributes,
        },
      })
      continue
    }

    const nextAttributes = localization?.attributes || {}
    const currentAttributes = existing?.attributes || {}

    merged.set(locale, {
      ...existing,
      attributes: {
        ...currentAttributes,
        name: currentAttributes.name || nextAttributes.name || '',
        subtitle: currentAttributes.subtitle || nextAttributes.subtitle || '',
        promotionalText: currentAttributes.promotionalText || nextAttributes.promotionalText || '',
        description: currentAttributes.description || nextAttributes.description || '',
        whatsNew: currentAttributes.whatsNew || nextAttributes.whatsNew || '',
        keywords: currentAttributes.keywords || nextAttributes.keywords || '',
        locale,
      },
    })
  }

  return Array.from(merged.values())
}

function mergeSubscriptionLocalizationsByLocale(localizations, availableLocales = []) {
  const merged = new Map()

  for (const localization of localizations || []) {
    const locale = localization?.attributes?.locale
    if (!locale) {
      continue
    }

    merged.set(locale, {
      ...localization,
      attributes: {
        ...localization.attributes,
      },
    })
  }

  const locales = new Set([...availableLocales.filter(Boolean), ...merged.keys()])

  return Array.from(locales)
    .sort((left, right) => String(left).localeCompare(String(right)))
    .map((locale) => {
      const existing = merged.get(locale)

      return (
        existing || {
          id: `subscription-${locale}`,
          attributes: {
            locale,
            name: '',
            description: '',
          },
        }
      )
    })
}

function mergeSubscriptionGroupLocalizationsByLocale(localizations, availableLocales = []) {
  const merged = new Map()

  for (const localization of localizations || []) {
    const locale = localization?.attributes?.locale
    if (!locale) {
      continue
    }

    merged.set(locale, {
      ...localization,
      attributes: {
        ...localization.attributes,
      },
    })
  }

  const locales = new Set([...availableLocales.filter(Boolean), ...merged.keys()])

  return Array.from(locales)
    .sort((left, right) => String(left).localeCompare(String(right)))
    .map((locale) => {
      const existing = merged.get(locale)

      return (
        existing || {
          id: `subscription-group-${locale}`,
          attributes: {
            locale,
            name: '',
          },
        }
      )
    })
}

function mergeAppClipLocalizationsByLocale(localizations, availableLocales = []) {
  const merged = new Map()

  for (const localization of localizations || []) {
    const locale = localization?.attributes?.locale
    if (!locale) {
      continue
    }

    merged.set(locale, {
      ...localization,
      attributes: {
        ...localization.attributes,
      },
    })
  }

  const locales = new Set([...availableLocales.filter(Boolean), ...merged.keys()])

  return Array.from(locales)
    .sort((left, right) => String(left).localeCompare(String(right)))
    .map((locale) => {
      const existing = merged.get(locale)

      return (
        existing || {
          id: `appclip-${locale}`,
          attributes: {
            locale,
            subtitle: '',
          },
        }
      )
    })
}

function normalizeKeywordsValue(value) {
  const keywords = String(value || '')
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean)

  const seen = new Set()
  const uniqueKeywords = []

  for (const keyword of keywords) {
    const normalizedKeyword = keyword.toLowerCase()
    if (seen.has(normalizedKeyword)) {
      continue
    }

    seen.add(normalizedKeyword)
    uniqueKeywords.push(normalizedKeyword)
  }

  return uniqueKeywords.join(', ')
}

function buildAppleKeywordsString(value) {
  return normalizeKeywordsValue(value)
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .join(',')
}

function countAppleKeywordChars(value) {
  return Array.from(buildAppleKeywordsString(value)).length
}

function countChars(value) {
  return Array.from(String(value || '')).length
}

function getFieldTranslationLimit(field) {
  if (field === 'name' || field === 'subtitle' || field === 'subscription_name' || field === 'subscription_group_name') {
    return { maxChars: 30, strictLessThan: false }
  }

  if (field === 'description' || field === 'subscription_description') {
    return { maxChars: 4000, strictLessThan: false }
  }

  if (field === 'keywords') {
    return { maxChars: 100, strictLessThan: false }
  }

  return null
}

function getComparableFieldValue(field, value) {
  if (field === 'keywords') {
    return normalizeKeywordsValue(value)
  }

  return value || ''
}

function getKeywordMatchesInText(text, keywordsValue) {
  const normalizedText = String(text || '').toLowerCase()
  if (!normalizedText) {
    return []
  }

  const keywords = String(keywordsValue || '')
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean)

  const matches = []
  for (const keyword of keywords) {
    if (normalizedText.includes(keyword.toLowerCase())) {
      matches.push(keyword)
    }
  }

  return matches
}

function normalizeAppName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export default function AppStoreConnect() {
  // Step 1 — app list
  const [apps, setApps] = useState([])
  const [appsLoading, setAppsLoading] = useState(true)
  const [appsError, setAppsError] = useState(null)

  // Step 2 — selected app + its localizations
  const [selectedApp, setSelectedApp] = useState(null)
  const [activeSectionTab, setActiveSectionTab] = useState('aso')
  const [versionMeta, setVersionMeta] = useState(null)
  const [localizations, setLocalizations] = useState([])
  const [localizationsLoading, setLocalizationsLoading] = useState(false)
  const [localizationsError, setLocalizationsError] = useState(null)
  const [subscriptions, setSubscriptions] = useState([])
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false)
  const [subscriptionsError, setSubscriptionsError] = useState(null)
  const [selectedSubscription, setSelectedSubscription] = useState(null)
  const [subscriptionLocalizations, setSubscriptionLocalizations] = useState([])
  const [subscriptionLocalizationsLoading, setSubscriptionLocalizationsLoading] = useState(false)
  const [subscriptionLocalizationsError, setSubscriptionLocalizationsError] = useState(null)
  const [subscriptionMetadataByLocale, setSubscriptionMetadataByLocale] = useState({})
  const [originalSubscriptionMetadataByLocale, setOriginalSubscriptionMetadataByLocale] = useState({})
  const [savingSubscriptions, setSavingSubscriptions] = useState(false)
  const [subscriptionMessage, setSubscriptionMessage] = useState(null)
  const [subscriptionTranslationSourceByLocale, setSubscriptionTranslationSourceByLocale] = useState({})
  const [translatingSubscriptionSectionField, setTranslatingSubscriptionSectionField] = useState(null)
  const [translatingSubscriptionFieldKey, setTranslatingSubscriptionFieldKey] = useState(null)
  const [subscriptionGroupLocalizations, setSubscriptionGroupLocalizations] = useState([])
  const [subscriptionGroupLocalizationsLoading, setSubscriptionGroupLocalizationsLoading] = useState(false)
  const [subscriptionGroupLocalizationsError, setSubscriptionGroupLocalizationsError] = useState(null)
  const [subscriptionGroupMetadataByLocale, setSubscriptionGroupMetadataByLocale] = useState({})
  const [originalSubscriptionGroupMetadataByLocale, setOriginalSubscriptionGroupMetadataByLocale] = useState({})
  const [savingSubscriptionGroups, setSavingSubscriptionGroups] = useState(false)
  const [subscriptionGroupMessage, setSubscriptionGroupMessage] = useState(null)
  const [subscriptionGroupTranslationSourceByLocale, setSubscriptionGroupTranslationSourceByLocale] = useState({})
  const [translatingSubscriptionGroupSectionField, setTranslatingSubscriptionGroupSectionField] = useState(null)
  const [translatingSubscriptionGroupFieldKey, setTranslatingSubscriptionGroupFieldKey] = useState(null)

  // App Clips
  const [appClips, setAppClips] = useState([])
  const [appClipsLoading, setAppClipsLoading] = useState(false)
  const [appClipsError, setAppClipsError] = useState(null)
  const [selectedAppClip, setSelectedAppClip] = useState(null)
  const [appClipLocalizations, setAppClipLocalizations] = useState([])
  const [appClipLocalizationsLoading, setAppClipLocalizationsLoading] = useState(false)
  const [appClipLocalizationsError, setAppClipLocalizationsError] = useState(null)
  const [appClipMetadataByLocale, setAppClipMetadataByLocale] = useState({})
  const [originalAppClipMetadataByLocale, setOriginalAppClipMetadataByLocale] = useState({})
  const [savingAppClip, setSavingAppClip] = useState(false)
  const [appClipMessage, setAppClipMessage] = useState(null)
  const [appClipTranslationSourceByLocale, setAppClipTranslationSourceByLocale] = useState({})
  const [translatingAppClipSectionField, setTranslatingAppClipSectionField] = useState(null)
  const [translatingAppClipFieldKey, setTranslatingAppClipFieldKey] = useState(null)

  // Step 3 — edit form
  const [metadataByLocale, setMetadataByLocale] = useState({})
  const [originalMetadataByLocale, setOriginalMetadataByLocale] = useState({})
  const [savingAll, setSavingAll] = useState(false)
  const [translationSourceByLocale, setTranslationSourceByLocale] = useState({})
  const [translatingSectionField, setTranslatingSectionField] = useState(null)
  const [translatingFieldKey, setTranslatingFieldKey] = useState(null)
  const [keywordSuggestionAdamId, setKeywordSuggestionAdamId] = useState('')
  const [keywordSuggestionSeed, setKeywordSuggestionSeed] = useState('')
  const [keywordDraftByLocale, setKeywordDraftByLocale] = useState({})
  const [keywordSuggestions, setKeywordSuggestions] = useState([])
  const [keywordSuggestionsLoading, setKeywordSuggestionsLoading] = useState(false)
  const [keywordSuggestionsMeta, setKeywordSuggestionsMeta] = useState(null)
  const [keywordSuggestionsError, setKeywordSuggestionsError] = useState(null)
  const [keywordSuggestionAutoFillNote, setKeywordSuggestionAutoFillNote] = useState(null)
  const [progress, setProgress] = useState(null)
  const [message, setMessage] = useState(null)
  const [stopRequested, setStopRequested] = useState(false)
  const stopRequestedRef = useRef(false)
  const activeRequestControllerRef = useRef(null)

  const clearStopRequested = () => {
    stopRequestedRef.current = false
    setStopRequested(false)
  }

  const requestStop = () => {
    stopRequestedRef.current = true
    setStopRequested(true)
    activeRequestControllerRef.current?.abort()
    setMessage({ type: 'error', text: 'Stop requested. Finishing current task...' })
  }

  const createRequestController = () => {
    const controller = new AbortController()
    activeRequestControllerRef.current = controller
    return controller
  }

  const clearRequestController = (controller) => {
    if (activeRequestControllerRef.current === controller) {
      activeRequestControllerRef.current = null
    }
  }

  const loadSelectedAppLocalizations = async (appId, options = {}) => {
    const { clearExisting = false, resetMessage = false } = options

    setLocalizationsLoading(true)
    setLocalizationsError(null)

    if (clearExisting) {
      setLocalizations([])
      setVersionMeta(null)
      setMetadataByLocale({})
      setOriginalMetadataByLocale({})
      setTranslationSourceByLocale({})
    }

    if (resetMessage) {
      setMessage(null)
    }

    try {
      const res = await fetch(`/api/appstore/apps/${appId}/localizations`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message || 'Failed to load localizations')
      const locs = mergeLocalizationsByLocale(json.data || [])
      setVersionMeta(json.meta || null)
      setLocalizations(locs)
      const nextMetadataByLocale = locs.reduce((acc, loc) => {
        const locale = loc?.attributes?.locale
        if (locale) {
          acc[locale] = {
            name: loc?.attributes?.name || '',
            subtitle: loc?.attributes?.subtitle || '',
            keywords: loc?.attributes?.keywords || '',
            promotionalText: loc?.attributes?.promotionalText || '',
            description: loc?.attributes?.description || '',
            whatsNew: loc?.attributes?.whatsNew || '',
          }
        }
        return acc
      }, {})
      setMetadataByLocale(nextMetadataByLocale)
      setOriginalMetadataByLocale(nextMetadataByLocale)
      if (locs.length > 0) {
        const availableLocales = locs.map((loc) => loc?.attributes?.locale).filter(Boolean)
        const englishLocale = getEnglishSourceLocale(availableLocales)
        setTranslationSourceByLocale(
          availableLocales.reduce((acc, targetLocale) => {
            acc[targetLocale] = englishLocale || pickDefaultSourceLocale(availableLocales, targetLocale)
            return acc
          }, {})
        )
      }
    } catch (err) {
      setLocalizationsError(err.message)
      throw err
    } finally {
      setLocalizationsLoading(false)
    }
  }

  const pickDefaultSourceLocale = (availableLocales, targetLocale) => {
    const nonTargetLocales = availableLocales.filter((locale) => locale !== targetLocale)
    if (nonTargetLocales.length === 0) {
      return targetLocale || ''
    }

    return (
      nonTargetLocales.find((locale) => locale.toLowerCase() === 'en-us') ||
      nonTargetLocales.find((locale) => /^en([_-]|$)/i.test(locale)) ||
      nonTargetLocales[0]
    )
  }

  const getEnglishSourceLocale = (availableLocales) => {
    return availableLocales.find((locale) => locale.toLowerCase() === 'en-us') || availableLocales.find((locale) => /^en([_-]|$)/i.test(locale)) || ''
  }

  // Load app list on mount
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/appstore/apps')
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error?.message || 'Failed to load apps')
        setApps(json.data || [])
      } catch (err) {
        setAppsError(err.message)
      } finally {
        setAppsLoading(false)
      }
    }
    load()
  }, [])

  // Load localizations whenever selected app changes
  useEffect(() => {
    if (selectedApp) {
      setActiveSectionTab('aso')
      setKeywordSuggestionAdamId('')
      setKeywordSuggestions([])
      setKeywordSuggestionSeed('')
      setKeywordSuggestionsMeta(null)
      setKeywordSuggestionsError(null)
      setKeywordSuggestionAutoFillNote(null)
      setKeywordDraftByLocale({})
    }
  }, [selectedApp])

  useEffect(() => {
    if (!selectedApp) {
      return
    }

    const selectedAppName = selectedApp?.attributes?.name || ''
    if (!selectedAppName.trim()) {
      setKeywordSuggestionAutoFillNote('App name is unavailable, so suggestions will run by keyword only.')
      return
    }

    let cancelled = false

    const loadApplications = async () => {
      try {
        const res = await fetch('/api/applications')
        const json = await res.json()

        if (!res.ok) {
          throw new Error(json?.error?.message || 'Failed to load Apple Ads applications')
        }

        const applications = json?.data?.data || []
        const normalizedSelectedName = normalizeAppName(selectedAppName)

        const exactMatches = applications.filter((application) => normalizeAppName(application?.appName) === normalizedSelectedName)
        const partialMatches = applications.filter((application) => {
          const appName = normalizeAppName(application?.appName)
          return appName.includes(normalizedSelectedName) || normalizedSelectedName.includes(appName)
        })

        const bestMatch = exactMatches[0] || (partialMatches.length === 1 ? partialMatches[0] : null)

        if (cancelled) {
          return
        }

        if (bestMatch?.adamId) {
          setKeywordSuggestionAdamId(String(bestMatch.adamId))
          setKeywordSuggestionAutoFillNote(`Auto-filled from Apple Ads app: ${bestMatch.appName}.`)
          return
        }

        setKeywordSuggestionAutoFillNote('Could not confidently auto-match this app in Apple Ads. Suggestions will run by keyword only.')
      } catch (error) {
        if (cancelled) {
          return
        }

        setKeywordSuggestionAutoFillNote(`Auto-fill unavailable: ${error.message}`)
      }
    }

    loadApplications()

    return () => {
      cancelled = true
    }
  }, [selectedApp])

  useEffect(() => {
    if (!selectedApp) return
    const load = async () => {
      try {
        await loadSelectedAppLocalizations(selectedApp.id, { clearExisting: true, resetMessage: true })
      } catch (err) {
        setLocalizationsError(err.message)
      }
    }
    load()
  }, [selectedApp])

  useEffect(() => {
    if (!selectedApp) {
      return
    }

    const load = async () => {
      setSubscriptionsLoading(true)
      setSubscriptionsError(null)
      setSubscriptions([])
      setSelectedSubscription(null)
      setSubscriptionLocalizations([])
      setSubscriptionMetadataByLocale({})
      setOriginalSubscriptionMetadataByLocale({})
      setSubscriptionGroupLocalizations([])
      setSubscriptionGroupMetadataByLocale({})
      setOriginalSubscriptionGroupMetadataByLocale({})
      setSubscriptionMessage(null)
      setSubscriptionGroupMessage(null)

      try {
        const res = await fetch(`/api/appstore/apps/${selectedApp.id}/subscriptions`)
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json?.error?.message || 'Failed to load subscriptions')
        }

        const nextSubscriptions = json.data || []
        setSubscriptions(nextSubscriptions)
        setSelectedSubscription(nextSubscriptions[0] || null)
      } catch (err) {
        setSubscriptionsError(err.message)
      } finally {
        setSubscriptionsLoading(false)
      }
    }

    load()
  }, [selectedApp])

  useEffect(() => {
    if (!selectedApp) {
      setAppClips([])
      setSelectedAppClip(null)
      setAppClipLocalizations([])
      setAppClipMetadataByLocale({})
      setOriginalAppClipMetadataByLocale({})
      setAppClipTranslationSourceByLocale({})
      return
    }

    const load = async () => {
      setAppClipsLoading(true)
      setAppClipsError(null)
      setAppClips([])
      setSelectedAppClip(null)
      setAppClipLocalizations([])
      setAppClipMetadataByLocale({})
      setOriginalAppClipMetadataByLocale({})
      setAppClipTranslationSourceByLocale({})
      setAppClipMessage(null)

      try {
        const res = await fetch(`/api/appstore/apps/${selectedApp.id}/appclips`)
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json?.error?.message || 'Failed to load app clips')
        }

        const nextAppClips = json.data || []
        setAppClips(nextAppClips)
        setSelectedAppClip(nextAppClips[0] || null)
      } catch (err) {
        setAppClipsError(err.message)
      } finally {
        setAppClipsLoading(false)
      }
    }

    load()
  }, [selectedApp])

  useEffect(() => {
    if (!selectedAppClip) {
      setAppClipLocalizations([])
      setAppClipMetadataByLocale({})
      setOriginalAppClipMetadataByLocale({})
      setAppClipTranslationSourceByLocale({})
      return
    }

    const load = async () => {
      setAppClipLocalizationsLoading(true)
      setAppClipLocalizationsError(null)
      setAppClipMessage(null)

      try {
        const res = await fetch(`/api/appstore/appclips/${selectedAppClip.id}/localizations`)
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json?.error?.message || 'Failed to load app clip localizations')
        }

        const nextLocalizations = json.data || []
        const availableLocales = localizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
        const mergedByLocale = mergeAppClipLocalizationsByLocale(nextLocalizations, availableLocales)
        setAppClipLocalizations(mergedByLocale)
        const metadataMap = {}
        const originalMetadataMap = {}

        for (const loc of mergedByLocale) {
          const locale = loc?.attributes?.locale
          if (!locale) {
            continue
          }

          metadataMap[locale] = {
            subtitle: loc.attributes?.subtitle || '',
          }

          originalMetadataMap[locale] = {
            subtitle: loc.attributes?.subtitle || '',
          }
        }

        setAppClipMetadataByLocale(metadataMap)
        setOriginalAppClipMetadataByLocale(originalMetadataMap)
        if (mergedByLocale.length > 0) {
          const mergedAvailableLocales = mergedByLocale.map((loc) => loc?.attributes?.locale).filter(Boolean)
          const englishLocale = getEnglishSourceLocale(mergedAvailableLocales)
          setAppClipTranslationSourceByLocale(
            mergedAvailableLocales.reduce((acc, targetLocale) => {
              acc[targetLocale] = englishLocale || pickDefaultSourceLocale(mergedAvailableLocales, targetLocale)
              return acc
            }, {})
          )
        }
      } catch (err) {
        setAppClipLocalizationsError(err.message)
      } finally {
        setAppClipLocalizationsLoading(false)
      }
    }

    load()
  }, [selectedAppClip, localizations])

  useEffect(() => {
    if (!selectedSubscription) {
      setSubscriptionLocalizations([])
      setSubscriptionMetadataByLocale({})
      setOriginalSubscriptionMetadataByLocale({})
      setSubscriptionGroupLocalizations([])
      setSubscriptionGroupMetadataByLocale({})
      setOriginalSubscriptionGroupMetadataByLocale({})
      return
    }

    const load = async () => {
      setSubscriptionLocalizationsLoading(true)
      setSubscriptionLocalizationsError(null)
      setSubscriptionMessage(null)

      try {
        const res = await fetch(`/api/appstore/subscriptions/${selectedSubscription.id}/localizations`)
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json?.error?.message || 'Failed to load subscription localizations')
        }

        const availableLocales = localizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
        const mergedLocalizations = mergeSubscriptionLocalizationsByLocale(json.data || [], availableLocales)
        setSubscriptionLocalizations(mergedLocalizations)

        const nextMetadataByLocale = mergedLocalizations.reduce((acc, loc) => {
          const locale = loc?.attributes?.locale
          if (locale) {
            acc[locale] = {
              name: loc?.attributes?.name || '',
              description: loc?.attributes?.description || '',
            }
          }
          return acc
        }, {})

        setSubscriptionMetadataByLocale(nextMetadataByLocale)
        setOriginalSubscriptionMetadataByLocale(nextMetadataByLocale)
        if (mergedLocalizations.length > 0) {
          const mergedAvailableLocales = mergedLocalizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
          const englishLocale = getEnglishSourceLocale(mergedAvailableLocales)
          setSubscriptionTranslationSourceByLocale(
            mergedAvailableLocales.reduce((acc, targetLocale) => {
              acc[targetLocale] = englishLocale || pickDefaultSourceLocale(mergedAvailableLocales, targetLocale)
              return acc
            }, {})
          )
        }
      } catch (err) {
        setSubscriptionLocalizationsError(err.message)
      } finally {
        setSubscriptionLocalizationsLoading(false)
      }
    }

    load()
  }, [selectedSubscription, localizations])

  useEffect(() => {
    const subscriptionGroupId = selectedSubscription?.subscriptionGroup?.id

    if (!subscriptionGroupId) {
      setSubscriptionGroupLocalizations([])
      setSubscriptionGroupMetadataByLocale({})
      setOriginalSubscriptionGroupMetadataByLocale({})
      return
    }

    const load = async () => {
      setSubscriptionGroupLocalizationsLoading(true)
      setSubscriptionGroupLocalizationsError(null)
      setSubscriptionGroupMessage(null)

      try {
        const res = await fetch(`/api/appstore/subscription-groups/${subscriptionGroupId}/localizations`)
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json?.error?.message || 'Failed to load subscription group localizations')
        }

        const availableLocales = localizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
        const mergedLocalizations = mergeSubscriptionGroupLocalizationsByLocale(json.data || [], availableLocales)
        setSubscriptionGroupLocalizations(mergedLocalizations)

        const nextMetadataByLocale = mergedLocalizations.reduce((acc, loc) => {
          const locale = loc?.attributes?.locale
          if (locale) {
            acc[locale] = {
              name: loc?.attributes?.name || '',
            }
          }
          return acc
        }, {})

        setSubscriptionGroupMetadataByLocale(nextMetadataByLocale)
        setOriginalSubscriptionGroupMetadataByLocale(nextMetadataByLocale)

        if (mergedLocalizations.length > 0) {
          const mergedAvailableLocales = mergedLocalizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
          const englishLocale = getEnglishSourceLocale(mergedAvailableLocales)
          setSubscriptionGroupTranslationSourceByLocale(
            mergedAvailableLocales.reduce((acc, targetLocale) => {
              acc[targetLocale] = englishLocale || pickDefaultSourceLocale(mergedAvailableLocales, targetLocale)
              return acc
            }, {})
          )
        }
      } catch (err) {
        setSubscriptionGroupLocalizationsError(err.message)
      } finally {
        setSubscriptionGroupLocalizationsLoading(false)
      }
    }

    load()
  }, [selectedSubscription, localizations])

  const handleMetadataChange = (locale, field, value) => {
    const nextValue = field === 'keywords' ? normalizeKeywordsValue(value) : value

    setMetadataByLocale((previous) => ({
      ...previous,
      [locale]: {
        ...(previous[locale] || {
          name: '',
          subtitle: '',
          keywords: '',
          promotionalText: '',
          description: '',
          whatsNew: '',
        }),
        [field]: nextValue,
      },
    }))
    setMessage(null)
  }

  const handleKeywordDraftChange = (locale, value) => {
    setKeywordDraftByLocale((previous) => ({
      ...previous,
      [locale]: String(value || '').toLowerCase(),
    }))
  }

  const handleAddKeywordToLocale = (locale) => {
    const draft = String(keywordDraftByLocale[locale] || '')
      .trim()
      .toLowerCase()

    if (!draft) {
      return
    }

    const nextKeywords = normalizeKeywordsValue([metadataByLocale[locale]?.keywords || '', draft].join(','))

    handleMetadataChange(locale, 'keywords', nextKeywords)
    setKeywordDraftByLocale((previous) => ({
      ...previous,
      [locale]: '',
    }))
  }

  const handleSubscriptionMetadataChange = (locale, field, value) => {
    setSubscriptionMetadataByLocale((previous) => ({
      ...previous,
      [locale]: {
        ...(previous[locale] || { name: '', description: '' }),
        [field]: value,
      },
    }))
    setSubscriptionMessage(null)
  }

  const isFieldChanged = (locale, field) => {
    return getComparableFieldValue(field, metadataByLocale[locale]?.[field]) !== getComparableFieldValue(field, originalMetadataByLocale[locale]?.[field])
  }

  const isSubscriptionFieldChanged = (locale, field) => {
    return String(subscriptionMetadataByLocale[locale]?.[field] || '') !== String(originalSubscriptionMetadataByLocale[locale]?.[field] || '')
  }

  const handleSubscriptionGroupMetadataChange = (locale, field, value) => {
    setSubscriptionGroupMetadataByLocale((previous) => ({
      ...previous,
      [locale]: {
        ...(previous[locale] || { name: '' }),
        [field]: value,
      },
    }))
    setSubscriptionGroupMessage(null)
  }

  const isSubscriptionGroupFieldChanged = (locale, field) => {
    return String(subscriptionGroupMetadataByLocale[locale]?.[field] || '') !== String(originalSubscriptionGroupMetadataByLocale[locale]?.[field] || '')
  }

  const handleAppClipMetadataChange = (locale, field, value) => {
    setAppClipMetadataByLocale((previous) => ({
      ...previous,
      [locale]: {
        ...(previous[locale] || { subtitle: '' }),
        [field]: value,
      },
    }))
    setAppClipMessage(null)
  }

  const isAppClipFieldChanged = (locale, field) => {
    return String(appClipMetadataByLocale[locale]?.[field] || '') !== String(originalAppClipMetadataByLocale[locale]?.[field] || '')
  }

  const getChangedAppClipMetadataForLocale = (locale) => {
    const changedMetadata = {}

    for (const field of ['subtitle']) {
      if (!isAppClipFieldChanged(locale, field)) {
        continue
      }

      changedMetadata[field] = appClipMetadataByLocale[locale]?.[field] || ''
    }

    return changedMetadata
  }

  const getChangedMetadataForLocale = (locale) => {
    const changedMetadata = {}

    for (const field of ['name', 'subtitle', 'keywords', 'promotionalText', 'description', 'whatsNew']) {
      if (!isFieldChanged(locale, field)) {
        continue
      }

      if (field === 'keywords') {
        changedMetadata[field] = buildAppleKeywordsString(metadataByLocale[locale]?.[field] || '')
          .split(',')
          .filter(Boolean)
        continue
      }

      changedMetadata[field] = metadataByLocale[locale]?.[field] || ''
    }

    return changedMetadata
  }

  const getExportMetadataForLocale = (locale) => {
    return {
      name: metadataByLocale[locale]?.name || '',
      subtitle: metadataByLocale[locale]?.subtitle || '',
      keywords: buildAppleKeywordsString(metadataByLocale[locale]?.keywords || '')
        .split(',')
        .filter(Boolean),
      promotionalText: metadataByLocale[locale]?.promotionalText || '',
      description: metadataByLocale[locale]?.description || '',
      whatsNew: metadataByLocale[locale]?.whatsNew || '',
    }
  }

  const getChangedSubscriptionMetadataForLocale = (locale) => {
    const changedMetadata = {}

    for (const field of ['name', 'description']) {
      if (!isSubscriptionFieldChanged(locale, field)) {
        continue
      }

      changedMetadata[field] = subscriptionMetadataByLocale[locale]?.[field] || ''
    }

    return changedMetadata
  }

  const getChangedSubscriptionGroupMetadataForLocale = (locale) => {
    const changedMetadata = {}

    for (const field of ['name']) {
      if (!isSubscriptionGroupFieldChanged(locale, field)) {
        continue
      }

      changedMetadata[field] = subscriptionGroupMetadataByLocale[locale]?.[field] || ''
    }

    return changedMetadata
  }

  const changedLocales = useMemo(() => {
    return localizations
      .map((loc) => loc?.attributes?.locale)
      .filter(Boolean)
      .filter((locale) => Object.keys(getChangedMetadataForLocale(locale)).length > 0)
  }, [localizations, metadataByLocale, originalMetadataByLocale])
  const hasChangedVersionMetadata = useMemo(() => {
    return changedLocales.some((locale) => ['keywords', 'promotionalText', 'description', 'whatsNew'].some((field) => isFieldChanged(locale, field)))
  }, [changedLocales, metadataByLocale, originalMetadataByLocale])

  const changedSubscriptionLocales = useMemo(() => {
    return subscriptionLocalizations
      .map((loc) => loc?.attributes?.locale)
      .filter(Boolean)
      .filter((locale) => Object.keys(getChangedSubscriptionMetadataForLocale(locale)).length > 0)
  }, [subscriptionLocalizations, subscriptionMetadataByLocale, originalSubscriptionMetadataByLocale])

  const hasChangedLocales = changedLocales.length > 0
  const hasChangedSubscriptionLocales = changedSubscriptionLocales.length > 0
  const changedSubscriptionGroupLocales = useMemo(() => {
    return subscriptionGroupLocalizations
      .map((loc) => loc?.attributes?.locale)
      .filter(Boolean)
      .filter((locale) => Object.keys(getChangedSubscriptionGroupMetadataForLocale(locale)).length > 0)
  }, [subscriptionGroupLocalizations, subscriptionGroupMetadataByLocale, originalSubscriptionGroupMetadataByLocale])
  const hasChangedSubscriptionGroupLocales = changedSubscriptionGroupLocales.length > 0
  const nameLimitByLocale = useMemo(() => {
    return localizations
      .map((loc) => loc?.attributes?.locale)
      .filter(Boolean)
      .reduce((acc, locale) => {
        const nameCount = countChars(metadataByLocale[locale]?.name || '')
        acc[locale] = nameCount > 30
        return acc
      }, {})
  }, [localizations, metadataByLocale])
  const subtitleLimitByLocale = useMemo(() => {
    return localizations
      .map((loc) => loc?.attributes?.locale)
      .filter(Boolean)
      .reduce((acc, locale) => {
        const subtitleCount = countChars(metadataByLocale[locale]?.subtitle || '')
        acc[locale] = subtitleCount > 30
        return acc
      }, {})
  }, [localizations, metadataByLocale])
  const keywordsLimitByLocale = useMemo(() => {
    return localizations
      .map((loc) => loc?.attributes?.locale)
      .filter(Boolean)
      .reduce((acc, locale) => {
        const keywordsCount = countAppleKeywordChars(metadataByLocale[locale]?.keywords || '')
        acc[locale] = keywordsCount > 100
        return acc
      }, {})
  }, [localizations, metadataByLocale])
  const hasNameLimitError = Object.values(nameLimitByLocale).some(Boolean)
  const hasSubtitleLimitError = Object.values(subtitleLimitByLocale).some(Boolean)
  const hasKeywordsLimitError = Object.values(keywordsLimitByLocale).some(Boolean)
  const descriptionLimitByLocale = useMemo(() => {
    return localizations
      .map((loc) => loc?.attributes?.locale)
      .filter(Boolean)
      .reduce((acc, locale) => {
        const descriptionCount = countChars(metadataByLocale[locale]?.description || '')
        acc[locale] = descriptionCount > 4000
        return acc
      }, {})
  }, [localizations, metadataByLocale])
  const hasDescriptionLimitError = Object.values(descriptionLimitByLocale).some(Boolean)
  const hasAnyMetadataLimitError = hasNameLimitError || hasSubtitleLimitError || hasKeywordsLimitError || hasDescriptionLimitError
  const hasBlockingAction = savingAll || translatingSectionField !== null || translatingFieldKey !== null
  const progressPercent = progress ? Math.min(100, Math.max(0, Math.round((progress.current / Math.max(progress.total, 1)) * 100))) : 0

  const saveLocaleMetadata = async (locale, signal) => {
    const changedMetadata = getChangedMetadataForLocale(locale)
    if (Object.keys(changedMetadata).length === 0) {
      return false
    }

    const res = await fetch('/api/appstore/keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        appId: selectedApp.id,
        locale,
        ...changedMetadata,
      }),
    })

    const json = await res.json()
    if (!res.ok) {
      throw new Error(json?.error?.message || 'Unknown error')
    }

    return true
  }

  const handleSaveAllLocales = async () => {
    if (hasNameLimitError) {
      setMessage({ type: 'error', text: 'App Name must be less than or equal to 30 characters for all locales.' })
      return
    }

    if (hasSubtitleLimitError) {
      setMessage({ type: 'error', text: 'Subtitle must be less than or equal to 30 characters for all locales.' })
      return
    }

    if (hasKeywordsLimitError) {
      setMessage({ type: 'error', text: 'Keywords must be less than or equal to 100 characters for all locales.' })
      return
    }

    if (hasDescriptionLimitError) {
      setMessage({ type: 'error', text: 'Description must be less than or equal to 4000 characters for all locales.' })
      return
    }

    const localesToUpdate = [...changedLocales]

    if (localesToUpdate.length === 0) {
      setMessage({ type: 'error', text: 'No changed locales to update.' })
      return
    }

    if (!versionMeta?.versionId && hasChangedVersionMetadata) {
      setMessage({
        type: 'error',
        text: "Keywords, Promotional Text, Description, and What's New require an editable App Store version. Create or open a version in Prepare for Submission first.",
      })
      return
    }

    clearStopRequested()
    setSavingAll(true)
    setProgress({
      type: 'update',
      label: 'Updating changed locales',
      current: 0,
      total: localesToUpdate.length,
    })
    setMessage(null)

    try {
      const updatedLocales = []
      for (const [index, locale] of localesToUpdate.entries()) {
        if (stopRequestedRef.current) {
          setMessage({ type: 'error', text: `Update stopped. ${updatedLocales.length} locale${updatedLocales.length === 1 ? '' : 's'} updated.` })
          break
        }

        const controller = createRequestController()
        await saveLocaleMetadata(locale, controller.signal)
        clearRequestController(controller)
        updatedLocales.push(locale)
        setProgress({
          type: 'update',
          label: `Updating changed locales: ${locale}`,
          current: index + 1,
          total: localesToUpdate.length,
        })
      }

      if (updatedLocales.length > 0 && updatedLocales.length === localesToUpdate.length) {
        await loadSelectedAppLocalizations(selectedApp.id)
      }

      if (!stopRequestedRef.current) {
        setMessage({ type: 'success', text: `Updated ${updatedLocales.length} changed locale${updatedLocales.length === 1 ? '' : 's'} successfully.` })
      }
    } catch (err) {
      if (err?.name === 'AbortError' && stopRequestedRef.current) {
        setMessage({ type: 'error', text: 'Update stopped by user.' })
      } else {
        setMessage({ type: 'error', text: err.message })
      }
    } finally {
      activeRequestControllerRef.current = null
      clearStopRequested()
      setSavingAll(false)
      setProgress(null)
    }
  }

  const handleTranslateSectionField = async (field) => {
    const locales = localizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
    if (locales.length === 0) {
      setMessage({ type: 'error', text: 'No locales available for translation.' })
      return
    }

    const englishSourceLocale = getEnglishSourceLocale(locales)
    if (!englishSourceLocale) {
      setMessage({ type: 'error', text: 'No English locale found (en-US/en-*). Add an English localization first.' })
      return
    }

    clearStopRequested()
    setTranslatingSectionField(field)
    setProgress({
      type: 'translate',
      label: `Translating ${field}`,
      current: 0,
      total: locales.length,
    })
    setMessage(null)

    try {
      const fieldLimit = getFieldTranslationLimit(field)
      let completed = 0
      for (const targetLocale of locales) {
        if (stopRequestedRef.current) {
          setMessage({ type: 'error', text: `Translation stopped. ${completed} locale${completed === 1 ? '' : 's'} completed.` })
          break
        }

        const sourceLocale = englishSourceLocale

        if (!sourceLocale || sourceLocale === targetLocale) {
          completed += 1
          setProgress({
            type: 'translate',
            label: `Translating ${field}: ${targetLocale}`,
            current: completed,
            total: locales.length,
          })
          continue
        }

        const sourceValue = metadataByLocale[sourceLocale]?.[field] || ''
        if (!sourceValue.trim()) {
          completed += 1
          setProgress({
            type: 'translate',
            label: `Translating ${field}: ${targetLocale}`,
            current: completed,
            total: locales.length,
          })
          continue
        }

        const controller = createRequestController()
        const res = await fetch('/api/appstore/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text: sourceValue,
            sourceLocale,
            targetLocale,
            maxChars: fieldLimit?.maxChars,
            strictLessThan: fieldLimit?.strictLessThan,
          }),
        })
        clearRequestController(controller)

        const json = await res.json()
        if (!res.ok) {
          throw new Error(json?.error?.message || 'Translation failed')
        }

        handleMetadataChange(targetLocale, field, json?.translatedText || '')
        completed += 1
        setProgress({
          type: 'translate',
          label: `Translating ${field}: ${targetLocale}`,
          current: completed,
          total: locales.length,
        })
      }

      if (!stopRequestedRef.current) {
        setMessage({ type: 'success', text: `${field} translated for all locales.` })
      }
    } catch (err) {
      if (err?.name === 'AbortError' && stopRequestedRef.current) {
        setMessage({ type: 'error', text: 'Translation stopped by user.' })
      } else {
        setMessage({ type: 'error', text: err.message })
      }
    } finally {
      activeRequestControllerRef.current = null
      clearStopRequested()
      setTranslatingSectionField(null)
      setProgress(null)
    }
  }

  const handleTranslateLocaleField = async (field, targetLocale) => {
    const locales = localizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
    const sourceLocale = getEnglishSourceLocale(locales)

    if (!sourceLocale) {
      setMessage({ type: 'error', text: 'No English locale found (en-US/en-*). Add an English localization first.' })
      return
    }

    if (sourceLocale === targetLocale) {
      setMessage({ type: 'error', text: `Source and target locale are the same (${targetLocale}).` })
      return
    }

    const sourceValue = metadataByLocale[sourceLocale]?.[field] || ''
    if (!sourceValue.trim()) {
      setMessage({ type: 'error', text: `Source ${field} is empty for ${sourceLocale}.` })
      return
    }

    const key = `${targetLocale}:${field}`
    clearStopRequested()
    setTranslatingFieldKey(key)
    setProgress({
      type: 'translate',
      label: `Translating ${field}: ${targetLocale}`,
      current: 0,
      total: 1,
    })
    setMessage(null)

    try {
      const fieldLimit = getFieldTranslationLimit(field)
      const controller = createRequestController()
      const res = await fetch('/api/appstore/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: sourceValue,
          sourceLocale,
          targetLocale,
          maxChars: fieldLimit?.maxChars,
          strictLessThan: fieldLimit?.strictLessThan,
        }),
      })
      clearRequestController(controller)

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error?.message || 'Translation failed')
      }

      handleMetadataChange(targetLocale, field, json?.translatedText || '')
      setProgress({
        type: 'translate',
        label: `Translating ${field}: ${targetLocale}`,
        current: 1,
        total: 1,
      })
      setMessage({ type: 'success', text: `${field} translated for ${targetLocale}.` })
    } catch (err) {
      if (err?.name === 'AbortError' && stopRequestedRef.current) {
        setMessage({ type: 'error', text: 'Translation stopped by user.' })
      } else {
        setMessage({ type: 'error', text: err.message })
      }
    } finally {
      activeRequestControllerRef.current = null
      clearStopRequested()
      setTranslatingFieldKey(null)
      setProgress(null)
    }
  }

  const handleSuggestKeywords = async () => {
    const adamId = String(keywordSuggestionAdamId || '').trim()
    const seedKeyword = String(keywordSuggestionSeed || '').trim()

    if (!seedKeyword) {
      setKeywordSuggestionsError('Please enter at least one keyword.')
      return
    }

    const locales = localizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
    const locale = getEnglishSourceLocale(locales) || locales[0] || 'en-US'

    setKeywordSuggestionsLoading(true)
    setKeywordSuggestionsError(null)
    setKeywordSuggestions([])
    setKeywordSuggestionsMeta(null)

    try {
      const res = await fetch('/api/appstore/keywords/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adamId: adamId || undefined,
          seedKeyword,
          locale,
          limit: 30,
        }),
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error?.message || 'Failed to load keyword suggestions')
      }

      setKeywordSuggestions(json?.data || [])
      setKeywordSuggestionsMeta(json?.meta || null)

      if (!json?.data?.length) {
        setKeywordSuggestionsError('No suggestions found for this input.')
      }
    } catch (error) {
      setKeywordSuggestionsError(error.message)
    } finally {
      setKeywordSuggestionsLoading(false)
    }
  }

  const saveAppClipLocaleMetadata = async (locale) => {
    const changedMetadata = getChangedAppClipMetadataForLocale(locale)
    if (Object.keys(changedMetadata).length === 0) {
      return false
    }

    const res = await fetch('/api/appstore/appclips/localizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: selectedApp?.id,
        appClipId: selectedAppClip.id,
        locale,
        ...changedMetadata,
      }),
    })

    const json = await res.json()
    if (!res.ok) {
      throw new Error(json?.error?.message || 'Unknown error')
    }

    return true
  }

  const changedAppClipLocales = useMemo(() => {
    return Array.from(
      new Set(
        appClipLocalizations
          .map((loc) => loc?.attributes?.locale)
          .filter(Boolean)
          .filter((locale) => Object.keys(getChangedAppClipMetadataForLocale(locale)).length > 0)
      )
    )
  }, [appClipLocalizations, appClipMetadataByLocale, originalAppClipMetadataByLocale])

  const hasChangedAppClipLocales = changedAppClipLocales.length > 0
  const hasBlockingAppClipAction = savingAppClip || translatingAppClipSectionField !== null || translatingAppClipFieldKey !== null

  const handleTranslateAppClipSectionField = async (field) => {
    const locales = appClipLocalizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
    if (locales.length === 0) {
      setAppClipMessage({ type: 'error', text: 'No app clip locales available for translation.' })
      return
    }

    const englishSourceLocale = getEnglishSourceLocale(locales)
    if (!englishSourceLocale) {
      setAppClipMessage({ type: 'error', text: 'No English locale found (en-US/en-*). Add an English app clip localization first.' })
      return
    }

    clearStopRequested()
    setTranslatingAppClipSectionField(field)
    setProgress({
      type: 'translate',
      label: `Translating app clip ${field}`,
      current: 0,
      total: locales.length,
    })
    setAppClipMessage(null)

    try {
      const fieldLimit = getFieldTranslationLimit(field)
      let completed = 0
      for (const targetLocale of locales) {
        if (stopRequestedRef.current) {
          setAppClipMessage({ type: 'error', text: `Translation stopped. ${completed} locale${completed === 1 ? '' : 's'} completed.` })
          break
        }

        if (englishSourceLocale === targetLocale) {
          completed += 1
          setProgress({
            type: 'translate',
            label: `Translating app clip ${field}: ${targetLocale}`,
            current: completed,
            total: locales.length,
          })
          continue
        }

        const sourceValue = appClipMetadataByLocale[englishSourceLocale]?.[field] || ''
        if (!sourceValue.trim()) {
          completed += 1
          setProgress({
            type: 'translate',
            label: `Translating app clip ${field}: ${targetLocale}`,
            current: completed,
            total: locales.length,
          })
          continue
        }

        const controller = createRequestController()
        const res = await fetch('/api/appstore/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text: sourceValue,
            sourceLocale: englishSourceLocale,
            targetLocale,
            maxChars: fieldLimit?.maxChars,
            strictLessThan: fieldLimit?.strictLessThan,
          }),
        })
        clearRequestController(controller)

        const json = await res.json()
        if (!res.ok) {
          throw new Error(json?.error?.message || 'Translation failed')
        }

        handleAppClipMetadataChange(targetLocale, field, json?.translatedText || '')
        completed += 1
        setProgress({
          type: 'translate',
          label: `Translating app clip ${field}: ${targetLocale}`,
          current: completed,
          total: locales.length,
        })
      }

      if (!stopRequestedRef.current) {
        setAppClipMessage({ type: 'success', text: `App clip ${field} translated for all locales.` })
      }
    } catch (err) {
      if (err?.name === 'AbortError' && stopRequestedRef.current) {
        setAppClipMessage({ type: 'error', text: 'Translation stopped by user.' })
      } else {
        setAppClipMessage({ type: 'error', text: err.message })
      }
    } finally {
      activeRequestControllerRef.current = null
      clearStopRequested()
      setTranslatingAppClipSectionField(null)
      setProgress(null)
    }
  }

  const handleTranslateAppClipLocaleField = async (field, targetLocale) => {
    const locales = appClipLocalizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
    const sourceLocale = getEnglishSourceLocale(locales)

    if (!sourceLocale) {
      setAppClipMessage({ type: 'error', text: 'No English locale found (en-US/en-*). Add an English app clip localization first.' })
      return
    }

    if (sourceLocale === targetLocale) {
      setAppClipMessage({ type: 'error', text: `Source and target locale are the same (${targetLocale}).` })
      return
    }

    const sourceValue = appClipMetadataByLocale[sourceLocale]?.[field] || ''
    if (!sourceValue.trim()) {
      setAppClipMessage({ type: 'error', text: `Source ${field} is empty for ${sourceLocale}.` })
      return
    }

    const key = `${targetLocale}:${field}`
    clearStopRequested()
    setTranslatingAppClipFieldKey(key)
    setProgress({
      type: 'translate',
      label: `Translating app clip ${field}: ${targetLocale}`,
      current: 0,
      total: 1,
    })
    setAppClipMessage(null)

    try {
      const fieldLimit = getFieldTranslationLimit(field)
      const controller = createRequestController()
      const res = await fetch('/api/appstore/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: sourceValue,
          sourceLocale,
          targetLocale,
          maxChars: fieldLimit?.maxChars,
          strictLessThan: fieldLimit?.strictLessThan,
        }),
      })
      clearRequestController(controller)

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error?.message || 'Translation failed')
      }

      handleAppClipMetadataChange(targetLocale, field, json?.translatedText || '')
      setProgress({
        type: 'translate',
        label: `Translating app clip ${field}: ${targetLocale}`,
        current: 1,
        total: 1,
      })
      setAppClipMessage({ type: 'success', text: `App clip ${field} translated for ${targetLocale}.` })
    } catch (err) {
      if (err?.name === 'AbortError' && stopRequestedRef.current) {
        setAppClipMessage({ type: 'error', text: 'Translation stopped by user.' })
      } else {
        setAppClipMessage({ type: 'error', text: err.message })
      }
    } finally {
      activeRequestControllerRef.current = null
      clearStopRequested()
      setTranslatingAppClipFieldKey(null)
      setProgress(null)
    }
  }

  const handleSaveAllAppClipLocales = async () => {
    setSavingAppClip(true)
    setAppClipMessage(null)

    try {
      const updatedLocales = []

      for (const locale of changedAppClipLocales) {
        await saveAppClipLocaleMetadata(locale)
        updatedLocales.push(locale)
      }

      setOriginalAppClipMetadataByLocale((previous) => {
        const next = { ...previous }
        for (const locale of updatedLocales) {
          next[locale] = { ...appClipMetadataByLocale[locale] }
        }
        return next
      })

      setAppClipMessage({
        type: 'success',
        text: `Updated ${updatedLocales.length} app clip locale${updatedLocales.length === 1 ? '' : 's'} successfully.`,
      })
    } catch (err) {
      setAppClipMessage({ type: 'error', text: err.message })
    } finally {
      setSavingAppClip(false)
    }
  }

  const handleExportToMacOS = async () => {
    if (!selectedApp) {
      setMessage({ type: 'error', text: 'Please select an app first.' })
      return
    }

    const exportLocalizations = localizations.reduce((accumulator, loc) => {
      const locale = loc?.attributes?.locale
      if (locale) {
        accumulator[locale] = getExportMetadataForLocale(locale)
      }
      return accumulator
    }, {})

    if (Object.keys(exportLocalizations).length === 0) {
      setMessage({ type: 'error', text: 'No locales to export.' })
      return
    }

    if (!versionMeta?.versionId && hasChangedVersionMetadata) {
      setMessage({
        type: 'error',
        text: "Keywords, Promotional Text, Description, and What's New require an editable App Store version. Create or open a version in Prepare for Submission first.",
      })
      return
    }

    setSavingAll(true)
    setMessage(null)

    try {
      const res = await fetch('/api/appstore/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: selectedApp.id,
          localizations: exportLocalizations,
          subscriptions: subscriptionMetadataByLocale,
          subscriptionGroups: subscriptionGroupMetadataByLocale,
        }),
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error?.message || 'Export failed')
      }

      const successCount = Number(json?.data?.summary?.success || 0)
      const errorCount = Number(json?.data?.summary?.errors || 0)

      const succeededLocales = (json?.data?.updates || [])
        .filter((item) => item?.status === 'success')
        .map((item) => item?.locale)
        .filter(Boolean)
      if (succeededLocales.length > 0 && errorCount === 0) {
        await loadSelectedAppLocalizations(selectedApp.id)
      }

      if (errorCount > 0) {
        setMessage({
          type: 'error',
          text: `Export partially completed. Updated ${successCount} locale${successCount === 1 ? '' : 's'}, ${errorCount} failed.`,
        })
      } else {
        setMessage({ type: 'success', text: `Successfully exported to macOS app (${successCount} locale${successCount === 1 ? '' : 's'}).` })
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSavingAll(false)
    }
  }

  const saveSubscriptionLocaleMetadata = async (locale) => {
    const changedMetadata = getChangedSubscriptionMetadataForLocale(locale)
    if (Object.keys(changedMetadata).length === 0) {
      return false
    }

    const res = await fetch('/api/appstore/subscriptions/localizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriptionId: selectedSubscription.id,
        locale,
        ...changedMetadata,
      }),
    })

    const json = await res.json()
    if (!res.ok) {
      throw new Error(json?.error?.message || 'Unknown error')
    }

    return true
  }

  const handleSaveAllSubscriptionLocales = async () => {
    if (changedSubscriptionLocales.length === 0) {
      setSubscriptionMessage({ type: 'error', text: 'No changed subscription locales to update.' })
      return
    }

    setSavingSubscriptions(true)
    setSubscriptionMessage(null)

    try {
      const updatedLocales = []

      for (const locale of changedSubscriptionLocales) {
        await saveSubscriptionLocaleMetadata(locale)
        updatedLocales.push(locale)
      }

      setOriginalSubscriptionMetadataByLocale((previous) => {
        const next = { ...previous }
        for (const locale of updatedLocales) {
          next[locale] = { ...subscriptionMetadataByLocale[locale] }
        }
        return next
      })

      setSubscriptionMessage({
        type: 'success',
        text: `Updated ${updatedLocales.length} subscription locale${updatedLocales.length === 1 ? '' : 's'} successfully.`,
      })
    } catch (err) {
      setSubscriptionMessage({ type: 'error', text: err.message })
    } finally {
      setSavingSubscriptions(false)
    }
  }

  const saveSubscriptionGroupLocaleMetadata = async (locale) => {
    const changedMetadata = getChangedSubscriptionGroupMetadataForLocale(locale)
    if (Object.keys(changedMetadata).length === 0) {
      return false
    }

    const res = await fetch('/api/appstore/subscription-groups/localizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriptionGroupId: selectedSubscription?.subscriptionGroup?.id,
        locale,
        ...changedMetadata,
      }),
    })

    const json = await res.json()
    if (!res.ok) {
      throw new Error(json?.error?.message || 'Unknown error')
    }

    return true
  }

  const handleSaveAllSubscriptionGroupLocales = async () => {
    if (changedSubscriptionGroupLocales.length === 0) {
      setSubscriptionGroupMessage({ type: 'error', text: 'No changed subscription group locales to update.' })
      return
    }

    setSavingSubscriptionGroups(true)
    setSubscriptionGroupMessage(null)

    try {
      const updatedLocales = []

      for (const locale of changedSubscriptionGroupLocales) {
        await saveSubscriptionGroupLocaleMetadata(locale)
        updatedLocales.push(locale)
      }

      setOriginalSubscriptionGroupMetadataByLocale((previous) => {
        const next = { ...previous }
        for (const locale of updatedLocales) {
          next[locale] = { ...subscriptionGroupMetadataByLocale[locale] }
        }
        return next
      })

      setSubscriptionGroupMessage({
        type: 'success',
        text: `Updated ${updatedLocales.length} subscription group locale${updatedLocales.length === 1 ? '' : 's'} successfully.`,
      })
    } catch (err) {
      setSubscriptionGroupMessage({ type: 'error', text: err.message })
    } finally {
      setSavingSubscriptionGroups(false)
    }
  }

  const handleTranslateSubscriptionGroupSectionField = async (field) => {
    const locales = subscriptionGroupLocalizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
    if (locales.length === 0) {
      setSubscriptionGroupMessage({ type: 'error', text: 'No locales available for translation.' })
      return
    }

    const englishSourceLocale = getEnglishSourceLocale(locales)
    if (!englishSourceLocale) {
      setSubscriptionGroupMessage({ type: 'error', text: 'No English locale found (en-US/en-*). Add an English localization first.' })
      return
    }

    clearStopRequested()
    setTranslatingSubscriptionGroupSectionField(field)
    setProgress({
      type: 'translate',
      label: `Translating subscription group ${field}`,
      current: 0,
      total: locales.length,
    })
    setSubscriptionGroupMessage(null)

    try {
      const fieldLimit = getFieldTranslationLimit(`subscription_group_${field}`)
      let completed = 0
      for (const targetLocale of locales) {
        if (stopRequestedRef.current) {
          setSubscriptionGroupMessage({ type: 'error', text: `Translation stopped. ${completed} locale${completed === 1 ? '' : 's'} completed.` })
          break
        }

        const sourceLocale = englishSourceLocale

        if (!sourceLocale || sourceLocale === targetLocale) {
          completed += 1
          setProgress({
            type: 'translate',
            label: `Translating subscription group ${field}: ${targetLocale}`,
            current: completed,
            total: locales.length,
          })
          continue
        }

        const sourceValue = subscriptionGroupMetadataByLocale[sourceLocale]?.[field] || ''
        if (!sourceValue.trim()) {
          completed += 1
          setProgress({
            type: 'translate',
            label: `Translating subscription group ${field}: ${targetLocale}`,
            current: completed,
            total: locales.length,
          })
          continue
        }

        const controller = createRequestController()
        const res = await fetch('/api/appstore/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text: sourceValue,
            sourceLocale,
            targetLocale,
            maxChars: fieldLimit?.maxChars,
            strictLessThan: fieldLimit?.strictLessThan,
          }),
        })
        clearRequestController(controller)

        const json = await res.json()
        if (!res.ok) {
          throw new Error(json?.error?.message || 'Translation failed')
        }

        handleSubscriptionGroupMetadataChange(targetLocale, field, json?.translatedText || '')
        completed += 1
        setProgress({
          type: 'translate',
          label: `Translating subscription group ${field}: ${targetLocale}`,
          current: completed,
          total: locales.length,
        })
      }

      if (!stopRequestedRef.current) {
        setSubscriptionGroupMessage({ type: 'success', text: `Subscription group ${field} translated for all locales.` })
      }
    } catch (err) {
      if (err?.name === 'AbortError' && stopRequestedRef.current) {
        setSubscriptionGroupMessage({ type: 'error', text: 'Translation stopped by user.' })
      } else {
        setSubscriptionGroupMessage({ type: 'error', text: err.message })
      }
    } finally {
      activeRequestControllerRef.current = null
      clearStopRequested()
      setTranslatingSubscriptionGroupSectionField(null)
      setProgress(null)
    }
  }

  const handleTranslateSubscriptionGroupLocaleField = async (field, targetLocale) => {
    const locales = subscriptionGroupLocalizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
    const sourceLocale = getEnglishSourceLocale(locales)

    if (!sourceLocale) {
      setSubscriptionGroupMessage({ type: 'error', text: 'No English locale found (en-US/en-*). Add an English localization first.' })
      return
    }

    if (sourceLocale === targetLocale) {
      setSubscriptionGroupMessage({ type: 'error', text: `Source and target locale are the same (${targetLocale}).` })
      return
    }

    const sourceValue = subscriptionGroupMetadataByLocale[sourceLocale]?.[field] || ''
    if (!sourceValue.trim()) {
      setSubscriptionGroupMessage({ type: 'error', text: `Source ${field} is empty for ${sourceLocale}.` })
      return
    }

    const key = `${targetLocale}:${field}`
    clearStopRequested()
    setTranslatingSubscriptionGroupFieldKey(key)
    setProgress({
      type: 'translate',
      label: `Translating subscription group ${field}: ${targetLocale}`,
      current: 0,
      total: 1,
    })
    setSubscriptionGroupMessage(null)

    try {
      const fieldLimit = getFieldTranslationLimit(`subscription_group_${field}`)
      const controller = createRequestController()
      const res = await fetch('/api/appstore/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: sourceValue,
          sourceLocale,
          targetLocale,
          maxChars: fieldLimit?.maxChars,
          strictLessThan: fieldLimit?.strictLessThan,
        }),
      })
      clearRequestController(controller)

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error?.message || 'Translation failed')
      }

      handleSubscriptionGroupMetadataChange(targetLocale, field, json?.translatedText || '')
      setProgress({
        type: 'translate',
        label: `Translating subscription group ${field}: ${targetLocale}`,
        current: 1,
        total: 1,
      })
      setSubscriptionGroupMessage({ type: 'success', text: `Subscription group ${field} translated for ${targetLocale}.` })
    } catch (err) {
      if (err?.name === 'AbortError' && stopRequestedRef.current) {
        setSubscriptionGroupMessage({ type: 'error', text: 'Translation stopped by user.' })
      } else {
        setSubscriptionGroupMessage({ type: 'error', text: err.message })
      }
    } finally {
      activeRequestControllerRef.current = null
      clearStopRequested()
      setTranslatingSubscriptionGroupFieldKey(null)
      setProgress(null)
    }
  }

  const handleTranslateSubscriptionSectionField = async (field) => {
    const locales = subscriptionLocalizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
    if (locales.length === 0) {
      setSubscriptionMessage({ type: 'error', text: 'No locales available for translation.' })
      return
    }

    const englishSourceLocale = getEnglishSourceLocale(locales)
    if (!englishSourceLocale) {
      setSubscriptionMessage({ type: 'error', text: 'No English locale found (en-US/en-*). Add an English localization first.' })
      return
    }

    clearStopRequested()
    setTranslatingSubscriptionSectionField(field)
    setProgress({
      type: 'translate',
      label: `Translating subscription ${field}`,
      current: 0,
      total: locales.length,
    })
    setSubscriptionMessage(null)

    try {
      const fieldLimit = getFieldTranslationLimit(`subscription_${field}`)
      let completed = 0
      for (const targetLocale of locales) {
        if (stopRequestedRef.current) {
          setSubscriptionMessage({ type: 'error', text: `Translation stopped. ${completed} locale${completed === 1 ? '' : 's'} completed.` })
          break
        }

        const sourceLocale = englishSourceLocale

        if (!sourceLocale || sourceLocale === targetLocale) {
          completed += 1
          setProgress({
            type: 'translate',
            label: `Translating subscription ${field}: ${targetLocale}`,
            current: completed,
            total: locales.length,
          })
          continue
        }

        const sourceValue = subscriptionMetadataByLocale[sourceLocale]?.[field] || ''
        if (!sourceValue.trim()) {
          completed += 1
          setProgress({
            type: 'translate',
            label: `Translating subscription ${field}: ${targetLocale}`,
            current: completed,
            total: locales.length,
          })
          continue
        }

        const controller = createRequestController()
        const res = await fetch('/api/appstore/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text: sourceValue,
            sourceLocale,
            targetLocale,
            maxChars: fieldLimit?.maxChars,
            strictLessThan: fieldLimit?.strictLessThan,
          }),
        })
        clearRequestController(controller)

        const json = await res.json()
        if (!res.ok) {
          throw new Error(json?.error?.message || 'Translation failed')
        }

        handleSubscriptionMetadataChange(targetLocale, field, json?.translatedText || '')
        completed += 1
        setProgress({
          type: 'translate',
          label: `Translating subscription ${field}: ${targetLocale}`,
          current: completed,
          total: locales.length,
        })
      }

      if (!stopRequestedRef.current) {
        setSubscriptionMessage({ type: 'success', text: `Subscription ${field} translated for all locales.` })
      }
    } catch (err) {
      if (err?.name === 'AbortError' && stopRequestedRef.current) {
        setSubscriptionMessage({ type: 'error', text: 'Translation stopped by user.' })
      } else {
        setSubscriptionMessage({ type: 'error', text: err.message })
      }
    } finally {
      activeRequestControllerRef.current = null
      clearStopRequested()
      setTranslatingSubscriptionSectionField(null)
      setProgress(null)
    }
  }

  const handleTranslateSubscriptionLocaleField = async (field, targetLocale) => {
    const locales = subscriptionLocalizations.map((loc) => loc?.attributes?.locale).filter(Boolean)
    const sourceLocale = getEnglishSourceLocale(locales)

    if (!sourceLocale) {
      setSubscriptionMessage({ type: 'error', text: 'No English locale found (en-US/en-*). Add an English localization first.' })
      return
    }

    if (sourceLocale === targetLocale) {
      setSubscriptionMessage({ type: 'error', text: `Source and target locale are the same (${targetLocale}).` })
      return
    }

    const sourceValue = subscriptionMetadataByLocale[sourceLocale]?.[field] || ''
    if (!sourceValue.trim()) {
      setSubscriptionMessage({ type: 'error', text: `Source ${field} is empty for ${sourceLocale}.` })
      return
    }

    const key = `${targetLocale}:${field}`
    clearStopRequested()
    setTranslatingSubscriptionFieldKey(key)
    setProgress({
      type: 'translate',
      label: `Translating subscription ${field}: ${targetLocale}`,
      current: 0,
      total: 1,
    })
    setSubscriptionMessage(null)

    try {
      const fieldLimit = getFieldTranslationLimit(`subscription_${field}`)
      const controller = createRequestController()
      const res = await fetch('/api/appstore/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: sourceValue,
          sourceLocale,
          targetLocale,
          maxChars: fieldLimit?.maxChars,
          strictLessThan: fieldLimit?.strictLessThan,
        }),
      })
      clearRequestController(controller)

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error?.message || 'Translation failed')
      }

      handleSubscriptionMetadataChange(targetLocale, field, json?.translatedText || '')
      setProgress({
        type: 'translate',
        label: `Translating subscription ${field}: ${targetLocale}`,
        current: 1,
        total: 1,
      })
      setSubscriptionMessage({ type: 'success', text: `Subscription ${field} translated for ${targetLocale}.` })
    } catch (err) {
      if (err?.name === 'AbortError' && stopRequestedRef.current) {
        setSubscriptionMessage({ type: 'error', text: 'Translation stopped by user.' })
      } else {
        setSubscriptionMessage({ type: 'error', text: err.message })
      }
    } finally {
      activeRequestControllerRef.current = null
      clearStopRequested()
      setTranslatingSubscriptionFieldKey(null)
      setProgress(null)
    }
  }

  return (
    <div className="w-full rounded-3xl bg-white p-6 shadow-lg shadow-slate-200/70 ring-1 ring-slate-200 sm:p-8">
      <div className="mb-6">
        <h3 className="text-2xl font-semibold tracking-tight text-slate-900">App Store Connect</h3>
        <p className="mt-1 text-sm text-slate-500">Select an app and manage localized metadata sections at once.</p>
      </div>

      {/* Step 1 — App list */}
      {appsLoading && <p className="text-sm text-slate-500">Loading apps…</p>}
      {appsError && <p className="text-sm text-rose-600">{appsError}</p>}
      {!appsLoading && !appsError && (
        <div className="mb-6">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-500">App</label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => setSelectedApp(app)}
                className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                  selectedApp?.id === app.id
                    ? 'border-sky-700 bg-sky-50 font-semibold text-sky-900 ring-1 ring-sky-700'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-400'
                }`}>
                <div className="font-medium">{app.attributes?.name || app.id}</div>
                <div className="mt-0.5 text-xs text-slate-400">{app.attributes?.bundleId || app.id}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2 — Localizations + edit */}
      {selectedApp && (
        <div className="border-t border-slate-100 pt-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setActiveSectionTab('submit')}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  activeSectionTab === 'submit' ? 'bg-sky-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                }`}>
                Submit
              </button>
              <button
                type="button"
                onClick={() => setActiveSectionTab('aso')}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  activeSectionTab === 'aso' ? 'bg-sky-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                }`}>
                ASO
              </button>
              <button
                type="button"
                onClick={() => setActiveSectionTab('subscriptions')}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  activeSectionTab === 'subscriptions' ? 'bg-sky-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                }`}>
                Subscriptions
              </button>
              <button
                type="button"
                onClick={() => setActiveSectionTab('appclips')}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  activeSectionTab === 'appclips' ? 'bg-sky-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                }`}>
                App Clips
              </button>
            </div>
            <button
              type="button"
              onClick={handleExportToMacOS}
              disabled={savingAll}
              className="ml-auto inline-flex items-center justify-center rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
              {savingAll ? 'Exporting…' : '⬆ Export to macOS App'}
            </button>
          </div>

          {(activeSectionTab === 'aso' || activeSectionTab === 'submit') && (
            <>
              {localizationsLoading && <p className="text-sm text-slate-500">Loading localizations…</p>}
              {localizationsError && <p className="text-sm text-rose-600">{localizationsError}</p>}

              {/* Show version info */}
              {!localizationsLoading && versionMeta && (
                <div className="flex items-center gap-2 text-xs text-slate-600 mb-4">
                  {versionMeta.versionString && (
                    <span className="rounded-full bg-blue-100 px-3 py-1 font-semibold tracking-wide text-blue-900 ring-1 ring-blue-200">
                      v{versionMeta.versionString}
                    </span>
                  )}
                  {versionMeta.appStoreState && (
                    <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold tracking-wide">{versionMeta.appStoreState.replace(/_/g, ' ')}</span>
                  )}
                </div>
              )}

              {!localizationsLoading && !localizationsError && versionMeta && !versionMeta.versionId && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Showing metadata from the latest App Store version. To update keywords, promotional text, description, or What's New, the app must also have
                  an editable version in <strong>Prepare for Submission</strong>, a rejected state, or similar.
                </div>
              )}
              {!localizationsLoading && !localizationsError && localizations.length === 0 && versionMeta?.versionId && (
                <p className="text-sm text-slate-500">No localizations found for this version.</p>
              )}
              {!localizationsLoading && localizations.length > 0 && (
                <div className="relative grid gap-4">
                  {activeSectionTab === 'aso' && (
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)] xl:items-start">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 xl:sticky xl:top-4">
                        <div className="mb-3 flex items-center gap-2">
                          <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500">ASO Core By Locale</h4>
                          {[
                            { key: 'name', label: 'Name' },
                            { key: 'subtitle', label: 'Subtitle' },
                            { key: 'keywords', label: 'Keywords' },
                          ].map((field) => (
                            <button
                              key={`translate-core-${field.key}`}
                              type="button"
                              onClick={() => handleTranslateSectionField(field.key)}
                              disabled={hasBlockingAction}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600 disabled:opacity-50">
                              {translatingSectionField === field.key ? `Translating ${field.label}…` : `Translate ${field.label}`}
                            </button>
                          ))}
                        </div>

                        <div className="grid gap-3">
                          {localizations.map((loc) => {
                            const locale = loc?.attributes?.locale || 'unknown'
                            const localeLabel = formatLocaleLabel(locale)
                            const isEnglish = isEnglishLocale(locale)
                            const localeMetadata = metadataByLocale[locale] || {
                              name: '',
                              subtitle: '',
                              keywords: '',
                              promotionalText: '',
                              description: '',
                              whatsNew: '',
                            }
                            const hasCoreChanged = ['name', 'subtitle', 'keywords'].some((field) => isFieldChanged(locale, field))

                            return (
                              <div
                                key={`core-${loc.id}`}
                                className={`rounded-xl border p-3 transition ${hasCoreChanged ? 'border-amber-300 bg-amber-50/60 shadow-sm ring-1 ring-amber-200' : 'border-slate-200 bg-white'}`}>
                                <div className="mb-3 flex items-center gap-2">
                                  <span className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold tracking-wide text-sky-900 ring-1 ring-sky-200">
                                    <span>{localeLabel}</span>
                                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-sky-800 ring-1 ring-sky-200">
                                      {locale}
                                    </span>
                                  </span>

                                  {hasCoreChanged && (
                                    <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">
                                      Changed
                                    </span>
                                  )}

                                  {!isEnglish && (
                                    <>
                                      <label className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Source</label>
                                      <select
                                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                        value={translationSourceByLocale[locale] || ''}
                                        disabled>
                                        {localizations
                                          .map((sourceLoc) => sourceLoc?.attributes?.locale)
                                          .filter(Boolean)
                                          .filter((sourceLocale) => /^en([_-]|$)/i.test(sourceLocale))
                                          .map((sourceLocale) => (
                                            <option key={`core-${locale}-source-${sourceLocale}`} value={sourceLocale}>
                                              {sourceLocale}
                                            </option>
                                          ))}
                                      </select>
                                    </>
                                  )}
                                </div>

                                <div className="grid gap-3">
                                  {[
                                    { key: 'name', label: 'App Name', rows: 1 },
                                    { key: 'subtitle', label: 'Subtitle', rows: 2 },
                                    { key: 'keywords', label: 'Keywords', rows: 3 },
                                  ].map((field) => {
                                    const fieldChanged = isFieldChanged(locale, field.key)
                                    const matchedKeywords =
                                      field.key === 'name' || field.key === 'subtitle'
                                        ? getKeywordMatchesInText(localeMetadata[field.key] || '', localeMetadata.keywords || '')
                                        : []
                                    const hasKeywordMatch = matchedKeywords.length > 0
                                    return (
                                      <div key={`core-field-${locale}-${field.key}`}>
                                        <div className="mb-1 flex items-center gap-2">
                                          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{field.label}</label>
                                          {hasKeywordMatch && (
                                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
                                              Keyword Match
                                            </span>
                                          )}
                                          {!isEnglish && (
                                            <button
                                              type="button"
                                              onClick={() => handleTranslateLocaleField(field.key, locale)}
                                              disabled={hasBlockingAction}
                                              className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600 disabled:opacity-50">
                                              {translatingFieldKey === `${locale}:${field.key}` ? 'Translating…' : 'Translate'}
                                            </button>
                                          )}
                                        </div>

                                        <textarea
                                          rows={field.rows}
                                          className={`w-full rounded-xl border px-3 py-2 text-sm text-slate-700 ${fieldChanged ? 'border-amber-300 bg-amber-50/40 focus:border-amber-400' : 'border-slate-200 bg-white'} ${
                                            hasKeywordMatch ? 'ring-1 ring-emerald-200 border-emerald-300 bg-emerald-50/40 focus:border-emerald-400' : ''
                                          }`}
                                          value={localeMetadata[field.key] || ''}
                                          onChange={(e) => handleMetadataChange(locale, field.key, e.target.value)}
                                        />

                                        {hasKeywordMatch && (
                                          <div className="mt-2 flex items-center justify-between">
                                            <p className="text-xs text-emerald-700">Matched keywords: {matchedKeywords.join(', ')}</p>
                                          </div>
                                        )}

                                        {field.key === 'name' && (
                                          <div className="mt-2">
                                            <p
                                              className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${
                                                countChars(localeMetadata.name || '') > 30
                                                  ? 'bg-rose-50 text-rose-700 ring-rose-200'
                                                  : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                              }`}>
                                              Name: {countChars(localeMetadata.name || '')} / 30
                                            </p>
                                            {countChars(localeMetadata.name || '') > 30 && (
                                              <p className="mt-1 text-xs font-semibold text-rose-600">
                                                Warning: Name exceeds the limit by {countChars(localeMetadata.name || '') - 30} characters.
                                              </p>
                                            )}
                                          </div>
                                        )}

                                        {field.key === 'subtitle' && (
                                          <div className="mt-2">
                                            <p
                                              className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${
                                                countChars(localeMetadata.subtitle || '') > 30
                                                  ? 'bg-rose-50 text-rose-700 ring-rose-200'
                                                  : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                              }`}>
                                              Subtitle: {countChars(localeMetadata.subtitle || '')} / 30
                                            </p>
                                            {countChars(localeMetadata.subtitle || '') > 30 && (
                                              <p className="mt-1 text-xs font-semibold text-rose-600">
                                                Warning: Subtitle exceeds the limit by {countChars(localeMetadata.subtitle || '') - 30} characters.
                                              </p>
                                            )}
                                          </div>
                                        )}

                                        {field.key === 'keywords' && (
                                          <div className="mt-2 space-y-2">
                                            <div className="flex items-center gap-2">
                                              <input
                                                type="text"
                                                value={keywordDraftByLocale[locale] || ''}
                                                onChange={(event) => handleKeywordDraftChange(locale, event.target.value)}
                                                onKeyDown={(event) => {
                                                  if (event.key === 'Enter') {
                                                    event.preventDefault()
                                                    handleAddKeywordToLocale(locale)
                                                  }
                                                }}
                                                placeholder="add keyword"
                                                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => handleAddKeywordToLocale(locale)}
                                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-600 hover:border-slate-300">
                                                Add
                                              </button>
                                            </div>
                                            <p
                                              className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${
                                                countAppleKeywordChars(localeMetadata.keywords || '') > 100
                                                  ? 'bg-rose-50 text-rose-700 ring-rose-200'
                                                  : countAppleKeywordChars(localeMetadata.keywords || '') < 100
                                                    ? 'bg-amber-50 text-amber-700 ring-amber-200'
                                                    : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                              }`}>
                                              Keywords: {countAppleKeywordChars(localeMetadata.keywords || '')} / 100
                                            </p>
                                            {countAppleKeywordChars(localeMetadata.keywords || '') > 100 && (
                                              <p className="text-xs font-semibold text-rose-600">
                                                Warning: Keywords exceed the limit by {countAppleKeywordChars(localeMetadata.keywords || '') - 100} characters.
                                              </p>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      <div className="sticky top-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-3">
                          <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Keyword Suggestions</h4>
                          <p className="mt-1 text-xs text-slate-500">
                            Uses free App Store Search results to estimate related keywords, popularity, and competition.
                          </p>
                        </div>

                        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end xl:grid-cols-1">
                          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            Keywords
                            <input
                              type="text"
                              value={keywordSuggestionSeed}
                              onChange={(event) => setKeywordSuggestionSeed(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  handleSuggestKeywords()
                                }
                              }}
                              placeholder="e.g. sleep tracker, meditation app"
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                            />
                          </label>

                          <button
                            type="button"
                            onClick={handleSuggestKeywords}
                            disabled={keywordSuggestionsLoading}
                            className="inline-flex items-center justify-center rounded-full bg-sky-900 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60 xl:w-full">
                            {keywordSuggestionsLoading ? 'Suggesting…' : 'Suggest Keywords'}
                          </button>
                        </div>

                        {keywordSuggestionAutoFillNote && <p className="mt-2 text-xs text-slate-500">{keywordSuggestionAutoFillNote}</p>}

                        {keywordSuggestionsMeta?.source && (
                          <p className="mt-3 text-xs text-slate-500">
                            Source: <span className="font-semibold text-slate-700">{keywordSuggestionsMeta.source}</span>
                            {keywordSuggestionsMeta?.note ? ` · ${keywordSuggestionsMeta.note}` : ''}
                          </p>
                        )}

                        {keywordSuggestionsError && <p className="mt-3 text-sm text-rose-600">{keywordSuggestionsError}</p>}

                        {!keywordSuggestionsError && keywordSuggestions.length > 0 && (
                          <div className="mt-3  max-h-[70vh] overflow-x-auto rounded-xl border border-slate-200 bg-white">
                            <table className="min-w-full text-left text-sm">
                              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                                <tr>
                                  <th className="px-3 py-2">Keyword</th>
                                  <th className="px-3 py-2">Popularity</th>
                                  <th className="px-3 py-2">Competition</th>
                                  <th className="px-3 py-2">Search Signal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {keywordSuggestions.map((item, index) => {
                                  return (
                                    <tr key={`${item.keyword}-${index}`} className="border-t border-slate-100">
                                      <td className="px-3 py-2 font-medium text-slate-800">{item.keyword}</td>
                                      <td className="px-3 py-2 text-slate-700">{Number(item.popularity || 0)}</td>
                                      <td className="px-3 py-2">
                                        <span
                                          className={`rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wider ${
                                            item.competition === 'high'
                                              ? 'bg-rose-100 text-rose-700'
                                              : item.competition === 'medium'
                                                ? 'bg-amber-100 text-amber-800'
                                                : 'bg-emerald-100 text-emerald-700'
                                          }`}>
                                          {item.competition || 'low'}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-slate-700">{item.signal || 'Derived from matching app titles and metadata'}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeSectionTab === 'submit' &&
                    localizations.length > 0 &&
                    [
                      { key: 'promotionalText', label: 'Promotional Text', rows: 2 },
                      { key: 'description', label: 'Description', rows: 4 },
                      { key: 'whatsNew', label: "Update Message (What's New)", rows: 3 },
                    ].map((field) => (
                      <div key={field.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-3 flex items-center gap-2">
                          <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500">{field.label}</h4>
                          <button
                            type="button"
                            onClick={() => handleTranslateSectionField(field.key)}
                            disabled={hasBlockingAction}
                            className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600 disabled:opacity-50">
                            {translatingSectionField === field.key ? 'Translating…' : 'Translate Section'}
                          </button>
                        </div>

                        <div className="grid gap-3">
                          {localizations.map((loc) => {
                            const locale = loc?.attributes?.locale || 'unknown'
                            const localeLabel = formatLocaleLabel(locale)
                            const isEnglish = isEnglishLocale(locale)
                            const fieldChanged = isFieldChanged(locale, field.key)
                            const localeMetadata = metadataByLocale[locale] || {
                              name: '',
                              subtitle: '',
                              keywords: '',
                              promotionalText: '',
                              description: '',
                              whatsNew: '',
                            }

                            return (
                              <div
                                key={`${field.key}-${loc.id}`}
                                className={`rounded-xl border p-3 transition ${fieldChanged ? 'border-amber-300 bg-amber-50/60 shadow-sm ring-1 ring-amber-200' : 'border-slate-200 bg-white'}`}>
                                <div className="mb-2 flex items-center gap-2">
                                  <span className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold tracking-wide text-sky-900 ring-1 ring-sky-200">
                                    <span>{localeLabel}</span>
                                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-sky-800 ring-1 ring-sky-200">
                                      {locale}
                                    </span>
                                  </span>

                                  {fieldChanged && (
                                    <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">
                                      Changed
                                    </span>
                                  )}

                                  {!isEnglish && (
                                    <>
                                      <label className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Source</label>
                                      <select
                                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                        value={translationSourceByLocale[locale] || ''}
                                        disabled>
                                        {localizations
                                          .map((sourceLoc) => sourceLoc?.attributes?.locale)
                                          .filter(Boolean)
                                          .filter((sourceLocale) => /^en([_-]|$)/i.test(sourceLocale))
                                          .map((sourceLocale) => (
                                            <option key={`${field.key}-${locale}-source-${sourceLocale}`} value={sourceLocale}>
                                              {sourceLocale}
                                            </option>
                                          ))}
                                      </select>
                                      <button
                                        type="button"
                                        onClick={() => handleTranslateLocaleField(field.key, locale)}
                                        disabled={hasBlockingAction}
                                        className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600 disabled:opacity-50">
                                        {translatingFieldKey === `${locale}:${field.key}` ? 'Translating…' : 'Translate'}
                                      </button>
                                    </>
                                  )}
                                </div>

                                <textarea
                                  rows={field.rows}
                                  className={`w-full rounded-xl border px-3 py-2 text-sm text-slate-700 ${fieldChanged ? 'border-amber-300 bg-amber-50/40 focus:border-amber-400' : 'border-slate-200 bg-white'}`}
                                  value={localeMetadata[field.key] || ''}
                                  onChange={(e) => handleMetadataChange(locale, field.key, e.target.value)}
                                />

                                {field.key === 'description' && (
                                  <div className="mt-2">
                                    <p
                                      className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${
                                        countChars(localeMetadata.description || '') > 4000
                                          ? 'bg-rose-50 text-rose-700 ring-rose-200'
                                          : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                      }`}>
                                      Description: {countChars(localeMetadata.description || '')} / 4000
                                    </p>
                                    {countChars(localeMetadata.description || '') > 4000 && (
                                      <p className="mt-1 text-xs font-semibold text-rose-600">
                                        Warning: Description exceeds the limit by {countChars(localeMetadata.description || '') - 4000} characters.
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  <div className="sticky max-w-150 ml-auto mr-4 bottom-4 z-20 rounded-2xl border border-sky-200 bg-white/95 p-4 shadow-lg backdrop-blur">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-sky-900">{progress ? progress.label : 'Ready to update changed locales'}</p>
                          <span className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                            {progress ? `${progressPercent}%` : `${changedLocales.length} changed`}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-sky-700">
                          {progress ? `${progress.current} of ${progress.total} complete` : 'Only changed locales will be submitted.'}
                        </p>
                        <div
                          className="mt-2 h-2 overflow-hidden rounded-full bg-sky-100"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={progress ? progressPercent : 0}>
                          <div className="h-full rounded-full bg-sky-600 transition-all duration-300" style={{ width: `${progress ? progressPercent : 0}%` }} />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleSaveAllLocales}
                        disabled={hasBlockingAction || !hasChangedLocales || hasAnyMetadataLimitError}
                        className="inline-flex shrink-0 items-center justify-center rounded-full bg-sky-900 px-4 py-2 text-md font-semibold text-white hover:bg-sky-800 disabled:opacity-60">
                        {savingAll ? 'Updating…' : `Update Locales (${changedLocales.length})`}
                      </button>

                      <button
                        type="button"
                        onClick={requestStop}
                        disabled={!hasBlockingAction || stopRequested}
                        className="inline-flex shrink-0 items-center justify-center rounded-full border border-rose-300 bg-white px-4 py-2 text-md font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                        {stopRequested ? 'Stopping…' : 'Stop'}
                      </button>
                    </div>
                    <div>
                      {message && <span className={message.type === 'error' ? 'text-sm text-rose-600' : 'text-sm text-green-600'}>{message.text}</span>}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {activeSectionTab === 'subscriptions' && (
            <div>
              <div className="mb-4">
                <h4 className="text-lg font-semibold tracking-tight text-slate-900">Subscription Localizations</h4>
                <p className="mt-1 text-sm text-slate-500">Select a subscription product and edit its localized name and description.</p>
              </div>

              {subscriptionsLoading && <p className="text-sm text-slate-500">Loading subscriptions…</p>}
              {subscriptionsError && <p className="text-sm text-rose-600">{subscriptionsError}</p>}

              {!subscriptionsLoading && !subscriptionsError && subscriptions.length === 0 ? (
                <p className="text-sm text-slate-500">No subscriptions found for this app.</p>
              ) : null}

              {!subscriptionsLoading && subscriptions.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {subscriptions.map((subscription) => (
                    <button
                      key={subscription.id}
                      type="button"
                      onClick={() => setSelectedSubscription(subscription)}
                      className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                        selectedSubscription?.id === subscription.id
                          ? 'border-sky-700 bg-sky-50 font-semibold text-sky-900 ring-1 ring-sky-700'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-400'
                      }`}>
                      <div className="font-medium">{subscription.attributes?.name || subscription.attributes?.productId || subscription.id}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{subscription.attributes?.productId || subscription.id}</div>
                      {subscription.subscriptionGroup?.referenceName ? (
                        <div className="mt-1 text-[11px] text-slate-500">Group: {subscription.subscriptionGroup.referenceName}</div>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}

              {selectedSubscription ? (
                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {selectedSubscription.attributes?.name || selectedSubscription.attributes?.productId}
                      </div>
                      <div className="text-xs text-slate-500">{selectedSubscription.attributes?.productId || selectedSubscription.id}</div>
                    </div>
                    <div className="text-xs text-slate-500">
                      {selectedSubscription.attributes?.subscriptionPeriod || 'Subscription'}
                      {selectedSubscription.attributes?.state ? ` · ${selectedSubscription.attributes.state}` : ''}
                    </div>
                  </div>

                  {subscriptionLocalizationsLoading && <p className="text-sm text-slate-500">Loading subscription localizations…</p>}
                  {subscriptionLocalizationsError && <p className="text-sm text-rose-600">{subscriptionLocalizationsError}</p>}

                  {!subscriptionLocalizationsLoading && !subscriptionLocalizationsError && subscriptionLocalizations.length === 0 ? (
                    <p className="text-sm text-slate-500">No locales available for this subscription.</p>
                  ) : null}

                  {!subscriptionLocalizationsLoading && subscriptionLocalizations.length > 0 ? (
                    <div className="grid gap-4">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-3 flex items-center gap-2">
                          <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Localization By Locale</h4>
                          {[
                            { key: 'name', label: 'Name' },
                            { key: 'description', label: 'Description' },
                          ].map((field) => (
                            <button
                              key={`translate-subscription-${field.key}`}
                              type="button"
                              onClick={() => handleTranslateSubscriptionSectionField(field.key)}
                              disabled={savingSubscriptions || translatingSubscriptionSectionField !== null || translatingSubscriptionFieldKey !== null}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600 disabled:opacity-50">
                              {translatingSubscriptionSectionField === field.key ? `Translating ${field.label}…` : `Translate ${field.label}`}
                            </button>
                          ))}
                        </div>

                        <div className="grid gap-3">
                          {subscriptionLocalizations.map((loc) => {
                            const locale = loc?.attributes?.locale || 'unknown'
                            const localeLabel = formatLocaleLabel(locale)
                            const isEnglish = isEnglishLocale(locale)
                            const localeMetadata = subscriptionMetadataByLocale[locale] || { name: '', description: '' }
                            const hasChanges = ['name', 'description'].some((field) => isSubscriptionFieldChanged(locale, field))

                            return (
                              <div
                                key={`subscription-core-${selectedSubscription.id}-${locale}`}
                                className={`rounded-xl border p-3 transition ${hasChanges ? 'border-amber-300 bg-amber-50/60 shadow-sm ring-1 ring-amber-200' : 'border-slate-200 bg-white'}`}>
                                <div className="mb-3 flex items-center gap-2">
                                  <span className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold tracking-wide text-sky-900 ring-1 ring-sky-200">
                                    <span>{localeLabel}</span>
                                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-sky-800 ring-1 ring-sky-200">
                                      {locale}
                                    </span>
                                  </span>

                                  {hasChanges && (
                                    <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">
                                      Changed
                                    </span>
                                  )}

                                  {!isEnglish && (
                                    <>
                                      <label className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Source</label>
                                      <select
                                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                        value={subscriptionTranslationSourceByLocale[locale] || ''}
                                        disabled>
                                        {subscriptionLocalizations
                                          .map((sourceLoc) => sourceLoc?.attributes?.locale)
                                          .filter(Boolean)
                                          .filter((sourceLocale) => /^en([_-]|$)/i.test(sourceLocale))
                                          .map((sourceLocale) => (
                                            <option key={`subscription-${locale}-source-${sourceLocale}`} value={sourceLocale}>
                                              {sourceLocale}
                                            </option>
                                          ))}
                                      </select>
                                    </>
                                  )}
                                </div>

                                <div className="grid gap-3">
                                  {[
                                    { key: 'name', label: 'Subscription Name', rows: 2 },
                                    { key: 'description', label: 'Description', rows: 3 },
                                  ].map((field) => {
                                    const fieldChanged = isSubscriptionFieldChanged(locale, field.key)
                                    return (
                                      <div key={`subscription-field-${locale}-${field.key}`}>
                                        <div className="mb-1 flex items-center gap-2">
                                          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{field.label}</label>
                                          {!isEnglish && (
                                            <button
                                              type="button"
                                              onClick={() => handleTranslateSubscriptionLocaleField(field.key, locale)}
                                              disabled={
                                                savingSubscriptions || translatingSubscriptionSectionField !== null || translatingSubscriptionFieldKey !== null
                                              }
                                              className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600 disabled:opacity-50">
                                              {translatingSubscriptionFieldKey === `${locale}:${field.key}` ? 'Translating…' : 'Translate'}
                                            </button>
                                          )}
                                        </div>

                                        <textarea
                                          rows={field.rows}
                                          className={`w-full rounded-xl border px-3 py-2 text-sm text-slate-700 ${fieldChanged ? 'border-amber-300 bg-amber-50/40 focus:border-amber-400' : 'border-slate-200 bg-white'}`}
                                          value={localeMetadata[field.key] || ''}
                                          onChange={(e) => handleSubscriptionMetadataChange(locale, field.key, e.target.value)}
                                        />
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 rounded-2xl border border-sky-200 bg-white/95 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-sky-900">Update subscription locales</p>
                          <p className="mt-1 text-xs text-sky-700">Only changed locales will be submitted for this subscription.</p>
                          {subscriptionMessage ? (
                            <p className={`mt-2 text-sm ${subscriptionMessage.type === 'error' ? 'text-rose-600' : 'text-green-600'}`}>
                              {subscriptionMessage.text}
                            </p>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          onClick={handleSaveAllSubscriptionLocales}
                          disabled={
                            savingSubscriptions ||
                            !hasChangedSubscriptionLocales ||
                            translatingSubscriptionSectionField !== null ||
                            translatingSubscriptionFieldKey !== null
                          }
                          className="inline-flex shrink-0 items-center justify-center rounded-full bg-sky-900 px-4 py-2 text-md font-semibold text-white hover:bg-sky-800 disabled:opacity-60">
                          {savingSubscriptions ? 'Updating…' : `Update Subscription Locales (${changedSubscriptionLocales.length})`}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {selectedSubscription?.subscriptionGroup?.id ? (
                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Subscription Group Name</div>
                      <div className="text-xs text-slate-500">
                        {selectedSubscription.subscriptionGroup.referenceName || selectedSubscription.subscriptionGroup.id}
                      </div>
                    </div>
                  </div>

                  {subscriptionGroupLocalizationsLoading && <p className="text-sm text-slate-500">Loading subscription group localizations…</p>}
                  {subscriptionGroupLocalizationsError && <p className="text-sm text-rose-600">{subscriptionGroupLocalizationsError}</p>}

                  {!subscriptionGroupLocalizationsLoading && !subscriptionGroupLocalizationsError && subscriptionGroupLocalizations.length === 0 ? (
                    <p className="text-sm text-slate-500">No locales available for this subscription group.</p>
                  ) : null}

                  {!subscriptionGroupLocalizationsLoading && subscriptionGroupLocalizations.length > 0 ? (
                    <div className="grid gap-4">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-3 flex items-center gap-2">
                          <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Group Name By Locale</h4>
                          <button
                            type="button"
                            onClick={() => handleTranslateSubscriptionGroupSectionField('name')}
                            disabled={
                              savingSubscriptionGroups || translatingSubscriptionGroupSectionField !== null || translatingSubscriptionGroupFieldKey !== null
                            }
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600 disabled:opacity-50">
                            {translatingSubscriptionGroupSectionField === 'name' ? 'Translating Name…' : 'Translate Name'}
                          </button>
                        </div>

                        <div className="grid gap-3">
                          {subscriptionGroupLocalizations.map((loc) => {
                            const locale = loc?.attributes?.locale || 'unknown'
                            const localeLabel = formatLocaleLabel(locale)
                            const isEnglish = isEnglishLocale(locale)
                            const localeMetadata = subscriptionGroupMetadataByLocale[locale] || { name: '' }
                            const hasChanges = isSubscriptionGroupFieldChanged(locale, 'name')

                            return (
                              <div
                                key={`subscription-group-${selectedSubscription.subscriptionGroup.id}-${locale}`}
                                className={`rounded-xl border p-3 transition ${hasChanges ? 'border-amber-300 bg-amber-50/60 shadow-sm ring-1 ring-amber-200' : 'border-slate-200 bg-white'}`}>
                                <div className="mb-3 flex items-center gap-2">
                                  <span className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold tracking-wide text-sky-900 ring-1 ring-sky-200">
                                    <span>{localeLabel}</span>
                                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-sky-800 ring-1 ring-sky-200">
                                      {locale}
                                    </span>
                                  </span>

                                  {hasChanges && (
                                    <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">
                                      Changed
                                    </span>
                                  )}

                                  {!isEnglish && (
                                    <>
                                      <label className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Source</label>
                                      <select
                                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                        value={subscriptionGroupTranslationSourceByLocale[locale] || ''}
                                        disabled>
                                        {subscriptionGroupLocalizations
                                          .map((sourceLoc) => sourceLoc?.attributes?.locale)
                                          .filter(Boolean)
                                          .filter((sourceLocale) => /^en([_-]|$)/i.test(sourceLocale))
                                          .map((sourceLocale) => (
                                            <option key={`subscription-group-${locale}-source-${sourceLocale}`} value={sourceLocale}>
                                              {sourceLocale}
                                            </option>
                                          ))}
                                      </select>
                                      <button
                                        type="button"
                                        onClick={() => handleTranslateSubscriptionGroupLocaleField('name', locale)}
                                        disabled={
                                          savingSubscriptionGroups ||
                                          translatingSubscriptionGroupSectionField !== null ||
                                          translatingSubscriptionGroupFieldKey !== null
                                        }
                                        className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600 disabled:opacity-50">
                                        {translatingSubscriptionGroupFieldKey === `${locale}:name` ? 'Translating…' : 'Translate'}
                                      </button>
                                    </>
                                  )}
                                </div>

                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Group Name</label>
                                  <textarea
                                    rows={2}
                                    className={`w-full rounded-xl border px-3 py-2 text-sm text-slate-700 ${hasChanges ? 'border-amber-300 bg-amber-50/40 focus:border-amber-400' : 'border-slate-200 bg-white'}`}
                                    value={localeMetadata.name || ''}
                                    onChange={(e) => handleSubscriptionGroupMetadataChange(locale, 'name', e.target.value)}
                                  />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 rounded-2xl border border-sky-200 bg-white/95 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-sky-900">Update subscription group locales</p>
                          <p className="mt-1 text-xs text-sky-700">Only changed locales will be submitted for this subscription group.</p>
                          {subscriptionGroupMessage ? (
                            <p className={`mt-2 text-sm ${subscriptionGroupMessage.type === 'error' ? 'text-rose-600' : 'text-green-600'}`}>
                              {subscriptionGroupMessage.text}
                            </p>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          onClick={handleSaveAllSubscriptionGroupLocales}
                          disabled={
                            savingSubscriptionGroups ||
                            !hasChangedSubscriptionGroupLocales ||
                            translatingSubscriptionGroupSectionField !== null ||
                            translatingSubscriptionGroupFieldKey !== null
                          }
                          className="inline-flex shrink-0 items-center justify-center rounded-full bg-sky-900 px-4 py-2 text-md font-semibold text-white hover:bg-sky-800 disabled:opacity-60">
                          {savingSubscriptionGroups ? 'Updating…' : `Update Subscription Group Locales (${changedSubscriptionGroupLocales.length})`}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {activeSectionTab === 'appclips' && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              {appClipsLoading && <p className="text-sm text-slate-500">Loading app clips…</p>}
              {appClipsError && <p className="text-sm text-rose-600">{appClipsError}</p>}

              {!appClipsLoading && appClips.length === 0 && <p className="text-sm text-slate-500">No app clips found for this app.</p>}

              {!appClipsLoading && appClips.length > 0 && (
                <div className="grid gap-4">
                  <div className="mb-2">
                    <label className="block text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">Select App Clip</label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {appClips.map((clip) => (
                        <button
                          key={clip.id}
                          type="button"
                          onClick={() => setSelectedAppClip(clip)}
                          className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                            selectedAppClip?.id === clip.id
                              ? 'border-sky-700 bg-sky-50 font-semibold text-sky-900 ring-1 ring-sky-700'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                          }`}>
                          <div className="font-medium">{clip.attributes?.bundleId || clip.id}</div>
                          {clip.attributes?.createdDate ? (
                            <div className="text-xs text-slate-400 mt-0.5">Created: {new Date(clip.attributes.createdDate).toLocaleDateString()}</div>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>

                  {appClipLocalizationsLoading && <p className="text-sm text-slate-500">Loading app clip localizations…</p>}
                  {appClipLocalizationsError && <p className="text-sm text-rose-600">{appClipLocalizationsError}</p>}

                  {!appClipLocalizationsLoading && selectedAppClip && appClipLocalizations.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <h4 className="text-sm font-semibold text-slate-900 mb-4">App Clip Localizations</h4>
                      <div className="mb-3 flex items-center gap-2">
                        <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Subtitle By Locale</h4>
                        <button
                          type="button"
                          onClick={() => handleTranslateAppClipSectionField('subtitle')}
                          disabled={hasBlockingAppClipAction}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600 disabled:opacity-50">
                          {translatingAppClipSectionField === 'subtitle' ? 'Translating Subtitle…' : 'Translate Subtitle'}
                        </button>
                      </div>
                      <div className="grid gap-4">
                        {appClipLocalizations.map((loc) => {
                          const locale = loc?.attributes?.locale || 'unknown'
                          const localeLabel = formatLocaleLabel(locale)
                          const isEnglish = isEnglishLocale(locale)
                          const hasChanges = isAppClipFieldChanged(locale, 'subtitle')
                          const localeMetadata = appClipMetadataByLocale[locale] || { subtitle: '' }

                          return (
                            <div
                              key={`appclip-${loc.id || `${selectedAppClip.id}-${locale}`}`}
                              className={`rounded-xl border p-3 transition ${hasChanges ? 'border-amber-300 bg-amber-50/60 shadow-sm ring-1 ring-amber-200' : 'border-slate-200 bg-white'}`}>
                              <div className="mb-3 flex items-center gap-2">
                                <span className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold tracking-wide text-sky-900 ring-1 ring-sky-200">
                                  <span>{localeLabel}</span>
                                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-sky-800 ring-1 ring-sky-200">{locale}</span>
                                </span>
                                {hasChanges && (
                                  <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">
                                    Changed
                                  </span>
                                )}

                                {!isEnglish && (
                                  <>
                                    <label className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Source</label>
                                    <select
                                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                      value={appClipTranslationSourceByLocale[locale] || ''}
                                      disabled>
                                      {appClipLocalizations
                                        .map((sourceLoc) => sourceLoc?.attributes?.locale)
                                        .filter(Boolean)
                                        .filter((sourceLocale) => /^en([_-]|$)/i.test(sourceLocale))
                                        .map((sourceLocale) => (
                                          <option key={`appclip-${locale}-source-${sourceLocale}`} value={sourceLocale}>
                                            {sourceLocale}
                                          </option>
                                        ))}
                                    </select>
                                  </>
                                )}
                              </div>

                              <div className="grid gap-3">
                                {[{ key: 'subtitle', label: 'Subtitle', rows: 2 }].map((field) => {
                                  const fieldChanged = isAppClipFieldChanged(locale, field.key)
                                  return (
                                    <div key={`appclip-field-${locale}-${field.key}`}>
                                      <div className="mb-1 flex items-center gap-2">
                                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{field.label}</label>
                                        {!isEnglish && (
                                          <button
                                            type="button"
                                            onClick={() => handleTranslateAppClipLocaleField(field.key, locale)}
                                            disabled={hasBlockingAppClipAction}
                                            className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600 disabled:opacity-50">
                                            {translatingAppClipFieldKey === `${locale}:${field.key}` ? 'Translating…' : 'Translate'}
                                          </button>
                                        )}
                                      </div>
                                      <textarea
                                        rows={field.rows}
                                        className={`w-full rounded-xl border px-3 py-2 text-sm text-slate-700 ${fieldChanged ? 'border-amber-300 bg-amber-50/40 focus:border-amber-400' : 'border-slate-200 bg-white'}`}
                                        value={localeMetadata[field.key] || ''}
                                        onChange={(e) => handleAppClipMetadataChange(locale, field.key, e.target.value)}
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-sky-200 bg-white/95 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-sky-900">Update app clip locales</p>
                          <p className="mt-1 text-xs text-sky-700">Only changed locales will be submitted.</p>
                          {appClipMessage ? (
                            <p className={`mt-2 text-sm ${appClipMessage.type === 'error' ? 'text-rose-600' : 'text-green-600'}`}>{appClipMessage.text}</p>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          onClick={handleSaveAllAppClipLocales}
                          disabled={hasBlockingAppClipAction}
                          className="inline-flex shrink-0 items-center justify-center rounded-full bg-sky-900 px-4 py-2 text-md font-semibold text-white hover:bg-sky-800 disabled:opacity-60">
                          {savingAppClip ? 'Updating…' : `Update App Clip Locales (${changedAppClipLocales.length})`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
