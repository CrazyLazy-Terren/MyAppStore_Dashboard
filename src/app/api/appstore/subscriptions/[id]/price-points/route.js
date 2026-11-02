import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function GET(request, { params }) {
  try {
    const { id } = await params
    const territory = new URL(request.url).searchParams.get('territory') || 'USA'
    const pricePoints = await appStoreConnect.listSubscriptionPricePoints(id, territory.split(',').filter(Boolean))
    pricePoints.sort((a, b) => Number(a.customerPrice) - Number(b.customerPrice))
    return ok({ data: pricePoints })
  } catch (error) {
    return fail(error)
  }
}
