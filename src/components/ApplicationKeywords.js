'use client'

import { useEffect, useState } from 'react'
import { applicationAPI, keywordAPI, reportAPI } from '@/components/api'
import KeywordTableRow, {
  getNextKeywordStatus,
  getConversionRate,
  getCostPerInstall,
  getDailyDownloadsSortValue,
  getDailySpendSortValue,
  getKeywordStatus,
  getMoneyAmount,
  getTapThroughRate,
} from '@/components/KeywordTableRow'
import useAdsDateRange from '@/components/useAdsDateRange'

const KEYWORD_SORT_OPTIONS = [
  { value: 'keyword', label: 'Keyword' },
  { value: 'campaignName', label: 'Campaign' },
  { value: 'status', label: 'Status' },
  { value: 'bidAmount', label: 'Bid' },
  { value: 'tapInstalls', label: 'Installs' },
  { value: 'dailySpend', label: 'Daily Spend' },
  { value: 'localSpend', label: 'Spend' },
  { value: 'costPerInstall', label: 'Cost Per Install' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'taps', label: 'Taps' },
  { value: 'ttr', label: 'Click Rate' },
  { value: 'conversionRate', label: 'Conversion Rate' },
]

const SORTABLE_COLUMNS = [
  { value: 'keyword', label: 'Keyword' },
  { value: 'campaignName', label: 'Campaign' },
  { value: 'status', label: 'Status' },
  { value: 'bidAmount', label: 'Bid' },
  { value: 'tapInstalls', label: 'Installs' },
  { value: 'dailyDownloads', label: 'Daily Downloads' },
  { value: 'dailySpend', label: 'Daily Spend' },
  { value: 'localSpend', label: 'Spend' },
  { value: 'costPerInstall', label: 'Cost Per Install' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'taps', label: 'Taps' },
  { value: 'ttr', label: 'Click Rate' },
  { value: 'conversionRate', label: 'Conversion Rate' },
  { value: 'keywordId', label: 'Keyword ID' },
]

function getKeywordSortValue(keyword, field) {
  switch (field) {
    case 'keyword':
      return (keyword.text || keyword.keyword || '').toLowerCase()
    case 'campaignName':
      return (keyword.campaignName || '').toLowerCase()
    case 'matchType':
      return (keyword.matchType || '').toLowerCase()
    case 'status':
      return getKeywordStatus(keyword).toLowerCase()
    case 'bidAmount':
      return getMoneyAmount(keyword.bidAmount)
    case 'impressions':
      return Number(keyword.impressions || 0)
    case 'taps':
      return Number(keyword.taps || 0)
    case 'ttr':
      return getTapThroughRate(keyword)
    case 'conversionRate':
      return getConversionRate(keyword)
    case 'tapInstalls':
      return Number(keyword.tapInstalls || 0)
    case 'dailyDownloads':
      return getDailyDownloadsSortValue(keyword)
    case 'dailySpend':
      return getDailySpendSortValue(keyword)
    case 'localSpend':
      return Number(keyword.localSpend || 0)
    case 'costPerInstall':
      return getCostPerInstall(keyword)
    case 'keywordId':
      return Number(keyword.id || 0)
    default:
      return ''
  }
}

function getSortIndicator(sortField, sortDirection, field) {
  if (sortField !== field) return '↕'
  return sortDirection === 'asc' ? '↑' : '↓'
}
function getUpdatedKeywordFromResponse(responseData) {
  if (Array.isArray(responseData?.data) && responseData.data.length > 0) {
    return responseData.data[0]
  }

  if (Array.isArray(responseData) && responseData.length > 0) {
    return responseData[0]
  }

  return responseData?.data || responseData || null
}

