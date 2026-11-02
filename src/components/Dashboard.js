'use client'

import { useEffect, useState } from 'react'
import { campaignAPI, reportAPI } from '@/components/api'
import CountryDownloads from '@/components/CountryDownloads'
import Reports from '@/components/Reports'
import useAdsDateRange from '@/components/useAdsDateRange'
import { buildCampaignReportRequest } from '@/lib/reportDateRange'

function getMetricValue(value) {
  if (value && typeof value === 'object') {
    return Number(value.amount ?? value.value ?? 0)
  }

  return Number(value ?? 0)
}

function summarizeReportMetrics(reportData) {
  const rows = reportData?.data?.reportingDataResponse?.row || reportData?.reportingDataResponse?.row || []

  return rows.reduce(
    (summary, row) => {
      const granularityRows = Array.isArray(row?.granularity) ? row.granularity : []

      for (const entry of granularityRows) {
        summary.totalSpend += getMetricValue(entry?.localSpend)
        summary.totalImpressions += getMetricValue(entry?.impressions)
      }

      return summary
    },
    {
      totalSpend: 0,
      totalImpressions: 0,
    }
  )
}

export default function Dashboard() {
  const { startDate, endDate } = useAdsDateRange(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [stats, setStats] = useState({
    totalCampaigns: 0,
    activeCampaigns: 0,
    totalSpend: 0,
    totalImpressions: 0,
  })

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      const [campaignsResponse, reportResponse] = await Promise.all([
        campaignAPI.getAll(),
        reportAPI.getCampaignReport(buildCampaignReportRequest(startDate, endDate)),
      ])
      const campaigns = campaignsResponse.data?.data || []
      const reportTotals = summarizeReportMetrics(reportResponse.data)

      setStats({
        totalCampaigns: campaigns.length,
        activeCampaigns: campaigns.filter((c) => c.status === 'ENABLED').length,
        totalSpend: reportTotals.totalSpend,
        totalImpressions: reportTotals.totalImpressions,
      })
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboardData()
  }, [startDate, endDate])

  if (loading) {
    return (
      <div className="flex w-full items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/80 px-6 py-16 text-sm font-medium text-slate-500 shadow-sm">
        Loading dashboard...
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full rounded-3xl border border-rose-200 bg-rose-50 px-6 py-10 text-center shadow-sm">
        <p className="text-sm font-medium text-rose-700">Error loading dashboard: {error}</p>
        <button
          className="mt-4 inline-flex rounded-full bg-sky-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800"
          onClick={fetchDashboardData}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <CountryDownloads startDate={startDate} endDate={endDate} />

      <Reports
        defaultRangeDays={30}
        showRawResponse={false}
        autoLoadCampaignReport={true}
        startDate={startDate}
        endDate={endDate}
        showDateControls={false}
        title="Campaign Report"
        description="Daily campaign performance for the shared ads date range."
      />
    </div>
  )
}
