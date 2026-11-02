import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function POST(request) {
  try {
    const body = await request.json()
    const { subscriptionGroupId, locale } = body || {}

    if (!subscriptionGroupId || !locale) {
      throw new Error('subscriptionGroupId and locale are required')
    }

    const metadata = {}
    for (const key of ['name', 'customAppName']) {
      if (Object.prototype.hasOwnProperty.call(body || {}, key)) {
        metadata[key] = body[key]
      }
    }

    if (Object.keys(metadata).length === 0) {
      throw new Error('No subscription group localization fields provided for update')
    }

    const result = await appStoreConnect.updateSubscriptionGroupMetadata(subscriptionGroupId, locale, metadata)
    return ok(result)
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json()
    const { subscriptionGroupLocalizationId } = body || {}

    if (!subscriptionGroupLocalizationId) {
      throw new Error('subscriptionGroupLocalizationId is required')
    }

    const result = await appStoreConnect.deleteSubscriptionGroupLocalization(subscriptionGroupLocalizationId)
    return ok(result)
  } catch (error) {
    return fail(error)
  }
}
