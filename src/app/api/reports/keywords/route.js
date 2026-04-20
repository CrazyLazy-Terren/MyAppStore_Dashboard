import appleAds from '@/lib/appleAds'
import { fail, ok } from '@/lib/http'
import { validateConfig } from '@/lib/config'
import { getDateRangeFromSearchParams } from '@/lib/reportDateRange'

export async function GET(request) {
  try {
    validateConfig()

    const { searchParams } = new URL(request.url)
    const keywordId = searchParams.get('keywordId')?.trim()

    if (!keywordId) {
      return fail(new Error('keywordId is required'), 400)
    }

    const reportDateRange = getDateRangeFromSearchParams(searchParams, 30, {
      startKey: 'startDate',
      endKey: 'endDate',
    })
    const data = await appleAds.findKeywordById(keywordId, reportDateRange)

    if (!data.data || data.data.length === 0) {
      return fail(new Error(`No keyword found for keywordId ${keywordId}`), 404)
    }

    return ok(data)
  } catch (error) {
    return fail(error)
  }
}
