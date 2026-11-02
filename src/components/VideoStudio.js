'use client'

import { useEffect, useRef, useState } from 'react'

function isEnglishLocale(locale) {
  return /^en([_-]|$)/i.test(String(locale || ''))
}

export default function VideoStudio() {
  const [apps, setApps] = useState([])
  const [appsLoading, setAppsLoading] = useState(true)
  const [appsError, setAppsError] = useState(null)
  const [selectedApp, setSelectedApp] = useState(null)

  const [appMetadata, setAppMetadata] = useState({ subtitle: '', description: '' })
  const [metadataLoading, setMetadataLoading] = useState(false)

  const [prompt, setPrompt] = useState('')
  const [brief, setBrief] = useState('')
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [ideaLoading, setIdeaLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [statusText, setStatusText] = useState(null)
  const [error, setError] = useState(null)
  const [take, setTake] = useState(null) // { dataUrl, video: {uri, mimeType}, promptHistory: [] }
  const [history, setHistory] = useState([])
  const [continuePrompt, setContinuePrompt] = useState('')
  const cancelRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()

    const load = async () => {
      try {
        const res = await fetch('/api/appstore/apps', { signal: controller.signal })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error?.message || 'Failed to load apps')
        if (controller.signal.aborted) return
        setApps(json.data || [])
      } catch (err) {
        if (err?.name === 'AbortError') return
        setAppsError(err.message)
      } finally {
        if (!controller.signal.aborted) {
          setAppsLoading(false)
        }
      }
    }
    load()

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!selectedApp?.id) {
      setAppMetadata({ subtitle: '', description: '' })
      return
    }

    const controller = new AbortController()
    setMetadataLoading(true)

    const load = async () => {
      try {
        const res = await fetch(`/api/appstore/apps/${selectedApp.id}/localizations?platform=IOS`, { signal: controller.signal })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error?.message || 'Failed to load app metadata')
        if (controller.signal.aborted) return

        const englishLoc = (json.data || []).find((loc) => isEnglishLocale(loc?.attributes?.locale)) || (json.data || [])[0]
        setAppMetadata({
          subtitle: englishLoc?.attributes?.subtitle || '',
          description: englishLoc?.attributes?.description || '',
        })
      } catch (err) {
        if (err?.name === 'AbortError') return
      } finally {
        if (!controller.signal.aborted) {
          setMetadataLoading(false)
        }
      }
    }
    load()

    return () => controller.abort()
  }, [selectedApp])

  const handleGenerateIdea = async () => {
    setIdeaLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/appstore/videos/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName: selectedApp?.attributes?.name || '',
          metadata: appMetadata,
          brief,
        }),
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error?.message || 'Failed to generate a video idea')
      }

      setPrompt(json.prompt || '')
    } catch (err) {
      setError(err.message)
    } finally {
      setIdeaLoading(false)
    }
  }

  const pollVideoOperation = async (operation) => {
    let current = operation

    while (!current.done) {
      if (cancelRef.current) {
        return null
      }

      await new Promise((resolve) => setTimeout(resolve, 8000))

      const res = await fetch('/api/appstore/videos/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: current }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error?.message || 'Failed to check video generation status')
      }

      if (json.done) {
        return json
      }

      current = json.operation
    }

    return null
  }

  const handleGenerateVideo = async () => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      setError('Write or generate a video prompt first.')
      return
    }

    cancelRef.current = false
    setGenerating(true)
    setError(null)
    setStatusText('Starting video generation…')

    try {
      const res = await fetch('/api/appstore/videos/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmedPrompt, aspectRatio }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error?.message || 'Failed to start video generation')
      }

      setStatusText('Rendering your video… this can take a few minutes.')
      const result = await pollVideoOperation(json.operation)
      if (!result) {
        return
      }

      setTake({ dataUrl: result.videoDataUrl, video: result.video, promptHistory: [trimmedPrompt] })
      setHistory([])
      setContinuePrompt('')
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
      setStatusText(null)
    }
  }

  const handleContinueVideo = async () => {
    const trimmedPrompt = continuePrompt.trim()
    if (!trimmedPrompt) {
      setError('Write what should happen next before continuing the video.')
      return
    }

    if (!take?.video?.uri) {
      setError('Generate a first video before continuing it.')
      return
    }

    cancelRef.current = false
    setGenerating(true)
    setError(null)
    setStatusText('Continuing your video in the same scene…')

    try {
      const res = await fetch('/api/appstore/videos/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmedPrompt, aspectRatio, video: take.video }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error?.message || 'Failed to continue video generation')
      }

      setStatusText('Rendering the continuation… this can take a few minutes.')
      const result = await pollVideoOperation(json.operation)
      if (!result) {
        return
      }

      setHistory((previous) => [...previous, take])
      setTake({
        dataUrl: result.videoDataUrl,
        video: result.video,
        promptHistory: [...take.promptHistory, trimmedPrompt],
      })
      setContinuePrompt('')
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
      setStatusText(null)
    }
  }

  const handleCancelGeneration = () => {
    cancelRef.current = true
    setStatusText('Cancelling…')
  }

  const handleReset = () => {
    cancelRef.current = true
    setPrompt('')
    setBrief('')
    setTake(null)
    setHistory([])
    setContinuePrompt('')
    setError(null)
    setStatusText(null)
  }

  return (
    <div className="w-full rounded-3xl bg-white p-6 shadow-lg shadow-slate-200/70 ring-1 ring-slate-200 sm:p-8">
      <div className="mb-6">
        <h3 className="text-2xl font-semibold tracking-tight text-slate-900">Video Studio</h3>
        <p className="mt-1 text-sm text-slate-500">
          Step 1: write or generate a video prompt. Step 2: generate the clip with Gemini (Veo). Each clip is limited to a few seconds, so continue
          the same video with another prompt to keep going in the same scene.
        </p>
      </div>

      {appsLoading && <p className="text-sm text-slate-500">Loading apps…</p>}
      {appsError && <p className="text-sm text-rose-600">{appsError}</p>}
      {!appsLoading && !appsError && (
        <div className="mb-6">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-500">App (optional, used for idea generation)</label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => setSelectedApp(app)}
                className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                  selectedApp?.id === app.id
                    ? 'border-sky-700 bg-sky-50 font-semibold text-sky-900 ring-1 ring-sky-700'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-400'
                }`}>
                <div className="font-medium">{app.attributes?.name || app.id}</div>
                <div className="mt-0.5 text-xs text-slate-400">{app.attributes?.bundleId || app.id}</div>
              </button>
            ))}
          </div>
          {metadataLoading && <p className="mt-2 text-xs text-slate-400">Loading app metadata…</p>}
        </div>
      )}

      <div className="border-t border-slate-100 pt-6">
        {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div className="grid gap-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Step 1 · Prompt</p>
                <button
                  type="button"
                  onClick={handleGenerateIdea}
                  disabled={ideaLoading}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-60">
                  {ideaLoading ? 'Generating idea…' : '✨ Generate idea'}
                </button>
              </div>

              <input
                type="text"
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                placeholder="Optional direction for the idea generator (e.g. focus on onboarding, upbeat and playful)"
                className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />

              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={6}
                placeholder="Click Generate idea, or paste your own text-to-video prompt here…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Step 2 · Generate video</p>
                <div className="inline-flex rounded-full border border-slate-200 bg-white p-1">
                  {['9:16', '16:9'].map((ratio) => (
                    <button
                      key={`video-aspect-${ratio}`}
                      type="button"
                      onClick={() => setAspectRatio(ratio)}
                      disabled={generating}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                        aspectRatio === ratio ? 'bg-sky-900 text-white' : 'text-slate-600'
                      }`}>
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleGenerateVideo}
                disabled={generating || !prompt.trim()}
                className="inline-flex w-full items-center justify-center rounded-full bg-sky-900 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60">
                {generating && !take ? 'Generating…' : take ? 'Regenerate from scratch' : 'Generate video'}
              </button>

              {generating && statusText && (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-500">{statusText}</p>
                  <button
                    type="button"
                    onClick={handleCancelGeneration}
                    disabled={statusText === 'Cancelling…'}
                    className="shrink-0 text-xs font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-60">
                    ✕ Remove unfinished
                  </button>
                </div>
              )}
            </div>

            {take && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Continue this video</p>
                <p className="mb-2 text-xs text-slate-500">
                  Add another beat to the same scene — it reuses the last clip as context, so the result is one continuous, longer video.
                </p>
                <textarea
                  value={continuePrompt}
                  onChange={(event) => setContinuePrompt(event.target.value)}
                  rows={3}
                  placeholder="Describe what should happen next in the same scene…"
                  className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={handleContinueVideo}
                  disabled={generating || !continuePrompt.trim()}
                  className="inline-flex items-center justify-center rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900 hover:border-sky-300 disabled:opacity-60">
                  {generating ? 'Continuing…' : 'Continue video'}
                </button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Result</p>
              {take && (
                <button type="button" onClick={handleReset} className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                  Start over
                </button>
              )}
            </div>

            {take ? (
              <div className="grid gap-3">
                <div className={`overflow-hidden rounded-xl border border-slate-200 bg-slate-950 ${aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'}`}>
                  <video src={take.dataUrl} controls preload="metadata" className="h-full w-full bg-black object-contain" />
                </div>
                <a
                  href={take.dataUrl}
                  download={`short-video-take-${history.length + 1}.mp4`}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300">
                  ⬇ Download current video
                </a>

                {history.length > 0 && (
                  <div className="grid gap-2">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Earlier, shorter takes</p>
                    {history.map((historyTake, index) => (
                      <a
                        key={`video-history-${index}`}
                        href={historyTake.dataUrl}
                        download={`short-video-take-${index + 1}.mp4`}
                        className="inline-flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-slate-300">
                        <span>Take {index + 1}</span>
                        <span>⬇ Download</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex aspect-[9/16] items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 text-center text-xs text-slate-400">
                Your generated video will appear here.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
