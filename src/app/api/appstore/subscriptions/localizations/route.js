import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function POST(request) {
  try {
    const body = await request.json()
    const { subscriptionId, locale } = body || {}

    if (!subscriptionId || !locale) {
      throw new Error('subscriptionId and locale are required')
    }

    const metadata = {}
    for (const key of ['name', 'description']) {
      if (Object.prototype.hasOwnProperty.call(body || {}, key)) {
        metadata[key] = body[key]
      }
    }

    if (Object.keys(metadata).length === 0) {
      throw new Error('No subscription localization fields provided for update')
    }

    const result = await appStoreConnect.updateSubscriptionMetadata(subscriptionId, locale, metadata)
    return ok(result)
  } catch (error) {
    return fail(error)
  }
}
