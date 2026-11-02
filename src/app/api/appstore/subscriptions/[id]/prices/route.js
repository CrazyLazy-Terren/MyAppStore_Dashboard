import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'
import { getTerritoryTemplate } from '@/lib/pricingTemplate'

function todayUtc() {
  return new Date().toISOString().slice(0, 10)
}

// Per territory: the price new subscribers pay today and the change already
// scheduled, if any. Only the UPFRONT plan is shown.
function summarize(prices, today = todayUtc()) {
  const byTerritory = new Map()
  for (const price of prices) {
    if (price.planType !== 'UPFRONT') continue
    if (!byTerritory.has(price.territoryId)) byTerritory.set(price.territoryId, [])
    byTerritory.get(price.territoryId).push(price)
  }

  const rows = []
  for (const [territoryId, records] of byTerritory) {
    // A null startDate is the starting price, so it sorts first.
    records.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
    const started = records.filter((record) => !record.startDate || record.startDate <= today)
    const current = started.at(-1) || null
    const scheduled = records.filter((record) => record.startDate && record.startDate > today).at(-1) || null
    rows.push({
      territoryId,
      name: getTerritoryTemplate(territoryId).name,
      currency: (current || scheduled)?.currency || '',
      current: current && { customerPrice: current.customerPrice, proceeds: current.proceeds, startDate: current.startDate, pricePointId: current.pricePointId },
      scheduled: scheduled && { customerPrice: scheduled.customerPrice, proceeds: scheduled.proceeds, startDate: scheduled.startDate, pricePointId: scheduled.pricePointId, preserved: scheduled.preserved },
    })
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export async function GET(_request, { params }) {
  try {
    const { id } = await params
    return ok({ data: summarize(await appStoreConnect.listSubscriptionPrices(id)), today: todayUtc() })
  } catch (error) {
    return fail(error)
  }
}

// json { changes: [{ territoryId, pricePointId, preserveCurrentPrice? }], startDate, preserveCurrentPrice }
// -> one result per territory; a failed territory does not stop the others.
export async function POST(request, { params }) {
  try {
    const { id } = await params
    const { changes, startDate, preserveCurrentPrice = false } = await request.json()
    if (!Array.isArray(changes) || changes.length === 0) throw new Error('changes is required')
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('startDate must be YYYY-MM-DD')
    if (startDate && startDate <= todayUtc()) throw new Error('startDate must be after today')

    const results = []
    for (let index = 0; index < changes.length; index += 5) {
      const batch = changes.slice(index, index + 5)
      results.push(
        ...(await Promise.all(
          batch.map(async ({ territoryId, pricePointId, preserveCurrentPrice: preserve = preserveCurrentPrice }) => {
            try {
              await appStoreConnect.createSubscriptionPrice(id, { territoryId, pricePointId, startDate, preserveCurrentPrice: preserve })
              return { territoryId, status: 'scheduled' }
            } catch (error) {
              return { territoryId, status: 'failed', message: error instanceof Error ? error.message : String(error) }
            }
          })
        ))
      )
    }

    return ok({ data: results })
  } catch (error) {
    return fail(error)
  }
}
