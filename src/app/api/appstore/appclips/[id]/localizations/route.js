import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function GET(_request, { params }) {
  try {
    const { id: appClipId } = await params

    if (!appClipId) {
      throw new Error('App Clip ID is required')
    }

    const result = await appStoreConnect.getAppClipLocalizations(appClipId)
    return ok({
      data: result.localizations,
      meta: {
        defaultExperiences: result.defaultExperiences || [],
      },
    })
  } catch (error) {
    return fail(error)
  }
}
