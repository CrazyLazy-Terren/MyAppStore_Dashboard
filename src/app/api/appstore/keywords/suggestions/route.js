import appStoreSearch from '@/lib/appStoreSearch'
import { fail, ok } from '@/lib/http'

export async function POST(request) {
  try {
    const body = await request.json()
    const { adamId, seedKeyword = '', locale = 'en-US', limit = 20 } = body || {}

    const result = await appStoreSearch.suggestKeywords({
      adamId: adamId ? String(adamId).trim() : undefined,
      seedKeyword: String(seedKeyword || '').trim(),
      locale: String(locale || 'en-US').trim() || 'en-US',
      limit,
    })

    return ok(result)
  } catch (error) {
    return fail(error)
  }
}
