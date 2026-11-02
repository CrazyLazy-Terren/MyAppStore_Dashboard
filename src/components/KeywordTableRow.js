'use client'

import { useEffect, useState } from 'react'

export function getKeywordStatus(keyword) {
  return keyword.status || (keyword.deleted === true ? 'DELETED' : 'ACTIVE')
}

export function canToggleKeywordStatus(keyword) {
  const status = String(getKeywordStatus(keyword)).toUpperCase()

  return status !== 'DELETED' && status !== 'DISABLED'
}

export function getNextKeywordStatus(keyword) {
  const status = String(getKeywordStatus(keyword)).toUpperCase()

  return status === 'PAUSED' ? 'ACTIVE' : 'PAUSED'
}

export function getKeywordToggleLabel(keyword) {
  return getNextKeywordStatus(keyword) === 'PAUSED' ? 'Pause' : 'Resume'
}

export function canEditKeywordBid(keyword) {
  const status = String(getKeywordStatus(keyword)).toUpperCase()

  return status !== 'DELETED' && status !== 'DISABLED'
}

export function getMoneyAmount(value) {
  if (value && typeof value === 'object') {
    return Number(value.amount ?? value.value ?? 0)
  }

  return Number(value ?? 0)
}

export function getConversionRate(keyword) {
  const taps = Number(keyword.taps || 0)
  const installs = Number(keyword.tapInstalls || 0)

  if (taps <= 0) {
    return 0
  }

  return (installs / taps) * 100
}

export function getTapThroughRate(keyword) {
  const value = Number(keyword?.ttr || 0)

  if (value <= 0) {
    return 0
  }

  return value <= 1 ? value * 100 : value
}

export function getCostPerInstall(keyword) {
  const installs = Number(keyword.tapInstalls || 0)
  const spend = Number(keyword.localSpend || 0)

  if (installs <= 0) {
    return 0
  }

  return spend / installs
}

export function getDailyDownloadsSeries(keyword) {
  return Array.isArray(keyword.dailyTapInstalls) ? keyword.dailyTapInstalls : []
}

export function getDailyDownloadsSortValue(keyword) {
  return getDailyDownloadsSeries(keyword).reduce((sum, point) => sum + Number(point?.value || 0), 0)
}

export function getDailySpendSeries(keyword) {
  return Array.isArray(keyword.dailyLocalSpend) ? keyword.dailyLocalSpend : []
}

export function getDailySpendSortValue(keyword) {
  return getDailySpendSeries(keyword).reduce((sum, point) => sum + Number(point?.value || 0), 0)
}

export function getKeywordDisplayText(keyword) {
  const text = keyword.text || keyword.keyword || 'Unknown keyword'
  const matchType = String(keyword.matchType || '').toUpperCase()

  if (matchType === 'EXACT') {
    return (
      <>
        <span className="text-slate-400">[</span>
        {text}
        <span className="text-slate-400">]</span>
      </>
    )
  }

  return text
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`
}

function getStatusBadge(keyword) {
  const status = getKeywordStatus(keyword)
  const statusUpper = String(status).toUpperCase()
  const label = statusUpper
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())

  let colorClasses = ''

  switch (statusUpper) {
    case 'ACTIVE':
    case 'ENABLED':
      colorClasses = 'bg-emerald-100 text-emerald-700 ring-emerald-600/20'
      break
    case 'PAUSED':
      colorClasses = 'bg-amber-100 text-amber-700 ring-amber-600/20'
      break
    case 'DELETED':
    case 'DISABLED':
      colorClasses = 'bg-rose-100 text-rose-700 ring-rose-600/20'
      break
    default:
      colorClasses = 'bg-slate-100 text-slate-700 ring-slate-600/20'
  }

  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold tracking-wide ring-1 ring-inset ${colorClasses}`}>{label}</span>
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

  const values = points.map((point) => Number(point?.value || 0))
  const usableWidth = width - padding * 2
  const firstX = padding
  const lastX = padding + (values.length === 1 ? usableWidth / 2 : usableWidth)
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

