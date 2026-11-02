import { fail, ok } from '@/lib/http'
import { generateGeminiText, getGeminiModel, hasGeminiApiKey } from '@/lib/gemini'

function trimForPrompt(value, maxLength = 1800) {
  const text = String(value || '').trim()
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trim()}...`
}

function buildSystemPrompt() {
  return [
    'You are a short-form video creative director specializing in App Store preview videos and vertical social ads.',
    'Given an app name, subtitle, and description, write ONE scroll-stopping video concept as a single ready-to-use text-to-video generation prompt.',
    'The prompt must describe, in flowing prose (not a list, not JSON): the opening hook shot for the first 2-3 seconds, the core app feature or benefit shown in action, visual style and mood, camera movement, pacing, any minimal on-screen text overlay ideas, and a closing beat.',
    'Keep it concrete and visual so a text-to-video model can render it directly. Do not include camera brand names, real people, copyrighted characters, or competitor brand names.',
    'Respond with only the prompt text, under 130 words, no preamble, no quotes, no markdown.',
  ].join(' ')
}

function buildUserPayload({ appName, metadata, brief }) {
  return JSON.stringify({
    appName,
    subtitle: metadata.subtitle,
    description: metadata.description,
    userDirectionGuidance: brief || 'No extra guidance provided, use your best creative judgement.',
  })
}

export async function POST(request) {
  try {
    if (!hasGeminiApiKey()) {
      throw new Error('Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY to generate video ideas.')
    }

    const body = await request.json()
    const { appName = '', metadata = {}, brief = '' } = body || {}

    const normalizedMetadata = {
      subtitle: String(metadata?.subtitle || '').trim(),
      description: trimForPrompt(metadata?.description || ''),
    }

    const model = getGeminiModel('GEMINI_KEYWORD_MODEL')
    const prompt = await generateGeminiText({
      model,
      contents: buildUserPayload({ appName: String(appName || '').trim(), metadata: normalizedMetadata, brief: String(brief || '').trim() }),
      config: {
        systemInstruction: buildSystemPrompt(),
        temperature: 0.9,
      },
    })

    return ok({
      prompt: prompt.trim(),
      meta: { model, source: 'Gemini' },
    })
  } catch (error) {
    return fail(error)
  }
}
