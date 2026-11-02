import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function POST(request) {
  try {
    const body = await request.json()
    const appClipId = String(body?.appClipId || '').trim()
    const targetDefaultExperienceId = String(body?.defaultExperienceId || '').trim()

    if (!appClipId) {
      throw new Error('appClipId is required')
    }

    const result = await appStoreConnect.copyUsAppClipActionAndImage(appClipId, {
      targetDefaultExperienceId: targetDefaultExperienceId || undefined,
    })

    return ok({ data: result })
  } catch (error) {
    return fail(error)
  }
}
