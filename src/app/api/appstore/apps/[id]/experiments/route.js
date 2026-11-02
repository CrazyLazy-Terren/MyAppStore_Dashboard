import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'
import { sortLocales } from '@/lib/localeOrder'

export const runtime = 'nodejs'

// Product Page Optimization tests of an app. ?experimentId= returns that
// test's treatments instead.
export async function GET(request, { params }) {
  try {
    const { id } = await params
    const experimentId = request.nextUrl.searchParams.get('experimentId')

    if (experimentId) {
      const treatments = await appStoreConnect.getProductPageTreatments(experimentId)
      return ok({
        data: treatments.map((treatment) => ({
          id: treatment.id,
          name: treatment.attributes?.name,
          locales: sortLocales(treatment.localizations.map((item) => item.attributes?.locale)),
        })),
      })
    }

    const experiments = await appStoreConnect.listProductPageExperiments(id)
    return ok({ data: experiments.map((experiment) => ({ id: experiment.id, ...experiment.attributes })) })
  } catch (error) {
    return fail(error)
  }
}
