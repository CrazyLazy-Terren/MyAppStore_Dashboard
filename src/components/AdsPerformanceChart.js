'use client'

import { useMemo, useState } from 'react'

// Categorical palette in fixed order; campaigns get a slot by campaign ID so colors stay stable.
const CAMPAIGN_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const OTHER_COLOR = '#a3a3a3'
const CHART_HEIGHT = 220

const METRICS = [
  { key: 'localSpend', label: 'Spend', kind: 'sum', format: 'money' },
  { key: 'tapInstalls', label: 'Installs', kind: 'sum', format: 'count' },
  { key: 'taps', label: 'Taps', kind: 'sum', format: 'count' },
  { key: 'impressions', label: 'Impressions', kind: 'sum', format: 'count' },
  { key: 'cpi', label: 'Cost per install', kind: 'ratio', numerator: 'localSpend', denominator: 'tapInstalls', format: 'money' },
  { key: 'conversion', label: 'Conversion rate', kind: 'ratio', numerator: 'tapInstalls', denominator: 'taps', format: 'percent' },
  { key: 'ttr', label: 'Tap-through rate', kind: 'ratio', numerator: 'taps', denominator: 'impressions', format: 'percent' },
]
const BASE_KEYS = ['localSpend', 'impressions', 'taps', 'tapInstalls']

function getMetricValue(value) {
  if (value && typeof value === 'object') {
    return Number(value.amount ?? value.value ?? 0)
  }
  return Number(value ?? 0)
}

