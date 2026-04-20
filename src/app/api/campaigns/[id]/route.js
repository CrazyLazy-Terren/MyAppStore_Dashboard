import appleAds from '@/lib/appleAds'
import { fail, ok } from '@/lib/http'
import { validateConfig } from '@/lib/config'

export async function GET(_request, { params }) {
  try {
    validateConfig()
    const { id } = await params
    const data = await appleAds.getCampaign(id)
    return ok(data)
  } catch (error) {
    return fail(error)
  }
}

export async function PUT(request, { params }) {
  try {
    validateConfig()
    const { id } = await params
    const payload = await request.json()
    const data = await appleAds.updateCampaign(id, payload)
    return ok(data)
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(_request, { params }) {
  try {
    validateConfig()
    const { id } = await params
    const data = await appleAds.deleteCampaign(id)
    return ok(data)
  } catch (error) {
    return fail(error)
  }
}
