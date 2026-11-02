import appStoreConnect from '@/lib/appStoreConnect'
import { fail, ok } from '@/lib/http'

export async function POST(request) {
  try {
    const { appIds } = await request.json()

    if (!Array.isArray(appIds) || appIds.length === 0) {
      throw new Error('At least one app ID is required')
    }

    const results = []
    for (const appId of appIds) {
      results.push(await appStoreConnect.enableAnalyticsReports(appId))
    }

    return ok({ data: results })
  } catch (error) {
    return fail(error)
  }
}
