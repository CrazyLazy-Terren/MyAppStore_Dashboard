'use client'

import { startTransition, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { getDateRangeFromSearchParams, getDefaultReportDates, normalizeDateRange } from '@/lib/reportDateRange'

const DATE_RANGE_PRESETS = [7, 14, 30, 90]

function shouldShowAdsDateRange(pathname) {
  return pathname !== '/appstore'
}

export default function AdsDateRangeToolbar() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, setIsPending] = useState(false)

  const currentRange = getDateRangeFromSearchParams(searchParams, 30)
  const searchParamsString = searchParams.toString()
  const selectedPresetDays = useMemo(() => {
    return DATE_RANGE_PRESETS.find((days) => {
      const presetRange = getDefaultReportDates(days)
      return presetRange.startDate === currentRange.startDate && presetRange.endDate === currentRange.endDate
    })
  }, [currentRange.endDate, currentRange.startDate])

  if (!shouldShowAdsDateRange(pathname)) {
    return null
  }

  const updateUrlRange = (nextStartDate, nextEndDate) => {
    const normalizedRange = normalizeDateRange(nextStartDate, nextEndDate, 30)
    const nextSearchParams = new URLSearchParams(searchParamsString)

    nextSearchParams.set('adsStartDate', normalizedRange.startDate)
    nextSearchParams.set('adsEndDate', normalizedRange.endDate)

    setIsPending(true)
    startTransition(() => {
      const nextQuery = nextSearchParams.toString()
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname)
      setIsPending(false)
    })
  }

  return (
    <div className="border-b border-slate-200 bg-white/90 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-8xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Ads Date Range</div>
          <div className="mt-1 text-sm text-slate-600">Shared across dashboard, campaigns, and keyword stats.</div>
        </div>

        <div className="flex flex-col gap-3 lg:items-end">
          <div className="flex flex-wrap gap-2">
            {DATE_RANGE_PRESETS.map((days) => (
              <button
                key={days}
                type="button"
                className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                  selectedPresetDays === days ? 'bg-sky-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
                onClick={() => {
                  const presetRange = getDefaultReportDates(days)
                  updateUrlRange(presetRange.startDate, presetRange.endDate)
                }}
                disabled={isPending}>
                {days}D
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:min-w-90">
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Start
              <input
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium tracking-normal text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                type="date"
                value={currentRange.startDate}
                onChange={(event) => updateUrlRange(event.target.value, currentRange.endDate)}
                disabled={isPending}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              End
              <input
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium tracking-normal text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                type="date"
                value={currentRange.endDate}
                onChange={(event) => updateUrlRange(currentRange.startDate, event.target.value)}
                disabled={isPending}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
