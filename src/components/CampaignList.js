'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { campaignAPI, reportAPI } from '@/components/api'
import useAdsDateRange from '@/components/useAdsDateRange'
import { buildCampaignReportRequest } from '@/lib/reportDateRange'

function getMetricValue(value) {
  if (value && typeof value === 'object') {
    return Number(value.amount ?? value.value ?? 0)
  }

  return Number(value ?? 0)
}

function getCampaignStatus(campaign) {
  return String(campaign?.status || campaign?.displayStatus || 'UNKNOWN').toUpperCase()
}

function isActiveCampaign(campaign) {
  const status = getCampaignStatus(campaign)
  return status === 'ENABLED' || status === 'ACTIVE'
}

function buildCampaignSpendMap(reportData) {
  const rows = reportData?.data?.reportingDataResponse?.row || reportData?.reportingDataResponse?.row || []
  const campaignSpendMap = new Map()

  for (const row of rows) {
    const metadata = row?.metadata || {}
    const campaignId = String(metadata.campaignId ?? row?.campaignId ?? '')

    if (!campaignId) {
      continue
    }

    const granularityRows = Array.isArray(row?.granularity) ? row.granularity : []
    campaignSpendMap.set(
      campaignId,
      granularityRows.map((entry) => ({
        date: entry?.date || '',
        value: getMetricValue(entry?.localSpend),
      }))
    )
  }

  return campaignSpendMap
}

