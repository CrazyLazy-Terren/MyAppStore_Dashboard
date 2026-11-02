'use client'

import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_PPP_SETTINGS } from '@/lib/pricingTemplate'

const OFFER_MODES = [
  { value: 'PAY_AS_YOU_GO', label: 'Pay as you go', hint: 'Discounted price each period for N periods' },
  { value: 'PAY_UP_FRONT', label: 'Pay up front', hint: 'One discounted payment for the whole duration' },
  { value: 'FREE_TRIAL', label: 'Free', hint: 'Free for the duration' },
]

const DURATIONS = ['THREE_DAYS', 'ONE_WEEK', 'TWO_WEEKS', 'ONE_MONTH', 'TWO_MONTHS', 'THREE_MONTHS', 'SIX_MONTHS', 'ONE_YEAR']

function today() {
  return new Date().toISOString().slice(0, 10)
}

function emptyOffer() {
  return {
    referenceName: '',
    offerId: '',
    offerMode: 'PAY_AS_YOU_GO',
    duration: 'ONE_MONTH',
    periodCount: 3,
    customerEligibilityPaidSubscriptionDurationInMonths: 1,
    customerEligibilityTimeSinceLastSubscribedInMonths: { minimum: 1, maximum: 12 },
    customerEligibilityWaitBetweenOffersInMonths: '',
    startDate: today(),
    endDate: '',
    priority: 'NORMAL',
    promotionIntent: 'NOT_PROMOTED',
  }
}

function formatLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (char) => char.toUpperCase())
}

function formatPercent(value) {
  if (value == null) return '—'
  const percent = Math.round(value * 100)
  return `${percent > 0 ? '+' : ''}${percent}%`
}

