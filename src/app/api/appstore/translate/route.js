import { ok, fail } from '@/lib/http'
import { generateGeminiText, getGeminiModel, hasGeminiApiKey } from '@/lib/gemini'

let translationQueue = Promise.resolve()
const DEFAULT_TRANSLATION_MODEL = 'gpt-5-chat'
const DEFAULT_OPENAI_TRANSLATION_MODEL = 'gpt-5.5'
const PRESERVED_URLS = ['https://www.apple.com/legal/internet-services/itunes/dev/stdeula/']

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

function findPreservedUrl(text) {
  return PRESERVED_URLS.find((url) => String(text || '').includes(url)) || null
}

function buildPrompt(mode, { text, sourceLocale, targetLocale, maxChars, strictLessThan }) {
  const sourceLocaleDescription = getLocaleDescription(sourceLocale)
  const targetLocaleDescription = getLocaleDescription(targetLocale)
  const effectiveMaxChars = getEffectiveMaxChars(maxChars, strictLessThan)
  const lengthInstruction = Number.isInteger(effectiveMaxChars)
    ? ` Keep the text at ${strictLessThan ? 'fewer than' : 'at most'} ${maxChars} characters.`
    : ''
  const urlInstruction = ' Never translate, alter, shorten, or remove any URL — copy every URL character-for-character exactly as it appears in the source, especially https://www.apple.com/legal/internet-services/itunes/dev/stdeula/ if present.'

  if (mode === 'shorten') {
    return {
      systemInstruction: `You are a professional app localization editor. Rewrite the given text in ${targetLocaleDescription || targetLocale} so it is shorter while preserving its meaning, tone, and key information. Return only the rewritten text with no explanation, no quotes, and no extra formatting.${lengthInstruction}${urlInstruction}`,
      userInput: `The following text is written in ${targetLocaleDescription || targetLocale} and is too long. Rewrite it to be shorter while keeping the same meaning.\n\n${text}`,
    }
  }

  return {
    systemInstruction: `You are a professional app localization translator. Return only the translated text with no explanation, no quotes, and no extra formatting.${lengthInstruction}${urlInstruction}`,
    userInput: `Translate from ${sourceLocaleDescription || sourceLocale} to ${targetLocaleDescription || targetLocale}. Preserve the target locale's writing system and regional conventions.\n\n${text}`,
  }
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

async function translateWithOpenAI({ text, sourceLocale, targetLocale, maxChars, strictLessThan, mode = 'translate' }) {
  const token = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_TRANSLATION_MODEL || DEFAULT_OPENAI_TRANSLATION_MODEL

  if (!token) {
    throw new Error('Missing OpenAI API key. Set OPENAI_API_KEY.')
  }

  const { systemInstruction, userInput } = buildPrompt(mode, { text, sourceLocale, targetLocale, maxChars, strictLessThan })

  logTranslation('openai.translate.start', {
    mode,
    sourceLocale,
    targetLocale,
    textLength: String(text || '').length,
    maxChars,
    strictLessThan,
    model,
  })

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      instructions: systemInstruction,
      input: userInput,
    }),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`OpenAI translation failed with ${model}: ${response.status} ${data?.error?.message || ''}`.trim())
  }

  const translatedText = extractOpenAIText(data).trim()
  if (!translatedText) {
    throw new Error(`OpenAI translation failed with ${model}: empty response`)
  }

  logTranslation('openai.translate.success', {
    mode,
    model,
    outputLength: translatedText.length,
  })

  return translatedText
}

async function translateWithGemini({ text, sourceLocale, targetLocale, maxChars, strictLessThan, mode = 'translate' }) {
  const model = getGeminiModel('GEMINI_TRANSLATION_MODEL')
  const { systemInstruction, userInput } = buildPrompt(mode, { text, sourceLocale, targetLocale, maxChars, strictLessThan })

  logTranslation('gemini.translate.start', {
    mode,
    sourceLocale,
    targetLocale,
    textLength: String(text || '').length,
    maxChars,
    strictLessThan,
    model,
  })

  const translatedText = await generateGeminiText({
    model,
    contents: userInput,
    config: {
      systemInstruction,
      temperature: 0.1,
    },
  })

  logTranslation('gemini.translate.success', {
    mode,
    model,
    outputLength: translatedText.length,
  })

  return translatedText
}

