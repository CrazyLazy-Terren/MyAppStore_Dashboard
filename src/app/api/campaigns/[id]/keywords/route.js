import appleAds from '@/lib/appleAds'
import { fail, ok } from '@/lib/http'
import { validateConfig } from '@/lib/config'
import { getDateRangeFromSearchParams } from '@/lib/reportDateRange'

export async function GET(request, { params }) {
  try {
    validateConfig()
    const { id } = await params
    const reportDateRange = getDateRangeFromSearchParams(new URL(request.url).searchParams, 30, {
      startKey: 'startDate',
      endKey: 'endDate',
    })
    const data = await appleAds.getCampaignKeywords(id, reportDateRange)
    return ok(data)
  } catch (error) {
    return fail(error)
  }
}
