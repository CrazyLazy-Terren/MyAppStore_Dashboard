export function formatDateForInput(date) {
  return date.toISOString().split('T')[0]
}

export function getDefaultReportDates(rangeDays = 30) {
  const endDate = new Date()
  const startDate = new Date(endDate)

  startDate.setDate(endDate.getDate() - Math.max(rangeDays - 1, 0))

  return {
    startDate: formatDateForInput(startDate),
    endDate: formatDateForInput(endDate),
  }
}

export function isValidDateInput(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
}

export function normalizeDateRange(startDate, endDate, defaultRangeDays = 30) {
  const defaults = getDefaultReportDates(defaultRangeDays)
  const nextStartDate = isValidDateInput(startDate) ? startDate.trim() : defaults.startDate
  const nextEndDate = isValidDateInput(endDate) ? endDate.trim() : defaults.endDate

  if (nextStartDate <= nextEndDate) {
    return {
      startDate: nextStartDate,
      endDate: nextEndDate,
    }
  }

  return {
    startDate: nextEndDate,
    endDate: nextStartDate,
  }
}

export function getDateRangeFromSearchParams(searchParams, defaultRangeDays = 30, options = {}) {
  const { startKey = 'adsStartDate', endKey = 'adsEndDate' } = options
  const startDate = searchParams?.get?.(startKey)
  const endDate = searchParams?.get?.(endKey)

  return normalizeDateRange(startDate, endDate, defaultRangeDays)
}

export function buildCampaignReportRequest(startDate, endDate, options = {}) {
  const { limit = 1000, returnRecordsWithNoMetrics = true } = options

  return {
    startTime: startDate,
    endTime: endDate,
    granularity: 'DAILY',
    selector: {
      orderBy: [
        {
          field: 'campaignId',
          sortOrder: 'ASCENDING',
        },
      ],
      pagination: {
        offset: 0,
        limit,
      },
    },
    timeZone: 'ORTZ',
    returnRecordsWithNoMetrics,
    returnRowTotals: false,
    returnGrandTotals: false,
  }
}
