// App Store Connect character limits, keyed by scope then field.
// Shared by the /api/appstore/metadata/count route and the MCP server in mcp/.
export const METADATA_LIMITS = {
  app: {
    name: { max: 30, min: 2 },
    subtitle: { max: 30 },
    keywords: { max: 100 },
    promotionalText: { max: 170 },
    description: { max: 4000 },
    whatsNew: { max: 4000 },
    supportUrl: { max: 255 },
    marketingUrl: { max: 255 },
  },
  subscription: {
    name: { max: 30 },
    description: { max: 45 },
  },
  subscriptionGroup: {
    name: { max: 75 },
    customAppName: { max: 30 },
  },
  appClip: {
    subtitle: { max: 56 },
  },
}

// App Store Connect counts characters, not bytes: "日本語" is 3 and an emoji is 1.
export function countChars(value) {
  return Array.from(String(value ?? '')).length
}

// The keyword field is sent as "a,b,c": no spaces around commas, no empty or repeated terms.
export function normalizeKeywords(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value ?? '')
  const seen = new Set()
  const terms = []

  for (const term of raw.split(/[,，、]/)) {
    const normalized = term.trim().replace(/\s+/g, ' ').toLowerCase()
    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    terms.push(normalized)
  }

  return terms.join(',')
}

function tokenize(value) {
  return String(value ?? '')
    .toLowerCase()
    .split(/[\s,，、]+/)
    .filter(Boolean)
}

function getKeywordWarnings(keywords, fields) {
  const warnings = []
  const tokens = tokenize(keywords)

  const repeated = [...new Set(tokens.filter((token, index) => tokens.indexOf(token) !== index))]
  if (repeated.length > 0) {
    warnings.push(`Words repeated inside keywords: ${repeated.join(', ')}`)
  }

  const indexedElsewhere = new Set([...tokenize(fields.name), ...tokenize(fields.subtitle)])
  const wasted = [...new Set(tokens.filter((token) => indexedElsewhere.has(token)))]
  if (wasted.length > 0) {
    warnings.push(`Words already indexed from name/subtitle: ${wasted.join(', ')}`)
  }

  return warnings
}

export function checkField(scope, field, value, fields = {}) {
  const limit = METADATA_LIMITS[scope]?.[field]
  if (!limit) {
    return null
  }

  const isKeywords = scope === 'app' && field === 'keywords'
  const text = isKeywords ? normalizeKeywords(value) : String(value ?? '')
  const count = countChars(text)
  const result = {
    count,
    max: limit.max,
    remaining: limit.max - count,
    ok: count <= limit.max && (count === 0 || count >= (limit.min || 0)),
  }

  if (limit.min) {
    result.min = limit.min
  }

  if (isKeywords) {
    result.value = text
    result.warnings = getKeywordWarnings(text, fields)
  }

  return result
}

// fields: { name: '...', keywords: '...' } -> { ok, fields: { name: { count, max, remaining, ok }, ... }, unknownFields }
export function checkMetadata(fields = {}, scope = 'app') {
  if (!METADATA_LIMITS[scope]) {
    throw new Error(`Unknown scope "${scope}". Use one of: ${Object.keys(METADATA_LIMITS).join(', ')}`)
  }

  const checked = {}
  const unknownFields = []

  for (const [field, value] of Object.entries(fields || {})) {
    const result = checkField(scope, field, value, fields)
    if (result) {
      checked[field] = result
    } else {
      unknownFields.push(field)
    }
  }

  return {
    scope,
    ok: Object.values(checked).every((result) => result.ok),
    fields: checked,
    unknownFields,
  }
}

// Human-readable list of the fields that break their limit, for error messages.
export function describeViolations(check) {
  return Object.entries(check.fields)
    .filter(([, result]) => !result.ok)
    .map(([field, result]) =>
      result.remaining < 0
        ? `${field} is ${result.count}/${result.max} (${-result.remaining} over)`
        : `${field} is ${result.count} chars, minimum is ${result.min}`
    )
}