function buildSparklinePath(points, width, height, padding) {
  if (points.length === 0) {
    return ''
  }

  const values = points.map((point) => Number(point?.value || 0))
  const maxValue = Math.max(...values, 1)
  const usableWidth = width - padding * 2
  const usableHeight = height - padding * 2

  return values
    .map((value, index) => {
      const x = padding + (values.length === 1 ? usableWidth / 2 : (index / (values.length - 1)) * usableWidth)
      const y = height - padding - (value / maxValue) * usableHeight
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
}

function buildSparklineArea(points, width, height, padding) {
  const path = buildSparklinePath(points, width, height, padding)

  if (!path) {
    return ''
  }

  const usableWidth = width - padding * 2
  const firstX = padding
  const lastX = padding + (points.length === 1 ? usableWidth / 2 : usableWidth)
  const baseline = height - padding

  return `${path} L ${lastX} ${baseline} L ${firstX} ${baseline} Z`
}

function formatSparklineDate(value) {
  if (!value) {
    return '-'
  }

  const parsed = new Date(`${value}T00:00:00`)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function buildSparklinePoints(points, width, height, padding) {
  if (points.length === 0) {
    return []
  }

  const values = points.map((point) => Number(point?.value || 0))
  const maxValue = Math.max(...values, 1)
  const usableWidth = width - padding * 2
  const usableHeight = height - padding * 2

  return points.map((point, index) => ({
    ...point,
    x: padding + (points.length === 1 ? usableWidth / 2 : (index / (points.length - 1)) * usableWidth),
    y: height - padding - (Number(point?.value || 0) / maxValue) * usableHeight,
    label: formatSparklineDate(point?.date),
  }))
}

function DailyCostSparkline({ campaignId, dailySpend, compact = false }) {
  const points = Array.isArray(dailySpend) ? dailySpend : []
  const [hoveredPointIndex, setHoveredPointIndex] = useState(null)

  if (points.length === 0) {
    return <span className="text-xs font-medium text-slate-400">No spend data</span>
  }

  const width = compact ? 96 : 128
  const height = compact ? 28 : 36
  const padding = 4
  const path = buildSparklinePath(points, width, height, padding)
  const areaPath = buildSparklineArea(points, width, height, padding)
  const chartPoints = buildSparklinePoints(points, width, height, padding)
  const total = points.reduce((sum, point) => sum + Number(point?.value || 0), 0)
  const last = Number(points[points.length - 1]?.value || 0)
  const average = points.length > 0 ? total / points.length : 0
  const peak = Math.max(...points.map((point) => Number(point?.value || 0)), 0)
  const hoveredPoint = hoveredPointIndex === null ? null : chartPoints[hoveredPointIndex]
  const hoverZoneWidth = chartPoints.length > 1 ? Math.max(10, (width - padding * 2) / chartPoints.length) : width - padding * 2

  return (
    <div className={compact ? 'relative inline-flex min-w-24 flex-col gap-1' : 'relative inline-flex min-w-32 flex-col gap-1'}>
      {hoveredPoint ? (
        <div className="pointer-events-none absolute -top-20 left-1/2 z-20 min-w-36 -translate-x-1/2 rounded-xl bg-slate-950 px-3 py-2 text-[11px] font-semibold text-white shadow-lg shadow-slate-950/20">
          <div className="flex items-center justify-between gap-3 text-slate-300">
            <span>{hoveredPoint.label}</span>
            <span>${Number(hoveredPoint.value || 0).toFixed(2)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 text-slate-400">
            <span>Avg ${average.toFixed(2)}</span>
            <span>Peak ${peak.toFixed(2)}</span>
          </div>
          <div className="mt-1 text-right text-slate-400">Total ${total.toFixed(2)}</div>
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={compact ? 'h-7 w-24 overflow-visible' : 'h-9 w-32 overflow-visible'}
        role="img"
        aria-label="Daily cost trend"
        onMouseLeave={() => setHoveredPointIndex(null)}>
        <defs>
          <linearGradient id={`campaign-spend-${campaignId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <path d={`M ${padding} ${height - padding} H ${width - padding}`} className="stroke-slate-200" strokeWidth="1" fill="none" />
        <path d={areaPath} fill={`url(#campaign-spend-${campaignId})`} />
        <path d={path} className="stroke-teal-600" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {hoveredPoint ? (
          <path
            d={`M ${hoveredPoint.x} ${padding} L ${hoveredPoint.x} ${height - padding}`}
            className="stroke-teal-300"
            strokeWidth="1"
            strokeDasharray="3 3"
            fill="none"
          />
        ) : null}
        {chartPoints.map((point, index) => (
          <rect
            key={`${campaignId}-${point.date}-${index}`}
            x={Math.max(0, point.x - hoverZoneWidth / 2)}
            y={0}
            width={hoverZoneWidth}
            height={height}
            fill="transparent"
            onMouseEnter={() => setHoveredPointIndex(index)}>
            <title>{`${point.label}: $${Number(point.value || 0).toFixed(2)}`}</title>
          </rect>
        ))}
      </svg>
      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
        <span>Last ${last.toFixed(2)}</span>
        <span>{compact ? `Tot $${total.toFixed(2)}` : `Total $${total.toFixed(2)}`}</span>
      </div>
    </div>
  )
}

export default function CampaignList() {
  const router = useRouter()
  const { startDate, endDate } = useAdsDateRange(30)
  const [campaigns, setCampaigns] = useState([])
  const [campaignSpendMap, setCampaignSpendMap] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchCampaigns = async () => {
    try {
      setLoading(true)
      const [campaignsResponse, reportResponse] = await Promise.all([
        campaignAPI.getAll(),
        reportAPI.getCampaignReport(buildCampaignReportRequest(startDate, endDate)),
      ])

      setCampaigns(campaignsResponse.data?.data || [])
      setCampaignSpendMap(buildCampaignSpendMap(reportResponse.data))
      setError(null)
    } catch (err) {
      setError(err.message)
      setCampaignSpendMap(new Map())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCampaigns()
  }, [startDate, endDate])

  if (loading) {
    return (
      <div className="flex w-full items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/80 px-6 py-16 text-sm font-medium text-slate-500 shadow-sm">
        Loading campaigns...
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full rounded-3xl border border-rose-200 bg-rose-50 px-6 py-10 text-center shadow-sm">
        <p className="text-sm font-medium text-rose-700">Error loading campaigns: {error}</p>
        <button
          className="mt-4 inline-flex rounded-full bg-sky-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800"
          onClick={fetchCampaigns}>
          Retry
        </button>
      </div>
    )
  }

  const sortedCampaigns = [...campaigns].sort((left, right) => {
    const leftActiveRank = isActiveCampaign(left) ? 0 : 1
    const rightActiveRank = isActiveCampaign(right) ? 0 : 1

    if (leftActiveRank !== rightActiveRank) {
      return leftActiveRank - rightActiveRank
    }

    return String(left.name || '').localeCompare(String(right.name || ''))
  })

  const activeCampaigns = sortedCampaigns.filter((campaign) => isActiveCampaign(campaign))
  const otherCampaigns = sortedCampaigns.filter((campaign) => !isActiveCampaign(campaign))

  return (
    <div className="w-full rounded-3xl bg-white p-6 shadow-lg shadow-slate-200/70 ring-1 ring-slate-200 sm:p-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Campaigns</h2>
          <p className="mt-1 text-sm text-slate-500">Browse your campaigns and drill into individual account details.</p>
        </div>
        <div className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
          {startDate} to {endDate}
        </div>
      </div>

      {campaigns.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">No campaigns found.</p>
      ) : (
        <div className="space-y-6">
          {activeCampaigns.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {activeCampaigns.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  className="h-full rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
                  onClick={() => router.push(`/campaigns/${campaign.id}`)}>
                  <div className="flex h-full flex-col gap-4">
                    <div className="flex justify-between min-w-0 gap-3">
                      <h3 className="text-lg font-semibold tracking-tight text-slate-900">{campaign.name}</h3>
                      <p className="mt-1 shrink-0 text-sm text-slate-500">
                        Budget: ${campaign.dailyBudget?.amount || campaign.dailyBudgetAmount?.amount || 0} / day
                      </p>
                    </div>
                    <div className="mt-auto flex flex-col gap-3">
                      <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">
                        {campaign.status || 'Unknown'}
                      </span>
                      <DailyCostSparkline campaignId={campaign.id} dailySpend={campaignSpendMap.get(String(campaign.id))} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {otherCampaigns.length > 0 ? (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Other Campaigns</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {otherCampaigns.map((campaign) => (
                  <button
                    key={campaign.id}
                    type="button"
                    className="h-full rounded-xl border border-slate-200 bg-slate-50 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:bg-white hover:shadow-md"
                    onClick={() => router.push(`/campaigns/${campaign.id}`)}>
                    <div className="flex h-full flex-col gap-3">
                      <div className="space-y-1">
                        <h3 className="line-clamp-2 text-sm font-semibold tracking-tight text-slate-900">{campaign.name}</h3>
                        <p className="text-xs text-slate-500">Budget: ${campaign.dailyBudget?.amount || campaign.dailyBudgetAmount?.amount || 0} / day</p>
                      </div>
                      <div className="mt-auto flex items-end justify-between gap-3">
                        <span className="inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700 ring-1 ring-rose-200">
                          {campaign.status || 'Unknown'}
                        </span>
                        <DailyCostSparkline campaignId={campaign.id} dailySpend={campaignSpendMap.get(String(campaign.id))} compact />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
