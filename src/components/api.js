const fetchAPI = async (url, options = {}) => {
  try {
    const response = await fetch(`/api${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('API Error:', data)
      throw new Error(data.error?.message || data.error || 'API request failed')
    }

    return { data }
  } catch (error) {
    console.error('API Error:', error)
    throw error
  }
}

function withDateRange(url, range) {
  if (!range?.startDate || !range?.endDate) {
    return url
  }

  const separator = url.includes('?') ? '&' : '?'
  const searchParams = new URLSearchParams({
    startDate: range.startDate,
    endDate: range.endDate,
  })

  return `${url}${separator}${searchParams.toString()}`
}

export const campaignAPI = {
  getAll: () => fetchAPI('/campaigns'),
  getById: (id) => fetchAPI(`/campaigns/${id}`),
  getKeywords: (id, range) => fetchAPI(withDateRange(`/campaigns/${id}/keywords`, range)),
  create: (data) =>
    fetchAPI('/campaigns', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id, data) =>
    fetchAPI(`/campaigns/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id) =>
    fetchAPI(`/campaigns/${id}`, {
      method: 'DELETE',
    }),
  getAdGroups: (id) => fetchAPI(`/campaigns/${id}/adgroups`),
}

export const reportAPI = {
  getCampaignReport: (data) =>
    fetchAPI('/reports/campaigns', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getKeywordById: (keywordId, range) => fetchAPI(withDateRange(`/reports/keywords?keywordId=${encodeURIComponent(keywordId)}`, range)),
  getCountryReport: (range, appId) =>
    fetchAPI(withDateRange(`/reports/countries${appId ? `?appId=${encodeURIComponent(appId)}` : ''}`, range)),
  getCustomReport: (data) =>
    fetchAPI('/reports/custom', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

export const keywordAPI = {
  getByApplication: (adamId, range) => fetchAPI(withDateRange(`/keywords/application?adamId=${encodeURIComponent(adamId)}`, range)),
  updateStatus: (id, data) =>
    fetchAPI(`/keywords/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  updateBid: (id, data) =>
    fetchAPI(`/keywords/${encodeURIComponent(id)}/bid`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}

export const appStoreAnalyticsAPI = {
  enable: (appIds) =>
    fetchAPI('/appstore/analytics/enable', {
      method: 'POST',
      body: JSON.stringify({ appIds }),
    }),
}

export const applicationAPI = {
  getAll: () => fetchAPI('/applications'),
}

export const dynamoDBAPI = {
  listTables: () => fetchAPI('/dynamodb/tables'),
  describeTable: (name) => fetchAPI(`/dynamodb/tables/${encodeURIComponent(name)}`),
  getItems: (name, params = {}) => {
    const searchParams = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
    const query = searchParams.toString()
    return fetchAPI(`/dynamodb/tables/${encodeURIComponent(name)}/items${query ? `?${query}` : ''}`)
  },
}

export default fetchAPI
