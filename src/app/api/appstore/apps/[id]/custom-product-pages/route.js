import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'
import { sortLocales } from '@/lib/localeOrder'

export const runtime = 'nodejs'

function summarize(page) {
  return {
    id: page.id,
    name: page.attributes?.name,
    url: page.attributes?.url,
    visible: page.attributes?.visible,
    editableVersionId: page.editableVersion?.id || null,
    state: page.editableVersion?.attributes?.state || page.latestVersion?.attributes?.state || null,
    deepLink: page.editableVersion?.attributes?.deepLink || null,
    locales: sortLocales(page.localizations.map((item) => item.attributes?.locale)),
  }
}

export async function GET(request, { params }) {
  try {
    const { id } = await params
    const pages = await appStoreConnect.listCustomProductPages(id)
    return ok({ data: pages.map(summarize) })
  } catch (error) {
    return fail(error)
  }
}

// { newVersionOf: pageId } starts a new editable version of a live page.
// { name, deepLink?, locales?: string[], promotionalText?: { [locale]: string }, copyFromVersion?: boolean, templatePageId? }
export async function POST(request, { params }) {
  try {
    const { id } = await params
    const { name, deepLink, locales = [], promotionalText = {}, copyFromVersion = false, templatePageId, newVersionOf } = await request.json()

    if (newVersionOf) {
      const version = await appStoreConnect.createCustomProductPageVersion(newVersionOf, deepLink || undefined)
      return ok({ data: { id: newVersionOf, versionId: version?.id } })
    }

    let template
    if (templatePageId) template = { pageId: templatePageId }
    else if (copyFromVersion) {
      const version = await appStoreConnect.getEditableVersion(id, 'IOS')
      if (!version?.id) throw new Error('No App Store version to copy from')
      template = { versionId: version.id }
    }

    const page = await appStoreConnect.createCustomProductPage(id, {
      name,
      deepLink: deepLink || undefined,
      localizations: locales.map((locale) => ({ locale, promotionalText: promotionalText[locale] })),
      template,
    })
    return ok({ data: { id: page?.id, name: page?.attributes?.name } })
  } catch (error) {
    return fail(error)
  }
}
