'use client'

import { useEffect, useState } from 'react'

function getErrorMessage(value) {
  if (!value) return 'An unexpected error occurred.'
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message || 'An unexpected error occurred.'
  return String(value?.message || value?.reason || 'An unexpected error occurred.')
}

export default function GlobalErrorBanner() {
  const [message, setMessage] = useState('')

  useEffect(() => {
    const handleWindowError = (event) => {
      const nextMessage = getErrorMessage(event?.error || event?.message)
      setMessage(nextMessage)
    }

    const handleUnhandledRejection = (event) => {
      const nextMessage = getErrorMessage(event?.reason)
      setMessage(nextMessage)
    }

    const handleCustomAppError = (event) => {
      const nextMessage = getErrorMessage(event?.detail)
      setMessage(nextMessage)
    }

    window.addEventListener('error', handleWindowError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    window.addEventListener('app-error', handleCustomAppError)

    return () => {
      window.removeEventListener('error', handleWindowError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
      window.removeEventListener('app-error', handleCustomAppError)
    }
  }, [])

  if (!message) {
    return null
  }

  return (
    <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-rose-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-8xl items-start justify-between gap-4">
        <p className="text-sm font-medium">{message}</p>
        <button
          type="button"
          onClick={() => setMessage('')}
          className="inline-flex rounded-full border border-rose-300 bg-white px-3 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100">
          Dismiss
        </button>
      </div>
    </div>
  )
}
