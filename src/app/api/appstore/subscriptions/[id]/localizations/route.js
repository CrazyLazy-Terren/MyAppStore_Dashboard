import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function GET(_request, { params }) {
  try {
    const { id } = await params
    const localizations = await appStoreConnect.getSubscriptionLocalizations(id)
    return ok({ data: localizations })
  } catch (error) {
    return fail(error)
  }
}