export default function ApplicationKeywords() {
  const { startDate, endDate } = useAdsDateRange(30)
  const [adamId, setAdamId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lookupKeywordId, setLookupKeywordId] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState(null)
  const [lookupResult, setLookupResult] = useState(null)
  const [keywords, setKeywords] = useState([])
  const [applicationSummary, setApplicationSummary] = useState(null)
  const [applications, setApplications] = useState([])
  const [applicationsLoading, setApplicationsLoading] = useState(true)
  const [applicationsError, setApplicationsError] = useState(null)
  const [updatingKeywordId, setUpdatingKeywordId] = useState(null)
  const [sortField, setSortField] = useState('localSpend')
  const [sortDirection, setSortDirection] = useState('desc')

  const loadApplications = async () => {
    try {
      setApplicationsLoading(true)
      const response = await applicationAPI.getAll()
      setApplications(response.data?.data || [])
      setApplicationsError(null)
    } catch (err) {
      setApplicationsError(err.message)
      setApplications([])
    } finally {
      setApplicationsLoading(false)
    }
  }

  useEffect(() => {
    loadApplications()
  }, [])

  const sortedKeywords = [...keywords].sort((left, right) => {
    const leftValue = getKeywordSortValue(left, sortField)
    const rightValue = getKeywordSortValue(right, sortField)

    if (leftValue < rightValue) {
      return sortDirection === 'asc' ? -1 : 1
    }

    if (leftValue > rightValue) {
      return sortDirection === 'asc' ? 1 : -1
    }

    return 0
  })

  const handleSearch = async (nextAdamId = adamId) => {
    const trimmedAdamId = nextAdamId.trim()

    if (!trimmedAdamId) {
      setError('Please enter an application Adam ID')
      setKeywords([])
      setApplicationSummary(null)
      return
    }

    try {
      setLoading(true)
      const response = await keywordAPI.getByApplication(trimmedAdamId, { startDate, endDate })
      const keywordResults = response.data?.data || []

      setKeywords(keywordResults)
      setApplicationSummary(
        keywordResults.length > 0
          ? {
              appName: keywordResults[0].appName || 'Unknown App',
              appAdamId: keywordResults[0].appAdamId || trimmedAdamId,
            }
          : null
      )
      setError(null)
    } catch (err) {
      setError(err.message)
      setKeywords([])
      setApplicationSummary(null)
    } finally {
      setLoading(false)
    }
  }

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((currentDirection) => (currentDirection === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortField(field)
    setSortDirection(field === 'keyword' || field === 'campaignName' || field === 'status' ? 'asc' : 'desc')
  }

  const handleToggleKeyword = async (keyword) => {
    const nextStatus = getNextKeywordStatus(keyword)

    try {
      setUpdatingKeywordId(String(keyword.id))

      const response = await keywordAPI.updateStatus(keyword.id, {
        campaignId: keyword.campaignId,
        adGroupId: keyword.adGroupId ?? keyword.adgroupId,
        status: nextStatus,
      })

      const updatedKeyword = getUpdatedKeywordFromResponse(response.data)

      setKeywords((currentKeywords) =>
        currentKeywords.map((currentKeyword) =>
          String(currentKeyword.id) === String(keyword.id) && String(currentKeyword.campaignId) === String(keyword.campaignId)
            ? {
                ...currentKeyword,
                ...updatedKeyword,
                status: updatedKeyword?.status || nextStatus,
              }
            : currentKeyword
        )
      )
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setUpdatingKeywordId(null)
    }
  }

  const handleKeywordLookup = async () => {
    const trimmedKeywordId = lookupKeywordId.trim()

    if (!trimmedKeywordId) {
      setLookupError('Please enter a keyword ID')
      setLookupResult(null)
      return
    }

    try {
      setLookupLoading(true)
      const response = await reportAPI.getKeywordById(trimmedKeywordId, { startDate, endDate })
      setLookupResult(response.data?.data ?? response.data)
      setLookupError(null)
    } catch (err) {
      setLookupError(err.message)
      setLookupResult(null)
    } finally {
      setLookupLoading(false)
    }
  }

  useEffect(() => {
    if (!adamId.trim()) {
      return
    }

    handleSearch(adamId)
  }, [startDate, endDate])

  return (
    <div className="w-full rounded-3xl bg-white p-6 shadow-lg shadow-slate-200/70 ring-1 ring-slate-200 sm:p-8">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Application Keywords</h2>
          <p className="mt-1 text-sm text-slate-500">List all applications found in your campaigns, then load every targeting keyword under a selected app.</p>
        </div>
        <div className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
          {startDate} to {endDate}
        </div>
      </div>

      <div className="mb-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <div className="mb-4">
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">Keyword Lookup</h3>
          <p className="mt-1 text-sm text-slate-500">
            Search a keyword by ID here while working with application keywords. Stats follow the shared ads date range.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="grid gap-2 text-sm font-semibold text-slate-700">
            Keyword ID
            <input
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              type="search"
              inputMode="numeric"
              placeholder="Enter keyword ID"
              value={lookupKeywordId}
              onChange={(e) => setLookupKeywordId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleKeywordLookup()
                }
              }}
            />
          </label>
          <button
            type="button"
            className="inline-flex rounded-full bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-400"
            onClick={handleKeywordLookup}
            disabled={lookupLoading}>
            {lookupLoading ? 'Searching...' : 'Search Keyword'}
          </button>
        </div>

        {lookupError ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">Error: {lookupError}</div>
        ) : null}

        {lookupResult ? (
          <pre className="mt-4 max-h-96 overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs leading-6 text-slate-100">
            {JSON.stringify(lookupResult, null, 2)}
          </pre>
        ) : null}
      </div>

      <div className="mb-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">Applications</h3>
            <p className="mt-1 text-sm text-slate-500">Choose an application to load its keywords, or copy the Adam ID into the search form.</p>
          </div>
          <button
            type="button"
            className="inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            onClick={loadApplications}
            disabled={applicationsLoading}>
            {applicationsLoading ? 'Refreshing...' : 'Refresh Apps'}
          </button>
        </div>

        {applicationsError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">Error: {applicationsError}</div>
        ) : null}

        {applications.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {applications.map((application) => (
              <button
                key={application.adamId}
                type="button"
                className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
                onClick={() => {
                  setAdamId(application.adamId)
                  handleSearch(application.adamId)
                }}>
                <div className="text-lg font-semibold tracking-tight text-slate-900">{application.appName}</div>
                <div className="mt-2 text-sm text-slate-500">Adam ID: {application.adamId}</div>
                <div className="mt-3 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {application.campaignCount} {application.campaignCount === 1 ? 'campaign' : 'campaigns'}
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {!applicationsLoading && applications.length === 0 && !applicationsError ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
            No applications found in current campaigns.
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          Application Adam ID
          <input
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
            type="search"
            inputMode="numeric"
            placeholder="Enter app Adam ID"
            value={adamId}
            onChange={(e) => setAdamId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSearch()
              }
            }}
          />
        </label>
        <button
          type="button"
          className="inline-flex rounded-full bg-sky-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          onClick={handleSearch}
          disabled={loading}>
          {loading ? 'Loading Keywords...' : 'Load Keywords'}
        </button>
      </div>

      {error ? <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">Error: {error}</div> : null}

      {applicationSummary ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Application</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{applicationSummary.appName}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Adam ID</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{applicationSummary.appAdamId}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Keywords</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{keywords.length.toLocaleString()}</div>
          </div>
        </div>
      ) : null}

      {!loading && !error && adamId.trim() && keywords.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
          No keyword-level rows were returned for this app in the selected range. If this app is running automated (AI) campaigns, Apple Search Ads may not
          provide keyword charts for those campaigns.
        </div>
      ) : null}

      {keywords.length > 0 ? (
        <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">Keyword Performance</h3>
            <p className="mt-1 text-sm text-slate-500">
              Metrics below reflect keyword report data for the selected application from {startDate} to {endDate}. Click any column header to sort.
            </p>
            <div className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Sorted by {KEYWORD_SORT_OPTIONS.find((option) => option.value === sortField)?.label || sortField}{' '}
              {sortDirection === 'asc' ? 'ascending' : 'descending'}
            </div>
          </div>
        </div>
      ) : null}

      {keywords.length > 0 ? (
        <div className="relative mt-6 rounded-sm border border-slate-200 bg-white shadow-sm ">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase text-slate-600">
              <tr>
                {SORTABLE_COLUMNS.map((column) => (
                  <th
                    key={column.value}
                    className={
                      column.value === 'status'
                        ? 'sticky top-0 z-30 w-32 border-b border-slate-200 bg-slate-50 px-4 py-3 text-center'
                        : 'sticky top-0 z-30 border-b border-slate-200 bg-slate-50 px-4 py-3'
                    }>
                    <button
                      type="button"
                      className={
                        column.value === 'status'
                          ? 'inline-flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-600 transition hover:text-slate-900'
                          : 'inline-flex items-center gap-2 text-left text-xs font-bold uppercase tracking-[0.18em] text-slate-600 transition hover:text-slate-900'
                      }
                      onClick={() => handleSort(column.value)}>
                      <span>{column.label}</span>
                      <span className="text-slate-400">{getSortIndicator(sortField, sortDirection, column.value)}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white text-lg font-semibold text-slate-700">
              {sortedKeywords.map((keyword) => (
                <KeywordTableRow
                  key={`${keyword.id}-${keyword.campaignId}`}
                  keyword={keyword}
                  campaignName={keyword.campaignName}
                  campaignId={keyword.campaignId}
                  updatingKeywordId={updatingKeywordId}
                  onToggleKeyword={handleToggleKeyword}
                  variant="application"
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
