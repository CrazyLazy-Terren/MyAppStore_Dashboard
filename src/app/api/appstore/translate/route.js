import { ok, fail } from '@/lib/http'

let translationQueue = Promise.resolve()
const DEFAULT_TRANSLATION_MODEL = 'gpt-5-chat'

function logTranslation(event, details = {}) {
  console.log(`[translate-api] ${event}`, {
    at: new Date().toISOString(),
    ...details,
  })
}

function normalizeLocale(locale) {
  return String(locale || '')
    .trim()
    .replace(/_/g, '-')
    .toLowerCase()
}

function getLocaleDescription(locale) {
  const normalizedLocale = String(locale || '')
    .trim()
    .replace(/_/g, '-')
  if (!normalizedLocale) {
    return ''
  }

  const [languageCode] = normalizedLocale.split('-')
  const scriptCode = normalizedLocale.split('-').find((part) => /^[A-Za-z]{4}$/.test(part)) || ''
  const regionCode = normalizedLocale.split('-').find((part) => /^[A-Za-z]{2}$/.test(part) && part.toLowerCase() !== languageCode.toLowerCase())

  try {
    const languageDisplayName = new Intl.DisplayNames(['en'], { type: 'language' })
    const scriptDisplayName = new Intl.DisplayNames(['en'], { type: 'script' })
    const regionDisplayName = new Intl.DisplayNames(['en'], { type: 'region' })
    const languageName = languageDisplayName.of(languageCode) || languageCode
    const scriptName = scriptCode ? scriptDisplayName.of(scriptCode) || scriptCode : ''
    const regionName = regionCode ? regionDisplayName.of(regionCode.toUpperCase()) || regionCode.toUpperCase() : ''

    const details = [scriptName, regionName].filter(Boolean).join(', ')
    return details ? `${languageName} (${details})` : languageName
  } catch {
    return normalizedLocale
  }
}

function buildAuthHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'api-key': token,
  }
}

function getEffectiveMaxChars(maxChars, strictLessThan) {
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    return null
  }

  const effectiveMaxChars = strictLessThan ? maxChars - 1 : maxChars
  return effectiveMaxChars >= 0 ? effectiveMaxChars : 0
}

async function enqueueTranslation(task) {
  const nextTask = translationQueue.then(task, task)
  translationQueue = nextTask.catch(() => undefined)
  return nextTask
}

function pickModelCandidates(configuredModel) {
  const preferredOrder = ['gpt-5-chat', 'gpt-4.1', 'gpt-4o']
  if (!configuredModel || configuredModel === 'auto') {
    return [DEFAULT_TRANSLATION_MODEL, ...preferredOrder.filter((model) => model !== DEFAULT_TRANSLATION_MODEL)]
  }

  return [configuredModel, ...preferredOrder.filter((model) => model !== configuredModel)]
}

async function translateWithGitHubModels({ text, sourceLocale, targetLocale, maxChars, strictLessThan }) {
  const token = process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN
  const configuredModel = process.env.GITHUB_MODELS_MODEL || DEFAULT_TRANSLATION_MODEL

  if (!token) {
    throw new Error('Missing GitHub models token. Set GITHUB_MODELS_TOKEN or GITHUB_TOKEN.')
  }

  const candidates = pickModelCandidates(configuredModel)
  const sourceLocaleDescription = getLocaleDescription(sourceLocale)
  const targetLocaleDescription = getLocaleDescription(targetLocale)
  let lastError = null
  let rateLimited = false

  logTranslation('translate.start', {
    sourceLocale,
    targetLocale,
    textLength: String(text || '').length,
    maxChars,
    strictLessThan,
    configuredModel,
    candidateCount: candidates.length,
  })

  for (const model of candidates) {
    const effectiveMaxChars = getEffectiveMaxChars(maxChars, strictLessThan)
    const lengthInstruction = Number.isInteger(effectiveMaxChars)
      ? ` Keep the translated text at ${strictLessThan ? 'fewer than' : 'at most'} ${maxChars} characters.`
      : ''
    const attempt = 1
    logTranslation('model.attempt', {
      model,
      attempt,
      maxAttemptsPerModel: 1,
    })

    const response = await fetch('https://models.inference.ai.azure.com/chat/completions', {
      method: 'POST',
      headers: buildAuthHeaders(token),
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `You are a professional app localization translator. Return only the translated text with no explanation, no quotes, and no extra formatting.${lengthInstruction}`,
          },
          {
            role: 'user',
            content: `Translate from ${sourceLocaleDescription || sourceLocale} to ${targetLocaleDescription || targetLocale}. Preserve the target locale's writing system and regional conventions.\n\n${text}`,
          },
        ],
      }),
    })

    const data = await response.json().catch(() => null)
    if (response.ok) {
      const translatedText = data?.choices?.[0]?.message?.content?.trim()
      if (translatedText) {
        logTranslation('translate.success', {
          model,
          attempt,
          outputLength: translatedText.length,
        })
        return translatedText
      }

      lastError = new Error(`GitHub Models translation failed with ${model}: empty response`)
      continue
    }

    if (response.status === 429) {
      rateLimited = true
      logTranslation('model.rate_limited', {
        model,
        attempt,
      })
      lastError = new Error(`GitHub Models translation failed with ${model}: 429`)
      continue
    }

    lastError = new Error(`GitHub Models translation failed with ${model}: ${response.status}`)
  }

  if (rateLimited) {
    logTranslation('translate.failed_rate_limited', {
      sourceLocale,
      targetLocale,
    })
    throw new Error('Translation is temporarily rate-limited by GitHub Models (429). Please retry in a moment.')
  }

  logTranslation('translate.failed', {
    sourceLocale,
    targetLocale,
    error: lastError?.message || 'GitHub Models translation failed',
  })
  throw lastError || new Error('GitHub Models translation failed')
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { text, sourceLocale, targetLocale, maxChars, strictLessThan } = body || {}
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    logTranslation('request.received', {
      requestId,
      sourceLocale,
      targetLocale,
      textLength: String(text || '').length,
      maxChars,
      strictLessThan,
    })

    if (!text) {
      logTranslation('request.empty_text', { requestId })
      return ok({ translatedText: '' })
    }

    const sourceNormalizedLocale = normalizeLocale(sourceLocale)
    const targetNormalizedLocale = normalizeLocale(targetLocale)

    if (!sourceNormalizedLocale || !targetNormalizedLocale) {
      throw new Error('sourceLocale and targetLocale are required')
    }

    if (sourceNormalizedLocale === targetNormalizedLocale) {
      logTranslation('request.short_circuit_same_locale', {
        requestId,
        sourceLocale,
        targetLocale,
      })
      return ok({ translatedText: text })
    }

    const translatedText = await enqueueTranslation(() =>
      translateWithGitHubModels({
        text,
        sourceLocale,
        targetLocale,
        maxChars,
        strictLessThan: Boolean(strictLessThan),
      })
    )

    logTranslation('request.completed', {
      requestId,
      outputLength: String(translatedText || '').length,
    })

    return ok({ translatedText })
  } catch (error) {
    logTranslation('request.error', {
      error: error instanceof Error ? error.message : String(error),
    })
    return fail(error)
  }
}
