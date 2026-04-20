import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function GET(_request, { params }) {
  try {
    const { id } = await params
    const subscriptions = await appStoreConnect.listAppSubscriptions(id)
    return ok({ data: subscriptions })
  } catch (error) {
    return fail(error)
  }
}
