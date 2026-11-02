#!/usr/bin/env node
// Stdio MCP server that reads an Apple Ads account straight from Apple: Campaign Management API v5,
// plus change history from the Apple Ads Platform API v1 (v5 has no audit endpoint).
// Writes spend real money, so each one changes a single item and runs only on a second call carrying
// the token from its preview. APPLE_ADS_READ_ONLY=1 in .env hides the write tools.
// Registered in .mcp.json; run by hand with: node mcp/apple-ads.mjs
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import jwt from 'jsonwebtoken'

// stdout carries the JSON-RPC stream, so nothing else may write to it.
console.log = console.error

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
dotenv.config({ path: path.join(root, '.env'), quiet: true })

const env = process.env
const V5_BASE = `${env.API_BASE_URL || 'https://api.searchads.apple.com/api'}/${env.API_VERSION || 'v5'}`
const V1_BASE = 'https://api.ads.apple.com/v1'

let accessToken = null
let accessTokenExpiry = 0

async function getAccessToken() {
  if (accessToken && accessTokenExpiry > Date.now() + 5 * 60 * 1000) {
    return accessToken
  }

  const missing = ['CLIENT_ID', 'TEAM_ID', 'KEY_ID', 'PRIVATE_KEY_PATH'].filter((key) => !env[key])
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')} in ${path.join(root, '.env')}. See mcp/README-apple-ads.md for setup.`)
  }

  const keyPath = path.resolve(env.PRIVATE_KEY_PATH)
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Private key file not found: ${keyPath}`)
  }

  const now = Math.floor(Date.now() / 1000)
  const clientSecret = jwt.sign(
    { sub: env.CLIENT_ID, aud: 'https://appleid.apple.com', iat: now, exp: now + 60 * 60, iss: env.TEAM_ID },
    fs.readFileSync(keyPath, 'utf8'),
    { algorithm: 'ES256', header: { alg: 'ES256', kid: env.KEY_ID } },
  )

  const response = await fetch('https://appleid.apple.com/auth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.CLIENT_ID, client_secret: clientSecret, scope: 'searchadsorg' }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) {
    throw new Error(`OAuth token request failed: ${response.status} ${JSON.stringify(data)}`)
  }

  accessToken = data.access_token
  accessTokenExpiry = Date.now() + Number(data.expires_in || 3600) * 1000
  return accessToken
}

async function request(base, method, endpoint, { body, context } = {}) {
  const headers = { Authorization: `Bearer ${await getAccessToken()}`, 'Content-Type': 'application/json' }
  if (context) {
    headers['X-AP-Context'] = context
  }

  const response = await fetch(`${base}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }

  if (!response.ok) {
    throw new Error(`Apple Ads API ${method} ${endpoint} failed: ${response.status} ${JSON.stringify(data.error || data)}`)
  }

  return data
}

let aclCache = null

async function listAcls() {
  aclCache ??= (await request(V5_BASE, 'GET', '/acls')).data
  return aclCache
}

// Explicit argument, then ORG_ID in .env, then the only org. Never guess between several orgs.
async function resolveOrgId(orgId) {
  if (orgId) {
    return String(orgId)
  }

  if (env.ORG_ID) {
    return env.ORG_ID
  }

  const acls = await listAcls()
  if (acls.length === 1) {
    return String(acls[0].orgId)
  }

  throw new Error(`orgId is required: this API user can reach ${acls.length} orgs (${acls.map((acl) => `${acl.orgId} ${acl.orgName}`).join(', ')}). Pass orgId, or set ORG_ID in .env.`)
}

async function v5(method, endpoint, orgId, body) {
  return request(V5_BASE, method, endpoint, { body, context: `orgId=${await resolveOrgId(orgId)}` })
}

function page(limit, offset) {
  return `limit=${Math.min(Number(limit) || 1000, 1000)}&offset=${Number(offset) || 0}`
}

function listResult(response) {
  return { data: response.data, pagination: response.pagination }
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10)
}

