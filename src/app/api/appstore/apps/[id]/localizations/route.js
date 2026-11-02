import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'
import { sortByLocale } from '@/lib/localeOrder'

export async function GET(request, { params }) {
  try {
    const { id } = await params
    const platform = request.nextUrl.searchParams.get('platform') || 'IOS'
    const versionResult = await appStoreConnect.getAppLocalizations(id, platform)
    const appInfoResult = await appStoreConnect.getAppInfoLocalizations(id)

    const mergedByLocale = new Map()

    for (const localization of versionResult.localizations || []) {
      const locale = localization?.attributes?.locale
      if (!locale) {
        continue
      }

      mergedByLocale.set(locale, {
        ...localization,
        versionLocalizationId: localization.id || null,
        appInfoLocalizationId: null,
        attributes: {
          ...localization.attributes,
        },
      })
    }

    for (const localization of appInfoResult.localizations || []) {
      const locale = localization?.attributes?.locale
      if (!locale) {
        continue
      }

      const existing = mergedByLocale.get(locale)
      if (!existing) {
        mergedByLocale.set(locale, {
          ...localization,
          id: localization.id || `appinfo-${locale}`,
          versionLocalizationId: null,
          appInfoLocalizationId: localization.id || null,
          attributes: {
            ...localization.attributes,
          },
        })
        continue
      }

      mergedByLocale.set(locale, {
        ...existing,
        appInfoLocalizationId: localization.id || null,
        attributes: {
          ...existing.attributes,
          name: existing?.attributes?.name || localization?.attributes?.name || '',
          subtitle: existing?.attributes?.subtitle || localization?.attributes?.subtitle || '',
        },
      })
    }

    return ok({
      data: sortByLocale(Array.from(mergedByLocale.values())),
      meta: {
        versionId: versionResult.versionId,
        versionString: versionResult.versionString,
        appStoreState: versionResult.appStoreState,
        appInfoId: appInfoResult.appInfoId,
      },
    })
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { versionLocalizationId, appInfoLocalizationId } = body || {}

    if (!versionLocalizationId && !appInfoLocalizationId) {
      throw new Error('versionLocalizationId or appInfoLocalizationId is required')
    }

    if (versionLocalizationId) {
      await appStoreConnect.deleteVersionLocalization(versionLocalizationId)
    }

    if (appInfoLocalizationId) {
      await appStoreConnect.deleteAppInfoLocalization(appInfoLocalizationId)
    }

    return ok({ deleted: true })
  } catch (error) {
    return fail(error)
  }
}
