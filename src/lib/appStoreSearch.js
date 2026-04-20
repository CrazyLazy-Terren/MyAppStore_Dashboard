const APP_STORE_SEARCH_BASE_URL = 'https://itunes.apple.com'
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'app',
  'apps',
  'best',
  'by',
  'for',
  'free',
  'from',
  'game',
  'games',
  'get',
  'in',
  'ios',
  'ipad',
  'iphone',
  'is',
  'it',
  'my',
  'of',
  'on',
  'or',
  'pro',
  'the',
  'to',
  'track',
  'with',
  'your',
])

function splitSeedKeywords(value) {
  return String(value || '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeKeyword(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function localeToCountry(locale) {
  const parts = String(locale || '')
    .replace('_', '-')
    .split('-')
    .filter(Boolean)

  const region = parts.find((part, index) => index > 0 && /^[A-Za-z]{2}$/.test(part))
  return region ? region.toLowerCase() : 'us'
}

function tokenizeWords(value) {
  return normalizeKeyword(value)
    .split(' ')
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
}

function extractCandidateKeywords(text) {
  const words = tokenizeWords(text)
  const phrases = new Set(words)

  for (let index = 0; index < words.length - 1; index += 1) {
    phrases.add(`${words[index]} ${words[index + 1]}`)
  }

  return Array.from(phrases)
}

function addSuggestion(map, keyword, score, rank, source) {
  const normalized = normalizeKeyword(keyword)
  if (!normalized || STOPWORDS.has(normalized) || normalized.length < 3) {
    return
  }

  const existing = map.get(normalized) || {
    keyword: normalized,
    score: 0,
    hits: 0,
    bestRank: Number.POSITIVE_INFINITY,
    sources: {
      title: 0,
      subtitle: 0,
      genre: 0,
      seed: 0,
    },
  }

  existing.score += score
  existing.hits += 1
  existing.bestRank = Math.min(existing.bestRank, rank)
  if (source && Object.prototype.hasOwnProperty.call(existing.sources, source)) {
    existing.sources[source] += 1
  }
  map.set(normalized, existing)
}

function getCompetitionFromSignal(hits, bestRank, popularity) {
  if (hits >= 8 || (bestRank <= 8 && popularity >= 65)) {
    return 'high'
  }

  if (hits >= 4 || popularity >= 40) {
    return 'medium'
  }

  return 'low'
}

function formatKeyword(keyword) {
  return keyword
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function buildSignalLabel(item) {
  const sourceParts = []

  if (item.sources.title > 0) {
    sourceParts.push(`${item.sources.title} in titles`)
  }

  if (item.sources.subtitle > 0) {
    sourceParts.push(`${item.sources.subtitle} in subtitles`)
  }

  if (item.sources.genre > 0) {
    sourceParts.push(`${item.sources.genre} in genres`)
  }

  if (item.sources.seed > 0) {
    sourceParts.push('seed match')
  }

  const rankLabel = Number.isFinite(item.bestRank) ? `best rank #${item.bestRank}` : 'no rank'
  const sourceLabel = sourceParts.length > 0 ? sourceParts.join(', ') : `${item.hits} matches in top search apps`

  return `${sourceLabel}; ${rankLabel}`
}

class AppStoreSearchClient {
  async requestSearch(term, country, limit = 25) {
    const url = new URL('/search', APP_STORE_SEARCH_BASE_URL)
    url.searchParams.set('term', term)
    url.searchParams.set('entity', 'software')
    url.searchParams.set('limit', String(limit))

    if (country) {
      url.searchParams.set('country', country)
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    const data = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(`App Store Search API Error: ${response.status}`)
    }

    return Array.isArray(data?.results) ? data.results : []
  }

  async searchApps(term, country, limit = 25) {
    const storefrontCandidates = [country, 'us', undefined].filter((value, index, array) => array.indexOf(value) === index)

    let lastError = null

    for (const storefront of storefrontCandidates) {
      try {
        return await this.requestSearch(term, storefront, limit)
      } catch (error) {
        lastError = error
      }
    }

    throw lastError || new Error('App Store Search API request failed')
  }

  buildSuggestionsFromResults(seedKeywords, results, limit) {
    const map = new Map()

    seedKeywords.forEach((seed, index) => {
      addSuggestion(map, seed, 120 - index * 5, 1, 'seed')
    })

    results.forEach((result, index) => {
      const rank = index + 1
      const rankWeight = Math.max(4, 28 - index)
      const titleKeywords = extractCandidateKeywords(result?.trackName || '')
      const subtitleKeywords = extractCandidateKeywords(result?.subtitle || result?.description || '')
      const genreKeywords = Array.isArray(result?.genres) ? result.genres.flatMap((genre) => extractCandidateKeywords(genre)) : []

      titleKeywords.forEach((keyword) => addSuggestion(map, keyword, rankWeight * 1.2, rank, 'title'))
      subtitleKeywords.slice(0, 8).forEach((keyword) => addSuggestion(map, keyword, rankWeight * 0.45, rank, 'subtitle'))
      genreKeywords.forEach((keyword) => addSuggestion(map, keyword, rankWeight * 0.7, rank, 'genre'))
    })

    const suggestions = Array.from(map.values()).sort((left, right) => right.score - left.score)
    const maxScore = suggestions[0]?.score || 1

    return suggestions.slice(0, limit).map((item) => {
      const popularity = Math.max(1, Math.min(100, Math.round((item.score / maxScore) * 100)))

      return {
        keyword: formatKeyword(item.keyword),
        popularity,
        competition: getCompetitionFromSignal(item.hits, item.bestRank, popularity),
        bidRange: {
          min: 0,
          max: 0,
        },
        signal: buildSignalLabel(item),
      }
    })
  }

  async suggestKeywords({ seedKeyword = '', locale = 'en-US', limit = 20 }) {
    const seedKeywords = splitSeedKeywords(seedKeyword)
    if (seedKeywords.length === 0) {
      return {
        data: [],
        meta: {
          source: 'app-store-search',
          locale,
          note: 'Enter at least one keyword to search the public App Store API.',
        },
      }
    }

    const country = localeToCountry(locale)
    const resultsById = new Map()

    for (const seed of seedKeywords) {
      const results = await this.searchApps(seed, country, Math.max(20, Math.min(50, limit * 2)))
      results.forEach((result) => {
        const key = String(result?.trackId || result?.bundleId || `${seed}-${result?.trackName || ''}`)
        if (!resultsById.has(key)) {
          resultsById.set(key, result)
        }
      })
    }

    const suggestions = this.buildSuggestionsFromResults(seedKeywords, Array.from(resultsById.values()), limit)

    return {
      data: suggestions,
      meta: {
        source: 'app-store-search',
        locale,
        note: 'Free heuristic from public App Store search results. Popularity and competition are estimated, not official Apple metrics.',
      },
    }
  }
}

const appStoreSearch = new AppStoreSearchClient()
export default appStoreSearch
