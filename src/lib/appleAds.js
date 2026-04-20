import auth from './auth'
import config from './config'

function formatReportDate(date) {
  return date.toISOString().split('T')[0]
}

function getDefaultKeywordReportDateRange(range) {
  if (range?.startDate && range?.endDate) {
    return {
      startTime: range.startDate,
      endTime: range.endDate,
    }
  }

  const endDate = new Date()
  const startDate = new Date(endDate)

  startDate.setDate(endDate.getDate() - 30)

  return {
    startTime: formatReportDate(startDate),
    endTime: formatReportDate(endDate),
  }
}

class AppleAdsClient {
  constructor() {
    this.baseUrl = `${config.appleAds.apiBaseUrl}/${config.appleAds.apiVersion}`
    this.orgId = null
  }

  async request(method, endpoint, data = null, orgId = null) {
    try {
      const headers = await auth.getHeaders(orgId)
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
      })

      const responseData = await response.json()

      if (!response.ok) {
        throw new Error(`Apple Ads API Error: ${response.status} - ${JSON.stringify(responseData)}`)
      }

      return responseData
    } catch (error) {
      throw error
    }
  }

  async getOrgId() {
    if (this.orgId) return this.orgId

    const response = await this.request('GET', '/acls')
    if (response.data && response.data.length > 0) {
      this.orgId = response.data[0].orgId
    }
    return this.orgId
  }

  async getCampaigns() {
    const orgId = await this.getOrgId()
    return this.request('GET', `/campaigns?orgId=${orgId}`, null, orgId)
  }

  async getCampaign(campaignId) {
    const orgId = await this.getOrgId()
    return this.request('GET', `/campaigns/${campaignId}?orgId=${orgId}`, null, orgId)
  }

  async createCampaign(campaignData) {
    const orgId = await this.getOrgId()
    return this.request('POST', `/campaigns?orgId=${orgId}`, campaignData, orgId)
  }

  async updateCampaign(campaignId, campaignData) {
    const orgId = await this.getOrgId()
    return this.request('PUT', `/campaigns/${campaignId}?orgId=${orgId}`, campaignData, orgId)
  }

  async deleteCampaign(campaignId) {
    const orgId = await this.getOrgId()
    return this.request('DELETE', `/campaigns/${campaignId}?orgId=${orgId}`, null, orgId)
  }

  async getAdGroups(campaignId) {
    const orgId = await this.getOrgId()
    return this.request('GET', `/campaigns/${campaignId}/adgroups?orgId=${orgId}`, null, orgId)
  }

  async getCampaignKeywords(campaignId, reportDateRange = null) {
    const orgId = await this.getOrgId()
    let keywordPerformanceMap = new Map()
    let response

    try {
      const keywordReportResponse = await this.getKeywordReports(campaignId, reportDateRange)
      keywordPerformanceMap = this.buildKeywordPerformanceMap(keywordReportResponse)

      response = await this.request(
        'POST',
        `/campaigns/${campaignId}/adgroups/targetingkeywords/find?orgId=${orgId}`,
        {
          orderBy: [
            {
              field: 'id',
              sortOrder: 'ASCENDING',
            },
          ],
          pagination: {
            offset: 0,
            limit: 1000,
          },
          conditions: [
            {
              field: 'deleted',
              operator: 'IN',
              values: ['false', 'true'],
            },
          ],
        },
        orgId
      )
    } catch (error) {
      if (this.isUnsupportedKeywordCampaignError(error)) {
        return {
          data: [],
          pagination: null,
        }
      }

      throw error
    }

    return {
      ...response,
      data: (response.data || []).map((keyword) => {
        const performance = keywordPerformanceMap.get(String(keyword.id)) || {
          impressions: 0,
          taps: 0,
          tapInstalls: 0,
          localSpend: 0,
          ttr: 0,
          dailyLocalSpend: [],
          dailyTapInstalls: [],
        }

        return {
          ...keyword,
          impressions: performance.impressions,
          taps: performance.taps,
          tapInstalls: performance.tapInstalls,
          localSpend: performance.localSpend,
          ttr: performance.ttr,
          dailyLocalSpend: performance.dailyLocalSpend,
          dailyTapInstalls: performance.dailyTapInstalls,
        }
      }),
    }
  }

  async getCampaignReports(payload) {
    const orgId = await this.getOrgId()
    return this.request('POST', `/reports/campaigns?orgId=${orgId}`, payload, orgId)
  }

  getCampaignAppAdamId(campaign) {
    return String(campaign?.adamId ?? campaign?.app?.adamId ?? campaign?.appAdamId ?? '')
  }

  getCampaignAppName(campaign) {
    return campaign?.app?.appName ?? campaign?.appName ?? campaign?.name ?? 'Unknown App'
  }

  isUnsupportedKeywordCampaignError(error) {
    const message = error instanceof Error ? error.message : String(error)

    return message.includes('DOES NOT CONTAIN KEYWORD') || message.includes('APPSTORE_PRODUCT_PAGES CAMPAIGN')
  }

  getKeywordMetricValue(value) {
    if (value && typeof value === 'object') {
      return Number(value.amount ?? value.value ?? 0)
    }

    return Number(value ?? 0)
  }

  buildKeywordReportRequest(reportDateRange = null) {
    const { startTime, endTime } = getDefaultKeywordReportDateRange(reportDateRange)

    return {
      startTime,
      endTime,
      granularity: 'DAILY',
      timeZone: 'ORTZ',
      returnRecordsWithNoMetrics: true,
      returnRowTotals: true,
      returnGrandTotals: true,
      selector: {
        orderBy: [
          {
            field: 'localSpend',
            sortOrder: 'DESCENDING',
          },
        ],
        conditions: [
          {
            field: 'deleted',
            operator: 'IN',
            values: ['false', 'true'],
          },
        ],
        pagination: {
          offset: 0,
          limit: 1000,
        },
      },
    }
  }

  async getKeywordReports(campaignId, reportDateRange = null) {
    const orgId = await this.getOrgId()
    return this.request('POST', `/reports/campaigns/${campaignId}/keywords?orgId=${orgId}`, this.buildKeywordReportRequest(reportDateRange), orgId)
  }

  buildKeywordPerformanceMap(reportResponse) {
    const rows = reportResponse?.data?.reportingDataResponse?.row || reportResponse?.reportingDataResponse?.row || []
    const performanceMap = new Map()

    for (const row of rows) {
      const metadata = row?.metadata || {}
      const total = row?.total || {}
      const keywordId = String(metadata.keywordId ?? row?.keywordId ?? '')

      if (!keywordId) {
        continue
      }

      const granularityRows = Array.isArray(row?.granularity) ? row.granularity : []
      const dailyLocalSpend = granularityRows.map((entry) => ({
        date: entry?.date || '',
        value: this.getKeywordMetricValue(entry?.localSpend),
      }))
      const dailyTapInstalls = granularityRows.map((entry) => ({
        date: entry?.date || '',
        value: this.getKeywordMetricValue(entry?.tapInstalls),
      }))

      performanceMap.set(keywordId, {
        impressions: this.getKeywordMetricValue(total.impressions),
        taps: this.getKeywordMetricValue(total.taps),
        tapInstalls: this.getKeywordMetricValue(total.tapInstalls),
        localSpend: this.getKeywordMetricValue(total.localSpend),
        ttr: this.getKeywordMetricValue(total.ttr),
        dailyLocalSpend,
        dailyTapInstalls,
      })
    }

    return performanceMap
  }

  listApplications() {
    return this.getCampaigns().then((campaignsResponse) => {
      const campaigns = campaignsResponse.data || []
      const applications = new Map()

      for (const campaign of campaigns) {
        const appAdamId = this.getCampaignAppAdamId(campaign)

        if (!appAdamId) {
          continue
        }

        if (!applications.has(appAdamId)) {
          applications.set(appAdamId, {
            adamId: appAdamId,
            appName: this.getCampaignAppName(campaign),
            campaignCount: 0,
          })
        }

        const application = applications.get(appAdamId)
        application.campaignCount += 1
      }

      return {
        data: Array.from(applications.values()).sort((left, right) => left.appName.localeCompare(right.appName)),
        pagination: null,
      }
    })
  }

  async findKeywordsByAppAdamId(adamId, reportDateRange = null) {
    const orgId = await this.getOrgId()
    const campaignsResponse = await this.getCampaigns()
    const campaigns = (campaignsResponse.data || []).filter((campaign) => this.getCampaignAppAdamId(campaign) === String(adamId))

    if (campaigns.length === 0) {
      return {
        data: [],
        pagination: null,
      }
    }

    const keywords = []

    for (const campaign of campaigns) {
      let keywordPerformanceMap = new Map()
      let response

      try {
        const keywordReportResponse = await this.getKeywordReports(campaign.id, reportDateRange)
        keywordPerformanceMap = this.buildKeywordPerformanceMap(keywordReportResponse)

        response = await this.request(
          'POST',
          `/campaigns/${campaign.id}/adgroups/targetingkeywords/find?orgId=${orgId}`,
          {
            orderBy: [
              {
                field: 'id',
                sortOrder: 'ASCENDING',
              },
            ],
            pagination: {
              offset: 0,
              limit: 1000,
            },
            conditions: [
              {
                field: 'deleted',
                operator: 'EQUALS',
                values: ['false'],
              },
            ],
          },
          orgId
        )
      } catch (error) {
        if (this.isUnsupportedKeywordCampaignError(error)) {
          continue
        }

        throw error
      }

      for (const keyword of response.data || []) {
        const performance = keywordPerformanceMap.get(String(keyword.id)) || {
          impressions: 0,
          taps: 0,
          tapInstalls: 0,
          localSpend: 0,
          ttr: 0,
          dailyLocalSpend: [],
          dailyTapInstalls: [],
        }

        keywords.push({
          ...keyword,
          campaignId: campaign.id,
          campaignName: campaign.name,
          appAdamId: this.getCampaignAppAdamId(campaign),
          appName: this.getCampaignAppName(campaign),
          impressions: performance.impressions,
          taps: performance.taps,
          tapInstalls: performance.tapInstalls,
          localSpend: performance.localSpend,
          ttr: performance.ttr,
          dailyLocalSpend: performance.dailyLocalSpend,
          dailyTapInstalls: performance.dailyTapInstalls,
        })
      }
    }

    return {
      data: keywords,
      pagination: null,
    }
  }

  async findKeywordById(keywordId, reportDateRange = null) {
    const orgId = await this.getOrgId()
    const campaignsResponse = await this.getCampaigns()
    const campaigns = campaignsResponse.data || []
    const matches = []

    for (const campaign of campaigns) {
      let keywordPerformanceMap = new Map()
      let response

      try {
        const keywordReportResponse = await this.getKeywordReports(campaign.id, reportDateRange)
        keywordPerformanceMap = this.buildKeywordPerformanceMap(keywordReportResponse)

        response = await this.request(
          'POST',
          `/campaigns/${campaign.id}/adgroups/targetingkeywords/find?orgId=${orgId}`,
          {
            pagination: {
              offset: 0,
              limit: 100,
            },
            conditions: [
              {
                field: 'id',
                operator: 'EQUALS',
                values: [String(keywordId)],
              },
            ],
          },
          orgId
        )
      } catch (error) {
        if (this.isUnsupportedKeywordCampaignError(error)) {
          continue
        }

        throw error
      }

      const keywords = response.data || []
      if (keywords.length > 0) {
        matches.push(
          ...keywords.map((keyword) => ({
            ...keyword,
            campaignId: campaign.id,
            campaignName: campaign.name,
            ...(keywordPerformanceMap.get(String(keyword.id)) || {
              impressions: 0,
              taps: 0,
              tapInstalls: 0,
              localSpend: 0,
              ttr: 0,
              dailyLocalSpend: [],
              dailyTapInstalls: [],
            }),
          }))
        )
      }
    }

    return {
      data: matches,
      pagination: null,
    }
  }

  getNumericValue(value) {
    if (value && typeof value === 'object') {
      return Number(value.amount ?? value.value ?? value.bid ?? value.average ?? 0)
    }

    const parsed = Number(value ?? 0)
    return Number.isFinite(parsed) ? parsed : 0
  }

  getBidRangeFromSuggestion(item) {
    const lowCandidate =
      item?.bidAmount?.min ||
      item?.bidAmount?.low ||
      item?.localBidAmount?.min ||
      item?.localBidAmount?.low ||
      item?.suggestedBid?.min ||
      item?.suggestedBid?.low ||
      item?.minBidAmount ||
      item?.bidMin
    const highCandidate =
      item?.bidAmount?.max ||
      item?.bidAmount?.high ||
      item?.localBidAmount?.max ||
      item?.localBidAmount?.high ||
      item?.suggestedBid?.max ||
      item?.suggestedBid?.high ||
      item?.maxBidAmount ||
      item?.bidMax

    const low = this.getNumericValue(lowCandidate)
    const high = this.getNumericValue(highCandidate)

    return {
      low,
      high,
    }
  }

  getCompetitionFromBidRange(low, high) {
    const pressure = Number.isFinite(high) && high > 0 ? high : low

    if (pressure >= 4) {
      return 'high'
    }

    if (pressure >= 2) {
      return 'medium'
    }

    return 'low'
  }

  normalizePopularity(value) {
    const popularity = this.getNumericValue(value)

    if (!Number.isFinite(popularity) || popularity <= 0) {
      return 0
    }

    if (popularity <= 5) {
      return Math.round((popularity / 5) * 100)
    }

    return Math.min(100, Math.round(popularity))
  }

  normalizeKeywordSuggestion(item) {
    const keyword = String(
      item?.keyword ||
        item?.text ||
        item?.searchTerm ||
        item?.searchTermText ||
        item?.targetingKeyword ||
        item?.metadata?.keyword ||
        item?.metadata?.searchTerm ||
        ''
    ).trim()

    if (!keyword) {
      return null
    }

    const popularity = this.normalizePopularity(item?.popularity ?? item?.popularityScore ?? item?.searchPopularity ?? item?.score)
    const { low, high } = this.getBidRangeFromSuggestion(item)
    const competition = this.getCompetitionFromBidRange(low, high)

    return {
      keyword,
      popularity,
      competition,
      bidRange: {
        min: low,
        max: high,
      },
    }
  }

  normalizeKeywordSuggestionResponse(response) {
    const rows =
      response?.data || response?.results || response?.suggestions || response?.searchTerms || response?.keywords || response?.reportingDataResponse?.row || []

    const seen = new Set()
    const suggestions = []

    for (const row of rows) {
      const suggestion = this.normalizeKeywordSuggestion(row)
      if (!suggestion) {
        continue
      }

      const dedupeKey = suggestion.keyword.toLowerCase()
      if (seen.has(dedupeKey)) {
        continue
      }

      seen.add(dedupeKey)
      suggestions.push(suggestion)
    }

    return suggestions
  }

  buildFallbackKeywordSuggestions(keywords, seedKeyword, limit) {
    const seed = String(seedKeyword || '')
      .trim()
      .toLowerCase()
    const candidates = []

    for (const keyword of keywords || []) {
      const text = String(keyword?.text || keyword?.keyword || '').trim()
      if (!text) {
        continue
      }

      if (seed && !text.toLowerCase().includes(seed)) {
        continue
      }

      const impressions = this.getNumericValue(keyword?.impressions)
      const taps = this.getNumericValue(keyword?.taps)
      const localSpend = this.getNumericValue(keyword?.localSpend)
      const averageCpt = taps > 0 ? localSpend / taps : 0

      candidates.push({
        keyword: text,
        impressions,
        averageCpt,
      })
    }

    const maxImpressions = candidates.reduce((currentMax, item) => Math.max(currentMax, item.impressions), 0)

    return candidates
      .sort((left, right) => right.impressions - left.impressions)
      .slice(0, limit)
      .map((item) => {
        const popularity = maxImpressions > 0 ? Math.round((item.impressions / maxImpressions) * 100) : 0
        const competition = this.getCompetitionFromBidRange(item.averageCpt, item.averageCpt)

        return {
          keyword: item.keyword,
          popularity,
          competition,
          bidRange: {
            min: item.averageCpt,
            max: item.averageCpt,
          },
        }
      })
  }

  async suggestKeywords({ adamId, seedKeyword = '', locale = 'en-US', limit = 20 }) {
    const orgId = await this.getOrgId()
    const normalizedLimit = Math.min(100, Math.max(1, Number(limit) || 20))

    const requestCandidates = [
      {
        method: 'POST',
        endpoint: `/searchterms/recommendations?orgId=${orgId}`,
        payload: {
          adamId: adamId ? String(adamId) : undefined,
          locale,
          searchTerm: seedKeyword || undefined,
          limit: normalizedLimit,
        },
      },
      {
        method: 'POST',
        endpoint: `/searchterms/find?orgId=${orgId}`,
        payload: {
          pagination: {
            offset: 0,
            limit: normalizedLimit,
          },
          conditions: [
            ...(seedKeyword
              ? [
                  {
                    field: 'searchTerm',
                    operator: 'CONTAINS',
                    values: [seedKeyword],
                  },
                ]
              : []),
            ...(adamId
              ? [
                  {
                    field: 'adamId',
                    operator: 'EQUALS',
                    values: [String(adamId)],
                  },
                ]
              : []),
          ],
        },
      },
    ]

    for (const candidate of requestCandidates) {
      try {
        const response = await this.request(candidate.method, candidate.endpoint, candidate.payload, orgId)
        const suggestions = this.normalizeKeywordSuggestionResponse(response)

        if (suggestions.length > 0) {
          return {
            data: suggestions.slice(0, normalizedLimit),
            meta: {
              source: 'apple-search-ads',
              locale,
              seedKeyword,
            },
          }
        }
      } catch {
        // Try the next request shape; Search Ads keyword suggestion endpoints vary by account/version.
      }
    }

    if (adamId) {
      const appKeywords = await this.findKeywordsByAppAdamId(String(adamId))
      const fallbackSuggestions = this.buildFallbackKeywordSuggestions(appKeywords?.data || [], seedKeyword, normalizedLimit)

      if (fallbackSuggestions.length > 0) {
        return {
          data: fallbackSuggestions,
          meta: {
            source: 'fallback-performance',
            locale,
            seedKeyword,
            note: 'Using existing keyword performance as a proxy because suggestion endpoint was unavailable.',
          },
        }
      }
    }

    return {
      data: [],
      meta: {
        source: 'unavailable',
        locale,
        seedKeyword,
      },
    }
  }

  async updateKeywordStatus(keywordId, { campaignId, adGroupId, status }) {
    const orgId = await this.getOrgId()

    if (!campaignId) {
      throw new Error('campaignId is required to update a keyword status')
    }

    if (!adGroupId) {
      throw new Error('adGroupId is required to update a keyword status')
    }

    return this.request(
      'PUT',
      `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk?orgId=${orgId}`,
      [
        {
          id: Number(keywordId),
          status,
        },
      ],
      orgId
    )
  }
}

const appleAds = new AppleAdsClient()
export default appleAds