function formatPrice(value, currency) {
  if (value == null || value === '') return '—'
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency || ''}`.trim()
}

async function readJson(res, fallbackMessage) {
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error?.message || fallbackMessage)
  return json
}

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700'
const labelClass = 'mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500'

export default function SubscriptionWinBackOffers({ subscription }) {
  const subscriptionId = subscription?.id
  const [offers, setOffers] = useState([])
  const [offersLoading, setOffersLoading] = useState(false)
  const [offersError, setOffersError] = useState(null)
  const [deletingOfferId, setDeletingOfferId] = useState(null)

  const [offer, setOffer] = useState(emptyOffer)
  const [usPricePoints, setUsPricePoints] = useState([])
  const [basePricePointId, setBasePricePointId] = useState('')
  const [pppSettings, setPppSettings] = useState(DEFAULT_PPP_SETTINGS)
  const [priceRows, setPriceRows] = useState([])
  const [templateInfo, setTemplateInfo] = useState(null)
  const [excludedTerritories, setExcludedTerritories] = useState(() => new Set())
  const [pricesLoading, setPricesLoading] = useState(false)
  const [pricesError, setPricesError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState(null)

  const isFreeTrial = offer.offerMode === 'FREE_TRIAL'

  async function loadOffers(signal) {
    setOffersLoading(true)
    setOffersError(null)
    try {
      const json = await readJson(await fetch(`/api/appstore/subscriptions/${subscriptionId}/win-back-offers`, { signal }), 'Failed to load win-back offers')
      setOffers(json.data || [])
    } catch (err) {
      if (err.name !== 'AbortError') setOffersError(err.message)
    } finally {
      if (!signal?.aborted) setOffersLoading(false)
    }
  }

  useEffect(() => {
    if (!subscriptionId) return undefined
    const controller = new AbortController()
    setOffer(emptyOffer())
    setPriceRows([])
    setExcludedTerritories(new Set())
    setMessage(null)
    loadOffers(controller.signal)

    fetch(`/api/appstore/subscriptions/${subscriptionId}/price-points?territory=USA`, { signal: controller.signal })
      .then((res) => readJson(res, 'Failed to load US price points'))
      .then((json) => {
        const points = json.data || []
        setUsPricePoints(points)
        // Default the offer price to roughly $4.99, a common win-back price.
        const preferred = points.find((point) => Number(point.customerPrice) >= 4.99) || points[0]
        setBasePricePointId(preferred?.id || '')
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setPricesError(err.message)
      })

    return () => controller.abort()
  }, [subscriptionId])

  function updateOffer(key, value) {
    setOffer((current) => ({ ...current, [key]: value }))
  }

  function updateEligibilityRange(key, value) {
    setOffer((current) => ({
      ...current,
      customerEligibilityTimeSinceLastSubscribedInMonths: { ...current.customerEligibilityTimeSinceLastSubscribedInMonths, [key]: value },
    }))
  }

  async function handleCalculatePrices() {
    if (!basePricePointId) return
    setPricesLoading(true)
    setPricesError(null)
    try {
      const query = new URLSearchParams({ basePricePointId, ...Object.fromEntries(Object.entries(pppSettings).map(([key, value]) => [key, String(value)])) })
      const json = await readJson(await fetch(`/api/appstore/subscriptions/${subscriptionId}/ppp-prices?${query}`), 'Failed to calculate PPP prices')
      setPriceRows(json.data || [])
      setTemplateInfo(json.template || null)
    } catch (err) {
      setPricesError(err.message)
    } finally {
      setPricesLoading(false)
    }
  }

  function toggleTerritory(territoryId) {
    setExcludedTerritories((current) => {
      const next = new Set(current)
      if (next.has(territoryId)) next.delete(territoryId)
      else next.add(territoryId)
      return next
    })
  }

  const includedRows = useMemo(() => priceRows.filter((row) => !excludedTerritories.has(row.territoryId)), [priceRows, excludedTerritories])
  const missingTemplateCount = priceRows.filter((row) => row.missingTemplate).length

  async function handleCreate() {
    setMessage(null)
    if (!offer.referenceName.trim() || !offer.offerId.trim()) {
      setMessage({ type: 'error', text: 'Reference name and offer ID are required.' })
      return
    }
    if (includedRows.length === 0) {
      setMessage({ type: 'error', text: 'Calculate territory prices first and keep at least one territory selected.' })
      return
    }

    setCreating(true)
    try {
      const prices = includedRows.map((row) => ({ territoryId: row.territoryId, pricePointId: row.pricePointId }))
      const periodCount = offer.offerMode === 'PAY_AS_YOU_GO' ? offer.periodCount : 1
      await readJson(
        await fetch(`/api/appstore/subscriptions/${subscriptionId}/win-back-offers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offer: { ...offer, periodCount, referenceName: offer.referenceName.trim(), offerId: offer.offerId.trim() }, prices }),
        }),
        'Failed to create win-back offer'
      )
      setMessage({ type: 'success', text: `Created "${offer.referenceName}" in ${prices.length} territories.` })
      setOffer(emptyOffer())
      await loadOffers()
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(winBackOffer) {
    const name = winBackOffer.attributes?.referenceName || winBackOffer.id
    if (!window.confirm(`Delete the win-back offer "${name}" from App Store Connect? This cannot be undone.`)) {
      return
    }
    setDeletingOfferId(winBackOffer.id)
    try {
      await readJson(await fetch(`/api/appstore/win-back-offers/${winBackOffer.id}`, { method: 'DELETE' }), 'Failed to delete win-back offer')
      setOffers((current) => current.filter((item) => item.id !== winBackOffer.id))
    } catch (err) {
      setOffersError(err.message)
    } finally {
      setDeletingOfferId(null)
    }
  }

  if (!subscriptionId) return null

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4">
        <div className="text-sm font-semibold text-slate-900">Win-Back Offers</div>
        <div className="text-xs text-slate-500">
          Discounts shown to lapsed subscribers of {subscription.attributes?.name || subscription.attributes?.productId}. Requires iOS 18+.
        </div>
      </div>

      {offersLoading && <p className="text-sm text-slate-500">Loading win-back offers…</p>}
      {offersError && <p className="text-sm text-rose-600">{offersError}</p>}
      {!offersLoading && !offersError && offers.length === 0 ? <p className="text-sm text-slate-500">No win-back offers yet.</p> : null}

      {offers.length > 0 ? (
        <div className="grid gap-2">
          {offers.map((item) => {
            const attrs = item.attributes || {}
            const range = attrs.customerEligibilityTimeSinceLastSubscribedInMonths || {}
            return (
              <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium text-slate-900">
                    {attrs.referenceName} <span className="text-xs font-normal text-slate-400">{attrs.offerId}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {formatLabel(attrs.offerMode)} · {formatLabel(attrs.duration)}
                    {attrs.offerMode === 'PAY_AS_YOU_GO' ? ` × ${attrs.periodCount}` : ''} · lapsed {range.minimum}–{range.maximum} mo · paid ≥{' '}
                    {attrs.customerEligibilityPaidSubscriptionDurationInMonths} mo · {attrs.startDate}
                    {attrs.endDate ? ` → ${attrs.endDate}` : ' → no end'} · {formatLabel(attrs.priority)} priority
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  disabled={deletingOfferId === item.id}
                  className="self-start rounded-full border border-rose-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-rose-600 disabled:opacity-50 sm:self-auto">
                  {deletingOfferId === item.id ? 'Deleting…' : '✕ Delete'}
                </button>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">New Win-Back Offer</h4>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={labelClass}>Reference Name</label>
            <input className={inputClass} value={offer.referenceName} onChange={(e) => updateOffer('referenceName', e.target.value)} placeholder="Win-back 50% off 3 months" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Offer ID</label>
            <input className={inputClass} value={offer.offerId} onChange={(e) => updateOffer('offerId', e.target.value)} placeholder="winback_50_3m" />
          </div>

          <div>
            <label className={labelClass}>Offer Type</label>
            <select className={inputClass} value={offer.offerMode} onChange={(e) => updateOffer('offerMode', e.target.value)}>
              {OFFER_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">{OFFER_MODES.find((mode) => mode.value === offer.offerMode)?.hint}</p>
          </div>
          <div>
            <label className={labelClass}>Duration {offer.offerMode === 'PAY_AS_YOU_GO' ? '(per period)' : ''}</label>
            <select className={inputClass} value={offer.duration} onChange={(e) => updateOffer('duration', e.target.value)}>
              {DURATIONS.map((duration) => (
                <option key={duration} value={duration}>
                  {formatLabel(duration)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Number of Periods</label>
            <input
              type="number"
              min={1}
              max={12}
              className={inputClass}
              value={offer.offerMode === 'PAY_AS_YOU_GO' ? offer.periodCount : 1}
              disabled={offer.offerMode !== 'PAY_AS_YOU_GO'}
              onChange={(e) => updateOffer('periodCount', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Priority</label>
            <select className={inputClass} value={offer.priority} onChange={(e) => updateOffer('priority', e.target.value)}>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Min. Paid Months</label>
            <input
              type="number"
              min={1}
              className={inputClass}
              value={offer.customerEligibilityPaidSubscriptionDurationInMonths}
              onChange={(e) => updateOffer('customerEligibilityPaidSubscriptionDurationInMonths', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Lapsed For (months)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={offer.customerEligibilityTimeSinceLastSubscribedInMonths.minimum}
                onChange={(e) => updateEligibilityRange('minimum', e.target.value)}
              />
              <span className="text-slate-400">–</span>
              <input
                type="number"
                min={1}
                className={inputClass}
                value={offer.customerEligibilityTimeSinceLastSubscribedInMonths.maximum}
                onChange={(e) => updateEligibilityRange('maximum', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Wait Between Offers (months)</label>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={offer.customerEligibilityWaitBetweenOffersInMonths}
              placeholder="Optional"
              onChange={(e) => updateOffer('customerEligibilityWaitBetweenOffersInMonths', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Promotion</label>
            <select className={inputClass} value={offer.promotionIntent} onChange={(e) => updateOffer('promotionIntent', e.target.value)}>
              <option value="NOT_PROMOTED">Not promoted</option>
              <option value="USE_AUTO_GENERATED_ASSETS">Promote on App Store</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Start Date</label>
            <input type="date" className={inputClass} value={offer.startDate} onChange={(e) => updateOffer('startDate', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>End Date</label>
            <input type="date" className={inputClass} value={offer.endDate} onChange={(e) => updateOffer('endDate', e.target.value)} />
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
            {isFreeTrial ? 'Territories' : 'Price By Territory · PPP + Tax Template'}
          </div>
          {!isFreeTrial ? (
            <p className="mb-3 text-xs text-slate-500">
              Local price = US price × PPP multiplier × FX × (1 + VAT), snapped to the nearest App Store price point. FX comes from Apple&apos;s own
              equalization; the PPP multiplier blends between 1 (plain FX) and the World Bank price level ratio by Strength, clamped to Floor–Cap.
            </p>
          ) : (
            <p className="mb-3 text-xs text-slate-500">Free offers have no price. Load the territory list, then untick any territory to leave out.</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className={isFreeTrial ? 'hidden' : ''}>
              <label className={labelClass}>US Offer Price</label>
              <select className={inputClass} value={basePricePointId} onChange={(e) => setBasePricePointId(e.target.value)}>
                {usPricePoints.map((point) => (
                  <option key={point.id} value={point.id}>
                    ${point.customerPrice}
                  </option>
                ))}
              </select>
            </div>
            {!isFreeTrial
              ? [
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
                ))
              : null}
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleCalculatePrices}
                disabled={pricesLoading || !basePricePointId}
                className="w-full rounded-full border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-900 hover:border-sky-400 disabled:opacity-50">
                {pricesLoading ? 'Calculating… (first load takes ~30s)' : isFreeTrial ? 'Load Territories' : 'Calculate Prices'}
              </button>
            </div>
          </div>

          {pricesError && <p className="mt-2 text-sm text-rose-600">{pricesError}</p>}

          {priceRows.length > 0 ? (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>
                  {includedRows.length} of {priceRows.length} territories selected
                </span>
                {missingTemplateCount > 0 ? (
                  <span className="text-amber-700">{missingTemplateCount} territories lack PPP or VAT data and fall back to Apple&apos;s equalized price.</span>
                ) : null}
                {templateInfo ? (
                  <span>
                    PPP: {templateInfo.source}, built {templateInfo.generatedAt}
                  </span>
                ) : null}
                <button type="button" className="text-sky-700 underline" onClick={() => setExcludedTerritories(new Set())}>
                  Select all
                </button>
                <button type="button" className="text-sky-700 underline" onClick={() => setExcludedTerritories(new Set(priceRows.map((row) => row.territoryId)))}>
                  Select none
                </button>
              </div>

              <div className="mt-2 max-h-96 overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-2 py-2"></th>
                      <th className="px-2 py-2">Territory</th>
                      {!isFreeTrial ? (
                        <>
                          <th className="px-2 py-2 text-right">Price Level</th>
                          <th className="px-2 py-2 text-right">VAT</th>
                          <th className="px-2 py-2 text-right">Multiplier</th>
                          <th className="px-2 py-2 text-right">Equalized</th>
                          <th className="px-2 py-2 text-right">Target</th>
                          <th className="px-2 py-2 text-right">Offer Price</th>
                          <th className="px-2 py-2 text-right">vs Equalized</th>
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {priceRows.map((row) => {
                      const included = !excludedTerritories.has(row.territoryId)
                      return (
                        <tr key={row.territoryId} className={`border-t border-slate-100 ${included ? '' : 'opacity-40'} ${row.missingTemplate ? 'bg-amber-50/60' : ''}`}>
                          <td className="px-2 py-1.5">
                            <input type="checkbox" checked={included} onChange={() => toggleTerritory(row.territoryId)} />
                          </td>
                          <td className="px-2 py-1.5 text-slate-700">
                            {row.name} <span className="text-slate-400">{row.territoryId}</span>
                          </td>
                          {!isFreeTrial ? (
                            <>
                              <td className="px-2 py-1.5 text-right">{row.plr == null ? '—' : row.plr.toFixed(2)}</td>
                              <td className="px-2 py-1.5 text-right">{row.vat == null ? '—' : `${(row.vat * 100).toFixed(1)}%`}</td>
                              <td className="px-2 py-1.5 text-right">{row.multiplier.toFixed(2)}×</td>
                              <td className="px-2 py-1.5 text-right text-slate-500">{formatPrice(row.equalizedPrice, row.currency)}</td>
                              <td className="px-2 py-1.5 text-right text-slate-500">{formatPrice(row.targetPrice, row.currency)}</td>
                              <td className="px-2 py-1.5 text-right font-semibold text-slate-900">{formatPrice(row.customerPrice, row.currency)}</td>
                              <td className={`px-2 py-1.5 text-right ${row.vsEqualized < 0 ? 'text-emerald-700' : 'text-slate-500'}`}>{formatPercent(row.vsEqualized)}</td>
                            </>
                          ) : null}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {message ? <p className={`text-sm ${message.type === 'error' ? 'text-rose-600' : 'text-green-600'}`}>{message.text}</p> : null}
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || includedRows.length === 0}
            className="inline-flex shrink-0 items-center justify-center rounded-full bg-sky-900 px-4 py-2 text-md font-semibold text-white hover:bg-sky-800 disabled:opacity-60">
            {creating ? 'Creating…' : `Create Win-Back Offer (${includedRows.length} territories)`}
          </button>
        </div>
      </div>
    </div>
  )
}
