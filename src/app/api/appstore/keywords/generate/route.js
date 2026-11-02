import { fail, ok } from '@/lib/http'
import { generateGeminiText, getGeminiModel, hasGeminiApiKey } from '@/lib/gemini'

const DEFAULT_KEYWORD_MODEL = 'gpt-5-chat'
const DEFAULT_OPENAI_KEYWORD_MODEL = 'gpt-5.5'
const RELEVANCE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'app',
  'apps',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'your',
])
const APP_STORE_KEYWORD_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'app',
  'apps',
  'best',
  'for',
  'free',
  'iphone',
  'ipad',
  'new',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
])
const KEYWORD_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    directions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          direction: { type: 'string' },
          keywords: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['direction', 'keywords'],
      },
    },
    recommendedKeywords: {
      type: 'array',
      items: { type: 'string' },
    },
    appStoreKeywords: {
      type: 'string',
    },
  },
  required: ['directions', 'recommendedKeywords', 'appStoreKeywords'],
}

function buildAuthHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'api-key': token,
  }
}

function pickModelCandidates(configuredModel) {
  const preferredOrder = ['gpt-5-chat', 'gpt-4.1', 'gpt-4o']
  if (!configuredModel || configuredModel === 'auto') {
    return [DEFAULT_KEYWORD_MODEL, ...preferredOrder.filter((model) => model !== DEFAULT_KEYWORD_MODEL)]
  }

  return [configuredModel, ...preferredOrder.filter((model) => model !== configuredModel)]
}

function buildGenerationRequest({ appName, locale, metadata, brief }) {
  const userDirectionGuidance = brief
    ? `User direction guidance is mandatory and should noticeably change the generated directions and keyword phrases: ${brief}`
    : 'No extra user direction guidance was provided.'

  return {
    task:
      'Create keyword lists grouped by different semantic expansion directions, plus one App Store Connect keyword-field recommendation. Use only the provided local app name, subtitle, and description as primary evidence. Direction examples: plain-language explanation, problem the app solves, user goal, feature meaning, benefit wording, broader category, narrower specific use case, alternative phrasing, related action, outcome/result. Do not make directions about competitors. If userDirectionGuidance is provided, make it the strongest steering signal after the app metadata: adapt direction names and keyword phrases to it. Reject unrelated generic phrases. Direction keywords and recommendedKeywords must be directly supported by or clearly inferable from the app metadata. Direction keywords and recommendedKeywords must be 2 to 5 words, never 1 word, and useful for App Store rank tracking. appStoreKeywords must follow App Store Connect keyword-field best practices: a comma-separated string under 100 characters, no spaces after commas, no duplicate words, avoid words already present in the app name or subtitle, avoid generic filler words such as app/free/best/new, avoid category names unless they are unusually specific, and do not include competitor brands.',
    outputShape: {
      directions: [{ direction: '', keywords: [''] }],
      recommendedKeywords: [''],
      appStoreKeywords: '',
    },
    userDirectionGuidance,
    appName,
    locale,
    metadata,
  }
}

function buildSystemPrompt() {
  return 'You are an App Store Optimization strategist. Generate semantic keyword expansion directions from app metadata. A direction is a different way to explain, rephrase, broaden, or specify the app meaning. Do not include brand names from competing apps. Direction keywords must be directly relevant searchable phrases of 2 to 5 words and must not contain commas. Also produce appStoreKeywords for the App Store Connect keyword field: comma-separated, no spaces after commas, 100 characters or fewer, no repeated words, no words already used in the app name or subtitle, and no generic filler words such as app/free/best/new.'
}

function extractJsonObject(text) {
  const value = String(text || '').trim()
  if (!value) {
    throw new Error('Keyword generation returned an empty response')
  }

  try {
    return JSON.parse(value)
  } catch {
    const jsonMatch = value.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Keyword generation returned non-JSON content')
    }

    return JSON.parse(jsonMatch[0])
  }
}

function normalizeKeyword(keyword) {
  return String(keyword || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/,+/g, ' ')
    .toLowerCase()
}

