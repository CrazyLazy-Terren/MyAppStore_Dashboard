import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function GET(_request, { params }) {
  try {
    const { id } = await params
    const offers = await appStoreConnect.listWinBackOffers(id)
    return ok({ data: offers })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params
    const { offer, prices } = (await request.json()) || {}

    for (const key of ['referenceName', 'offerId', 'duration', 'offerMode', 'periodCount', 'startDate']) {
      if (!offer?.[key]) throw new Error(`${key} is required`)
    }
    if (!Array.isArray(prices) || prices.length === 0) {
      throw new Error('At least one territory price is required')
    }

    const result = await appStoreConnect.createWinBackOffer(id, offer, prices)
    return ok(result)
  } catch (error) {
    return fail(error)
  }
}
