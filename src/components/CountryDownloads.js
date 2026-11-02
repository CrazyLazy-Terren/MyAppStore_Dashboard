'use client'

import { useEffect, useMemo, useState } from 'react'
import { appStoreAnalyticsAPI, reportAPI } from '@/components/api'
import DownloadSourcesChart from '@/components/DownloadSourcesChart'

const TOP_COUNTRY_COUNT = 15
const SELECTED_APP_STORAGE_KEY = 'dashboard.selectedAppId'

const SORT_OPTIONS = [
  { value: 'downloads', label: 'Downloads' },
  { value: 'storeConversionRate', label: 'App Store Conversion' },
  { value: 'conversionRate', label: 'Ads Conversion' },
  { value: 'installs', label: 'Ads Installs' },
]

const regionNames = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : null

function getCountryName(countryCode) {
  try {
    return regionNames?.of(countryCode) || countryCode
  } catch {
    return countryCode
  }
}

function formatPercent(value) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`
}

function formatMoney(value, currency) {
  return `${Number(value || 0).toFixed(2)}${currency ? ` ${currency}` : ''}`
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString()
}

const RATE_SCALE_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1]

function getRateScaleMax(values) {
  const max = Math.max(0, ...values.map((value) => value || 0))
  return RATE_SCALE_STEPS.find((step) => step >= max) || 1
}

function readSavedAppId() {
  try {
    return window.localStorage.getItem(SELECTED_APP_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function saveAppId(appId) {
  try {
    if (appId) {
      window.localStorage.setItem(SELECTED_APP_STORAGE_KEY, appId)
    } else {
      window.localStorage.removeItem(SELECTED_APP_STORAGE_KEY)
    }
  } catch {
    // Storage can be unavailable (private mode); the selection just won't persist.
  }
}

function StatTile({ label, value, hint }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200">
      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</h3>
      <div className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{value}</div>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}

function CountryTooltip({ country }) {
  const rows = [
    ['Downloads (sales)', formatNumber(country.downloads)],
    ['Redownloads (sales)', formatNumber(country.redownloads)],
    ['Store impressions (unique)', formatNumber(country.storeImpressions)],
    ['Store page views (unique)', formatNumber(country.storePageViews)],
    ['Store downloads (analytics)', formatNumber(country.storeDownloads)],
    ['App Store conversion', formatPercent(country.storeConversionRate)],
    ['Ads impressions', formatNumber(country.impressions)],
    ['Ads taps', formatNumber(country.taps)],
    ['Ads installs', formatNumber(country.installs)],
    ['Ads tap-through rate', formatPercent(country.tapThroughRate)],
    ['Ads conversion', formatPercent(country.conversionRate)],
    ['Ads spend', formatMoney(country.spend, country.currency)],
  ]

  return (
    <div className="pointer-events-none absolute left-40 top-full z-50 mt-1 w-72 rounded-xl bg-slate-900 p-3 text-xs text-slate-100 shadow-lg">
      <div className="mb-2 font-semibold text-white">
        {getCountryName(country.countryCode)} ({country.countryCode})
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-400">{label}</dt>
            <dd className="text-right tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function RateBar({ value, scaleMax, colorClass }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-3 flex-1">
        {value !== null && value !== undefined ? (
          <div className={`h-3 rounded-r ${colorClass}`} style={{ width: `${Math.min(value / scaleMax, 1) * 100}%` }} />
        ) : null}
      </div>
      <span className="w-14 text-right text-sm tabular-nums text-slate-900">{formatPercent(value)}</span>
    </div>
  )
}

function RateHeader({ label, values, scaleMax }) {
  const hasValues = values.some((value) => value !== null && value !== undefined)

  return (
    <span className="whitespace-nowrap">
      {label}
      <span className="block text-[10px] font-normal normal-case tracking-normal text-slate-400">{hasValues ? `scale 0–${formatPercent(scaleMax)}` : 'no data yet'}</span>
    </span>
  )
}

const CHART_GRID = 'grid grid-cols-[10rem_minmax(8rem,1fr)_10rem_10rem] gap-4'

function CountryChart({ countries, volumeKey, volumeLabel }) {
  const [hoveredCode, setHoveredCode] = useState(null)
  const maxVolume = Math.max(1, ...countries.map((country) => country[volumeKey]))
  const storeScaleMax = getRateScaleMax(countries.map((country) => country.storeConversionRate))
  const adsScaleMax = getRateScaleMax(countries.map((country) => country.conversionRate))

  return (
    <div className="overflow-visible">
      <div className="min-w-[44rem]">
        <div className={`${CHART_GRID} mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500`}>
          <span>Country</span>
          <span>{volumeLabel}</span>
          <RateHeader label="App Store conv." values={countries.map((country) => country.storeConversionRate)} scaleMax={storeScaleMax} />
          <RateHeader label="Ads conv." values={countries.map((country) => country.conversionRate)} scaleMax={adsScaleMax} />
        </div>
        <ul className="flex flex-col">
          {countries.map((country) => {
            const volume = country[volumeKey]
            const volumeWidth = (volume / maxVolume) * 100

            return (
              <li
                key={country.countryCode}
                className={`${CHART_GRID} relative items-center rounded-lg px-1 py-1.5 hover:bg-slate-50`}
                onMouseEnter={() => setHoveredCode(country.countryCode)}
                onMouseLeave={() => setHoveredCode(null)}>
                <span className="truncate text-sm text-slate-700" title={getCountryName(country.countryCode)}>
                  {getCountryName(country.countryCode)}
                </span>
                <div className="flex items-center gap-2">
                  <div className="h-3 flex-1">
                    <div className="h-3 rounded-r bg-sky-600" style={{ width: `${Math.max(volumeWidth, volume > 0 ? 0.5 : 0)}%` }} />
                  </div>
                  <span className="w-16 text-right text-sm tabular-nums text-slate-900">{formatNumber(volume)}</span>
                </div>
                <RateBar value={country.storeConversionRate} scaleMax={storeScaleMax} colorClass="bg-teal-600" />
                <RateBar value={country.conversionRate} scaleMax={adsScaleMax} colorClass="bg-indigo-500" />
                {hoveredCode === country.countryCode ? <CountryTooltip country={country} /> : null}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function CountryTable({ countries }) {
  const columns = [
    ['Downloads', (country) => formatNumber(country.downloads), true],
    ['Redownloads', (country) => formatNumber(country.redownloads)],
    ['Store Impr.', (country) => formatNumber(country.storeImpressions)],
    ['Page Views', (country) => formatNumber(country.storePageViews)],
    ['Store Conv.', (country) => formatPercent(country.storeConversionRate), true],
    ['Ads Impr.', (country) => formatNumber(country.impressions)],
    ['Ads Taps', (country) => formatNumber(country.taps)],
    ['Ads Installs', (country) => formatNumber(country.installs)],
    ['Ads Conv.', (country) => formatPercent(country.conversionRate), true],
    ['Spend', (country) => formatMoney(country.spend, country.currency)],
  ]

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            <th className="py-2 pr-4">Country</th>
            {columns.map(([label]) => (
              <th key={label} className="whitespace-nowrap py-2 pr-4 text-right">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {countries.map((country) => (
            <tr key={country.countryCode} className="border-b border-slate-100 tabular-nums text-slate-700">
              <td className="whitespace-nowrap py-2 pr-4">
                {getCountryName(country.countryCode)} <span className="text-slate-400">{country.countryCode}</span>
              </td>
              {columns.map(([label, render, emphasized]) => (
                <td key={label} className={`py-2 pr-4 text-right ${emphasized ? 'font-semibold text-slate-900' : ''}`}>
                  {render(country)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StoreAnalyticsNotice({ statuses, apps, enabling, enableError, onEnable }) {
  const needsEnable = statuses.filter((status) => status.status === 'not_enabled' || status.status === 'stopped')
  const pending = statuses.filter((status) => status.status === 'pending')

  if (needsEnable.length === 0 && pending.length === 0 && !enableError) {
    return null
  }

  const appName = (appId) => apps.find((app) => app.appId === appId)?.name || appId

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      {needsEnable.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            App Store conversion rate needs App Store Connect analytics reports, which are off for{' '}
            {needsEnable.length === 1 ? appName(needsEnable[0].appId) : `${needsEnable.length} apps`}. Turning them on asks Apple to start
            generating daily reports; the first ones arrive in 1–2 days.
          </p>
          <button
            className="rounded-full bg-sky-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:opacity-60"
            disabled={enabling}
            onClick={() => onEnable(needsEnable.map((status) => status.appId))}>
            {enabling ? 'Turning on...' : 'Turn on analytics reports'}
          </button>
        </div>
      ) : null}
      {pending.length > 0 ? (
        <p>
          Apple is generating analytics reports for {pending.length === 1 ? appName(pending[0].appId) : `${pending.length} apps`}. App Store
          conversion rate appears 1–2 days after they were turned on.
        </p>
      ) : null}
      {enableError ? <p className="text-rose-700">Couldn’t turn on analytics reports: {enableError}</p> : null}
    </div>
  )
}

export default function CountryDownloads({ startDate, endDate }) {
  const [appId, setAppId] = useState(null)
  const [sortBy, setSortBy] = useState('downloads')
  const [view, setView] = useState('chart')
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [report, setReport] = useState(null)
  const [enabling, setEnabling] = useState(false)
  const [enableError, setEnableError] = useState(null)

  // Read the saved app after mount so server and client render the same markup.
  useEffect(() => {
    setAppId(readSavedAppId())
  }, [])

  const selectApp = (nextAppId) => {
    saveAppId(nextAppId)
    setAppId(nextAppId)
  }

  const fetchReport = async () => {
    try {
      setLoading(true)
      const response = await reportAPI.getCountryReport({ startDate, endDate }, appId)
      const apps = response.data?.apps || []
      if (appId && apps.length > 0 && !apps.some((app) => app.appId === appId)) {
        // The saved app no longer exists; fall back to all apps.
        selectApp('')
        return
      }
      setReport(response.data)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (appId !== null) {
      fetchReport()
    }
  }, [startDate, endDate, appId])

  const enableAnalytics = async (appIds) => {
    try {
      setEnabling(true)
      setEnableError(null)
      await appStoreAnalyticsAPI.enable(appIds)
      await fetchReport()
    } catch (err) {
      setEnableError(err.message)
    } finally {
      setEnabling(false)
    }
  }

  const countries = report?.countries || []
  const salesAvailable = Boolean(report) && !report.errors?.downloads
  const storeAvailable = countries.some((country) => country.storeImpressions > 0 || country.storeDownloads > 0)
  const volumeKey = salesAvailable ? 'downloads' : storeAvailable ? 'storeDownloads' : 'installs'
  const volumeLabel = volumeKey === 'installs' ? 'Apple Ads installs' : 'App Store downloads'

  const totals = useMemo(
    () =>
      countries.reduce(
        (sum, country) => ({
          downloads: sum.downloads + country.downloads,
          redownloads: sum.redownloads + country.redownloads,
          storeImpressions: sum.storeImpressions + country.storeImpressions,
          storeDownloads: sum.storeDownloads + country.storeDownloads,
          taps: sum.taps + country.taps,
          installs: sum.installs + country.installs,
        }),
        { downloads: 0, redownloads: 0, storeImpressions: 0, storeDownloads: 0, taps: 0, installs: 0 }
      ),
    [countries]
  )

  const sortedCountries = useMemo(() => {
    const key = sortBy === 'downloads' ? volumeKey : sortBy
    return [...countries].sort((left, right) => (right[key] ?? -1) - (left[key] ?? -1) || right[volumeKey] - left[volumeKey])
  }, [countries, sortBy, volumeKey])
  const visibleCountries = showAll ? sortedCountries : sortedCountries.slice(0, TOP_COUNTRY_COUNT)
  const errorMessages = [
    report?.errors?.downloads && `App Store sales downloads unavailable: ${report.errors.downloads}`,
    report?.errors?.store && `App Store analytics unavailable: ${report.errors.store}`,
    report?.errors?.ads && `Apple Ads data unavailable: ${report.errors.ads}`,
  ].filter(Boolean)

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="w-full rounded-3xl bg-white p-6 shadow-lg shadow-slate-200/70 ring-1 ring-slate-200 sm:p-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">App Store Downloads by Country</h2>
            <p className="mt-1 text-sm text-slate-500">
              Downloads per country, with App Store conversion (downloads ÷ unique impressions) and Apple Ads conversion (installs ÷ taps).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              className="max-w-64 rounded-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              value={appId ?? ''}
              onChange={(event) => selectApp(event.target.value)}>
              <option value="">All apps</option>
              {appId && !(report?.apps || []).some((app) => app.appId === appId) ? <option value={appId}>Loading saved app...</option> : null}
              {(report?.apps || []).map((app) => (
                <option key={app.appId} value={app.appId}>
                  {app.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  Sort by {option.label}
                </option>
              ))}
            </select>
            <div className="inline-flex rounded-full bg-slate-100 p-1">
              {['chart', 'table'].map((option) => (
                <button
                  key={option}
                  className={`rounded-full px-3 py-1 text-sm font-semibold capitalize transition ${
                    view === option ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                  onClick={() => setView(option)}>
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm font-medium text-slate-500">
            Loading country data... (the first load fetches each day’s reports and can take a while)
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-8 text-center">
            <p className="text-sm font-medium text-rose-700">Error loading country data: {error}</p>
            <button
              className="mt-4 inline-flex rounded-full bg-sky-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800"
              onClick={fetchReport}>
              Retry
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {errorMessages.length > 0 ? (
              <div className="flex flex-col gap-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {errorMessages.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
            ) : null}

            <StoreAnalyticsNotice
              statuses={report?.storeStatuses || []}
              apps={report?.apps || []}
              enabling={enabling}
              enableError={enableError}
              onEnable={enableAnalytics}
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="App Store Downloads"
                value={formatNumber(salesAvailable ? totals.downloads : totals.storeDownloads)}
                hint={
                  salesAvailable
                    ? `${formatNumber(totals.redownloads)} redownloads · ${report.reportedDays} of ${report.requestedDays} days reported`
                    : 'From App Store analytics'
                }
              />
              <StatTile
                label="App Store Conversion"
                value={formatPercent(totals.storeImpressions > 0 ? totals.storeDownloads / totals.storeImpressions : null)}
                hint={
                  totals.storeImpressions > 0
                    ? `${formatNumber(totals.storeDownloads)} downloads ÷ ${formatNumber(totals.storeImpressions)} unique impressions`
                    : 'Needs App Store analytics reports'
                }
              />
              <StatTile
                label="Ads Conversion"
                value={formatPercent(totals.taps > 0 ? totals.installs / totals.taps : null)}
                hint={`${formatNumber(totals.installs)} installs ÷ ${formatNumber(totals.taps)} taps`}
              />
              <StatTile
                label="Ads Share of Downloads"
                value={formatPercent(salesAvailable && totals.downloads > 0 ? totals.installs / totals.downloads : null)}
                hint="Apple Ads installs ÷ App Store downloads"
              />
            </div>

            {countries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
                No downloads or ads activity in this date range.
              </div>
            ) : view === 'chart' ? (
              <CountryChart countries={visibleCountries} volumeKey={volumeKey} volumeLabel={volumeLabel} />
            ) : (
              <CountryTable countries={visibleCountries} />
            )}

            {countries.length > TOP_COUNTRY_COUNT ? (
              <button className="self-start text-sm font-semibold text-sky-700 hover:text-sky-900" onClick={() => setShowAll((value) => !value)}>
                {showAll ? `Show top ${TOP_COUNTRY_COUNT}` : `Show all ${countries.length} countries`}
              </button>
            ) : null}
          </div>
        )}
      </div>

      <DownloadSourcesChart
        days={report?.downloadSourcesByDay || []}
        referrers={report?.referrers}
        statuses={report?.storeStatuses || []}
        loading={loading}
      />
    </div>
  )
}