const orgIdSchema = { type: ['string', 'number'], description: 'Apple Ads org (campaign group) id. Required when the API user reaches more than one org and ORG_ID is not set; see list_orgs.' }
const campaignIdSchema = { type: ['string', 'number'] }
const adGroupIdSchema = { type: ['string', 'number'] }
const limitSchema = { type: 'number', description: 'Page size, max 1000. Default 1000.' }
const offsetSchema = { type: 'number', description: 'Default 0.' }

const REPORT_LEVELS = ['campaigns', 'adgroups', 'keywords', 'searchterms', 'ads']
const CHANGE_ENTITY_TYPES = ['Campaign', 'AdGroup', 'Keyword', 'NegativeKeyword', 'Ad', 'Creative']

function reportEndpoint(level, campaignId, adGroupId) {
  if (level === 'campaigns') {
    return '/reports/campaigns'
  }

  if (!campaignId) {
    throw new Error(`campaignId is required for ${level} reports`)
  }

  if (level === 'adgroups') {
    return `/reports/campaigns/${campaignId}/adgroups`
  }

  if (level === 'ads') {
    return `/reports/campaigns/${campaignId}/ads`
  }

  return adGroupId ? `/reports/campaigns/${campaignId}/adgroups/${adGroupId}/${level}` : `/reports/campaigns/${campaignId}/${level}`
}

