import { METADATA_LIMITS, checkMetadata } from '@/lib/metadataLimits'
import { ok, fail } from '@/lib/http'

export async function GET() {
  return ok({ limits: METADATA_LIMITS })
}

// Body: { scope?: 'app', fields: { name, subtitle, ... } }
//   or: { scope?: 'app', locales: { 'en-US': { name, ... }, 'ja': { ... } } }
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)
    const { scope = 'app', fields, locales } = body || {}

    if (locales && typeof locales === 'object') {
      const checkedLocales = Object.fromEntries(Object.entries(locales).map(([locale, localeFields]) => [locale, checkMetadata(localeFields, scope)]))
      return ok({
        scope,
        ok: Object.values(checkedLocales).every((result) => result.ok),
        locales: checkedLocales,
      })
    }

    if (!fields || typeof fields !== 'object') {
      return fail(new Error('fields or locales is required'), 400)
    }

    return ok(checkMetadata(fields, scope))
  } catch (error) {
    return fail(error, 400)
  }
}
