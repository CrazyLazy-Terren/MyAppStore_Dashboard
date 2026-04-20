import appleAds from '@/lib/appleAds'
import { fail, ok } from '@/lib/http'
import { validateConfig } from '@/lib/config'

export async function POST(request) {
  try {
    validateConfig()
    const payload = await request.json()
    const data = await appleAds.getCampaignReports(payload)
    return ok(data)
  } catch (error) {
    return fail(error)
  }
}