const tools = [
  {
    name: 'list_orgs',
    description: 'List the Apple Ads orgs (campaign groups) this API user can reach, with orgId, name, currency, payment model, time zone and roles. Call first to pick an orgId.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const me = await request(V5_BASE, 'GET', '/me').catch(() => null)
      return { me: me?.data ?? null, orgs: await listAcls() }
    },
  },
  {
    name: 'list_campaigns',
    description: 'List campaigns in an org: id, name, status, servingStatus, adamId, budget/dailyBudget, countriesOrRegions, supplySources, billingEvent and more.',
    inputSchema: { type: 'object', properties: { orgId: orgIdSchema, limit: limitSchema, offset: offsetSchema } },
    async handler({ orgId, limit, offset }) {
      return listResult(await v5('GET', `/campaigns?${page(limit, offset)}`, orgId))
    },
  },
  {
    name: 'get_campaign',
    description: 'Get one campaign by id.',
    inputSchema: { type: 'object', properties: { orgId: orgIdSchema, campaignId: campaignIdSchema }, required: ['campaignId'] },
    async handler({ orgId, campaignId }) {
      return (await v5('GET', `/campaigns/${campaignId}`, orgId)).data
    },
  },
  {
    name: 'list_ad_groups',
    description: 'List ad groups in a campaign: id, name, status, servingStatus, defaultBidAmount, cpaGoal, automatedKeywordsOptIn (search match), targetingDimensions, pricingModel.',
    inputSchema: { type: 'object', properties: { orgId: orgIdSchema, campaignId: campaignIdSchema, limit: limitSchema, offset: offsetSchema }, required: ['campaignId'] },
    async handler({ orgId, campaignId, limit, offset }) {
      return listResult(await v5('GET', `/campaigns/${campaignId}/adgroups?${page(limit, offset)}`, orgId))
    },
  },
  {
    name: 'get_ad_group',
    description: 'Get one ad group by id.',
    inputSchema: { type: 'object', properties: { orgId: orgIdSchema, campaignId: campaignIdSchema, adGroupId: adGroupIdSchema }, required: ['campaignId', 'adGroupId'] },
    async handler({ orgId, campaignId, adGroupId }) {
      return (await v5('GET', `/campaigns/${campaignId}/adgroups/${adGroupId}`, orgId)).data
    },
  },
  {
    name: 'list_keywords',
    description: 'List targeting keywords of an ad group: id, text, matchType, status, bidAmount. No metrics; use get_report with level keywords for performance.',
    inputSchema: { type: 'object', properties: { orgId: orgIdSchema, campaignId: campaignIdSchema, adGroupId: adGroupIdSchema, limit: limitSchema, offset: offsetSchema }, required: ['campaignId', 'adGroupId'] },
    async handler({ orgId, campaignId, adGroupId, limit, offset }) {
      return listResult(await v5('GET', `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords?${page(limit, offset)}`, orgId))
    },
  },
  {
    name: 'list_negative_keywords',
    description: 'List negative keywords. Without adGroupId returns campaign-level negatives; with adGroupId returns that ad group\'s negatives.',
    inputSchema: { type: 'object', properties: { orgId: orgIdSchema, campaignId: campaignIdSchema, adGroupId: adGroupIdSchema, limit: limitSchema, offset: offsetSchema }, required: ['campaignId'] },
    async handler({ orgId, campaignId, adGroupId, limit, offset }) {
      const scope = adGroupId ? `/campaigns/${campaignId}/adgroups/${adGroupId}` : `/campaigns/${campaignId}`
      return listResult(await v5('GET', `${scope}/negativekeywords?${page(limit, offset)}`, orgId))
    },
  },
  {
    name: 'list_ads',
    description: 'List ads of an ad group (default product page or Custom Product Page creatives): id, name, creativeId, creativeType, status, servingStatus.',
    inputSchema: { type: 'object', properties: { orgId: orgIdSchema, campaignId: campaignIdSchema, adGroupId: adGroupIdSchema, limit: limitSchema, offset: offsetSchema }, required: ['campaignId', 'adGroupId'] },
    async handler({ orgId, campaignId, adGroupId, limit, offset }) {
      return listResult(await v5('GET', `/campaigns/${campaignId}/adgroups/${adGroupId}/ads?${page(limit, offset)}`, orgId))
    },
  },
  {
    name: 'get_report',
    description:
      'Performance report (impressions, taps, installs, spend, avg CPT/CPA, TTR, CR, ...) at campaign, ad group, keyword, search term or ad level. Spend is in the org currency. keywords/searchterms take an optional adGroupId to narrow to one ad group. Dates are in the org time zone (ORTZ) by default, inclusive. Rows come back with metadata, total (when no granularity) and granularity buckets (when granularity is set).',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: orgIdSchema,
        level: { type: 'string', enum: REPORT_LEVELS },
        campaignId: { ...campaignIdSchema, description: 'Required for every level except campaigns.' },
        adGroupId: { ...adGroupIdSchema, description: 'Optional for keywords and searchterms.' },
        startDate: { type: 'string', description: 'YYYY-MM-DD. Default: 7 days ago.' },
        endDate: { type: 'string', description: 'YYYY-MM-DD. Default: today.' },
        granularity: { type: 'string', enum: ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'], description: 'Omit for one total per row.' },
        groupBy: { type: 'array', items: { type: 'string' }, description: 'e.g. ["countryOrRegion"], ["deviceClass"], ["ageRange"], ["gender"], ["adminArea"], ["locality"].' },
        timeZone: { type: 'string', enum: ['ORTZ', 'UTC'], description: 'Default ORTZ (org time zone, matches the Apple Ads UI).' },
        orderBy: { type: 'string', description: 'Metric to sort by, descending. Default localSpend.' },
        conditions: { type: 'array', items: { type: 'object' }, description: 'Raw selector conditions, e.g. [{"field":"countryOrRegion","operator":"IN","values":["US"]}].' },
        returnRecordsWithNoMetrics: { type: 'boolean', description: 'Include rows with no activity. Default false.' },
        limit: limitSchema,
        offset: offsetSchema,
      },
      required: ['level'],
    },
    async handler({ orgId, level, campaignId, adGroupId, startDate, endDate, granularity, groupBy, timeZone = 'ORTZ', orderBy = 'localSpend', conditions, returnRecordsWithNoMetrics = false, limit, offset }) {
      if (!REPORT_LEVELS.includes(level)) {
        throw new Error(`level must be one of ${REPORT_LEVELS.join(', ')}`)
      }

      const body = {
        startTime: startDate || isoDaysAgo(7),
        endTime: endDate || isoDaysAgo(0),
        timeZone,
        selector: {
          orderBy: [{ field: orderBy, sortOrder: 'DESCENDING' }],
          ...(conditions ? { conditions } : {}),
          pagination: { offset: Number(offset) || 0, limit: Math.min(Number(limit) || 1000, 1000) },
        },
        returnRecordsWithNoMetrics,
        returnRowTotals: !granularity,
        returnGrandTotals: !granularity,
        ...(granularity ? { granularity } : {}),
        ...(groupBy?.length ? { groupBy } : {}),
      }

      const response = await v5('POST', reportEndpoint(level, campaignId, adGroupId), orgId, body)
      const report = response.data?.reportingDataResponse ?? {}
      return { request: body, rows: report.row ?? [], grandTotals: report.grandTotals ?? null, pagination: response.pagination }
    },
  },
  {
    name: 'query_change_history',
    description:
      'Who changed what and when (create/update/delete on campaigns, ad groups, keywords, negatives, ads, creatives), from the Apple Ads Platform API change history. Max lookback 6 months. Rows are grouped per transaction; each metas entry has a detailId to pass to get_change_detail for field-level before/after values.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { ...orgIdSchema, description: 'The v5 orgId, sent as the Platform API adAccountId.' },
        startDate: { type: 'string', description: 'YYYY-MM-DD. Default: 30 days ago.' },
        endDate: { type: 'string', description: 'YYYY-MM-DD. Default: today.' },
        entityTypes: { type: 'array', items: { type: 'string' }, description: `Default: ${CHANGE_ENTITY_TYPES.join(', ')}.` },
        eventTypes: { type: 'array', items: { type: 'string', enum: ['CREATE', 'UPDATE', 'DELETE'] } },
        userTypes: { type: 'array', items: { type: 'string', enum: ['CUSTOMER', 'CUSTOMER_API', 'APPLE_SUPPORT'] } },
        campaignId: campaignIdSchema,
        adGroupId: adGroupIdSchema,
        entityId: { type: ['string', 'number'] },
        limit: { type: 'number', description: 'Page size. Default 100.' },
        offset: offsetSchema,
      },
    },
    async handler({ orgId, startDate, endDate, entityTypes, eventTypes, userTypes, campaignId, adGroupId, entityId, limit, offset }) {
      const filters = [{ field: 'eventTime', operator: 'BETWEEN', value: [startDate || isoDaysAgo(30), endDate || isoDaysAgo(-1)] }]
      const addIn = (field, values) => values?.length && filters.push({ field, operator: 'IN', value: values.map(String) })
      const addEquals = (field, value) => value && filters.push({ field, operator: 'EQUALS', value: String(value) })
      // The API rejects queries without an entityType filter, despite the docs calling it optional.
      addIn('entityType', entityTypes?.length ? entityTypes : CHANGE_ENTITY_TYPES)
      addIn('eventType', eventTypes)
      addIn('userType', userTypes)
      addEquals('campaignId', campaignId)
      addEquals('adGroupId', adGroupId)
      addEquals('entityId', entityId)

      const body = {
        filters,
        sorting: [{ field: 'eventTime', order: 'DESC' }],
        pagination: { offset: Number(offset) || 0, pageSize: Number(limit) || 100 },
        options: { timeZone: 'ORTZ', metadata: 'latest' },
      }
      const response = await request(V1_BASE, 'POST', '/change-history/query', { body, context: `adAccountId=${await resolveOrgId(orgId)}` })
      return { result: response.result, pagination: response.pagination }
    },
  },
  {
    name: 'get_change_detail',
    description: 'Field-level before/after values for one change, by a detailId from query_change_history metas.',
    inputSchema: { type: 'object', properties: { orgId: orgIdSchema, detailId: { type: 'string' } }, required: ['detailId'] },
    async handler({ orgId, detailId }) {
      return (await request(V1_BASE, 'GET', `/change-history/${encodeURIComponent(detailId)}`, { context: `adAccountId=${await resolveOrgId(orgId)}` })).result
    },
  },
  {
    name: 'api_get',
    description:
      'Read-only escape hatch: GET any Campaign Management API v5 path not covered above, e.g. /creatives, /apps/{adamId}/product-pages, /campaigns/{id}/adgroups/{id}/targetingkeywords/{id}, /search/apps?query=... . Only GET is allowed.',
    inputSchema: { type: 'object', properties: { orgId: orgIdSchema, path: { type: 'string', description: 'Path after /api/v5, starting with /. May include a query string.' } }, required: ['path'] },
    async handler({ orgId, path: endpoint }) {
      if (!endpoint?.startsWith('/')) {
        throw new Error('path must start with /')
      }

      return v5('GET', endpoint, orgId)
    },
  },
]

