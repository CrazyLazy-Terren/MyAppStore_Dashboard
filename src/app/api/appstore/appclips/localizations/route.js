import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function POST(request) {
  try {
    const body = await request.json()
    const { appClipId, locale, appId } = body || {}
    const defaultExperienceId = String(body?.defaultExperienceId || '').trim()

    if (!appClipId || !locale) {
      throw new Error('appClipId and locale are required')
    }

    const metadata = {}
    for (const key of ['subtitle']) {
      if (Object.prototype.hasOwnProperty.call(body || {}, key)) {
        metadata[key] = body[key]
      }
    }

    if (Object.keys(metadata).length === 0) {
      throw new Error('No metadata fields provided for update')
    }

    const result = await appStoreConnect.updateAppClipMetadata(appClipId, locale, metadata, {
      appId,
      defaultExperienceId: defaultExperienceId || undefined,
    })
    return ok(result)
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json()
    const { localizationId } = body || {}

    if (!localizationId) {
      throw new Error('localizationId is required')
    }

    const result = await appStoreConnect.deleteAppClipLocalization(localizationId)
    return ok(result)
  } catch (error) {
    return fail(error)
  }
}
