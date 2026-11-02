import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'
import { DEFAULT_PPP_SETTINGS, PPP_TEMPLATE_INFO, computeTargetPrice, getTerritoryTemplate, pppMultiplier, snapToCharmPricePoint, snapToPricePoint } from '@/lib/pricingTemplate'

const CACHE_TTL_MS = 30 * 60 * 1000
const pricePointCache = new Map()

// Every territory's price points for a subscription (~140k rows). Cached so moving the PPP sliders does not refetch.
async function getAllPricePointsByTerritory(subscriptionId, territoryIds) {
  const cached = pricePointCache.get(subscriptionId)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.byTerritory
  }

  const pricePoints = await appStoreConnect.listSubscriptionPricePoints(subscriptionId, territoryIds)
  const byTerritory = new Map()
  for (const point of pricePoints) {
    if (!byTerritory.has(point.territoryId)) byTerritory.set(point.territoryId, [])
    byTerritory.get(point.territoryId).push(point)
  }

  pricePointCache.set(subscriptionId, { loadedAt: Date.now(), byTerritory })
  return byTerritory
}

function readNumber(searchParams, key, fallback) {
  const value = Number(searchParams.get(key))
  return searchParams.has(key) && Number.isFinite(value) ? value : fallback
}

export async function GET(request, { params }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const basePricePointId = searchParams.get('basePricePointId')
    if (!basePricePointId) throw new Error('basePricePointId is required')

    const settings = {
      strength: readNumber(searchParams, 'strength', DEFAULT_PPP_SETTINGS.strength),
      floor: readNumber(searchParams, 'floor', DEFAULT_PPP_SETTINGS.floor),
      cap: readNumber(searchParams, 'cap', DEFAULT_PPP_SETTINGS.cap),
    }

    const [basePoints, allEqualizations] = await Promise.all([
      appStoreConnect.listSubscriptionPricePoints(id, ['USA']),
      appStoreConnect.getSubscriptionPricePointEqualizations(basePricePointId),
    ])
    const base = basePoints.find((point) => point.id === basePricePointId)
    if (!base) throw new Error('basePricePointId must be a United States price point for this subscription')

    const equalizations = allEqualizations.filter((point) => point.territoryId !== base.territoryId)
    const basePrice = Number(base.customerPrice)
    const baseProceeds = Number(base.proceeds)
    const territoryIds = equalizations.map((point) => point.territoryId)
    const pricePointsByTerritory = await getAllPricePointsByTerritory(id, ['USA', ...territoryIds])

    const rows = [base, ...equalizations].map((equalized) => {
      const template = getTerritoryTemplate(equalized.territoryId)
      const multiplier = pppMultiplier(template.plr, settings)
      const target = computeTargetPrice({ basePrice, baseProceeds, equalized, plr: template.plr, vat: template.vat, multiplier })
      const snapped = target ? snapToPricePoint(target, pricePointsByTerritory.get(equalized.territoryId)) : null
      const chosen = snapped || equalized
      const territoryPoints = pricePointsByTerritory.get(equalized.territoryId)
      // The US price is the one picked, so it is never re-snapped.
      const isBase = equalized.territoryId === base.territoryId
      const charmEqualized = isBase ? base : snapToCharmPricePoint(Number(equalized.customerPrice), territoryPoints) || equalized
      const charmTarget = isBase ? base : target ? snapToCharmPricePoint(target, territoryPoints) || chosen : chosen
      const pick = (point) => ({ pricePointId: point.id, customerPrice: point.customerPrice, proceeds: point.proceeds })

      return {
        territoryId: equalized.territoryId,
        name: template.name,
        currency: equalized.currency,
        plr: template.plr,
        pppYear: template.pppYear,
        vat: template.vat,
        multiplier,
        equalizedPrice: equalized.customerPrice,
        equalizedPricePointId: equalized.id,
        equalizedProceeds: equalized.proceeds,
        // Charm-priced alternatives (x.99, 890, 49,000) for each mode.
        charm: { equalized: pick(charmEqualized), ppp: pick(charmTarget) },
        // Local price -> US dollars, using Apple's match of the US base price.
        usdPerLocal: Number(equalized.customerPrice) > 0 ? basePrice / Number(equalized.customerPrice) : null,
        targetPrice: target,
        pricePointId: chosen.id,
        customerPrice: chosen.customerPrice,
        proceeds: chosen.proceeds,
        vsEqualized: Number(equalized.customerPrice) > 0 ? Number(chosen.customerPrice) / Number(equalized.customerPrice) - 1 : null,
        missingTemplate: template.plr == null || template.vat == null,
      }
    })

    rows.sort((a, b) => a.name.localeCompare(b.name))
    return ok({ data: rows, base, settings, template: PPP_TEMPLATE_INFO })
  } catch (error) {
    return fail(error)
  }
}
