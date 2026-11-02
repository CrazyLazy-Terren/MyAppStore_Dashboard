import dynamodb from '@/lib/dynamodb'
import { fail, ok } from '@/lib/http'

export const runtime = 'nodejs'

export async function GET(request, { params }) {
  try {
    const { name } = await params
    return ok(await dynamodb.describeTable(decodeURIComponent(name)))
  } catch (error) {
    return fail(error, error.$metadata?.httpStatusCode || 500)
  }
}
