'use client'

import { useEffect, useMemo, useState } from 'react'

async function postJSON(body) {
  const res = await fetch('/api/appstore/screenshot-bundles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message || 'Request failed')
  return json.data
}

async function getJSON(url) {
  const res = await fetch(url)
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message || 'Request failed')
  return json.data || []
}

// Creative asset slots (from the zip's creative-header and creative-search folders).
const SLOT_LABELS = {
  PRODUCT_PAGE_HEADER_ASSET: 'Product page header',
  APP_STORE_SEARCH_RESULTS_ASSET: 'Search results',
}

const STATUS_STYLE = {
  uploaded: 'bg-emerald-100 text-emerald-800',
  skipped: 'bg-amber-100 text-amber-800',
  failed: 'bg-rose-100 text-rose-800',
}

// Uploads the screenshot editor's export zip to an App Store version, a
// Product Page Optimization treatment or a Custom Product Page.
export default function ScreenshotBundles() {
  const [apps, setApps] = useState([])
  const [appId, setAppId] = useState('')
  const [targetKind, setTargetKind] = useState('version')
  const [experiments, setExperiments] = useState([])
  const [experimentId, setExperimentId] = useState('')
  const [treatments, setTreatments] = useState([])
  const [treatmentId, setTreatmentId] = useState('')
  const [pages, setPages] = useState([])
  const [pageId, setPageId] = useState('')
  const [newPage, setNewPage] = useState(null) // { name, deepLink, copyFromVersion } while the form is open

  const [bundle, setBundle] = useState(null) // { bundleId, sets, locales }
  const [plan, setPlan] = useState(null)
  const [localeMap, setLocaleMap] = useState(null)
  const [displayTypes, setDisplayTypes] = useState(null)
  const [replace, setReplace] = useState(false)
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const guard = async (label, work) => {
    setBusy(label)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    guard('Loading apps…', async () => {
      const list = await getJSON('/api/appstore/apps')
      setApps(list)
      setAppId((current) => current || list[0]?.id || '')
    })
  }, [])

  useEffect(() => {
    setExperiments([])
    setExperimentId('')
    if (!appId || targetKind !== 'experiment') return
    guard('Loading tests…', async () => {
      const list = await getJSON(`/api/appstore/apps/${appId}/experiments`)
      setExperiments(list)
      // Only a test that has not started can take new screenshots.
      setExperimentId(list.find((item) => item.state === 'PREPARE_FOR_SUBMISSION')?.id || '')
    })
  }, [appId, targetKind])

  const loadPages = async (selectId) => {
    const list = await getJSON(`/api/appstore/apps/${appId}/custom-product-pages`)
    setPages(list)
    setPageId(selectId || list.find((item) => item.editableVersionId)?.id || '')
  }

  useEffect(() => {
    setPages([])
    setPageId('')
    if (!appId || targetKind !== 'customProductPage') return
    guard('Loading Custom Product Pages…', () => loadPages())
  }, [appId, targetKind])

  const createPage = () =>
    guard('Creating the page…', async () => {
      const res = await fetch(`/api/appstore/apps/${appId}/custom-product-pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPage),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message || 'Could not create the page')
      setNewPage(null)
      await loadPages(json.data.id)
    })

  useEffect(() => {
    setTreatments([])
    setTreatmentId('')
    if (!appId || !experimentId) return
    guard('Loading treatments…', async () => {
      const list = await getJSON(`/api/appstore/apps/${appId}/experiments?experimentId=${experimentId}`)
      setTreatments(list)
      setTreatmentId(list[0]?.id || '')
    })
  }, [appId, experimentId])

  const target = useMemo(() => {
    if (targetKind === 'experiment') return treatmentId ? { kind: 'experiment', appId, treatmentId } : null
    if (targetKind === 'customProductPage') {
      const page = pages.find((item) => item.id === pageId)
      return page?.editableVersionId ? { kind: 'customProductPage', appId, customProductPageId: page.id } : null
    }
    return appId ? { kind: 'version', appId } : null
  }, [targetKind, appId, treatmentId, pages, pageId])

  // Re-plan whenever the zip, the target or a choice changes.
  useEffect(() => {
    setResults(null)
    if (!bundle || !target) {
      setPlan(null)
      return
    }
    guard('Checking App Store Connect…', async () => {
      const next = await postJSON({ bundleId: bundle.bundleId, target, localeMap: localeMap || undefined, displayTypes: displayTypes || undefined })
      setPlan(next)
      if (!localeMap) setLocaleMap(next.localeMap)
    })
  }, [bundle, target, localeMap, displayTypes])

  const chooseFile = (file) => {
    if (!file) return
    setBundle(null)
    setPlan(null)
    setLocaleMap(null)
    setDisplayTypes(null)
    guard('Reading the zip…', async () => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/appstore/screenshot-bundles', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message || 'Could not read the zip')
      setBundle(json.data)
    })
  }

  const allDisplayTypes = useMemo(() => [...new Set((bundle?.sets || []).map((set) => set.displayType).filter(Boolean))], [bundle])
  const selectedDisplayTypes = displayTypes || allDisplayTypes
  const rows = plan?.rows || []
  const toDelete = replace ? rows.reduce((sum, row) => sum + row.existing, 0) : 0
  const toUpload = rows.filter((row) => replace || row.existing === 0).reduce((sum, row) => sum + row.files.length, 0)

  const upload = () => {
    const warning = toDelete > 0 ? `This removes ${toDelete} existing image${toDelete === 1 ? '' : 's'} and uploads ${toUpload}. Deleted screenshots cannot be restored.` : `Upload ${toUpload} image${toUpload === 1 ? '' : 's'}?`
    if (!window.confirm(warning)) return
    guard('Uploading… this can take a few minutes', async () => {
      const done = await postJSON({ bundleId: bundle.bundleId, target, localeMap, displayTypes: displayTypes || undefined, replace, apply: true })
      setResults(done.results)
    })
  }

  const sameRow = (left, right) => left.storeLocale === right.storeLocale && left.displayType === right.displayType
  const failed = (results || []).filter((result) => result.status === 'failed')

  // Re-runs only the given rows, keeps the other results, then refreshes the
  // "There now" counts.
  const retry = (retryRows) =>
    guard(`Retrying ${retryRows.length} row${retryRows.length === 1 ? '' : 's'}…`, async () => {
      const only = retryRows.map(({ storeLocale, displayType }) => ({ storeLocale, displayType }))
      const done = await postJSON({ bundleId: bundle.bundleId, target, localeMap, displayTypes: displayTypes || undefined, replace, apply: true, only })
      setResults((current) => [...(current || []).filter((result) => !only.some((row) => sameRow(row, result))), ...done.results])
      setPlan(await postJSON({ bundleId: bundle.bundleId, target, localeMap, displayTypes: displayTypes || undefined }))
    })

  const field = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'

  return (
    <div className="w-full space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Screenshot upload</h2>
        <p className="mt-1 text-sm text-slate-500">Send the screenshot editor&apos;s export zip (screenshots, or the header and search results creative assets) to an App Store version, a Product Page Optimization test or a Custom Product Page.</p>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {busy && <p className="text-sm text-slate-500">{busy}</p>}

      <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">App</span>
          <select className={`${field} w-full`} value={appId} onChange={(event) => setAppId(event.target.value)}>
            {apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.attributes?.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Send to</span>
          <select className={`${field} w-full`} value={targetKind} onChange={(event) => setTargetKind(event.target.value)}>
            <option value="version">App Store version (the editable one)</option>
            <option value="experiment">Product Page Optimization test</option>
            <option value="customProductPage">Custom Product Page</option>
          </select>
        </label>
        {targetKind === 'customProductPage' && (
          <div className="space-y-3 md:col-span-2">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-64 flex-1 space-y-1 text-sm">
                <span className="font-medium">Page</span>
                <select className={`${field} w-full`} value={pageId} onChange={(event) => setPageId(event.target.value)}>
                  <option value="">{pages.length ? 'Choose a page…' : 'No pages yet'}</option>
                  {pages.map((page) => (
                    <option key={page.id} value={page.id} disabled={!page.editableVersionId}>
                      {page.name} · {page.state || 'no version'}
                      {page.editableVersionId ? '' : ' (not editable)'}
                    </option>
                  ))}
                </select>
              </label>
              {!newPage && (
                <button
                  type="button"
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium"
                  onClick={() => setNewPage({ name: '', deepLink: '', copyFromVersion: true })}
                >
                  New page…
                </button>
              )}
            </div>
            {pages.some((page) => !page.editableVersionId) && (
              <p className="text-xs text-slate-500">
                Pages that are live or in review can&apos;t take screenshots until you start a new version:{' '}
                {pages.filter((page) => !page.editableVersionId).map((page, index) => (
                  <span key={page.id}>
                    {index > 0 ? ', ' : ''}
                    <button
                      type="button"
                      className="underline disabled:opacity-40"
                      disabled={!!busy}
                      onClick={() => {
                        if (!window.confirm(`Start a new editable version of "${page.name}"? App Store Connect copies the current content into it.`)) return
                        guard('Starting a new version…', async () => {
                          const res = await fetch(`/api/appstore/apps/${appId}/custom-product-pages`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ newVersionOf: page.id }),
                          })
                          const json = await res.json()
                          if (!res.ok) throw new Error(json?.error?.message || 'Could not start a new version')
                          await loadPages(page.id)
                        })
                      }}
                    >
                      {page.name}
                    </button>
                  </span>
                ))}
              </p>
            )}
            {pageId && (() => {
              const page = pages.find((item) => item.id === pageId)
              return page ? (
                <p className="text-xs text-slate-500">
                  Locales: {page.locales.join(', ') || 'none yet'}
                  {page.deepLink ? ` · Deep link: ${page.deepLink}` : ''}
                  {page.url ? <> · <a className="underline" href={page.url} target="_blank" rel="noreferrer">Page URL</a></> : null}
                </p>
              ) : null
            })()}
            {newPage && (
              <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Name</span>
                  <input className={`${field} w-full`} value={newPage.name} maxLength={50} placeholder="e.g. Watch faces" onChange={(event) => setNewPage({ ...newPage, name: event.target.value })} />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Deep link (optional)</span>
                  <input className={`${field} w-full`} value={newPage.deepLink} placeholder="stepsapp://…" onChange={(event) => setNewPage({ ...newPage, deepLink: event.target.value })} />
                </label>
                <label className="flex items-center gap-2 text-sm md:col-span-2">
                  <input type="checkbox" checked={newPage.copyFromVersion} onChange={(event) => setNewPage({ ...newPage, copyFromVersion: event.target.checked })} />
                  Start from the current product page (copies its screenshots, previews and promotional text)
                </label>
                <div className="flex gap-2 md:col-span-2">
                  <button
                    type="button"
                    className="rounded-full bg-sky-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                    disabled={!!busy || !newPage.name.trim()}
                    onClick={createPage}
                  >
                    Create page
                  </button>
                  <button type="button" className="rounded-full px-4 py-2 text-sm" onClick={() => setNewPage(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {targetKind === 'experiment' && (
          <>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Test</span>
              <select className={`${field} w-full`} value={experimentId} onChange={(event) => setExperimentId(event.target.value)}>
                <option value="">Choose a test…</option>
                {experiments.map((experiment) => (
                  <option key={experiment.id} value={experiment.id}>
                    {experiment.name} · {experiment.state}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Treatment</span>
              <select className={`${field} w-full`} value={treatmentId} onChange={(event) => setTreatmentId(event.target.value)}>
                {treatments.map((treatment) => (
                  <option key={treatment.id} value={treatment.id}>
                    {treatment.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Export zip</span>
          <input className={`${field} w-full`} type="file" accept=".zip" onChange={(event) => chooseFile(event.target.files?.[0])} />
        </label>
      </section>

      {bundle && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h3 className="text-sm font-semibold">Slots</h3>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {allDisplayTypes.map((type) => (
                <label key={type} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={selectedDisplayTypes.includes(type)}
                    onChange={(event) => setDisplayTypes(event.target.checked ? [...selectedDisplayTypes, type] : selectedDisplayTypes.filter((item) => item !== type))}
                  />
                  {SLOT_LABELS[type] || type}
                </label>
              ))}
            </div>
            {plan?.unmapped?.length > 0 && <p className="mt-2 text-xs text-slate-500">No App Store slot for: {plan.unmapped.join(', ')} (left out).</p>}
          </div>

          {localeMap && (
            <div>
              <h3 className="text-sm font-semibold">Languages</h3>
              <p className="text-xs text-slate-500">Store locales each exported language goes to, comma separated. Leave empty to skip a language.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {bundle.locales.map((locale) => (
                  <label key={locale} className="flex items-center gap-2 text-sm">
                    <span className="w-16 shrink-0 font-mono text-xs">{locale}</span>
                    <input
                      className={`${field} w-full py-1.5`}
                      defaultValue={(localeMap[locale] || []).join(', ')}
                      onBlur={(event) => {
                        const next = event.target.value.split(',').map((item) => item.trim()).filter(Boolean)
                        if (next.join() !== (localeMap[locale] || []).join()) setLocaleMap({ ...localeMap, [locale]: next })
                      }}
                    />
                  </label>
                ))}
              </div>
              {plan && <p className="mt-2 text-xs text-slate-500">On the target now: {plan.storeLocales.join(', ') || 'no locales'}. Others are created on upload.</p>}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
            Replace what is already in a slot (removes it first). When off, slots that already have screenshots or a creative asset are skipped.
          </label>

          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">Store locale</th>
                    <th className="py-2 pr-4">Slot</th>
                    <th className="py-2 pr-4">New</th>
                    <th className="py-2 pr-4">There now</th>
                    <th className="py-2">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => {
                    const result = results?.find((item) => item.storeLocale === row.storeLocale && item.displayType === row.displayType)
                    return (
                      <tr key={`${row.storeLocale}-${row.displayType}`}>
                        <td className="py-2 pr-4 font-mono text-xs">{row.storeLocale}{row.localizationId ? '' : ' (new)'}</td>
                        <td className="py-2 pr-4">{SLOT_LABELS[row.displayType] || row.displayType}</td>
                        <td className="py-2 pr-4">{row.files.length}</td>
                        <td className="py-2 pr-4">{row.existing}</td>
                        <td className="py-2">
                          {result ? (
                            <span className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[result.status]}`}>
                                {result.status}
                                {result.message ? `: ${result.message}` : ''}
                              </span>
                              {result.status === 'failed' && (
                                <button type="button" className="rounded-full border border-slate-300 px-3 py-0.5 text-xs font-medium disabled:opacity-40" disabled={!!busy} onClick={() => retry([row])}>
                                  Retry
                                </button>
                              )}
                            </span>
                          ) : row.existing > 0 && !replace ? (
                            <span className="text-xs text-slate-400">will be skipped</span>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            className="rounded-full bg-sky-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
            disabled={!!busy || !target || toUpload === 0}
            onClick={upload}
          >
            Upload {toUpload} image{toUpload === 1 ? '' : 's'}
            {toDelete > 0 ? `, delete ${toDelete}` : ''}
          </button>
          {failed.length > 1 && (
            <button type="button" className="ml-3 rounded-full border border-rose-300 px-5 py-2 text-sm font-medium text-rose-700 disabled:opacity-40" disabled={!!busy} onClick={() => retry(failed)}>
              Retry {failed.length} failed
            </button>
          )}
        </section>
      )}
    </div>
  )
}
