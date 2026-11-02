import dynamodb from '@/lib/dynamodb'
import { fail, ok } from '@/lib/http'

export const runtime = 'nodejs'

// Scans the table (or ?index=) a page at a time. Passing ?pk= switches to a key
// Query, optionally narrowed with ?skOp=&sk= (and ?sk2= for "between").
export async function GET(request, { params }) {
  try {
    const { name } = await params
    const tableName = decodeURIComponent(name)
    const query = request.nextUrl.searchParams
    const options = {
      indexName: query.get('index') || undefined,
      limit: query.get('limit') || undefined,
      cursor: query.get('cursor') || undefined,
    }

    const partitionValue = query.get('pk')
    if (partitionValue !== null && partitionValue !== '') {
      const page = await dynamodb.queryTable(tableName, {
        ...options,
        partitionValue,
        sortOperator: query.get('skOp') || undefined,
        sortValue: query.get('sk') ?? undefined,
        sortValue2: query.get('sk2') ?? undefined,
        descending: query.get('order') === 'desc',
      })
      return ok({ mode: 'query', ...page })
    }

    return ok({ mode: 'scan', ...(await dynamodb.scanTable(tableName, options)) })
  } catch (error) {
    return fail(error, error.$metadata?.httpStatusCode || (error.name === 'Error' ? 400 : 500))
  }
}