function DailyMetricSparkline({
  points,
  chartKey,
  gradientPrefix,
  lineColor,
  stopColor,
  ariaLabel,
  emptyLabel,
  valueLabel,
  formatSummaryValue,
  formatPointValue,
}) {
  const [hoveredPointIndex, setHoveredPointIndex] = useState(null)

  if (points.length === 0) {
    return <span className="text-sm font-medium text-slate-400">{emptyLabel}</span>
  }

  const width = 128
  const height = 40
  const padding = 4
  const path = buildSparklinePath(points, width, height, padding)
  const areaPath = buildSparklineArea(points, width, height, padding)
  const chartPoints = buildSparklinePoints(points, width, height, padding)
  const values = points.map((point) => Number(point?.value || 0))
  const lastValue = values[values.length - 1] ?? 0
  const peakValue = Math.max(...values, 0)
  const totalValue = values.reduce((sum, value) => sum + value, 0)
  const averageValue = values.length > 0 ? totalValue / values.length : 0
  const hoveredPoint = hoveredPointIndex === null ? null : chartPoints[hoveredPointIndex]
  const hoverZoneWidth = chartPoints.length > 1 ? Math.max(10, (width - padding * 2) / chartPoints.length) : width - padding * 2
  const gradientId = `${gradientPrefix}-${chartKey}`

  return (
    <div className="relative inline-flex min-w-32 flex-col gap-1">
      {hoveredPoint ? (
        <div className="pointer-events-none absolute -top-15  left-1/2 min-w-36 -translate-x-1/2 rounded-xl bg-slate-950 px-3 py-2 text-[11px] font-semibold text-white shadow-lg shadow-slate-950/20">
          <div className="flex items-center justify-between gap-3 text-slate-300">
            <span>{hoveredPoint.label}</span>
            <span>{formatPointValue(Number(hoveredPoint.value || 0))}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 text-slate-400">
            <span>Avg {formatSummaryValue(averageValue)}</span>
            <span>Total {formatSummaryValue(totalValue)}</span>
          </div>
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-10 w-32 overflow-visible"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHoveredPointIndex(null)}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stopColor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stopColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={`M ${padding} ${height - padding} H ${width - padding}`} className="stroke-slate-200" strokeWidth="1" fill="none" />
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={path} stroke={lineColor} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {hoveredPoint ? (
          <path
            d={`M ${hoveredPoint.x} ${padding} L ${hoveredPoint.x} ${height - padding}`}
            className="stroke-sky-300"
            strokeWidth="1"
            strokeDasharray="3 3"
            fill="none"
          />
        ) : null}
        {chartPoints.map((point, index) => (
          <rect
            key={`${chartKey}-${point.date}-${index}`}
            x={Math.max(0, point.x - hoverZoneWidth / 2)}
            y={0}
            width={hoverZoneWidth}
            height={height}
            fill="transparent"
            onMouseEnter={() => setHoveredPointIndex(index)}>
            <title>{`${point.label}: ${formatPointValue(Number(point.value || 0))}`}</title>
          </rect>
        ))}
      </svg>
      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
        <span>Peak {formatSummaryValue(peakValue)}</span>
        <span>Last {formatSummaryValue(lastValue)}</span>
      </div>
    </div>
  )
}

function DailyDownloadsSparkline({ keyword, chartKey, gradientPrefix }) {
  return (
    <DailyMetricSparkline
      points={getDailyDownloadsSeries(keyword)}
      chartKey={chartKey}
      gradientPrefix={gradientPrefix}
      lineColor="#0284c7"
      stopColor="#38bdf8"
      ariaLabel="Daily downloads trend"
      emptyLabel="-"
      valueLabel="downloads"
      formatSummaryValue={(value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
      formatPointValue={(value) => `${Number(value || 0).toLocaleString()} downloads`}
    />
  )
}

function DailySpendSparkline({ keyword, chartKey, gradientPrefix }) {
  return (
    <DailyMetricSparkline
      points={getDailySpendSeries(keyword)}
      chartKey={chartKey}
      gradientPrefix={gradientPrefix}
      lineColor="#16a34a"
      stopColor="#4ade80"
      ariaLabel="Daily spend trend"
      emptyLabel="-"
      valueLabel="spend"
      formatSummaryValue={(value) => `$${Number(value || 0).toFixed(2)}`}
      formatPointValue={(value) => `$${Number(value || 0).toFixed(2)} spend`}
    />
  )
}

export default function KeywordTableRow({
  keyword,
  campaignName,
  campaignId,
  updatingKeywordId,
  updatingBidKeywordId,
  onToggleKeyword,
  onUpdateBid,
  variant = 'campaign',
}) {
  const isApplicationVariant = variant === 'application'
  const rowKey = `${campaignId || keyword.campaignId || 'unknown'}-${keyword.id}`
  const isUpdating = updatingKeywordId === String(keyword.id)
  const isUpdatingBid = updatingBidKeywordId === rowKey
  const toggleLabel = getKeywordToggleLabel(keyword)
  const bidAmount = getMoneyAmount(keyword.bidAmount)
  const formattedBidAmount = bidAmount.toFixed(2)
  const [isEditingBid, setIsEditingBid] = useState(false)
  const [bidDraft, setBidDraft] = useState(formattedBidAmount)

  useEffect(() => {
    if (!isEditingBid) {
      setBidDraft(formattedBidAmount)
    }
  }, [formattedBidAmount, isEditingBid])

  const bidDraftAmount = Number(bidDraft)
  const canSaveBid = Number.isFinite(bidDraftAmount) && bidDraftAmount > 0 && bidDraftAmount.toFixed(2) !== formattedBidAmount

  const handleCancelBidEdit = () => {
    setBidDraft(formattedBidAmount)
    setIsEditingBid(false)
  }

  const handleSaveBid = async () => {
    if (!canSaveBid || !onUpdateBid) {
      return
    }

    try {
      await onUpdateBid(keyword, bidDraftAmount)
      setIsEditingBid(false)
    } catch (_error) {
      // The parent shows the API error; keep the editor open so the bid can be corrected.
    }
  }

  return (
    <tr className={isApplicationVariant ? 'align-top' : ''}>
      <td className={`px-4 py-4 text-slate-900 ${isApplicationVariant ? 'font-bold' : 'font-medium'}`}>{getKeywordDisplayText(keyword)}</td>
      <td className="px-4 py-4">
        <div className={`${isApplicationVariant ? 'font-bold' : 'font-medium'} text-slate-900`}>{campaignName || '-'}</div>
        <div className={`mt-1 text-slate-500 ${isApplicationVariant ? 'text-xs' : 'text-xs'}`}>Campaign ID: {campaignId || '-'}</div>
      </td>
      <td className="px-4 py-4 w-40 whitespace-nowrap">
        <div className="flex flex-col items-center gap-2">
          {getStatusBadge(keyword)}
          <button type="button" className="text-sm" onClick={() => onToggleKeyword(keyword)} disabled={isUpdating || !canToggleKeywordStatus(keyword)}>
            {isUpdating ? `${toggleLabel}...` : toggleLabel}
          </button>
        </div>
      </td>
      <td className="px-4 py-4">
        {isEditingBid ? (
          <div className="flex w-36 flex-col gap-2">
            <label className="sr-only" htmlFor={`bid-${rowKey}`}>
              Bid amount
            </label>
            <div className="flex items-center rounded-md border border-slate-200 bg-white px-2 py-1.5 shadow-sm transition focus-within:border-sky-400 focus-within:ring-4 focus-within:ring-sky-100">
              <span className="text-sm font-semibold text-slate-400">$</span>
              <input
                id={`bid-${rowKey}`}
                className="ml-1 min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none"
                type="number"
                min="0.01"
                step="0.01"
                value={bidDraft}
                onChange={(event) => setBidDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleSaveBid()
                  }

                  if (event.key === 'Escape') {
                    handleCancelBidEdit()
                  }
                }}
                disabled={isUpdatingBid}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                onClick={handleSaveBid}
                disabled={isUpdatingBid || !canSaveBid}>
                {isUpdatingBid ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-400"
                onClick={handleCancelBidEdit}
                disabled={isUpdatingBid}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="rounded-md px-2 py-1 text-left font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            onClick={() => setIsEditingBid(true)}
            disabled={!onUpdateBid || isUpdatingBid || !canEditKeywordBid(keyword)}
            title={canEditKeywordBid(keyword) ? 'Edit bid' : 'Bid cannot be edited for this keyword status'}>
            ${formattedBidAmount}
          </button>
        )}
      </td>
      <td className="px-4 py-4">{Number(keyword.tapInstalls || 0).toLocaleString()}</td>
      <td className="px-4 py-4">
        <DailyDownloadsSparkline
          keyword={keyword}
          chartKey={rowKey}
          gradientPrefix={isApplicationVariant ? 'downloads-gradient' : 'campaign-keyword-downloads'}
        />
      </td>
      <td className="px-4 py-4">
        <DailySpendSparkline keyword={keyword} chartKey={rowKey} gradientPrefix={isApplicationVariant ? 'spend-gradient' : 'campaign-keyword-spend'} />
      </td>
      <td className="px-4 py-4">${Number(keyword.localSpend || 0).toFixed(2)}</td>
      <td className="px-4 py-4">${getCostPerInstall(keyword).toFixed(2)}</td>
      <td className="px-4 py-4">{Number(keyword.impressions || 0).toLocaleString()}</td>
      <td className="px-4 py-4">{Number(keyword.taps || 0).toLocaleString()}</td>
      <td className="px-4 py-4">{formatPercent(getTapThroughRate(keyword))}</td>
      <td className="px-4 py-4">{formatPercent(getConversionRate(keyword))}</td>
      <td className={`px-4 py-4 font-mono text-slate-600 ${isApplicationVariant ? 'font-semibold' : 'text-xs'}`}>{keyword.id}</td>
    </tr>
  )
}
