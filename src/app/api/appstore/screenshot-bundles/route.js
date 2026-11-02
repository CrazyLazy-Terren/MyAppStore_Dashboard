import { applyUpload, openBundleFromBuffer, planUpload } from '@/lib/screenshotBundle'
import { ok, fail } from '@/lib/http'

export const runtime = 'nodejs'

// multipart { file }                  -> unpack the editor's export zip
// json { bundleId, target, ... }      -> plan, or upload when apply is true
//                                       (only: [{ storeLocale, displayType }] to retry rows)
export async function POST(request) {
  try {
    if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
      const file = (await request.formData()).get('file')
      if (!file || typeof file.arrayBuffer !== 'function') {
        throw new Error('The screenshot export zip is required')
      }

      const { bundleId, sets, locales } = await openBundleFromBuffer(Buffer.from(await file.arrayBuffer()))
      return ok({ data: { bundleId, sets, locales } })
    }

    const { bundleId, target, localeMap, displayTypes, replace = false, apply = false, only } = await request.json()
    if (!bundleId || !target?.kind) {
      throw new Error('bundleId and target are required')
    }

    if (apply) {
      return ok({ data: await applyUpload(bundleId, target, { localeMap, displayTypes, replace, only }) })
    }

    const { folders, ...plan } = await planUpload(bundleId, target, { localeMap, displayTypes })
    return ok({ data: plan })
  } catch (error) {
    return fail(error)
  }
}
