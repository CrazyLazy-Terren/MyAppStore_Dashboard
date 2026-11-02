import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'

import { GenerateVideosOperation } from '@google/genai'
import { fail, ok } from '@/lib/http'
import { getGeminiClient, hasGeminiApiKey } from '@/lib/gemini'

export async function POST(request) {
  let tmpPath = null

  try {
    if (!hasGeminiApiKey()) {
      throw new Error('Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY.')
    }

    const body = await request.json()
    const { operation } = body || {}
    if (!operation?.name) {
      throw new Error('A video generation operation is required.')
    }

    const ai = getGeminiClient()
    const pending = Object.assign(new GenerateVideosOperation(), operation)
    const updated = await ai.operations.getVideosOperation({ operation: pending })

    if (!updated.done) {
      return ok({ done: false, operation: updated })
    }

    if (updated.error) {
      throw new Error(updated.error?.message || 'Video generation failed.')
    }

    const generatedVideo = updated.response?.generatedVideos?.[0]
    if (!generatedVideo?.video) {
      throw new Error('Video generation finished without producing a video.')
    }

    tmpPath = path.join(os.tmpdir(), `veo-${randomUUID()}.mp4`)
    await ai.files.download({ file: generatedVideo.video, downloadPath: tmpPath })
    const bytes = await readFile(tmpPath)
    const mimeType = generatedVideo.video.mimeType || 'video/mp4'

    return ok({
      done: true,
      videoDataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
      video: { uri: generatedVideo.video.uri, mimeType },
    })
  } catch (error) {
    return fail(error)
  } finally {
    if (tmpPath) {
      await unlink(tmpPath).catch(() => {})
    }
  }
}
