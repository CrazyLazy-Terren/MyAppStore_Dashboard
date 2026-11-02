'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { campaignAPI, keywordAPI } from '@/components/api'
import useAdsDateRange from '@/components/useAdsDateRange'
import KeywordTableRow, {
  getNextKeywordStatus,
  getConversionRate,
  getCostPerInstall,
  getDailyDownloadsSeries,
  getDailySpendSortValue,
  getKeywordStatus,
  getMoneyAmount,
  getTapThroughRate,
} from '@/components/KeywordTableRow'

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

const STATUS_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ENABLED', label: 'Enabled' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'DELETED', label: 'Deleted' },
  { value: 'DISABLED', label: 'Disabled' },
]

function getKeywordSortValue(keyword, field, campaign) {
  switch (field) {
    case 'keyword':
      return (keyword.text || keyword.keyword || '').toLowerCase()
    case 'campaignName':
      return String(campaign?.name || '').toLowerCase()
    case 'status':
      return getKeywordStatus(keyword).toLowerCase()
    case 'bidAmount':
      return getMoneyAmount(keyword.bidAmount)
    case 'tapInstalls':
      return Number(keyword.tapInstalls || 0)
    case 'dailyDownloads':
      return getDailyDownloadsSeries(keyword).reduce((sum, point) => sum + Number(point?.value || 0), 0)
    case 'dailySpend':
      return getDailySpendSortValue(keyword)
    case 'localSpend':
      return Number(keyword.localSpend || 0)
    case 'costPerInstall':
      return getCostPerInstall(keyword)
    case 'impressions':
      return Number(keyword.impressions || 0)
    case 'taps':
      return Number(keyword.taps || 0)
    case 'ttr':
      return getTapThroughRate(keyword)
    case 'conversionRate':
      return getConversionRate(keyword)
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

export default function CampaignDetail({ id }) {
  const router = useRouter()
  const { startDate, endDate } = useAdsDateRange(30)
  const [campaign, setCampaign] = useState(null)
  const [keywords, setKeywords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [updatingKeywordId, setUpdatingKeywordId] = useState(null)
  const [updatingBidKeywordId, setUpdatingBidKeywordId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [sortField, setSortField] = useState('localSpend')
  const [sortDirection, setSortDirection] = useState('desc')
  const isLikelyAutomatedCampaign = String(campaign?.biddingStrategy || '').toUpperCase() === 'MAX_CONVERSIONS'

  const fetchCampaign = async () => {
    try {
      setLoading(true)
      const [campaignResponse, keywordsResponse] = await Promise.all([campaignAPI.getById(id), campaignAPI.getKeywords(id, { startDate, endDate })])
      setCampaign(campaignResponse.data?.data)
      setKeywords(keywordsResponse.data?.data || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCampaign()
  }, [id, startDate, endDate])

  const filteredKeywords = keywords.filter((keyword) => {
    if (statusFilter === 'ALL') {
      return true
    }

    return String(getKeywordStatus(keyword)).toUpperCase() === statusFilter
  })

  const sortedKeywords = [...filteredKeywords].sort((left, right) => {
    const leftValue = getKeywordSortValue(left, sortField, campaign)
    const rightValue = getKeywordSortValue(right, sortField, campaign)

    if (leftValue < rightValue) {
      return sortDirection === 'asc' ? -1 : 1
    }

    if (leftValue > rightValue) {
      return sortDirection === 'asc' ? 1 : -1
    }

    return 0
  })

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
        campaignId: campaign.id,
        adGroupId: keyword.adGroupId ?? keyword.adgroupId,
        status: nextStatus,
      })

      const updatedKeyword = getUpdatedKeywordFromResponse(response.data)

      setKeywords((currentKeywords) =>
        currentKeywords.map((currentKeyword) =>
          String(currentKeyword.id) === String(keyword.id)
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

  const handleUpdateKeywordBid = async (keyword, nextBidAmount) => {
    const rowKey = `${campaign.id}-${keyword.id}`
    const previousBidAmount = keyword.bidAmount && typeof keyword.bidAmount === 'object' ? keyword.bidAmount : {}
    const nextBid = {
      ...previousBidAmount,
      amount: Number(nextBidAmount).toFixed(2),
    }

    try {
      setUpdatingBidKeywordId(rowKey)

      const response = await keywordAPI.updateBid(keyword.id, {
        campaignId: campaign.id,
        adGroupId: keyword.adGroupId ?? keyword.adgroupId,
        bidAmount: nextBid,
      })

      const updatedKeyword = getUpdatedKeywordFromResponse(response.data)

      setKeywords((currentKeywords) =>
        currentKeywords.map((currentKeyword) =>
          String(currentKeyword.id) === String(keyword.id)
            ? {
                ...currentKeyword,
                ...updatedKeyword,
                bidAmount: updatedKeyword?.bidAmount || nextBid,
              }
            : currentKeyword
        )
      )
      setError(null)
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setUpdatingBidKeywordId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex w-full items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/80 px-6 py-16 text-sm font-medium text-slate-500 shadow-sm">
        Loading campaign details...
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full rounded-3xl border border-rose-200 bg-rose-50 px-6 py-10 text-center text-sm font-medium text-rose-700 shadow-sm">
        Error loading campaign: {error}
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="w-full rounded-3xl border border-amber-200 bg-amber-50 px-6 py-10 text-center text-sm font-medium text-amber-700 shadow-sm">
        Campaign not found
      </div>
    )
  }

  return (
    <div className="w-full rounded-3xl bg-white p-6 shadow-lg shadow-slate-200/70 ring-1 ring-slate-200 sm:p-8">
      <button
        className="inline-flex rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
        onClick={() => router.push('/campaigns')}>
        Back to Campaigns
      </button>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{campaign.name}</h2>
          <p className="text-sm text-slate-500">Campaign configuration, pacing, and raw API response details.</p>
        </div>
        <div className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
          {startDate} to {endDate}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200">
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Status</h3>
          <div className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{campaign.status || 'Unknown'}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200">
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Daily Budget</h3>
          <div className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
            ${campaign.dailyBudget?.amount || campaign.dailyBudgetAmount?.amount || 0}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200">
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Spend</h3>
          <div className="mt-3 text-3xl font-bold tracking-tight text-slate-900">${campaign.spend?.toFixed(2) || '0.00'}</div>
        </div>
      </div>

      <div className="mt-6 grid gap-3">
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <strong className="text-sm font-semibold text-slate-700">Campaign ID</strong>
          <span className="break-all font-mono text-sm text-slate-600">{campaign.id}</span>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <strong className="text-sm font-semibold text-slate-700">Organization ID</strong>
          <span className="break-all font-mono text-sm text-slate-600">{campaign.orgId}</span>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <strong className="text-sm font-semibold text-slate-700">Start Time</strong>
          <span className="text-sm text-slate-600">{campaign.startTime || 'N/A'}</span>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">Keywords</h3>
            <p className="mt-1 text-sm text-slate-500">Targeting keywords currently attached to this campaign, with metrics for the shared ads date range.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span>Status</span>
              <select
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold tracking-normal text-slate-700 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}>
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
              {sortedKeywords.length} of {keywords.length} keywords
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Sorted by {SORTABLE_COLUMNS.find((column) => column.value === sortField)?.label || sortField}{' '}
              {sortDirection === 'asc' ? 'ascending' : 'descending'}
            </div>
          </div>
        </div>

        {keywords.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
            {isLikelyAutomatedCampaign
              ? 'This automated (AI) campaign does not expose keyword-level stats in Apple Search Ads, so keyword charts and rows are unavailable.'
              : 'No keywords found for this campaign.'}
          </div>
        ) : (
          <div className="relative   overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  {SORTABLE_COLUMNS.map((column) => (
                    <th key={column.value} className="px-4 py-3">
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 transition hover:text-slate-900"
                        onClick={() => handleSort(column.value)}>
                        <span>{column.label}</span>
                        <span className="text-slate-400">{getSortIndicator(sortField, sortDirection, column.value)}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white text-slate-700">
                {sortedKeywords.map((keyword) => (
                  <KeywordTableRow
                    key={keyword.id}
                    keyword={keyword}
                    campaignName={campaign.name}
                    campaignId={campaign.id}
                    updatingKeywordId={updatingKeywordId}
                    updatingBidKeywordId={updatingBidKeywordId}
                    onToggleKeyword={handleToggleKeyword}
                    onUpdateBid={handleUpdateKeywordBid}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-500">Show raw JSON</summary>
        <pre className="mt-4 max-h-80 overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs leading-6 text-slate-100">
          {JSON.stringify(campaign, null, 2)}
        </pre>
      </details>
    </div>
  )
}
