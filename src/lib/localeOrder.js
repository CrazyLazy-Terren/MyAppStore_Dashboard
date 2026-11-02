// One fixed locale order for every list: English first (en-US, en-GB, then other
// English variants), then the rest alphabetically.
const ENGLISH_PRIORITY = ['en-us', 'en-gb', 'en-au', 'en-ca', 'en']

function normalize(locale) {
  return String(locale || '')
    .trim()
    .replace(/_/g, '-')
    .toLowerCase()
}

function rank(locale) {
  const normalized = normalize(locale)
  const index = ENGLISH_PRIORITY.indexOf(normalized)
  if (index !== -1) return index
  return /^en(-|$)/.test(normalized) ? ENGLISH_PRIORITY.length : ENGLISH_PRIORITY.length + 1
}

export function compareLocales(left, right) {
  return rank(left) - rank(right) || normalize(left).localeCompare(normalize(right))
}

export function sortLocales(locales) {
  return [...locales].sort(compareLocales)
}

export function sortByLocale(items, getLocale = (item) => item?.attributes?.locale) {
  return [...items].sort((left, right) => compareLocales(getLocale(left), getLocale(right)))
}

export function sortLocaleEntries(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => compareLocales(left, right)))
}
