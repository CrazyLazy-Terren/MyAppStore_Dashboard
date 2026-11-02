'use client'

import { useEffect, useMemo, useState } from 'react'
import { dynamoDBAPI } from '@/components/api'

const SELECTED_TABLE_STORAGE_KEY = 'dynamodb.selectedTable'
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500]
const SORT_OPERATORS = [
  { value: '', label: 'Any' },
  { value: '=', label: '=' },
  { value: '<', label: '<' },
  { value: '<=', label: '<=' },
  { value: '>', label: '>' },
  { value: '>=', label: '>=' },
  { value: 'begins_with', label: 'begins with' },
  { value: 'between', label: 'between' },
]

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-cyan-600 focus:outline-none focus:ring-1 focus:ring-cyan-600'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-[0.15em] text-slate-500'

function readSavedTable() {
  try {
    return window.localStorage.getItem(SELECTED_TABLE_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function saveTable(tableName) {
  try {
    window.localStorage.setItem(SELECTED_TABLE_STORAGE_KEY, tableName)
  } catch {
    // Storage can be unavailable (private mode); the selection just won't persist.
  }
}

function formatNumber(value) {
  return value === null || value === undefined ? '—' : Number(value).toLocaleString()
}

function formatBytes(value) {
  if (value === null || value === undefined) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatCell(value) {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function describeKey(key) {
  return key ? `${key.name} (${key.type})` : '—'
}

// Key attributes first, then every other attribute in the order it first appears.
function getColumns(items, keySchema) {
  const keyColumns = [keySchema?.partitionKey?.name, keySchema?.sortKey?.name].filter(Boolean)
  const seen = new Set(keyColumns)
  const columns = [...keyColumns]
  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }
  return columns
}

function SummaryTile({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
      <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-900" title={String(value)}>
        {value}
      </div>
    </div>
  )
}

function TableSummary({ table }) {
  const indexes = [...table.globalSecondaryIndexes.map((index) => ({ ...index, kind: 'GSI' })), ...table.localSecondaryIndexes.map((index) => ({ ...index, kind: 'LSI' }))]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryTile label="Partition key" value={describeKey(table.keySchema.partitionKey)} />
        <SummaryTile label="Sort key" value={describeKey(table.keySchema.sortKey)} />
        <SummaryTile label="Items (approx.)" value={formatNumber(table.itemCount)} />
        <SummaryTile label="Size" value={formatBytes(table.sizeBytes)} />
        <SummaryTile label="Billing" value={table.billingMode === 'PAY_PER_REQUEST' ? 'On-demand' : 'Provisioned'} />
        <SummaryTile label="Status" value={table.status} />
      </div>
      {indexes.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {indexes.map((index) => (
            <span key={index.name} className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-900 ring-1 ring-cyan-200">
              <span className="font-semibold">{index.kind}</span> {index.name}: {describeKey(index.keySchema.partitionKey)}
              {index.keySchema.sortKey ? ` / ${describeKey(index.keySchema.sortKey)}` : ''}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ItemDetail({ item, onClose }) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(item, null, 2)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="rounded-2xl bg-slate-900 p-4 text-slate-100 shadow-lg">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Item JSON</h3>
        <div className="flex gap-2 text-xs">
          <button type="button" onClick={copy} className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20">
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={onClose} className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20">
            Close
          </button>
        </div>
      </div>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all text-xs leading-relaxed">{json}</pre>
    </div>
  )
}

export default function DynamoDBReader() {
  const [tables, setTables] = useState([])
  const [region, setRegion] = useState('')
  const [tablesLoading, setTablesLoading] = useState(true)
  const [tablesError, setTablesError] = useState('')
  const [tableFilter, setTableFilter] = useState('')

  const [selectedTable, setSelectedTable] = useState('')
  const [table, setTable] = useState(null)
  const [tableError, setTableError] = useState('')

  const [mode, setMode] = useState('scan')
  const [indexName, setIndexName] = useState('')
  const [pageSize, setPageSize] = useState(50)
  const [partitionValue, setPartitionValue] = useState('')
  const [sortOperator, setSortOperator] = useState('')
  const [sortValue, setSortValue] = useState('')
  const [sortValue2, setSortValue2] = useState('')
  const [descending, setDescending] = useState(false)

  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [stats, setStats] = useState({ count: 0, scannedCount: 0 })
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState('')
  const [lastRequest, setLastRequest] = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)

  useEffect(() => {
    let cancelled = false
    dynamoDBAPI
      .listTables()
      .then(({ data }) => {
        if (cancelled) return
        setTables(data.tables)
        setRegion(data.region)
        const saved = readSavedTable()
        if (saved && data.tables.includes(saved)) setSelectedTable(saved)
      })
      .catch((error) => !cancelled && setTablesError(error.message))
      .finally(() => !cancelled && setTablesLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedTable) return
    let cancelled = false
    setTable(null)
    setTableError('')
    setItems([])
    setCursor(null)
    setLastRequest(null)
    setSelectedItem(null)
    setIndexName('')
    setPartitionValue('')
    setSortOperator('')
    setSortValue('')
    setSortValue2('')
    dynamoDBAPI
      .describeTable(selectedTable)
      .then(({ data }) => !cancelled && setTable(data))
      .catch((error) => !cancelled && setTableError(error.message))
    return () => {
      cancelled = true
    }
  }, [selectedTable])

  const filteredTables = useMemo(() => {
    const needle = tableFilter.trim().toLowerCase()
    return needle ? tables.filter((name) => name.toLowerCase().includes(needle)) : tables
  }, [tables, tableFilter])

  const activeKeySchema = useMemo(() => {
    if (!table) return null
    if (!indexName) return table.keySchema
    const index = [...table.globalSecondaryIndexes, ...table.localSecondaryIndexes].find((entry) => entry.name === indexName)
    return index?.keySchema || table.keySchema
  }, [table, indexName])

  const columns = useMemo(() => getColumns(items, activeKeySchema), [items, activeKeySchema])

  const selectTable = (name) => {
    setSelectedTable(name)
    saveTable(name)
  }

  const fetchItems = async (params, append) => {
    setItemsLoading(true)
    setItemsError('')
    try {
      const { data } = await dynamoDBAPI.getItems(selectedTable, params)
      setItems((previous) => (append ? [...previous, ...data.items] : data.items))
      setStats((previous) => ({
        count: (append ? previous.count : 0) + data.count,
        scannedCount: (append ? previous.scannedCount : 0) + data.scannedCount,
      }))
      setCursor(data.cursor)
      setLastRequest(params)
      if (!append) setSelectedItem(null)
    } catch (error) {
      setItemsError(error.message)
    } finally {
      setItemsLoading(false)
    }
  }

  const run = (event) => {
    event?.preventDefault()
    const params = { index: indexName, limit: pageSize }
    if (mode === 'query') {
      Object.assign(params, {
        pk: partitionValue,
        skOp: sortOperator,
        sk: sortOperator ? sortValue : '',
        sk2: sortOperator === 'between' ? sortValue2 : '',
        order: descending ? 'desc' : '',
      })
    }
    fetchItems(params, false)
  }

  const loadMore = () => {
    if (lastRequest && cursor) fetchItems({ ...lastRequest, cursor }, true)
  }

  const indexOptions = table ? [...table.globalSecondaryIndexes, ...table.localSecondaryIndexes] : []

  return (
    <div className="grid w-full gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 lg:self-start">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Tables</h2>
          {region ? <span className="text-xs text-slate-500">{region}</span> : null}
        </div>
        <input type="search" value={tableFilter} onChange={(event) => setTableFilter(event.target.value)} placeholder="Filter tables" className={inputClass} />
        <div className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
          {tablesLoading ? <p className="px-2 py-1 text-sm text-slate-500">Loading tables…</p> : null}
          {tablesError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{tablesError}</p> : null}
          {!tablesLoading && !tablesError && filteredTables.length === 0 ? <p className="px-2 py-1 text-sm text-slate-500">No tables found.</p> : null}
          {filteredTables.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => selectTable(name)}
              className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm transition ${name === selectedTable ? 'bg-cyan-700 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
              title={name}
            >
              {name}
            </button>
          ))}
        </div>
      </aside>

      <section className="min-w-0 space-y-6">
        {!selectedTable ? (
          <div className="rounded-2xl bg-white p-10 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">Pick a table to browse its items.</div>
        ) : (
          <>
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <h2 className="mb-4 truncate text-lg font-semibold text-slate-900">{selectedTable}</h2>
              {tableError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{tableError}</p> : null}
              {!table && !tableError ? <p className="text-sm text-slate-500">Loading table details…</p> : null}
              {table ? <TableSummary table={table} /> : null}
            </div>

            {table ? (
              <form onSubmit={run} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="inline-flex rounded-full bg-slate-100 p-1 text-sm font-medium">
                    {['scan', 'query'].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMode(value)}
                        className={`rounded-full px-4 py-1.5 capitalize transition ${mode === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                  <div className="min-w-48">
                    <label className={labelClass} htmlFor="dynamo-index">
                      Index
                    </label>
                    <select id="dynamo-index" value={indexName} onChange={(event) => setIndexName(event.target.value)} className={inputClass}>
                      <option value="">Table (base)</option>
                      {indexOptions.map((index) => (
                        <option key={index.name} value={index.name}>
                          {index.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28">
                    <label className={labelClass} htmlFor="dynamo-page-size">
                      Page size
                    </label>
                    <select id="dynamo-page-size" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className={inputClass}>
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {mode === 'query' && activeKeySchema ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <label className={labelClass} htmlFor="dynamo-pk">
                        {describeKey(activeKeySchema.partitionKey)} =
                      </label>
                      <input id="dynamo-pk" value={partitionValue} onChange={(event) => setPartitionValue(event.target.value)} required className={inputClass} />
                    </div>
                    {activeKeySchema.sortKey ? (
                      <>
                        <div>
                          <label className={labelClass} htmlFor="dynamo-sk-op">
                            {describeKey(activeKeySchema.sortKey)}
                          </label>
                          <select id="dynamo-sk-op" value={sortOperator} onChange={(event) => setSortOperator(event.target.value)} className={inputClass}>
                            {SORT_OPERATORS.map((operator) => (
                              <option key={operator.value} value={operator.value}>
                                {operator.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {sortOperator ? (
                          <div className={sortOperator === 'between' ? 'grid grid-cols-2 gap-2' : ''}>
                            <div>
                              <label className={labelClass} htmlFor="dynamo-sk">
                                Value
                              </label>
                              <input id="dynamo-sk" value={sortValue} onChange={(event) => setSortValue(event.target.value)} required className={inputClass} />
                            </div>
                            {sortOperator === 'between' ? (
                              <div>
                                <label className={labelClass} htmlFor="dynamo-sk2">
                                  And
                                </label>
                                <input id="dynamo-sk2" value={sortValue2} onChange={(event) => setSortValue2(event.target.value)} required className={inputClass} />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                          <input type="checkbox" checked={descending} onChange={(event) => setDescending(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                          Newest first (descending)
                        </label>
                      </>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={itemsLoading}
                    className="rounded-full bg-cyan-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {itemsLoading && !cursor ? 'Running…' : mode === 'query' ? 'Run query' : 'Scan'}
                  </button>
                  {mode === 'scan' ? <span className="text-xs text-slate-500">Scans read every item in order and use read capacity — prefer Query when you know the key.</span> : null}
                </div>
                {itemsError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{itemsError}</p> : null}
              </form>
            ) : null}

            {lastRequest ? (
              <div className="space-y-4">
                <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3 text-sm">
                    <span className="font-semibold text-slate-900">{items.length.toLocaleString()} items</span>
                    <span className="text-xs text-slate-500">
                      Returned {stats.count.toLocaleString()} · scanned {stats.scannedCount.toLocaleString()}
                      {cursor ? ' · more available' : ' · end of results'}
                    </span>
                  </div>
                  {items.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-slate-500">No items matched.</p>
                  ) : (
                    <div className="max-h-[65vh] overflow-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                          <tr>
                            {columns.map((column) => (
                              <th key={column} className="whitespace-nowrap border-b border-slate-200 px-4 py-2 font-semibold">
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, rowIndex) => (
                            <tr
                              key={rowIndex}
                              onClick={() => setSelectedItem(item)}
                              className={`cursor-pointer border-b border-slate-100 transition hover:bg-cyan-50 ${selectedItem === item ? 'bg-cyan-50' : ''}`}
                            >
                              {columns.map((column) => {
                                const text = formatCell(item[column])
                                return (
                                  <td key={column} className="max-w-xs truncate whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-800" title={text}>
                                    {text}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {cursor ? (
                    <div className="border-t border-slate-200 px-5 py-3">
                      <button
                        type="button"
                        onClick={loadMore}
                        disabled={itemsLoading}
                        className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:opacity-60"
                      >
                        {itemsLoading ? 'Loading…' : 'Load more'}
                      </button>
                    </div>
                  ) : null}
                </div>
                {selectedItem ? <ItemDetail item={selectedItem} onClose={() => setSelectedItem(null)} /> : null}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}
