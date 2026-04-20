import appleAds from '@/lib/appleAds'
import { fail, ok } from '@/lib/http'
import { validateConfig } from '@/lib/config'

export async function PATCH(request, { params }) {
  try {
    validateConfig()

    const { id } = await params
    const payload = await request.json()
    const data = await appleAds.updateKeywordStatus(id, payload)

    return ok(data)
  } catch (error) {
    return fail(error)
  }
}
