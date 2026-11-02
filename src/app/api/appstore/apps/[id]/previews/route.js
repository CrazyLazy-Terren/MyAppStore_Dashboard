import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { id } = await params
    const platform = request.nextUrl.searchParams.get('platform') || 'IOS'
    const result = await appStoreConnect.getAppPreviews(id, platform)

    return ok({
      data: result.localizations,
      meta: {
        versionId: result.versionId,
        sourceVersionId: result.sourceVersionId,
        versionString: result.versionString,
        appStoreState: result.appStoreState,
        platform: result.platform,
      },
    })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params
    const formData = await request.formData()
    const file = formData.get('file')
    const locale = String(formData.get('locale') || '').trim()
    const previewType = String(formData.get('previewType') || '').trim()
    const platform = String(formData.get('platform') || 'IOS').trim()
    const previewFrameTimeCode = String(formData.get('previewFrameTimeCode') || '').trim()

    if (!locale || !previewType) {
      throw new Error('locale and previewType are required')
    }

    if (!file || typeof file.arrayBuffer !== 'function') {
      throw new Error('A preview video file is required')
    }

    const videoBuffer = Buffer.from(await file.arrayBuffer())
    const result = await appStoreConnect.uploadAppPreviewForLocale(id, locale, previewType, videoBuffer, {
      platform,
      fileName: file.name || 'app-preview.mov',
      fileSize: file.size || videoBuffer.byteLength,
      previewFrameTimeCode,
    })

    return ok({ data: result })
  } catch (error) {
    return fail(error)
  }
}
