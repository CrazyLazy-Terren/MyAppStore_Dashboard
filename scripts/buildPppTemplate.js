// Rebuilds src/lib/pppTemplate.json from the World Bank API.
// Price level ratio (PLR) = PPP conversion factor (LCU per international $) / official exchange rate (LCU per US$).
// A PLR of 0.25 means goods cost about a quarter of what they cost in the US. Run yearly: `npm run build-ppp-template`.
const fs = require('node:fs')
const path = require('node:path')

const WORLD_BANK = 'https://api.worldbank.org/v2/country/all/indicator'
const OUTPUT = path.join(__dirname, '..', 'src', 'lib', 'pppTemplate.json')
const MIN_YEAR = 2020

// Territories the World Bank does not cover. Values are IMF-based estimates; review them when rebuilding.
const MANUAL_ESTIMATES = {
  TWN: { name: 'Taiwan', plr: 0.45, year: 'estimate' },
}

// App Store Connect uses a few territory codes that differ from World Bank codes.
const CODE_ALIASES = {
  XKX: 'XKS',
}

// Returns Map<countryCode, Map<year, { name, value }>> for every year since MIN_YEAR.
async function fetchByYear(indicator) {
  const res = await fetch(`${WORLD_BANK}/${indicator}?format=json&date=${MIN_YEAR}:${new Date().getFullYear()}&per_page=20000`)
  const json = await res.json()
  if (!Array.isArray(json) || !Array.isArray(json[1])) {
    throw new Error(`World Bank indicator ${indicator} returned no data: ${JSON.stringify(json).slice(0, 200)}`)
  }
  const byCode = new Map()
  for (const row of json[1]) {
    if (!row.countryiso3code || row.value == null) continue
    if (!byCode.has(row.countryiso3code)) byCode.set(row.countryiso3code, new Map())
    byCode.get(row.countryiso3code).set(Number(row.date), { name: row.country?.value, value: Number(row.value) })
  }
  return byCode
}

async function main() {
  const [ppp, fx] = await Promise.all([fetchByYear('PA.NUS.PPP'), fetchByYear('PA.NUS.FCRF')])
  const territories = {}

  for (const [code, pppYears] of ppp) {
    const fxYears = fx.get(code)
    if (!fxYears) continue
    // Mixing years across a currency redenomination produces nonsense, so use the latest year that has both values.
    const year = [...pppYears.keys()].filter((y) => fxYears.get(y)?.value > 0).sort((a, b) => b - a)[0]
    if (!year) continue

    const plr = pppYears.get(year).value / fxYears.get(year).value
    // Values outside this band come from currency mismatches in the source data (e.g. Liberia mixes LRD and USD).
    if (!Number.isFinite(plr) || plr < 0.05 || plr > 3) continue

    territories[CODE_ALIASES[code] || code] = { name: pppYears.get(year).name, plr: Number(plr.toFixed(3)), year }
  }

  for (const [code, estimate] of Object.entries(MANUAL_ESTIMATES)) {
    if (!territories[code]) territories[code] = estimate
  }

  const sorted = Object.fromEntries(Object.entries(territories).sort(([a], [b]) => a.localeCompare(b)))
  const output = {
    source: 'World Bank PA.NUS.PPP / PA.NUS.FCRF',
    generatedAt: new Date().toISOString().slice(0, 10),
    territories: sorted,
  }

  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`)
  console.log(`Wrote ${Object.keys(sorted).length} territories to ${path.relative(process.cwd(), OUTPUT)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
