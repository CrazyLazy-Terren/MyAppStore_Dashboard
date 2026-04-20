import appleAds from '@/lib/appleAds'
import { fail, ok } from '@/lib/http'
import { validateConfig } from '@/lib/config'

export async function GET() {
  try {
    validateConfig()
    const data = await appleAds.getCampaigns()
    return ok(data)
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request) {
  try {
    validateConfig()
    const payload = await request.json()
    const data = await appleAds.createCampaign(payload)
    return ok(data, 201)
  } catch (error) {
    return fail(error)
  }
}