const CONFIRM_TTL_MS = 10 * 60 * 1000
const pendingWrites = new Map()

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function money(amount, currency) {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`amount must be a positive number, got ${amount}`)
  }

  return { amount: value.toFixed(2), currency }
}

function ratioWarning(label, from, to) {
  const before = Number(from)
  const after = Number(to)
  return before > 0 && after > before * 2 ? [`${label} more than doubles (${before} -> ${after}).`] : []
}

// plan() only reads. It returns what would change and an execute() that performs it. The first call
// returns the preview and a token bound to the exact arguments and the entity state it was built from;
// the second call with that token re-plans, refuses if anything moved, then executes once.
function writeTool({ name, description, properties, required = [], plan }) {
  return {
    name,
    write: true,
    description: `WRITE, spends real money. ${description} Call without confirmToken to get a preview; show it to the user and wait for their explicit yes; then call again with the same arguments plus confirmToken.`,
    inputSchema: {
      type: 'object',
      properties: { orgId: orgIdSchema, ...properties, confirmToken: { type: 'string', description: 'From the preview call. Only pass it after the user approved that exact preview.' } },
      required,
    },
    async handler({ confirmToken, ...args }) {
      const orgId = await resolveOrgId(args.orgId)
      const planned = await plan({ ...args, orgId })
      const preview = { action: name, orgId, target: planned.target, before: planned.before, after: planned.after, warnings: planned.warnings ?? [] }
      const argsHash = fingerprint({ name, args: { ...args, orgId } })
      const stateHash = fingerprint(planned.before)

      if (!confirmToken) {
        for (const [token, entry] of pendingWrites) {
          if (entry.expiresAt < Date.now()) {
            pendingWrites.delete(token)
          }
        }

        const token = crypto.randomBytes(9).toString('base64url')
        pendingWrites.set(token, { argsHash, stateHash, expiresAt: Date.now() + CONFIRM_TTL_MS })
        return {
          status: 'PREVIEW_ONLY_NOTHING_CHANGED',
          preview,
          confirmToken: token,
          expiresInMinutes: CONFIRM_TTL_MS / 60000,
          next: 'Show this preview to the user. Only after they explicitly approve it, call the same tool again with identical arguments plus confirmToken.',
        }
      }

      const entry = pendingWrites.get(confirmToken)
      pendingWrites.delete(confirmToken)
      if (!entry || entry.expiresAt < Date.now()) {
        throw new Error('confirmToken is unknown, used or expired. Nothing was changed. Call again without confirmToken for a fresh preview.')
      }

      if (entry.argsHash !== argsHash) {
        throw new Error('Arguments differ from the previewed ones. Nothing was changed. Get a fresh preview and approval.')
      }

      if (entry.stateHash !== stateHash) {
        throw new Error(`The entity changed since the preview. Nothing was changed. Current state: ${JSON.stringify(planned.before)}`)
      }

      return { status: 'DONE', preview, result: await planned.execute() }
    },
  }
}

