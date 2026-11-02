'use client'

import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_PPP_SETTINGS } from '@/lib/pricingTemplate'

const PRICING_MODES = [
  { value: 'equalized', label: "Apple's equalized prices", hint: 'Every territory gets Apple’s FX- and tax-adjusted match for the new US price.' },
  { value: 'ppp', label: 'PPP + tax template', hint: 'US price × PPP multiplier × FX × (1 + VAT), snapped to the nearest price point.' },
]

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

// Local currency with its own symbol and decimals (¥890, ₹209, €9.99).
function formatPrice(value, currency) {
  if (value == null || value === '') return '—'
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(Number(value))
    } catch {
      // Unknown currency code: fall through to the plain number.
    }
  }
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency || ''}`.trim()
}

function formatUsd(value, usdPerLocal) {
  if (value == null || value === '' || !usdPerLocal) return null
  return `≈ $${(Number(value) * usdPerLocal).toFixed(2)}`
}

function formatPercent(value) {
  if (value == null || !Number.isFinite(value)) return '—'
  const percent = Math.round(value * 1000) / 10
  return `${percent > 0 ? '+' : ''}${percent}%`
}

async function readJson(res, fallbackMessage) {
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error?.message || fallbackMessage)
  return json
}

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700'
const labelClass = 'mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500'

const RESULT_STYLE = {
  scheduled: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-800',
}

// Schedules a subscription price change: pick a new US price, compare every
// territory's new price with what new subscribers pay today, then confirm.
export default function SubscriptionPriceChange({ subscription }) {
  const subscriptionId = subscription?.id
  const [currentRows, setCurrentRows] = useState([])
  const [today, setToday] = useState(null)
  const [currentLoading, setCurrentLoading] = useState(false)
  const [usPricePoints, setUsPricePoints] = useState([])
  const [basePricePointId, setBasePricePointId] = useState('')
  const [mode, setMode] = useState('equalized')
  const [pppSettings, setPppSettings] = useState(DEFAULT_PPP_SETTINGS)
  const [charm, setCharm] = useState(true)
  const [proposedRows, setProposedRows] = useState([])
  const [proposedLoading, setProposedLoading] = useState(false)
  const [excluded, setExcluded] = useState(() => new Set())
  const [startDate, setStartDate] = useState('')
  const [preserve, setPreserve] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)

  async function loadCurrent(signal) {
    setCurrentLoading(true)
    try {
      const json = await readJson(await fetch(`/api/appstore/subscriptions/${subscriptionId}/prices`, { signal }), 'Failed to load current prices')
      setCurrentRows(json.data || [])
      setToday(json.today)
      setStartDate((value) => value || addDays(json.today, 2))
      return json.data || []
    } finally {
      if (!signal?.aborted) setCurrentLoading(false)
    }
  }

  useEffect(() => {
    if (!subscriptionId) return undefined
    const controller = new AbortController()
    setProposedRows([])
    setExcluded(new Set())
    setResults(null)
    setConfirming(false)
    setError(null)
    setStartDate('')

    Promise.all([
      loadCurrent(controller.signal),
      fetch(`/api/appstore/subscriptions/${subscriptionId}/price-points?territory=USA`, { signal: controller.signal }).then((res) => readJson(res, 'Failed to load US price points')),
    ])
      .then(([rows, points]) => {
        setUsPricePoints(points.data || [])
        setBasePricePointId(rows.find((row) => row.territoryId === 'USA')?.current?.pricePointId || points.data?.[0]?.id || '')
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message)
      })

    return () => controller.abort()
  }, [subscriptionId])

  async function handleCompare() {
    setProposedLoading(true)
    setError(null)
    setResults(null)
    setConfirming(false)
    try {
      const query = new URLSearchParams({ basePricePointId, ...Object.fromEntries(Object.entries(pppSettings).map(([key, value]) => [key, String(value)])) })
      const json = await readJson(await fetch(`/api/appstore/subscriptions/${subscriptionId}/ppp-prices?${query}`), 'Failed to calculate new prices')
      setProposedRows(json.data || [])
      setExcluded(new Set())
    } catch (err) {
      setError(err.message)
    } finally {
      setProposedLoading(false)
    }
  }

  const currentByTerritory = useMemo(() => new Map(currentRows.map((row) => [row.territoryId, row])), [currentRows])

  // One row per territory: today's price, the new one and the difference.
  const compareRows = useMemo(
    () =>
      proposedRows.map((row) => {
        const current = currentByTerritory.get(row.territoryId)
        const isEqualized = mode === 'equalized'
        const plain = isEqualized
          ? { pricePointId: row.equalizedPricePointId, customerPrice: row.equalizedPrice, proceeds: row.equalizedProceeds }
          : { pricePointId: row.pricePointId, customerPrice: row.customerPrice, proceeds: row.proceeds }
        const chosen = charm ? row.charm?.[mode] || plain : plain
        const newPrice = chosen.customerPrice
        const newProceeds = chosen.proceeds
        const pricePointId = chosen.pricePointId
        const currentPrice = current?.current?.customerPrice
        const change = Number(currentPrice) > 0 ? Number(newPrice) / Number(currentPrice) - 1 : null
        return {
          territoryId: row.territoryId,
          name: row.name,
          currency: row.currency,
          usdPerLocal: row.usdPerLocal,
          current: current?.current || null,
          scheduled: current?.scheduled || null,
          newPrice,
          newProceeds,
          pricePointId,
          change,
          unchanged: current?.current?.pricePointId === pricePointId || (currentPrice != null && Number(currentPrice) === Number(newPrice)),
          alreadyScheduled: current?.scheduled?.pricePointId === pricePointId && current?.scheduled?.startDate === startDate,
          notAvailable: !current?.current,
        }
      }),
    [proposedRows, currentByTerritory, mode, charm, startDate]
  )

  const isOpen = (row) => !row.unchanged && !row.alreadyScheduled
  const selectedRows = compareRows.filter((row) => isOpen(row) && !excluded.has(row.territoryId))
  const increases = selectedRows.filter((row) => row.change > 0)
  const decreases = selectedRows.filter((row) => row.change < 0)
  const bigIncreases = increases.filter((row) => row.change > 0.5)
  const overwrites = selectedRows.filter((row) => row.scheduled)
  const newTerritories = selectedRows.filter((row) => row.notAvailable)
  const unchangedCount = compareRows.filter((row) => row.unchanged).length
  const scheduledCount = compareRows.filter((row) => !row.unchanged && row.alreadyScheduled).length
  const usRow = compareRows.find((row) => row.territoryId === 'USA')
  const averageChange = (rows) => (rows.length ? rows.reduce((sum, row) => sum + row.change, 0) / rows.length : null)
  const resultFor = (territoryId) => results?.find((item) => item.territoryId === territoryId)
  const failed = (results || []).filter((item) => item.status === 'failed')

  function toggle(territoryId) {
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(territoryId)) next.delete(territoryId)
      else next.add(territoryId)
      return next
    })
  }

  async function apply(rows) {
    setApplying(true)
    setError(null)
    try {
      // Apple can't preserve a price on a decrease, so only increases carry it.
      const changes = rows.map((row) => ({ territoryId: row.territoryId, pricePointId: row.pricePointId, preserveCurrentPrice: preserve && row.change > 0 }))
      const json = await readJson(
        await fetch(`/api/appstore/subscriptions/${subscriptionId}/prices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ changes, startDate }),
        }),
        'Failed to schedule the price change'
      )
      const done = json.data || []
      setResults((current) => [...(current || []).filter((item) => !done.some((result) => result.territoryId === item.territoryId)), ...done])
      setConfirming(false)
      await loadCurrent()
    } catch (err) {
      setError(err.message)
    } finally {
      setApplying(false)
    }
  }

  if (!subscriptionId) return null

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4">
        <div className="text-sm font-semibold text-slate-900">Price Change</div>
        <div className="text-xs text-slate-500">
          Schedule a new price for {subscription.attributes?.name || subscription.attributes?.productId}. Compare every territory with what new subscribers pay today, then confirm.
        </div>
      </div>

      {currentLoading && <p className="text-sm text-slate-500">Loading current prices…</p>}
      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelClass}>New US Price</label>
            <select className={inputClass} value={basePricePointId} onChange={(e) => setBasePricePointId(e.target.value)}>
              {usPricePoints.map((point) => (
                <option key={point.id} value={point.id}>
                  ${point.customerPrice}
                  {point.id === currentByTerritory.get('USA')?.current?.pricePointId ? ' (current)' : ''}
                </option>
              ))}
            </select>
            {currentByTerritory.get('USA')?.current ? (
              <p className="mt-1 text-[11px] text-slate-400">Today: ${currentByTerritory.get('USA').current.customerPrice}</p>
            ) : null}
          </div>
          <div>
            <label className={labelClass}>Other Territories</label>
            <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value)}>
              {PRICING_MODES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">{PRICING_MODES.find((item) => item.value === mode)?.hint}</p>
          </div>
          <div>
            <label className={labelClass}>Start Date</label>
            <input type="date" className={inputClass} value={startDate} min={today ? addDays(today, 1) : undefined} onChange={(e) => setStartDate(e.target.value)} />
            <p className="mt-1 text-[11px] text-slate-400">Apple needs 1–2 days&apos; lead time.</p>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleCompare}
              disabled={proposedLoading || !basePricePointId}
              className="w-full rounded-full border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-900 hover:border-sky-400 disabled:opacity-50">
              {proposedLoading ? 'Calculating… (first load takes ~30s)' : 'Compare With Current'}
            </button>
          </div>
        </div>

        {mode === 'ppp' ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              { key: 'strength', label: `Strength ${Math.round(pppSettings.strength * 100)}%`, min: 0, max: 1, step: 0.05 },
              { key: 'floor', label: `Floor ${Math.round(pppSettings.floor * 100)}% of US`, min: 0.05, max: 1, step: 0.05 },
              { key: 'cap', label: `Cap ${Math.round(pppSettings.cap * 100)}% of US`, min: 1, max: 2, step: 0.05 },
            ].map((slider) => (
              <div key={slider.key}>
                <label className={labelClass}>{slider.label}</label>
                <input
                  type="range"
                  className="w-full"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={pppSettings[slider.key]}
                  onChange={(e) => setPppSettings((current) => ({ ...current, [slider.key]: Number(e.target.value) }))}
                />
              </div>
            ))}
            <p className="text-[11px] text-slate-400 sm:col-span-3">Press Compare again after moving a slider.</p>
          </div>
        ) : null}

        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={charm} onChange={(e) => setCharm(e.target.checked)} />
          <span>
            Charm prices
            <span className="block text-xs text-slate-500">
              Snap each territory to the nearest price ending in 9 (9.99, 9.90, ¥890, Rp49,000) within 12% of its calculated price. The US price stays as picked.
            </span>
          </span>
        </label>

        <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={preserve} onChange={(e) => setPreserve(e.target.checked)} />
          <span>
            Keep the current price for existing subscribers on increases.
            <span className="block text-xs text-slate-500">
              When off, existing subscribers move to the new price; Apple notifies them, and asks for consent where the region or the size of the increase requires it. Decreases always apply to existing subscribers.
            </span>
          </span>
        </label>

        {compareRows.length > 0 ? (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>
                {selectedRows.length} territories change · {increases.length} up · {decreases.length} down · {unchangedCount} unchanged{scheduledCount ? ` · ${scheduledCount} already scheduled` : ''} (left out)
              </span>
              <button type="button" className="text-sky-700 underline" onClick={() => setExcluded(new Set())}>
                Select all
              </button>
              <button type="button" className="text-sky-700 underline" onClick={() => setExcluded(new Set(compareRows.map((row) => row.territoryId)))}>
                Select none
              </button>
            </div>

            <div className="mt-2 max-h-[28rem] overflow-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-2 py-2"></th>
                    <th className="px-2 py-2">Territory</th>
                    <th className="px-2 py-2 text-right">Current</th>
                    <th className="px-2 py-2 text-right">New</th>
                    <th className="px-2 py-2 text-right">Change</th>
                    <th className="px-2 py-2 text-right">Proceeds</th>
                    <th className="px-2 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {compareRows.map((row) => {
                    const included = isOpen(row) && !excluded.has(row.territoryId)
                    const result = resultFor(row.territoryId)
                    return (
                      <tr key={row.territoryId} className={`border-t border-slate-100 ${included ? '' : 'opacity-40'}`}>
                        <td className="px-2 py-1.5">
                          <input type="checkbox" checked={included} disabled={!isOpen(row)} onChange={() => toggle(row.territoryId)} />
                        </td>
                        <td className="px-2 py-1.5 text-slate-700">
                          {row.name} <span className="text-slate-400">{row.territoryId}</span>
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-500">
                          {formatPrice(row.current?.customerPrice, row.currency)}
                          {row.currency !== 'USD' && row.current ? <span className="block text-[10px] text-slate-400">{formatUsd(row.current.customerPrice, row.usdPerLocal)}</span> : null}
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold text-slate-900">
                          {formatPrice(row.newPrice, row.currency)}
                          {row.currency !== 'USD' ? <span className="block text-[10px] font-normal text-slate-400">{formatUsd(row.newPrice, row.usdPerLocal)}</span> : null}
                        </td>
                        <td className={`px-2 py-1.5 text-right font-medium ${row.change > 0 ? 'text-amber-700' : row.change < 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                          {row.unchanged ? 'same' : formatPercent(row.change)}
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-500">
                          {formatPrice(row.current?.proceeds, row.currency)} → {formatPrice(row.newProceeds, row.currency)}
                        </td>
                        <td className="px-2 py-1.5 text-slate-500">
                          <span className="flex flex-wrap items-center gap-1.5">
                            {row.notAvailable ? <span className="text-sky-700">not sold here yet</span> : null}
                            {row.alreadyScheduled ? <span className="text-emerald-700">scheduled for {row.scheduled.startDate}</span> : null}
                            {row.scheduled && !row.alreadyScheduled ? (
                              <span className="text-amber-700">
                                replaces {formatPrice(row.scheduled.customerPrice, row.currency)} on {row.scheduled.startDate}
                              </span>
                            ) : null}
                            {row.change > 0.5 && !row.unchanged ? <span className="text-amber-700">&gt;50%: may need consent</span> : null}
                            {result ? (
                              <span className={`rounded-full px-2 py-0.5 ${RESULT_STYLE[result.status]}`} title={result.message || ''}>
                                {result.status}
                                {result.message ? `: ${result.message.slice(0, 160)}` : ''}
                              </span>
                            ) : null}
                            {result?.status === 'failed' ? (
                              <button type="button" className="rounded-full border border-slate-300 px-2 py-0.5 font-medium disabled:opacity-40" disabled={applying} onClick={() => apply([row])}>
                                Retry
                              </button>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {confirming ? (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-slate-800">
                <div className="font-semibold">Confirm the price change</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {usRow && isOpen(usRow) && !excluded.has('USA') ? (
                    <li>
                      United States: ${usRow.current?.customerPrice} → ${usRow.newPrice} ({formatPercent(usRow.change)})
                    </li>
                  ) : null}
                  <li>
                    {selectedRows.length} territories starting {startDate}: {increases.length} increase{increases.length === 1 ? '' : 's'}
                    {increases.length ? ` (avg ${formatPercent(averageChange(increases))})` : ''}, {decreases.length} decrease{decreases.length === 1 ? '' : 's'}
                    {decreases.length ? ` (avg ${formatPercent(averageChange(decreases))})` : ''}.
                  </li>
                  {increases.length ? (
                    <li>
                      Existing subscribers {preserve ? 'keep their current price on increases' : 'move to the increased price (Apple notifies them or asks for consent)'}.
                    </li>
                  ) : null}
                  {decreases.length ? <li>Decreases also lower the price for existing subscribers.</li> : null}
                  {bigIncreases.length ? <li>{bigIncreases.length} territories rise more than 50%; subscribers there may have to consent.</li> : null}
                  {overwrites.length ? <li>Replaces the change already scheduled in {overwrites.length} territories.</li> : null}
                  {newTerritories.length ? <li>{newTerritories.length} territories have no price today and become available.</li> : null}
                  <li>Once a change takes effect it can&apos;t be reversed. Until then you can remove it in App Store Connect.</li>
                </ul>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => apply(selectedRows)}
                    disabled={applying}
                    className="rounded-full bg-sky-900 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60">
                    {applying ? 'Scheduling…' : `Confirm ${selectedRows.length} Price Changes`}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} disabled={applying} className="rounded-full px-4 py-2 text-sm">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {failed.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => apply(compareRows.filter((row) => failed.some((item) => item.territoryId === row.territoryId)))}
                    disabled={applying}
                    className="rounded-full border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50">
                    Retry {failed.length} failed
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={applying || selectedRows.length === 0 || !startDate}
                  className="rounded-full bg-sky-900 px-4 py-2 text-md font-semibold text-white hover:bg-sky-800 disabled:opacity-60">
                  Review Price Change ({selectedRows.length} territories)
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
