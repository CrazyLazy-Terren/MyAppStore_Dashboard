import { fail, ok } from '@/lib/http'
import { getGeminiClient, getGeminiVideoModel, hasGeminiApiKey } from '@/lib/gemini'

const ALLOWED_ASPECT_RATIOS = new Set(['9:16', '16:9'])

export async function POST(request) {
  try {
    if (!hasGeminiApiKey()) {
      throw new Error('Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY to generate videos.')
    }

    const body = await request.json()
    const { prompt = '', aspectRatio = '9:16', video = null } = body || {}

    const trimmedPrompt = String(prompt || '').trim()
    if (!trimmedPrompt) {
      throw new Error('A video prompt is required.')
    }

    const safeAspectRatio = ALLOWED_ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : '9:16'
    const model = getGeminiVideoModel()
    const ai = getGeminiClient()

    const config = { numberOfVideos: 1, aspectRatio: safeAspectRatio }

    const operation =
      video?.uri
        ? await ai.models.generateVideos({
            model,
            source: { prompt: trimmedPrompt, video: { uri: video.uri, mimeType: video.mimeType } },
            config,
          })
        : await ai.models.generateVideos({ model, prompt: trimmedPrompt, config })

    return ok({ operation, meta: { model, aspectRatio: safeAspectRatio } })
  } catch (error) {
    return fail(error)
  }
}