async function getKeyword(orgId, campaignId, adGroupId, keywordId) {
  return (await v5('GET', `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/${keywordId}`, orgId)).data
}

async function getAdGroup(orgId, campaignId, adGroupId) {
  return (await v5('GET', `/campaigns/${campaignId}/adgroups/${adGroupId}`, orgId)).data
}

async function getCampaign(orgId, campaignId) {
  return (await v5('GET', `/campaigns/${campaignId}`, orgId)).data
}

async function listAll(orgId, endpoint) {
  const items = []
  for (let offset = 0; ; offset += 1000) {
    const response = await v5('GET', `${endpoint}?limit=1000&offset=${offset}`, orgId)
    items.push(...response.data)
    if (response.data.length < 1000) {
      return items
    }
  }
}

function sameText(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

const writeTools = [
  writeTool({
    name: 'set_campaign_status',
    description: 'Pause or enable one campaign.',
    properties: { campaignId: campaignIdSchema, status: { type: 'string', enum: ['ENABLED', 'PAUSED'] } },
    required: ['campaignId', 'status'],
    async plan({ orgId, campaignId, status }) {
      const campaign = await getCampaign(orgId, campaignId)
      return {
        target: { campaignId: campaign.id, name: campaign.name },
        before: { status: campaign.status },
        after: { status },
        warnings: campaign.status === status ? [`Campaign is already ${status}.`] : [],
        execute: async () => (await v5('PUT', `/campaigns/${campaignId}`, orgId, { campaign: { status } })).data,
      }
    },
  }),
  writeTool({
    name: 'set_campaign_daily_budget',
    description: 'Change the daily budget of one campaign, in the org currency.',
    properties: { campaignId: campaignIdSchema, amount: { type: 'number', description: 'New daily budget, e.g. 100 for 100.00 RMB.' } },
    required: ['campaignId', 'amount'],
    async plan({ orgId, campaignId, amount }) {
      const campaign = await getCampaign(orgId, campaignId)
      const current = campaign.dailyBudgetAmount
      const next = money(amount, current?.currency)
      return {
        target: { campaignId: campaign.id, name: campaign.name },
        before: { dailyBudgetAmount: current },
        after: { dailyBudgetAmount: next },
        warnings: ratioWarning('Daily budget', current?.amount, next.amount),
        execute: async () => (await v5('PUT', `/campaigns/${campaignId}`, orgId, { campaign: { dailyBudgetAmount: next } })).data,
      }
    },
  }),
  writeTool({
    name: 'set_ad_group_status',
    description: 'Pause or enable one ad group.',
    properties: { campaignId: campaignIdSchema, adGroupId: adGroupIdSchema, status: { type: 'string', enum: ['ENABLED', 'PAUSED'] } },
    required: ['campaignId', 'adGroupId', 'status'],
    async plan({ orgId, campaignId, adGroupId, status }) {
      const adGroup = await getAdGroup(orgId, campaignId, adGroupId)
      return {
        target: { campaignId: adGroup.campaignId, adGroupId: adGroup.id, name: adGroup.name },
        before: { status: adGroup.status },
        after: { status },
        warnings: adGroup.status === status ? [`Ad group is already ${status}.`] : [],
        execute: async () => (await v5('PUT', `/campaigns/${campaignId}/adgroups/${adGroupId}`, orgId, { status })).data,
      }
    },
  }),
  writeTool({
    name: 'set_ad_group_default_bid',
    description: 'Change the default max CPT bid of one ad group (applies to keywords without their own bid and to search match).',
    properties: { campaignId: campaignIdSchema, adGroupId: adGroupIdSchema, amount: { type: 'number' } },
    required: ['campaignId', 'adGroupId', 'amount'],
    async plan({ orgId, campaignId, adGroupId, amount }) {
      const adGroup = await getAdGroup(orgId, campaignId, adGroupId)
      const next = money(amount, adGroup.defaultBidAmount?.currency)
      return {
        target: { campaignId: adGroup.campaignId, adGroupId: adGroup.id, name: adGroup.name },
        before: { defaultBidAmount: adGroup.defaultBidAmount },
        after: { defaultBidAmount: next },
        warnings: ratioWarning('Default bid', adGroup.defaultBidAmount?.amount, next.amount),
        execute: async () => (await v5('PUT', `/campaigns/${campaignId}/adgroups/${adGroupId}`, orgId, { defaultBidAmount: next })).data,
      }
    },
  }),
  writeTool({
    name: 'set_keyword_status',
    description: 'Pause or activate one targeting keyword.',
    properties: { campaignId: campaignIdSchema, adGroupId: adGroupIdSchema, keywordId: { type: ['string', 'number'] }, status: { type: 'string', enum: ['ACTIVE', 'PAUSED'] } },
    required: ['campaignId', 'adGroupId', 'keywordId', 'status'],
    async plan({ orgId, campaignId, adGroupId, keywordId, status }) {
      const keyword = await getKeyword(orgId, campaignId, adGroupId, keywordId)
      return {
        target: { campaignId: keyword.campaignId, adGroupId: keyword.adGroupId, keywordId: keyword.id, text: keyword.text, matchType: keyword.matchType },
        before: { status: keyword.status },
        after: { status },
        warnings: keyword.status === status ? [`Keyword is already ${status}.`] : [],
        execute: async () => (await v5('PUT', `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, orgId, [{ id: Number(keywordId), status }])).data,
      }
    },
  }),
  writeTool({
    name: 'set_keyword_bid',
    description: 'Change the max CPT bid of one targeting keyword.',
    properties: { campaignId: campaignIdSchema, adGroupId: adGroupIdSchema, keywordId: { type: ['string', 'number'] }, amount: { type: 'number' } },
    required: ['campaignId', 'adGroupId', 'keywordId', 'amount'],
    async plan({ orgId, campaignId, adGroupId, keywordId, amount }) {
      const keyword = await getKeyword(orgId, campaignId, adGroupId, keywordId)
      const next = money(amount, keyword.bidAmount?.currency)
      return {
        target: { campaignId: keyword.campaignId, adGroupId: keyword.adGroupId, keywordId: keyword.id, text: keyword.text, matchType: keyword.matchType },
        before: { bidAmount: keyword.bidAmount, status: keyword.status },
        after: { bidAmount: next },
        warnings: ratioWarning('Keyword bid', keyword.bidAmount?.amount, next.amount),
        execute: async () => (await v5('PUT', `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, orgId, [{ id: Number(keywordId), bidAmount: next }])).data,
      }
    },
  }),
  writeTool({
    name: 'add_keyword',
    description: 'Add one targeting keyword to an ad group. Refuses an exact duplicate (same text and match type) already in the ad group.',
    properties: {
      campaignId: campaignIdSchema,
      adGroupId: adGroupIdSchema,
      text: { type: 'string' },
      matchType: { type: 'string', enum: ['EXACT', 'BROAD'] },
      bidAmount: { type: 'number', description: 'Max CPT bid. Default: the ad group default bid.' },
      status: { type: 'string', enum: ['ACTIVE', 'PAUSED'], description: 'Default ACTIVE.' },
    },
    required: ['campaignId', 'adGroupId', 'text', 'matchType'],
    async plan({ orgId, campaignId, adGroupId, text, matchType, bidAmount, status = 'ACTIVE' }) {
      const adGroup = await getAdGroup(orgId, campaignId, adGroupId)
      const existing = await listAll(orgId, `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords`)
      const duplicate = existing.find((keyword) => !keyword.deleted && keyword.matchType === matchType && sameText(keyword.text, text))
      if (duplicate) {
        throw new Error(`Not added: "${duplicate.text}" ${matchType} already exists in this ad group (keywordId ${duplicate.id}, ${duplicate.status}).`)
      }

      const bid = bidAmount === undefined ? adGroup.defaultBidAmount : money(bidAmount, adGroup.defaultBidAmount?.currency)
      const keyword = { text: text.trim(), matchType, status, bidAmount: bid }
      return {
        target: { campaignId: adGroup.campaignId, adGroupId: adGroup.id, adGroupName: adGroup.name },
        before: { keywordCount: existing.filter((item) => !item.deleted).length },
        after: { add: keyword },
        warnings: ratioWarning('Bid vs ad group default', adGroup.defaultBidAmount?.amount, bid?.amount),
        execute: async () => (await v5('POST', `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, orgId, [keyword])).data,
      }
    },
  }),
  writeTool({
    name: 'add_negative_keyword',
    description: 'Add one negative keyword, campaign-wide (no adGroupId) or to one ad group. Refuses an exact duplicate at the same level.',
    properties: { campaignId: campaignIdSchema, adGroupId: adGroupIdSchema, text: { type: 'string' }, matchType: { type: 'string', enum: ['EXACT', 'BROAD'] } },
    required: ['campaignId', 'text', 'matchType'],
    async plan({ orgId, campaignId, adGroupId, text, matchType }) {
      const scope = adGroupId ? `/campaigns/${campaignId}/adgroups/${adGroupId}` : `/campaigns/${campaignId}`
      const [owner, existing] = await Promise.all([
        adGroupId ? getAdGroup(orgId, campaignId, adGroupId) : getCampaign(orgId, campaignId),
        listAll(orgId, `${scope}/negativekeywords`),
      ])
      const duplicate = existing.find((keyword) => !keyword.deleted && keyword.matchType === matchType && sameText(keyword.text, text))
      if (duplicate) {
        throw new Error(`Not added: negative "${duplicate.text}" ${matchType} already exists here (id ${duplicate.id}).`)
      }

      const negative = { text: text.trim(), matchType }
      return {
        target: { level: adGroupId ? 'adGroup' : 'campaign', campaignId: Number(campaignId), adGroupId: adGroupId ? Number(adGroupId) : null, name: owner.name },
        before: { negativeCount: existing.filter((item) => !item.deleted).length },
        after: { add: negative },
        warnings: matchType === 'BROAD' ? ['BROAD negatives block every search containing these words; check it cannot block converting terms.'] : [],
        execute: async () => (await v5('POST', `${scope}/negativekeywords/bulk`, orgId, [negative])).data,
      }
    },
  }),
]

if (!['1', 'true'].includes(String(env.APPLE_ADS_READ_ONLY).toLowerCase())) {
  tools.push(...writeTools)
}

async function callTool({ name, arguments: args = {} }) {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }

  try {
    const result = await tool.handler(args)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }
  }
}

async function handle(message) {
  switch (message.method) {
    case 'initialize':
      return {
        protocolVersion: message.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'apple-ads', version: '1.0.0' },
        instructions:
          'Read-only access to Apple Ads, straight from Apple. Start with list_orgs; when more than one org comes back, pass orgId on every call. Walk the structure with list_campaigns -> list_ad_groups -> list_keywords / list_negative_keywords / list_ads, and pull performance with get_report (levels campaigns, adgroups, keywords, searchterms, ads). Use query_change_history then get_change_detail to see who changed what. Money values are in the org currency. Write tools (set_*, add_*) spend real money: change one item per call, never loop writes on your own, and always show the preview to the user and get their explicit yes for that exact change before calling again with confirmToken.',
      }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }
    case 'tools/call':
      return callTool(message.params || {})
    default:
      throw Object.assign(new Error(`Method not found: ${message.method}`), { code: -32601 })
  }
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

const pending = new Set()

readline
  .createInterface({ input: process.stdin })
  .on('line', (line) => {
    if (!line.trim()) {
      return
    }

    let message
    try {
      message = JSON.parse(line)
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }

    // Notifications carry no id and get no reply.
    if (message.id === undefined || message.id === null) {
      return
    }

    const task = handle(message)
      .then((result) => send({ jsonrpc: '2.0', id: message.id, result }))
      .catch((error) => send({ jsonrpc: '2.0', id: message.id, error: { code: error.code || -32603, message: error.message } }))
      .finally(() => pending.delete(task))
    pending.add(task)
  })
  .on('close', async () => {
    await Promise.allSettled(pending)
    process.exit(0)
  })
