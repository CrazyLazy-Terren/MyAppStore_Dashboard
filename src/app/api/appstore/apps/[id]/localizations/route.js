import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function GET(_request, { params }) {
  try {
    const { id } = await params
    const versionResult = await appStoreConnect.getAppLocalizations(id)
    const appInfoResult = await appStoreConnect.getAppInfoLocalizations(id)

    const mergedByLocale = new Map()

    for (const localization of versionResult.localizations || []) {
      const locale = localization?.attributes?.locale
      if (!locale) {
        continue
      }

      mergedByLocale.set(locale, {
        ...localization,
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
          attributes: {
            ...localization.attributes,
          },
        })
        continue
      }

      mergedByLocale.set(locale, {
        ...existing,
        attributes: {
          ...existing.attributes,
          name: existing?.attributes?.name || localization?.attributes?.name || '',
          subtitle: existing?.attributes?.subtitle || localization?.attributes?.subtitle || '',
        },
      })
    }

    return ok({
      data: Array.from(mergedByLocale.values()),
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
