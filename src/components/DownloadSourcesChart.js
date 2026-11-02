'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

// Fixed source → color mapping so a source keeps its color when others are hidden.
const SOURCES = [
  { key: 'App Store search', label: 'App Store search', color: '#2a78d6' },
  { key: 'App Store browse', label: 'App Store browse', color: '#eb6834' },
  { key: 'App referrer', label: 'App referrer', color: '#1baf7a' },
  { key: 'Web referrer', label: 'Web referrer', color: '#eda100' },
  { key: 'App Clip', label: 'App Clip', color: '#e87ba4' },
  { key: 'Other', label: 'Other', color: '#a3a3a3' },
]
const REFERRER_SOURCES = new Set(['App referrer', 'Web referrer'])
const NAMED_SOURCES = new Set(SOURCES.map((source) => source.key).filter((key) => key !== 'Other'))
const CHART_HEIGHT = 200

function niceMax(value) {
  if (value <= 0) {
    return 1
  }
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value)
  return step * magnitude
}

function formatDay(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// Case-insensitive match so "App Store Search" and "App Store search" land in the same series.
function normalizeSources(sources = {}) {
  const normalized = {}
  for (const [sourceType, downloads] of Object.entries(sources)) {
    const key = [...NAMED_SOURCES].find((name) => name.toLowerCase() === sourceType.toLowerCase()) || 'Other'
    normalized[key] = (normalized[key] || 0) + downloads
  }
  return normalized
}

const regionNames = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : null
const REFERRER_LIST_LIMIT = 10

function getCountryName(countryCode) {
  try {
    return regionNames?.of(countryCode) || countryCode
  } catch {
    return countryCode
  }
}

function includesCountry(selectedCountries, countryCode) {
  return selectedCountries.size === 0 || selectedCountries.has(countryCode)
}

function CountryFilter({ countries, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) {
      return undefined
    }
    const closeOnOutsideClick = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [open])

  const selectedCodes = countries.filter((country) => selected.has(country.code)).map((country) => country.code)
  const label =
    selectedCodes.length === 0
      ? 'All countries'
      : selectedCodes.length <= 2
        ? selectedCodes.map(getCountryName).join(', ')
        : `${getCountryName(selectedCodes[0])} +${selectedCodes.length - 1}`
  const matches = countries.filter((country) => {
    const needle = query.trim().toLowerCase()
    return !needle || country.code.toLowerCase().includes(needle) || getCountryName(country.code).toLowerCase().includes(needle)
  })

  const toggle = (code) => {
    const next = new Set(selected)
    if (next.has(code)) {
      next.delete(code)
    } else {
      next.add(code)
    }
    onChange(next)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        className="inline-flex max-w-64 items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        <span className="truncate">{label}</span>
        <span className="text-slate-400">▾</span>
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-2xl bg-white p-3 shadow-xl ring-1 ring-slate-200">
          <div className="mb-2 flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-full border border-slate-300 px-3 py-1.5 text-sm"
              placeholder="Search countries"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
            <button
              className="text-sm font-semibold text-sky-700 hover:text-sky-900 disabled:text-slate-300"
              disabled={selected.size === 0}
              onClick={() => onChange(new Set())}>
              Clear
            </button>
          </div>
          <ul className="max-h-72 overflow-y-auto">
            {matches.map((country) => (
              <li key={country.code}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                  <input type="checkbox" checked={selected.has(country.code)} onChange={() => toggle(country.code)} />
                  <span className="flex-1 truncate">{getCountryName(country.code)}</span>
                  <span className="tabular-nums text-slate-400">{country.downloads.toLocaleString()}</span>
                </label>
              </li>
            ))}
            {matches.length === 0 ? <li className="px-2 py-1.5 text-sm text-slate-400">No matching countries</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function ReferrerList({ title, color, entries, emptyText }) {
  const [showAll, setShowAll] = useState(false)
  const total = entries.reduce((sum, entry) => sum + entry.downloads, 0)
  const maxDownloads = Math.max(1, ...entries.map((entry) => entry.downloads))
  const visible = showAll ? entries : entries.slice(0, REFERRER_LIST_LIMIT)

  return (
    <div className="rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
          {title}
        </h3>
        <span className="text-xs tabular-nums text-slate-500">{total.toLocaleString()} downloads</span>
      </div>
      {entries.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visible.map((entry) => (
            <li
              key={entry.name}
              className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm"
              title={`${entry.name}: ${entry.downloads.toLocaleString()} downloads (${entry.firstDownloads.toLocaleString()} first-time)`}>
              <span className="truncate text-slate-700">{entry.name}</span>
              <div className="h-2.5">
                <div className="h-2.5 rounded-r" style={{ width: `${Math.max((entry.downloads / maxDownloads) * 100, 1)}%`, backgroundColor: color }} />
              </div>
              <span className="w-24 text-right tabular-nums text-slate-900">
                {entry.downloads.toLocaleString()} <span className="text-slate-400">{((entry.downloads / total) * 100).toFixed(0)}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {entries.length > REFERRER_LIST_LIMIT ? (
        <button className="mt-3 text-sm font-semibold text-sky-700 hover:text-sky-900" onClick={() => setShowAll((value) => !value)}>
          {showAll ? `Show top ${REFERRER_LIST_LIMIT}` : `Show all ${entries.length}`}
        </button>
      ) : null}
    </div>
  )
}

function filterReferrers(entries = [], selectedCountries) {
  return entries
    .map((entry) => {
      let downloads = 0
      let firstDownloads = 0
      for (const [countryCode, counts] of Object.entries(entry.countries || {})) {
        if (includesCountry(selectedCountries, countryCode)) {
          downloads += counts.downloads
          firstDownloads += counts.firstDownloads
        }
      }
      return { name: entry.name, downloads, firstDownloads }
    })
    .filter((entry) => entry.downloads > 0)
    .sort((left, right) => right.downloads - left.downloads)
}

function EmptyState({ children }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">{children}</div>
}

export default function DownloadSourcesChart({ days = [], referrers = { apps: [], websites: [] }, statuses = [], loading }) {
  const [hidden, setHidden] = useState(() => new Set())
  const [hoveredIndex, setHoveredIndex] = useState(null)
  const [view, setView] = useState('chart')
  const [selectedCountries, setSelectedCountries] = useState(() => new Set())

  const countryOptions = useMemo(() => {
    const totals = {}
    for (const day of days) {
      for (const [countryCode, sources] of Object.entries(day.countries || {})) {
        totals[countryCode] = (totals[countryCode] || 0) + Object.values(sources).reduce((sum, value) => sum + value, 0)
      }
    }
    return Object.entries(totals)
      .map(([code, downloads]) => ({ code, downloads }))
      .sort((left, right) => right.downloads - left.downloads)
  }, [days])

  const normalizedDays = useMemo(
    () =>
      days.map((day) => {
        const sources = {}
        for (const [countryCode, countrySources] of Object.entries(day.countries || {})) {
          if (!includesCountry(selectedCountries, countryCode)) {
            continue
          }
          for (const [sourceType, downloads] of Object.entries(countrySources)) {
            sources[sourceType] = (sources[sourceType] || 0) + downloads
          }
        }
        return { date: day.date, sources: normalizeSources(sources) }
      }),
    [days, selectedCountries],
  )
  const referringApps = useMemo(() => filterReferrers(referrers.apps, selectedCountries), [referrers, selectedCountries])
  const referringWebsites = useMemo(() => filterReferrers(referrers.websites, selectedCountries), [referrers, selectedCountries])
  const sourceTotals = useMemo(() => {
    const totals = {}
    for (const day of normalizedDays) {
      for (const [key, value] of Object.entries(day.sources)) {
        totals[key] = (totals[key] || 0) + value
      }
    }
    return totals
  }, [normalizedDays])

  const presentSources = SOURCES.filter((source) => sourceTotals[source.key] > 0)
  const visibleSources = presentSources.filter((source) => !hidden.has(source.key))
  const dayTotal = (day) => visibleSources.reduce((sum, source) => sum + (day.sources[source.key] || 0), 0)
  const yMax = niceMax(Math.max(0, ...normalizedDays.map(dayTotal)))
  const labelEvery = Math.max(1, Math.ceil(normalizedDays.length / 8))

  const toggleSource = (key) => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  let body
  if (loading) {
    body = <EmptyState>Loading download sources...</EmptyState>
  } else if (presentSources.length === 0) {
    const anyPending = statuses.some((status) => status.status === 'pending')
    const anyOff = statuses.some((status) => status.status === 'not_enabled' || status.status === 'stopped')
    body = (
      <EmptyState>
        {countryOptions.length > 0
          ? 'No downloads for the selected countries in this date range.'
          : anyPending
            ? 'Apple is still generating the App Store analytics reports. Daily downloads by source appear 1–2 days after reports are turned on.'
            : anyOff
              ? 'Turn on App Store analytics reports above to see downloads by source.'
              : 'No downloads in this date range.'}
      </EmptyState>
    )
  } else if (view === 'table') {
    body = (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              <th className="py-2 pr-4">Date</th>
              {presentSources.map((source) => (
                <th key={source.key} className="whitespace-nowrap py-2 pr-4 text-right">
                  {source.label}
                </th>
              ))}
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {normalizedDays.map((day) => (
              <tr key={day.date} className="border-b border-slate-100 tabular-nums text-slate-700">
                <td className="whitespace-nowrap py-2 pr-4">{formatDay(day.date)}</td>
                {presentSources.map((source) => (
                  <td key={source.key} className="py-2 pr-4 text-right">
                    {(day.sources[source.key] || 0).toLocaleString()}
                  </td>
                ))}
                <td className="py-2 text-right font-semibold text-slate-900">
                  {presentSources.reduce((sum, source) => sum + (day.sources[source.key] || 0), 0).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full bg-slate-100 p-1">
            {[
              ['All sources', () => setHidden(new Set())],
              ['Referrers only', () => setHidden(new Set(SOURCES.map((source) => source.key).filter((key) => !REFERRER_SOURCES.has(key))))],
            ].map(([label, apply]) => (
              <button
                key={label}
                className="rounded-full px-3 py-1 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-slate-900"
                onClick={apply}>
                {label}
              </button>
            ))}
          </div>
          {presentSources.map((source) => {
            const isHidden = hidden.has(source.key)
            return (
              <button
                key={source.key}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition ${
                  isHidden ? 'border-slate-200 text-slate-400' : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
                aria-pressed={!isHidden}
                onClick={() => toggleSource(source.key)}>
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: isHidden ? '#e2e8f0' : source.color }} />
                {source.label}
                <span className="tabular-nums text-slate-500">{sourceTotals[source.key].toLocaleString()}</span>
              </button>
            )
          })}
        </div>

        <div className="flex gap-2">
          <div className="relative w-10 text-right text-xs tabular-nums text-slate-400" style={{ height: CHART_HEIGHT }}>
            {[1, 0.5, 0].map((fraction) => (
              <span key={fraction} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - fraction) * 100}%` }}>
                {(yMax * fraction).toLocaleString()}
              </span>
            ))}
          </div>
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: CHART_HEIGHT }}>
              <div className="border-t border-slate-100" />
              <div className="border-t border-slate-100" />
              <div className="border-t border-slate-300" />
            </div>
            <div className="relative flex items-end gap-[2px]" style={{ height: CHART_HEIGHT }}>
              {normalizedDays.map((day, index) => {
                const total = dayTotal(day)
                const anchorRight = index > normalizedDays.length / 2
                return (
                  <div
                    key={day.date}
                    className={`relative flex h-full flex-1 flex-col-reverse gap-[2px] ${hoveredIndex === index ? 'bg-slate-100/70' : ''}`}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}>
                    {visibleSources.map((source, sourceIndex) => {
                      const value = day.sources[source.key] || 0
                      if (value <= 0) {
                        return null
                      }
                      const isTop = visibleSources.slice(sourceIndex + 1).every((later) => !(day.sources[later.key] > 0))
                      return (
                        <div
                          key={source.key}
                          className={isTop ? 'rounded-t' : ''}
                          style={{ height: `${(value / yMax) * CHART_HEIGHT}px`, backgroundColor: source.color }}
                        />
                      )
                    })}
                    {hoveredIndex === index ? (
                      <div
                        className={`pointer-events-none absolute bottom-full z-50 mb-2 w-56 rounded-xl bg-slate-900 p-3 text-xs text-slate-100 shadow-lg ${
                          anchorRight ? 'right-0' : 'left-0'
                        }`}>
                        <div className="mb-2 font-semibold text-white">{formatDay(day.date)}</div>
                        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                          {[...visibleSources].reverse().map((source) => (
                            <div key={source.key} className="contents">
                              <dt className="flex items-center gap-2 text-slate-300">
                                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: source.color }} />
                                {source.label}
                              </dt>
                              <dd className="text-right tabular-nums">{(day.sources[source.key] || 0).toLocaleString()}</dd>
                            </div>
                          ))}
                          <dt className="border-t border-slate-700 pt-1 text-slate-400">Total</dt>
                          <dd className="border-t border-slate-700 pt-1 text-right font-semibold tabular-nums">{total.toLocaleString()}</dd>
                        </dl>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <div className="mt-2 flex gap-[2px] text-xs text-slate-400">
              {normalizedDays.map((day, index) => (
                <span key={day.date} className="flex-1 whitespace-nowrap">
                  {index % labelEvery === 0 ? formatDay(day.date) : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full rounded-3xl bg-white p-6 shadow-lg shadow-slate-200/70 ring-1 ring-slate-200 sm:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Downloads by Source</h2>
          <p className="mt-1 text-sm text-slate-500">
            Daily App Store downloads (first-time and redownloads) by where users found the app. Click a source to hide or show it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {countryOptions.length > 0 ? <CountryFilter countries={countryOptions} selected={selectedCountries} onChange={setSelectedCountries} /> : null}
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
      {body}
      {!loading && countryOptions.length > 0 ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <ReferrerList
            title="Referring apps"
            color="#1baf7a"
            entries={referringApps}
            emptyText="No app referrer downloads with a named source. Apple leaves out small counts for privacy."
          />
          <ReferrerList
            title="Referring websites"
            color="#eda100"
            entries={referringWebsites}
            emptyText="No web referrer downloads with a named source. Apple leaves out small counts for privacy."
          />
        </div>
      ) : null}
    </div>
  )
}
