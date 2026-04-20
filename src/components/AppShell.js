import { Suspense } from 'react'
import Link from 'next/link'
import AdsDateRangeToolbar from '@/components/AdsDateRangeToolbar'
import GlobalErrorBanner from '@/components/GlobalErrorBanner'

export default function AppShell({ children }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <nav className="border-b border-cyan-950/20 bg-linear-to-r from-cyan-800  to-gray-900 text-white shadow-lg shadow-cyan-950/10">
        <div className="mx-auto flex w-full max-w-8xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
              <img src="/store-icon.svg" alt="Store Icon" className="h-7 w-7 inline-block align-middle" />
              Apple Search Ads Manager
            </h1>
            <p className="mt-1 text-sm text-cyan-100/80">Campaign operations and reporting in one place.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm font-medium">
            <Link href="/" className="rounded-full px-4 py-2 text-cyan-50 transition hover:bg-white/15 hover:text-white">
              Dashboard
            </Link>
            <Link href="/campaigns" className="rounded-full px-4 py-2 text-cyan-50 transition hover:bg-white/15 hover:text-white">
              Campaigns
            </Link>
            <Link href="/keywords" className="rounded-full px-4 py-2 text-cyan-50 transition hover:bg-white/15 hover:text-white">
              Keywords
            </Link>
            <Link href="/appstore" className="rounded-full px-4 py-2 text-cyan-50 transition hover:bg-white/15 hover:text-white">
              App Store Connect
            </Link>
          </div>
        </div>
      </nav>
      <Suspense fallback={null}>
        <AdsDateRangeToolbar />
      </Suspense>
      <GlobalErrorBanner />
      <main className="mx-auto flex w-full max-w-8xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <Suspense fallback={null}>{children}</Suspense>
      </main>
      <footer className="border-t border-slate-200 bg-white/70 px-4 py-5 text-center text-sm text-slate-500 backdrop-blur-sm">
        Apple Search Ads API Client © 2026
      </footer>
    </div>
  )
}
