import dynamodb from '@/lib/dynamodb'
import { fail, ok } from '@/lib/http'

export const runtime = 'nodejs'

export async function GET() {
  try {
    return ok(await dynamodb.listTables())
  } catch (error) {
    return fail(error, error.$metadata?.httpStatusCode || 500)
  }
}
