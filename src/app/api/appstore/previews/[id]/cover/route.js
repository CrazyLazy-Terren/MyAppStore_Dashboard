import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export const runtime = 'nodejs'

export async function PATCH(request, { params }) {
  try {
    const { id } = await params
    const body = await request.json()
    const previewFrameTimeCode = String(body?.previewFrameTimeCode || '').trim()

    if (!previewFrameTimeCode) {
      throw new Error('previewFrameTimeCode is required')
    }

    const result = await appStoreConnect.updateAppPreviewCoverFrame(id, previewFrameTimeCode)
    return ok({ data: result })
  } catch (error) {
    return fail(error)
  }
}
