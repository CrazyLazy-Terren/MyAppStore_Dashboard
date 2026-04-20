import appleAds from '@/lib/appleAds'
import { fail, ok } from '@/lib/http'
import { validateConfig } from '@/lib/config'
import { getDateRangeFromSearchParams } from '@/lib/reportDateRange'

export async function GET(request) {
  try {
    validateConfig()

    const { searchParams } = new URL(request.url)
    const adamId = searchParams.get('adamId')?.trim()

    if (!adamId) {
      return fail(new Error('adamId is required'), 400)
    }

    const reportDateRange = getDateRangeFromSearchParams(searchParams, 30, {
      startKey: 'startDate',
      endKey: 'endDate',
    })
    const data = await appleAds.findKeywordsByAppAdamId(adamId, reportDateRange)

    if (!data.data || data.data.length === 0) {
      return fail(new Error(`No keywords found for application ${adamId}`), 404)
    }

    return ok(data)
  } catch (error) {
    return fail(error)
  }
}
