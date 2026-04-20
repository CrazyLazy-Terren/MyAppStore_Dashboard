import appleAds from '@/lib/appleAds'
import { fail, ok } from '@/lib/http'
import { validateConfig } from '@/lib/config'

export async function GET(_request, { params }) {
  try {
    validateConfig()
    const { id } = await params
    const data = await appleAds.getAdGroups(id)
    return ok(data)
  } catch (error) {
    return fail(error)
  }
}
