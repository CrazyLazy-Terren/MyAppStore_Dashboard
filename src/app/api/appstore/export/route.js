import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

function buildLocalizationPayloads(versionLocalizations = [], appInfoLocalizations = []) {
  const payloadsByLocale = new Map()

  for (const localization of versionLocalizations || []) {
    const locale = localization?.attributes?.locale
    if (!locale) {
      continue
    }

    payloadsByLocale.set(locale, {
      keywords: localization?.attributes?.keywords || '',
      promotionalText: localization?.attributes?.promotionalText || '',
      description: localization?.attributes?.description || '',
      whatsNew: localization?.attributes?.whatsNew || '',
    })
  }

  for (const localization of appInfoLocalizations || []) {
    const locale = localization?.attributes?.locale
    if (!locale) {
      continue
    }

    payloadsByLocale.set(locale, {
      ...(payloadsByLocale.get(locale) || {}),
      name: localization?.attributes?.name || '',
      subtitle: localization?.attributes?.subtitle || '',
    })
  }

  return Object.fromEntries(payloadsByLocale.entries())
}

export async function POST(request) {
  try {
    const { appId } = await request.json()

    if (!appId) {
      throw new Error('App ID is required')
    }

    const iosLocalizations = await appStoreConnect.getAppLocalizations(appId, 'IOS')
    const appInfoLocalizations = await appStoreConnect.getAppInfoLocalizations(appId)
    const localizations = buildLocalizationPayloads(iosLocalizations.localizations, appInfoLocalizations.localizations)

    const updates = []

    if (Object.keys(localizations).length === 0) {
      throw new Error('No iOS localization data found to export.')
    }

    // Update app localizations (keywords, name, subtitle, description, etc.)
    if (localizations && Object.keys(localizations).length > 0) {
      for (const [locale, metadata] of Object.entries(localizations)) {
        if (!metadata || Object.keys(metadata).length === 0) {
          continue
        }

        try {
          const updateData = {}

          // Only include fields that are in the metadata
          if (metadata.name !== undefined && metadata.name !== null) {
            updateData.name = metadata.name
          }
          if (metadata.subtitle !== undefined && metadata.subtitle !== null) {
            updateData.subtitle = metadata.subtitle
          }
          if (metadata.keywords !== undefined && metadata.keywords !== null) {
            updateData.keywords = metadata.keywords
          }
          if (metadata.promotionalText !== undefined && metadata.promotionalText !== null) {
            updateData.promotionalText = metadata.promotionalText
          }
          if (metadata.description !== undefined && metadata.description !== null) {
            updateData.description = metadata.description
          }
          if (metadata.whatsNew !== undefined && metadata.whatsNew !== null) {
            updateData.whatsNew = metadata.whatsNew
          }

          if (Object.keys(updateData).length > 0) {
            const result = await appStoreConnect.updateAppMetadata(appId, locale, updateData, { platform: 'MAC_OS' })
            updates.push({
              type: 'app',
              locale,
              status: 'success',
              id: result?.data?.[0]?.id,
            })
          }
        } catch (err) {
          updates.push({
            type: 'app',
            locale,
            status: 'error',
            error: err.message,
          })
        }
      }
    }

    const successCount = updates.filter((u) => u.status === 'success').length
    const errorCount = updates.filter((u) => u.status === 'error').length
    const partial = errorCount > 0 && successCount > 0

    const body = {
      appId,
      updates,
      summary: {
        success: successCount,
        errors: errorCount,
        total: updates.length,
        partial,
      },
    }

    if (errorCount > 0 && successCount === 0) {
      throw new Error(`Export failed for all locales (${errorCount}/${updates.length}).`)
    }

    if (partial) {
      return ok(body, 207)
    }

    return ok(body)
  } catch (error) {
    return fail(error)
  }
}
