import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function GET(_request, { params }) {
  try {
    const { id: appId } = await params

    if (!appId) {
      throw new Error('App ID is required')
    }

    const appClips = await appStoreConnect.listAppClips(appId)
    return ok({ data: appClips })
  } catch (error) {
    return fail(error)
  }
}
