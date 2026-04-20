import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function POST(request) {
  try {
    const body = await request.json()
    const { appId, locale } = body || {}

    if (!appId || !locale) {
      throw new Error('appId and locale are required')
    }

    const metadata = {}
    for (const key of ['keywords', 'promotionalText', 'description', 'whatsNew', 'name', 'subtitle']) {
      if (Object.prototype.hasOwnProperty.call(body || {}, key)) {
        metadata[key] = body[key]
      }
    }

    if (Object.keys(metadata).length === 0) {
      throw new Error('No metadata fields provided for update')
    }

    const result = await appStoreConnect.updateAppMetadata(appId, locale, metadata)
    return ok(result)
  } catch (error) {
    return fail(error)
  }
}
