import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function PATCH(request, { params }) {
  try {
    const { id } = await params
    const attributes = (await request.json()) || {}
    const result = await appStoreConnect.updateWinBackOffer(id, attributes)
    return ok(result)
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params
    await appStoreConnect.deleteWinBackOffer(id)
    return ok({ deleted: true })
  } catch (error) {
    return fail(error)
  }
}
