'use client'

import { useSearchParams } from 'next/navigation'
import { getDateRangeFromSearchParams } from '@/lib/reportDateRange'

export default function useAdsDateRange(defaultRangeDays = 30) {
  const searchParams = useSearchParams()

  return getDateRangeFromSearchParams(searchParams, defaultRangeDays)
}