function toIsoDate(value) {
  if (/^\d{4}-\d{2}-\d{2}/.test(value || '')) {
    return value.slice(0, 10)
  }
  const match = String(value || '').match(/^(\d{2})-(\d{2})-(\d{4})/)
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function formatDay(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function niceMax(value) {
  if (value <= 0) {
    return 1
  }
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return [1, 2, 2.5, 5, 10].find((step) => step * magnitude >= value) * magnitude
}

function emptyTotals() {
  return { localSpend: 0, impressions: 0, taps: 0, tapInstalls: 0 }
}

function buildReport(reportData, startDate, endDate) {
  const rows = reportData?.data?.reportingDataResponse?.row || reportData?.reportingDataResponse?.row || []
  const campaigns = []
  const byDate = new Map()
  let currency = null

  for (const row of rows) {
    const metadata = row?.metadata || {}
    const campaignId = String(metadata.campaignId ?? campaigns.length)
    const campaign = {
      id: campaignId,
      name: metadata.campaignName || `Campaign ${campaignId}`,
      status: metadata.displayStatus || metadata.campaignStatus || '',
      totals: emptyTotals(),
    }
    campaigns.push(campaign)

    for (const entry of Array.isArray(row?.granularity) ? row.granularity : []) {
      const date = toIsoDate(entry?.date)
      if (!date) {
        continue
      }
      currency = currency || entry?.localSpend?.currency || null
      const day = byDate.get(date) || {}
      const values = (day[campaignId] ||= emptyTotals())
      for (const key of BASE_KEYS) {
        const value = getMetricValue(entry?.[key])
        values[key] += value
        campaign.totals[key] += value
      }
      byDate.set(date, day)
    }
  }

  const knownDates = [...byDate.keys()].sort()
  const firstDate = startDate || knownDates[0]
  const lastDate = endDate || knownDates.at(-1)
  const days = []
  if (firstDate && lastDate) {
    for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
      days.push({ date, campaigns: byDate.get(date) || {} })
    }
  }

  const sortedById = [...campaigns].sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
  for (const [index, campaign] of sortedById.entries()) {
    campaign.slot = index
    campaign.color = CAMPAIGN_COLORS[index] || OTHER_COLOR
  }

  return { campaigns: campaigns.sort((left, right) => right.totals.localSpend - left.totals.localSpend), days, currency }
}

function sumCampaigns(valuesByCampaign, campaignIds) {
  const totals = emptyTotals()
  for (const id of campaignIds) {
    const values = valuesByCampaign[id]
    if (values) {
      for (const key of BASE_KEYS) {
        totals[key] += values[key]
      }
    }
  }
  return totals
}

function metricValue(metric, totals) {
  if (metric.kind === 'sum') {
    return totals[metric.key]
  }
  const denominator = totals[metric.denominator]
  return denominator > 0 ? totals[metric.numerator] / denominator : null
}

export default function AdsPerformanceChart({ reportData, startDate, endDate }) {
  const [metricKey, setMetricKey] = useState('localSpend')
  const [hidden, setHidden] = useState(() => new Set())
  const [hoveredIndex, setHoveredIndex] = useState(null)

  const { campaigns, days, currency } = useMemo(() => buildReport(reportData, startDate, endDate), [reportData, startDate, endDate])
  const metric = METRICS.find((item) => item.key === metricKey)
  const visibleCampaigns = campaigns.filter((campaign) => !hidden.has(campaign.id))
  const visibleIds = visibleCampaigns.map((campaign) => campaign.id)
  const stackedCampaigns = [...visibleCampaigns].sort((left, right) => left.slot - right.slot)

  const format = (value, style = metric.format, decimals = 2) => {
    if (value === null || value === undefined) {
      return '—'
    }
    if (style === 'money') {
      return `${value.toFixed(decimals)}${currency ? ` ${currency}` : ''}`
    }
    if (style === 'percent') {
      return `${(value * 100).toFixed(1)}%`
    }
    return Math.round(value).toLocaleString()
  }

  const overall = sumCampaigns(Object.fromEntries(campaigns.map((campaign) => [campaign.id, campaign.totals])), visibleIds)
  const dayValues = days.map((day) => metricValue(metric, sumCampaigns(day.campaigns, visibleIds)))
  const yMax = niceMax(Math.max(0, ...dayValues.map((value) => value || 0)))
  const labelEvery = Math.max(1, Math.ceil(days.length / 8))
  const activeDays = dayValues.filter((value) => value !== null && value > 0)

  const toggleCampaign = (id) => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  if (campaigns.length === 0) {
    return null
  }

  const tiles = [
    ['Spend', format(overall.localSpend, 'money')],
    ['Installs', format(overall.tapInstalls, 'count')],
    ['Cost per install', format(metricValue(METRICS[4], overall), 'money')],
    ['Conversion rate', format(metricValue(METRICS[5], overall), 'percent')],
    ['Taps', format(overall.taps, 'count')],
    ['Tap-through rate', format(metricValue(METRICS[6], overall), 'percent')],
  ]

  return (
    <div className="mt-6 flex flex-col gap-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h4 className="text-base font-semibold text-slate-900">Ads Performance</h4>
        <p className="mt-1 text-sm text-slate-500">
          Daily Apple Ads results by campaign. Pick a metric, and click a campaign to include or exclude it everywhere below.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
            <div className="mt-2 text-xl font-bold tracking-tight text-slate-900">{value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 rounded-2xl bg-slate-100 p-1">
        {METRICS.map((item) => (
          <button
            key={item.key}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
              metricKey === item.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
            onClick={() => setMetricKey(item.key)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-slate-900">
          {metric.label} per day{metric.kind === 'sum' ? ', stacked by campaign' : ', all selected campaigns'}
        </span>
        <span className="text-slate-500">
          {metric.kind === 'sum'
            ? `Total ${format(overall[metric.key])} · daily average ${format(overall[metric.key] / Math.max(days.length, 1))}`
            : `Overall ${format(metricValue(metric, overall))} · ${activeDays.length} of ${days.length} days with data`}
        </span>
      </div>

      <div className="flex gap-2">
        <div className="relative w-20 shrink-0 text-right text-xs tabular-nums text-slate-400" style={{ height: CHART_HEIGHT }}>
          {[1, 0.5, 0].map((fraction) => (
            <span key={fraction} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${(1 - fraction) * 100}%` }}>
              {format(yMax * fraction, metric.format, yMax >= 10 ? 0 : 2)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: CHART_HEIGHT }}>
            <div className="border-t border-slate-100" />
            <div className="border-t border-slate-100" />
            <div className="border-t border-slate-300" />
          </div>
          <div className="relative flex items-end gap-[2px]" style={{ height: CHART_HEIGHT }}>
            {days.map((day, index) => {
              const anchorRight = index > days.length / 2
              const dayTotals = sumCampaigns(day.campaigns, visibleIds)
              const tooltipCampaigns = visibleCampaigns
                .map((campaign) => ({ campaign, value: day.campaigns[campaign.id] ? metricValue(metric, day.campaigns[campaign.id]) : null }))
                .filter((item) => item.value !== null && item.value > 0)
                .sort((left, right) => right.value - left.value)

              return (
                <div
                  key={day.date}
                  className={`relative flex h-full flex-1 flex-col-reverse gap-[2px] ${hoveredIndex === index ? 'bg-slate-100/70' : ''}`}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}>
                  {metric.kind === 'sum'
                    ? stackedCampaigns.map((campaign, stackIndex) => {
                        const value = day.campaigns[campaign.id]?.[metric.key] || 0
                        if (value <= 0) {
                          return null
                        }
                        const isTop = stackedCampaigns.slice(stackIndex + 1).every((later) => !(day.campaigns[later.id]?.[metric.key] > 0))
                        return (
                          <div
                            key={campaign.id}
                            className={isTop ? 'rounded-t' : ''}
                            style={{ height: `${(value / yMax) * CHART_HEIGHT}px`, backgroundColor: campaign.color }}
                          />
                        )
                      })
                    : dayValues[index] > 0 && (
                        <div className="rounded-t bg-slate-700" style={{ height: `${(dayValues[index] / yMax) * CHART_HEIGHT}px` }} />
                      )}
                  {hoveredIndex === index ? (
                    <div
                      className={`pointer-events-none absolute bottom-full z-50 mb-2 w-64 rounded-xl bg-slate-900 p-3 text-xs text-slate-100 shadow-lg ${
                        anchorRight ? 'right-0' : 'left-0'
                      }`}>
                      <div className="mb-2 flex justify-between font-semibold text-white">
                        <span>{formatDay(day.date)}</span>
                        <span>{format(dayValues[index])}</span>
                      </div>
                      {tooltipCampaigns.length > 0 ? (
                        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                          {tooltipCampaigns.map(({ campaign, value }) => (
                            <div key={campaign.id} className="contents">
                              <dt className="flex min-w-0 items-center gap-2 text-slate-300">
                                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: campaign.color }} />
                                <span className="truncate">{campaign.name}</span>
                              </dt>
                              <dd className="text-right tabular-nums">{format(value)}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="text-slate-400">No activity</p>
                      )}
                      <div className="mt-2 border-t border-slate-700 pt-2 text-slate-400">
                        {format(dayTotals.localSpend, 'money')} · {format(dayTotals.taps, 'count')} taps · {format(dayTotals.tapInstalls, 'count')} installs
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex gap-[2px] text-xs text-slate-400">
            {days.map((day, index) => (
              <span key={day.date} className="flex-1 whitespace-nowrap">
                {index % labelEvery === 0 ? formatDay(day.date) : ''}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              <th className="py-2 pr-4">Campaign</th>
              <th className="py-2 pr-4 text-right">Spend</th>
              <th className="py-2 pr-4 text-right">Impr.</th>
              <th className="py-2 pr-4 text-right">Taps</th>
              <th className="py-2 pr-4 text-right">Installs</th>
              <th className="py-2 pr-4 text-right">TTR</th>
              <th className="py-2 pr-4 text-right">Conv.</th>
              <th className="py-2 text-right">CPI</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => {
              const isHidden = hidden.has(campaign.id)
              return (
                <tr
                  key={campaign.id}
                  className={`cursor-pointer border-b border-slate-100 tabular-nums transition hover:bg-slate-50 ${isHidden ? 'text-slate-300' : 'text-slate-700'}`}
                  onClick={() => toggleCampaign(campaign.id)}
                  title={isHidden ? 'Click to include' : 'Click to exclude'}>
                  <td className="py-2 pr-4">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" readOnly checked={!isHidden} className="pointer-events-none" aria-label={`Include ${campaign.name}`} />
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: isHidden ? '#e2e8f0' : campaign.color }} />
                      <span className={`font-medium ${isHidden ? '' : 'text-slate-900'}`}>{campaign.name}</span>
                      {campaign.status ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {campaign.status.toLowerCase()}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right">{format(campaign.totals.localSpend, 'money')}</td>
                  <td className="py-2 pr-4 text-right">{format(campaign.totals.impressions, 'count')}</td>
                  <td className="py-2 pr-4 text-right">{format(campaign.totals.taps, 'count')}</td>
                  <td className="py-2 pr-4 text-right">{format(campaign.totals.tapInstalls, 'count')}</td>
                  <td className="py-2 pr-4 text-right">{format(metricValue(METRICS[6], campaign.totals), 'percent')}</td>
                  <td className="py-2 pr-4 text-right">{format(metricValue(METRICS[5], campaign.totals), 'percent')}</td>
                  <td className="py-2 text-right">{format(metricValue(METRICS[4], campaign.totals), 'money')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
