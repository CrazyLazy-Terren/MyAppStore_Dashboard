import appleAds from '@/lib/appleAds'
import { fail, ok } from '@/lib/http'
import { validateConfig } from '@/lib/config'

export async function GET() {
  try {
    validateConfig()
    const data = await appleAds.listApplications()
    return ok(data)
  } catch (error) {
    return fail(error)
  }
}
