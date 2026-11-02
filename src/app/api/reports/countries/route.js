import appleAds from '@/lib/appleAds'
import appStoreConnect from '@/lib/appStoreConnect'
import { validateConfig } from '@/lib/config'
import { fail, ok } from '@/lib/http'
import { normalizeDateRange } from '@/lib/reportDateRange'

function errorMessage(result) {
  return result.status === 'rejected' ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : null
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const { startDate, endDate } = normalizeDateRange(searchParams.get('startDate'), searchParams.get('endDate'))
    const appId = searchParams.get('appId') || null

    const appsResult = await Promise.allSettled([appStoreConnect.getCachedList('apps', () => appStoreConnect.listApps())])
    const ascApps = appsResult[0].status === 'fulfilled' ? appsResult[0].value : []
    const apps = ascApps.map((app) => ({ appId: app.id, name: app.attributes?.name || app.id })).sort((left, right) => left.name.localeCompare(right.name))
    const storeAppIds = appId ? [appId] : apps.map((app) => app.appId)

    const [downloadsResult, adsResult, storeResult] = await Promise.allSettled([
      appStoreConnect.getDownloadsByCountry({ startDate, endDate, appId }),
      (async () => {
        validateConfig()
        return appleAds.getCountryReport({ startDate, endDate, adamId: appId })
      })(),
      appStoreConnect.getAppStoreConversionByCountry({ startDate, endDate, appIds: storeAppIds }),
    ])

    const downloads = downloadsResult.status === 'fulfilled' ? downloadsResult.value : null
    const adsCountries = adsResult.status === 'fulfilled' ? adsResult.value : []
    const store = storeResult.status === 'fulfilled' ? storeResult.value : null
    const byCountry = new Map()

    for (const entry of downloads?.countries || []) {
      byCountry.set(entry.countryCode, { countryCode: entry.countryCode, downloads: entry.downloads, redownloads: entry.redownloads })
    }

    for (const entry of adsCountries) {
      byCountry.set(entry.countryCode, {
        countryCode: entry.countryCode,
        downloads: 0,
        redownloads: 0,
        ...byCountry.get(entry.countryCode),
        impressions: entry.impressions,
        taps: entry.taps,
        installs: entry.installs,
        spend: entry.spend,
        currency: entry.currency,
      })
    }

    for (const entry of store?.countries || []) {
      byCountry.set(entry.countryCode, {
        countryCode: entry.countryCode,
        downloads: 0,
        redownloads: 0,
        ...byCountry.get(entry.countryCode),
        storeImpressions: entry.impressions,
        storePageViews: entry.pageViews,
        storeDownloads: entry.firstDownloads + entry.redownloads,
        storeFirstDownloads: entry.firstDownloads,
      })
    }

    const countries = Array.from(byCountry.values())
      .map((entry) => ({
        impressions: 0,
        taps: 0,
        installs: 0,
        spend: 0,
        storeImpressions: 0,
        storePageViews: 0,
        storeDownloads: 0,
        storeFirstDownloads: 0,
        ...entry,
        // App Store Connect's definition: total downloads ÷ unique-device impressions.
        storeConversionRate: entry.storeImpressions > 0 ? (entry.storeDownloads || 0) / entry.storeImpressions : null,
        conversionRate: entry.taps > 0 ? entry.installs / entry.taps : null,
        tapThroughRate: entry.impressions > 0 ? entry.taps / entry.impressions : null,
      }))
      .sort((left, right) => right.downloads - left.downloads || right.installs - left.installs)

    return ok({
      startDate,
      endDate,
      appId,
      apps: apps.length > 0 ? apps : downloads?.apps || [],
      storeStatuses: store?.statuses || [],
      downloadSourcesByDay: store?.downloadSourcesByDay || [],
      referrers: store?.referrers || { apps: [], websites: [] },
      requestedDays: downloads?.requestedDays ?? null,
      reportedDays: downloads?.reportedDays ?? null,
      countries,
      errors: {
        downloads: errorMessage(downloadsResult),
        ads: errorMessage(adsResult),
        store: errorMessage(storeResult),
      },
    })
  } catch (error) {
    return fail(error)
  }
}
