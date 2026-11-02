'use client'

import { useEffect, useState } from 'react'
import { reportAPI } from '@/components/api'
import AdsPerformanceChart from '@/components/AdsPerformanceChart'
import { buildCampaignReportRequest, getDefaultReportDates } from '@/lib/reportDateRange'

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

  const startDate = controlledStartDate ?? localStartDate
  const endDate = controlledEndDate ?? localEndDate

  const handleGenerate = async () => {
    if (!startDate || !endDate) {
      alert('Please select start and end dates')
      return
    }

    try {
      setLoading(true)
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

      {reportData ? <AdsPerformanceChart reportData={reportData} startDate={startDate} endDate={endDate} /> : null}

      {showRawResponse && reportData ? (
        <pre className="mt-6 max-h-96 overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs leading-6 text-slate-100">
          {JSON.stringify(reportData, null, 2)}
        </pre>
      ) : null}
    </section>
  )
}
