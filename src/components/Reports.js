'use client'

import { useEffect, useState } from 'react'
import { reportAPI } from '@/components/api'
import { buildCampaignReportRequest, getDefaultReportDates } from '@/lib/reportDateRange'

const REPORT_METRICS = {
  localSpend: {
    label: 'Spend',
    color: '#0f766e',
    format: (value) => `$${value.toFixed(2)}`,
  },
  impressions: {
    label: 'Impressions',
    color: '#ea580c',
    format: (value) => Math.round(value).toLocaleString(),
  },
  taps: {
    label: 'Taps',
    color: '#0284c7',
    format: (value) => Math.round(value).toLocaleString(),
  },
  tapInstalls: {
    label: 'Installs',
    color: '#7c3aed',
    format: (value) => Math.round(value).toLocaleString(),
  },
}

function parseReportDate(value) {
  if (!value) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`)
  }

  const match = value.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}))?$/)
  if (match) {
    const [, month, day, year, hour = '00'] = match
    return new Date(`${year}-${month}-${day}T${hour}:00:00`)
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getMetricValue(entry, metricKey) {
  const value = entry?.[metricKey]

  if (value && typeof value === 'object') {
    return Number(value.amount ?? value.value ?? 0)
  }

  return Number(value ?? 0)
}

function formatChartDate(value) {
  const parsed = parseReportDate(value)

  if (!parsed) return value || '-'

  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function formatChartLongDate(value) {
  const parsed = parseReportDate(value)

  if (!parsed) return value || '-'

  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function buildChartPoints(reportData) {
  const rows = reportData?.data?.reportingDataResponse?.row || reportData?.reportingDataResponse?.row || []
  const pointsByDate = new Map()

  for (const row of rows) {
    const granularityRows = Array.isArray(row?.granularity) ? row.granularity : []

    for (const entry of granularityRows) {
      const date = entry?.date || ''

      if (!date) {
        continue
      }

      const existingPoint = pointsByDate.get(date)

      if (existingPoint) {
        existingPoint.localSpend += getMetricValue(entry, 'localSpend')
        existingPoint.impressions += getMetricValue(entry, 'impressions')
        existingPoint.taps += getMetricValue(entry, 'taps')
        existingPoint.tapInstalls += getMetricValue(entry, 'tapInstalls')
        continue
      }

      pointsByDate.set(date, {
        date,
        label: formatChartDate(date),
        timestamp: parseReportDate(date)?.getTime() ?? Number.MAX_SAFE_INTEGER,
        localSpend: getMetricValue(entry, 'localSpend'),
        impressions: getMetricValue(entry, 'impressions'),
        taps: getMetricValue(entry, 'taps'),
        tapInstalls: getMetricValue(entry, 'tapInstalls'),
      })
    }
  }

  return [...pointsByDate.values()].sort((left, right) => left.timestamp - right.timestamp)
}

function summarizeChartPoints(chartPoints) {
  return chartPoints.reduce(
    (summary, point) => ({
      localSpend: summary.localSpend + point.localSpend,
      impressions: summary.impressions + point.impressions,
      taps: summary.taps + point.taps,
      tapInstalls: summary.tapInstalls + point.tapInstalls,
    }),
    {
      localSpend: 0,
      impressions: 0,
      taps: 0,
      tapInstalls: 0,
    }
  )
}

function buildChartPath(chartPoints, metricKey, width, height, padding, maxValueOverride, logScale = true) {
  if (chartPoints.length === 0) return ''

  const values = chartPoints.map((point) => point[metricKey])
  const maxValue = Math.max(maxValueOverride ?? Math.max(...values, 1), 1)
  const usableWidth = width - padding * 2
  const usableHeight = height - padding * 2

  return chartPoints
    .map((point, index) => {
      const x = padding + (chartPoints.length === 1 ? usableWidth / 2 : (index / (chartPoints.length - 1)) * usableWidth)
      const scaledValue = logScale ? Math.log1p(Number(point[metricKey] || 0)) : Number(point[metricKey] || 0)
      const scaledMaxValue = logScale ? Math.log1p(maxValue) : maxValue
      const y = height - padding - (scaledValue / Math.max(scaledMaxValue, 1)) * usableHeight
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
}

function getPointLinearY(value, maxValue, height, padding) {
  const usableHeight = height - padding * 2
  const scaledValue = Number(value || 0)
  const scaledMaxValue = maxValue
  return height - padding - (scaledValue / Math.max(scaledMaxValue, 1)) * usableHeight
}
function getPointY(value, maxValue, height, padding) {
  const usableHeight = height - padding * 2
  const scaledValue = Math.log1p(Number(value || 0))
  const scaledMaxValue = Math.log1p(Math.max(maxValue, 1))
  return height - padding - (scaledValue / Math.max(scaledMaxValue, 1)) * usableHeight
}

function buildChartCoordinates(chartPoints, width, height, padding) {
  if (chartPoints.length === 0) {
    return []
  }

  const usableWidth = width - padding * 2

  return chartPoints.map((point, index) => ({
    ...point,
    x: padding + (chartPoints.length === 1 ? usableWidth / 2 : (index / (chartPoints.length - 1)) * usableWidth),
  }))
}

function getXAxisLabelStep(totalPoints) {
  if (totalPoints <= 8) {
    return 1
  }

  if (totalPoints <= 16) {
    return 2
  }

  return 4
}

export default function Reports({
  defaultRangeDays = 7,
  showRawResponse = true,
  autoLoadCampaignReport = false,
  title = 'Reports',
  description = 'Generate campaign report payloads.',
  startDate: controlledStartDate,
  endDate: controlledEndDate,
  showDateControls = true,
}) {
  const defaultDates = getDefaultReportDates(defaultRangeDays)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [reportData, setReportData] = useState(null)
  const [localStartDate, setLocalStartDate] = useState(defaultDates.startDate)
  const [localEndDate, setLocalEndDate] = useState(defaultDates.endDate)
  const [hoveredPointIndex, setHoveredPointIndex] = useState(null)
  const [hoveredPanelKey, setHoveredPanelKey] = useState(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })

  const startDate = controlledStartDate ?? localStartDate
  const endDate = controlledEndDate ?? localEndDate

  const chartPoints = buildChartPoints(reportData)
  const chartSummary = summarizeChartPoints(chartPoints)
  const chartWidth = 1600
  const chartHeight = 300
  const chartPadding = 16
  const chartCoordinates = buildChartCoordinates(chartPoints, chartWidth, chartHeight, chartPadding)
  const labelStep = getXAxisLabelStep(chartPoints.length)
  const mergedMetricKeys = ['impressions', 'taps', 'tapInstalls']
  const mergedSharedMaxValue = Math.max(...chartPoints.flatMap((point) => mergedMetricKeys.map((metricKey) => Number(point[metricKey] || 0))), 1)
  const chartSeries = Object.entries(REPORT_METRICS).map(([metricKey, metric]) => ({
    key: metricKey,
    ...metric,
    maxValue: Math.max(...chartPoints.map((point) => point[metricKey]), 1),
    chartMaxValue: mergedMetricKeys.includes(metricKey) ? mergedSharedMaxValue : Math.max(...chartPoints.map((point) => point[metricKey]), 1),
    path: buildChartPath(
      chartPoints,
      metricKey,
      chartWidth,
      chartHeight,
      chartPadding,
      mergedMetricKeys.includes(metricKey) ? mergedSharedMaxValue : undefined,
      metricKey !== 'localSpend'
    ),
  }))
  const spendSeries = chartSeries.find((series) => series.key === 'localSpend')
  const mergedSeries = chartSeries.filter((series) => series.key !== 'localSpend')
  const hoveredPoint = hoveredPointIndex === null ? null : chartCoordinates[hoveredPointIndex]
  const hoverZoneWidth = chartCoordinates.length > 1 ? Math.max(18, (chartWidth - chartPadding * 2) / chartCoordinates.length) : chartWidth - chartPadding * 2

  const handleChartHover = (index, panelKey, event) => {
    const svgElement = event.currentTarget.ownerSVGElement
    const panelElement = svgElement?.closest('[data-chart-panel]')
    const panelRect = panelElement?.getBoundingClientRect()

    setHoveredPointIndex(index)
    setHoveredPanelKey(panelKey)

    if (!panelRect) {
      return
    }

    const tooltipWidth = 240
    const tooltipHeight = 180
    const nextX = event.clientX - panelRect.left + 14
    const nextY = event.clientY - panelRect.top - 18

    setTooltipPosition({
      x: Math.min(Math.max(nextX, 8), Math.max(panelRect.width - tooltipWidth - 8, 8)),
      y: Math.min(Math.max(nextY, 8), Math.max(panelRect.height - tooltipHeight - 8, 8)),
    })
  }

  const clearChartHover = () => {
    setHoveredPointIndex(null)
    setHoveredPanelKey(null)
  }

  const handleGenerate = async () => {
    if (!startDate || !endDate) {
      alert('Please select start and end dates')
      return
    }

    try {
      setLoading(true)
      clearChartHover()
      const response = await reportAPI.getCampaignReport(
        buildCampaignReportRequest(startDate, endDate, {
          limit: 100,
          returnRecordsWithNoMetrics: false,
        })
      )
      setReportData(response.data)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!autoLoadCampaignReport) {
      return
    }

    handleGenerate()
  }, [autoLoadCampaignReport, startDate, endDate])

  return (
    <section className="w-full rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {description ||
            (showDateControls
              ? `Choose a date range and fetch campaign performance data. The default range is the last ${defaultRangeDays} days.`
              : 'Showing campaign performance for the shared ads date range.')}
        </p>
      </div>

      {showDateControls ? (
        <div className="grid max-w-xl gap-4">
          <label className="grid gap-2 text-sm font-semibold text-slate-700">
            Start Date
            <input
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              type="date"
              value={startDate}
              onChange={(e) => setLocalStartDate(e.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-slate-700">
            End Date
            <input
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              type="date"
              value={endDate}
              onChange={(e) => setLocalEndDate(e.target.value)}
            />
          </label>
          <button
            className="inline-flex w-fit rounded-full bg-sky-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            onClick={handleGenerate}
            disabled={loading}>
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600">
          {startDate} to {endDate}
        </div>
      )}

      {error ? <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">Error: {error}</div> : null}

      {chartPoints.length > 0 ? (
        <div className="mt-6 space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h4 className="text-base font-semibold text-slate-900">Performance Chart</h4>
              <p className="mt-1 text-sm text-slate-500">
                Daily campaign totals for the selected date range, with Spend separated and Impressions, Taps, and Installs merged into one shared chart.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {chartSeries.map((series) => (
                <div key={series.key} className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />
                  <span>{series.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Object.entries(REPORT_METRICS).map(([metricKey, metric]) => (
              <div key={metricKey} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{metric.label}</div>
                <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{metric.format(chartSummary[metricKey])}</div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950/98 p-4 text-slate-100">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-4 text-xs uppercase tracking-[0.2em] text-slate-400">
              <span>Daily Trends</span>
              <span>{chartPoints.length} days · log scale</span>
            </div>
            <div className="space-y-4" onMouseLeave={clearChartHover}>
              {spendSeries ? (
                <div data-chart-panel="spend" className="relative rounded-2xl border border-white/8 bg-white/3 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: spendSeries.color }} />
                      <span>{spendSeries.label}</span>
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Total {spendSeries.format(chartSummary[spendSeries.key])} · Peak {spendSeries.format(spendSeries.maxValue)}
                    </div>
                  </div>
                  {hoveredPoint && hoveredPanelKey === spendSeries.key ? (
                    <div
                      className="pointer-events-none absolute z-20 w-60 rounded-2xl border border-white/10 bg-slate-950/95 px-4 py-3 text-white shadow-lg shadow-black/30"
                      style={{
                        left: `${tooltipPosition.x}px`,
                        top: `${tooltipPosition.y}px`,
                      }}>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{formatChartLongDate(hoveredPoint.date)}</div>
                      <div className="mt-3 grid gap-2">
                        {Object.entries(REPORT_METRICS).map(([metricKey, metric]) => (
                          <div key={metricKey} className="flex items-center justify-between gap-3 text-sm">
                            <span className="inline-flex items-center gap-2 text-slate-300">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: metric.color }} />
                              <span>{metric.label}</span>
                            </span>
                            <span className="font-semibold text-white">{metric.format(hoveredPoint[metricKey])}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-full">
                    <line
                      x1={chartPadding}
                      y1={chartHeight - chartPadding}
                      x2={chartWidth - chartPadding}
                      y2={chartHeight - chartPadding}
                      stroke="rgba(148, 163, 184, 0.22)"
                      strokeWidth="1"
                    />
                    {[0.25, 0.5, 0.75, 1].map((ratio) => {
                      const y = chartHeight - chartPadding - (chartHeight - chartPadding * 2) * ratio
                      return (
                        <line
                          key={ratio}
                          x1={chartPadding}
                          y1={y}
                          x2={chartWidth - chartPadding}
                          y2={y}
                          stroke="rgba(148, 163, 184, 0.18)"
                          strokeWidth="1"
                          strokeDasharray="4 6"
                        />
                      )
                    })}
                    <text x="4" y={chartHeight - chartPadding + 4} fill="rgba(226, 232, 240, 0.78)" fontSize="12">
                      0
                    </text>
                    {hoveredPoint ? (
                      <line
                        x1={hoveredPoint.x}
                        y1={chartPadding}
                        x2={hoveredPoint.x}
                        y2={chartHeight - chartPadding}
                        stroke="rgba(226, 232, 240, 0.42)"
                        strokeWidth="1"
                        strokeDasharray="4 6"
                      />
                    ) : null}
                    <path d={spendSeries.path} fill="none" stroke={spendSeries.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    {hoveredPoint ? (
                      <circle
                        cx={hoveredPoint.x}
                        cy={getPointLinearY(hoveredPoint[spendSeries.key], spendSeries.maxValue, chartHeight, chartPadding)}
                        r="3.5"
                        fill={spendSeries.color}
                        stroke="rgba(15, 23, 42, 0.95)"
                        strokeWidth="1.5"
                      />
                    ) : null}
                    {chartCoordinates.map((point, index) => (
                      <g key={`${spendSeries.key}-${point.date}-${index}`}>
                        <rect
                          x={Math.max(0, point.x - hoverZoneWidth / 2)}
                          y={0}
                          width={hoverZoneWidth}
                          height={chartHeight}
                          fill="transparent"
                          onMouseEnter={(event) => handleChartHover(index, spendSeries.key, event)}
                          onMouseMove={(event) => handleChartHover(index, spendSeries.key, event)}>
                          <title>
                            {`${formatChartLongDate(point.date)} | Spend ${REPORT_METRICS.localSpend.format(point.localSpend)} | Impressions ${REPORT_METRICS.impressions.format(point.impressions)} | Taps ${REPORT_METRICS.taps.format(point.taps)} | Installs ${REPORT_METRICS.tapInstalls.format(point.tapInstalls)}`}
                          </title>
                        </rect>
                      </g>
                    ))}
                  </svg>
                </div>
              ) : null}

              <div data-chart-panel="merged" className="relative rounded-2xl border border-white/8 bg-white/3 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-white">
                    <span>Delivery Funnel</span>
                    {mergedSeries.map((series) => (
                      <span key={series.key} className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />
                        <span>{series.label}</span>
                      </span>
                    ))}
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Merged view of reach and conversion</div>
                </div>
                {hoveredPoint && hoveredPanelKey === 'merged' ? (
                  <div
                    className="pointer-events-none absolute z-20 w-60 rounded-2xl border border-white/10 bg-slate-950/95 px-4 py-3 text-white shadow-lg shadow-black/30"
                    style={{
                      left: `${tooltipPosition.x}px`,
                      top: `${tooltipPosition.y}px`,
                    }}>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{formatChartLongDate(hoveredPoint.date)}</div>
                    <div className="mt-3 grid gap-2">
                      {Object.entries(REPORT_METRICS).map(([metricKey, metric]) => (
                        <div key={metricKey} className="flex items-center justify-between gap-3 text-sm">
                          <span className="inline-flex items-center gap-2 text-slate-300">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: metric.color }} />
                            <span>{metric.label}</span>
                          </span>
                          <span className="font-semibold text-white">{metric.format(hoveredPoint[metricKey])}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-full">
                  <line
                    x1={chartPadding}
                    y1={chartHeight - chartPadding}
                    x2={chartWidth - chartPadding}
                    y2={chartHeight - chartPadding}
                    stroke="rgba(148, 163, 184, 0.22)"
                    strokeWidth="1"
                  />
                  {[0.25, 0.5, 0.75, 1].map((ratio) => {
                    const y = chartHeight - chartPadding - (chartHeight - chartPadding * 2) * ratio
                    return (
                      <line
                        key={ratio}
                        x1={chartPadding}
                        y1={y}
                        x2={chartWidth - chartPadding}
                        y2={y}
                        stroke="rgba(148, 163, 184, 0.18)"
                        strokeWidth="1"
                        strokeDasharray="4 6"
                      />
                    )
                  })}
                  <text x="4" y={chartHeight - chartPadding + 4} fill="rgba(226, 232, 240, 0.78)" fontSize="12">
                    0
                  </text>
                  {hoveredPoint ? (
                    <line
                      x1={hoveredPoint.x}
                      y1={chartPadding}
                      x2={hoveredPoint.x}
                      y2={chartHeight - chartPadding}
                      stroke="rgba(226, 232, 240, 0.42)"
                      strokeWidth="1"
                      strokeDasharray="4 6"
                    />
                  ) : null}
                  {mergedSeries.map((series) => (
                    <path key={series.key} d={series.path} fill="none" stroke={series.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  ))}
                  {hoveredPoint
                    ? mergedSeries.map((series) => (
                        <circle
                          key={series.key}
                          cx={hoveredPoint.x}
                          cy={getPointY(hoveredPoint[series.key], series.chartMaxValue, chartHeight, chartPadding)}
                          r="3.5"
                          fill={series.color}
                          stroke="rgba(15, 23, 42, 0.95)"
                          strokeWidth="1.5"
                        />
                      ))
                    : null}
                  {chartCoordinates.map((point, index) => {
                    const shouldShowLabel = index === 0 || index === chartCoordinates.length - 1 || index % labelStep === 0

                    return (
                      <g key={`merged-${point.date}-${index}`}>
                        {shouldShowLabel ? (
                          <text x={point.x} y={chartHeight - 2} textAnchor="middle" fill="rgba(226, 232, 240, 0.92)" fontSize="12">
                            {point.label}
                          </text>
                        ) : null}
                        <rect
                          x={Math.max(0, point.x - hoverZoneWidth / 2)}
                          y={0}
                          width={hoverZoneWidth}
                          height={chartHeight}
                          fill="transparent"
                          onMouseEnter={(event) => handleChartHover(index, 'merged', event)}
                          onMouseMove={(event) => handleChartHover(index, 'merged', event)}>
                          <title>
                            {`${formatChartLongDate(point.date)} | Spend ${REPORT_METRICS.localSpend.format(point.localSpend)} | Impressions ${REPORT_METRICS.impressions.format(point.impressions)} | Taps ${REPORT_METRICS.taps.format(point.taps)} | Installs ${REPORT_METRICS.tapInstalls.format(point.tapInstalls)}`}
                          </title>
                        </rect>
                      </g>
                    )
                  })}
                </svg>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showRawResponse && reportData ? (
        <pre className="mt-6 max-h-96 overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs leading-6 text-slate-100">
          {JSON.stringify(reportData, null, 2)}
        </pre>
      ) : null}
    </section>
  )
}