async function translateWithGitHubModels({ text, sourceLocale, targetLocale, maxChars, strictLessThan, mode = 'translate' }) {
  const token = process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN
  const configuredModel = process.env.GITHUB_MODELS_MODEL || DEFAULT_TRANSLATION_MODEL

  if (!token) {
    throw new Error('Missing GitHub models token. Set GITHUB_MODELS_TOKEN or GITHUB_TOKEN.')
  }

  const candidates = pickModelCandidates(configuredModel)
  const { systemInstruction, userInput } = buildPrompt(mode, { text, sourceLocale, targetLocale, maxChars, strictLessThan })
  let lastError = null
  let rateLimited = false

  logTranslation('translate.start', {
    mode,
    sourceLocale,
    targetLocale,
    textLength: String(text || '').length,
    maxChars,
    strictLessThan,
    configuredModel,
    candidateCount: candidates.length,
  })

  for (const model of candidates) {
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
            content: systemInstruction,
          },
          {
            role: 'user',
            content: userInput,
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

    // en-GB is copied from en-US as is, not translated.
    if (sourceNormalizedLocale === 'en-us' && targetNormalizedLocale === 'en-gb') {
      logTranslation('request.short_circuit_copy_en_us', {
        requestId,
        sourceLocale,
        targetLocale,
      })
      return ok({ translatedText: text })
    }

    if (sourceNormalizedLocale === targetNormalizedLocale) {
      logTranslation('request.short_circuit_same_locale', {
        requestId,
        sourceLocale,
        targetLocale,
      })
      return ok({ translatedText: text })
    }

    const translateFn = hasGeminiApiKey() ? translateWithGemini : process.env.OPENAI_API_KEY ? translateWithOpenAI : translateWithGitHubModels
    const runTranslation = (input, mode) =>
      enqueueTranslation(() =>
        translateFn({
          text: input,
          sourceLocale,
          targetLocale,
          maxChars,
          strictLessThan: Boolean(strictLessThan),
          mode,
        })
      )

    const requiredUrl = findPreservedUrl(text)
    const effectiveMaxChars = getEffectiveMaxChars(maxChars, strictLessThan)
    const isOverLimit = (value) => Number.isInteger(effectiveMaxChars) && Array.from(value || '').length > effectiveMaxChars
    const MAX_SHORTEN_ATTEMPTS = 2

    let translatedText = await runTranslation(text, 'translate')

    let shortenAttempts = 0
    while (isOverLimit(translatedText) && shortenAttempts < MAX_SHORTEN_ATTEMPTS) {
      logTranslation('request.oversized', {
        requestId,
        maxChars,
        strictLessThan,
        attempt: shortenAttempts + 1,
        outputLength: Array.from(translatedText).length,
      })
      translatedText = await runTranslation(translatedText, 'shorten')
      shortenAttempts += 1
      logTranslation('request.shortened', {
        requestId,
        attempt: shortenAttempts,
        outputLength: Array.from(translatedText).length,
      })
    }

    if (requiredUrl && !translatedText.includes(requiredUrl)) {
      logTranslation('request.url_reattached', { requestId, requiredUrl })
      translatedText = `${translatedText.trim()}\n${requiredUrl}`

      let urlShortenAttempts = 0
      while (isOverLimit(translatedText) && urlShortenAttempts < MAX_SHORTEN_ATTEMPTS) {
        translatedText = await runTranslation(translatedText, 'shorten')
        urlShortenAttempts += 1
        logTranslation('request.shortened_after_url', {
          requestId,
          attempt: urlShortenAttempts,
          outputLength: Array.from(translatedText).length,
        })
      }
    }

    if (isOverLimit(translatedText)) {
      logTranslation('request.still_oversized', {
        requestId,
        maxChars,
        strictLessThan,
        outputLength: Array.from(translatedText).length,
      })
    }

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