function countKeywordWords(keyword) {
  return String(keyword || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

function trimForPrompt(value, maxLength = 1800) {
  const text = String(value || '').trim()
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trim()}...`
}

function normalizeMetadata(metadata = {}) {
  const selectedLocale = metadata?.selectedLocale || metadata || {}

  return {
    name: selectedLocale?.name || metadata?.name || '',
    subtitle: selectedLocale?.subtitle || metadata?.subtitle || '',
    description: trimForPrompt(selectedLocale?.description || metadata?.description || ''),
  }
}

function getMeaningTokens(value) {
  return Array.from(
    new Set(
      String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !RELEVANCE_STOPWORDS.has(token))
    )
  )
}

function getAppStoreKeywordTokens(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s,;]+/g, ' ')
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function normalizeAppStoreKeywords(value, metadata = {}, fallbackKeywords = []) {
  const candidates = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\n,;]+/)
        .map((keyword) => keyword.trim())
        .filter(Boolean)

  const sourceCandidates = candidates.length > 0 ? candidates : fallbackKeywords
  const existingMetadataTokens = new Set(getAppStoreKeywordTokens([metadata.name, metadata.subtitle].filter(Boolean).join(' ')))
  const seenTokens = new Set()
  const outputTokens = []

  for (const candidate of sourceCandidates) {
    for (const token of getAppStoreKeywordTokens(candidate)) {
      if (token.length < 2 || APP_STORE_KEYWORD_STOPWORDS.has(token) || existingMetadataTokens.has(token) || seenTokens.has(token)) {
        continue
      }

      const nextOutput = [...outputTokens, token].join(',')
      if (Array.from(nextOutput).length > 100) {
        return outputTokens.join(',')
      }

      seenTokens.add(token)
      outputTokens.push(token)
    }
  }

  return outputTokens.join(',')
}

function buildRelevanceTokens(metadata = {}, brief = '') {
  return new Set(getMeaningTokens([metadata.name, metadata.subtitle, metadata.description, brief].filter(Boolean).join(' ')))
}

function isRelevantKeyword(keyword, relevanceTokens) {
  if (relevanceTokens.size === 0) {
    return true
  }

  const keywordTokens = getMeaningTokens(keyword)
  if (keywordTokens.length === 0) {
    return false
  }

  return keywordTokens.some((token) => {
    if (relevanceTokens.has(token)) {
      return true
    }

    return Array.from(relevanceTokens).some((relevanceToken) => token.includes(relevanceToken) || relevanceToken.includes(token))
  })
}

function normalizeDirections(rawDirections, relevanceTokens) {
  const directions = Array.isArray(rawDirections) ? rawDirections : []
  const seen = new Set()

  return directions
    .map((direction) => {
      const keywords = Array.isArray(direction?.keywords) ? direction.keywords : []
      const normalizedKeywords = []

      for (const keyword of keywords) {
        const normalized = normalizeKeyword(keyword)
        const wordCount = countKeywordWords(normalized)
        if (!normalized || wordCount < 2 || wordCount > 5 || seen.has(normalized) || !isRelevantKeyword(normalized, relevanceTokens)) {
          continue
        }

        seen.add(normalized)
        normalizedKeywords.push(normalized)
      }

      return {
        direction: String(direction?.direction || 'Keyword Direction').trim(),
        keywords: normalizedKeywords.slice(0, 18),
      }
    })
    .filter((direction) => direction.keywords.length > 0)
    .slice(0, 8)
}

function normalizeGeneratedPayload(payload, metadata, brief) {
  const relevanceTokens = buildRelevanceTokens(metadata, brief)
  const directions = normalizeDirections(payload?.directions, relevanceTokens)
  const recommendedKeywords = normalizeDirections([{ keywords: payload?.recommendedKeywords || [] }], relevanceTokens)[0]?.keywords || []
  const appStoreKeywords = normalizeAppStoreKeywords(payload?.appStoreKeywords, metadata, recommendedKeywords)

  if (directions.length === 0) {
    throw new Error('Keyword generation did not return any usable keywords')
  }

  return { directions, recommendedKeywords, appStoreKeywords }
}

function extractOpenAIText(data) {
  if (data?.output_text) {
    return data.output_text
  }

  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content?.text) {
        return content.text
      }
    }
  }

  return ''
}

async function generateWithOpenAI({ appName, locale, metadata, brief }) {
  const token = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_KEYWORD_MODEL || DEFAULT_OPENAI_KEYWORD_MODEL

  if (!token) {
    throw new Error('Missing OpenAI API key. Set OPENAI_API_KEY.')
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      instructions: buildSystemPrompt(),
      input: JSON.stringify(buildGenerationRequest({ appName, locale, metadata, brief })),
      text: {
        format: {
          type: 'json_schema',
          name: 'keyword_generation',
          strict: true,
          schema: KEYWORD_RESPONSE_SCHEMA,
        },
      },
    }),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`OpenAI keyword generation failed with ${model}: ${response.status} ${data?.error?.message || ''}`.trim())
  }

  const parsed = extractJsonObject(extractOpenAIText(data))
  const normalized = normalizeGeneratedPayload(parsed, metadata, brief)

  return {
    ...normalized,
    meta: {
      model,
      source: 'OpenAI',
    },
  }
}

async function generateWithGemini({ appName, locale, metadata, brief }) {
  const model = getGeminiModel('GEMINI_KEYWORD_MODEL')
  const text = await generateGeminiText({
    model,
    contents: JSON.stringify(buildGenerationRequest({ appName, locale, metadata, brief })),
    config: {
      systemInstruction: buildSystemPrompt(),
      temperature: 0.65,
      responseFormat: {
        text: {
          mimeType: 'application/json',
          schema: KEYWORD_RESPONSE_SCHEMA,
        },
      },
    },
  })
  const parsed = extractJsonObject(text)
  const normalized = normalizeGeneratedPayload(parsed, metadata, brief)

  return {
    ...normalized,
    meta: {
      model,
      source: 'Gemini',
    },
  }
}

async function generateWithGitHubModels({ appName, locale, metadata, brief }) {
  const token = process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN
  const configuredModel = process.env.GITHUB_MODELS_MODEL || DEFAULT_KEYWORD_MODEL

  if (!token) {
    throw new Error('Missing GitHub models token. Set GITHUB_MODELS_TOKEN or GITHUB_TOKEN.')
  }

  let lastError = null
  for (const model of pickModelCandidates(configuredModel)) {
    const response = await fetch('https://models.inference.ai.azure.com/chat/completions', {
      method: 'POST',
      headers: buildAuthHeaders(token),
      body: JSON.stringify({
        model,
        temperature: 0.65,
        messages: [
          {
            role: 'system',
            content: `${buildSystemPrompt()} Return only valid JSON.`,
          },
          {
            role: 'user',
            content: JSON.stringify(buildGenerationRequest({ appName, locale, metadata, brief })),
          },
        ],
      }),
    })

    const data = await response.json().catch(() => null)
    if (response.ok) {
      const content = data?.choices?.[0]?.message?.content
      const parsed = extractJsonObject(content)
      const normalized = normalizeGeneratedPayload(parsed, metadata, brief)

      return {
        ...normalized,
        meta: {
          model,
          source: 'GitHub Models',
        },
      }
    }

    if (response.status === 429) {
      lastError = new Error(`Keyword generation is temporarily rate-limited by GitHub Models (${model}).`)
      continue
    }

    lastError = new Error(`Keyword generation failed with ${model}: ${response.status}`)
  }

  throw lastError || new Error('Keyword generation failed')
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { appName = '', locale = 'en-US', metadata = {}, brief = '' } = body || {}

    const requestPayload = {
      appName: String(appName || '').trim(),
      locale: String(locale || 'en-US').trim() || 'en-US',
      metadata: normalizeMetadata(metadata),
      brief: String(brief || '').trim(),
    }

    let result
    if (hasGeminiApiKey()) {
      result = await generateWithGemini(requestPayload)
    } else if (process.env.OPENAI_API_KEY) {
      result = await generateWithOpenAI(requestPayload)
    } else {
      result = await generateWithGitHubModels(requestPayload)
    }

    return ok(result)
  } catch (error) {
    return fail(error)
  }
}
