import { GoogleGenAI } from '@google/genai'

export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite'
export const DEFAULT_GEMINI_VIDEO_MODEL = 'veo-3.1-generate-preview'

let client

export function hasGeminiApiKey() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
}

export function getGeminiModel(envKey) {
  return process.env[envKey] || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
}

export function getGeminiVideoModel() {
  return process.env.GEMINI_VIDEO_MODEL || DEFAULT_GEMINI_VIDEO_MODEL
}

export function getGeminiClient() {
  if (!hasGeminiApiKey()) {
    throw new Error('Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY.')
  }

  if (!client) {
    // The official SDK reads GEMINI_API_KEY or GOOGLE_API_KEY from the environment.
    client = new GoogleGenAI({})
  }

  return client
}

export async function generateGeminiText({ model, contents, config }) {
  const response = await getGeminiClient().models.generateContent({
    model,
    contents,
    config,
  })

  const text = String(response.text || '').trim()
  if (!text) {
    throw new Error(`Gemini generation failed with ${model}: empty response`)
  }

  return text
}
