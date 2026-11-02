import 'dotenv/config'
import { DescribeTableCommand, DynamoDBClient, ListTablesCommand, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'

// Read-only access to DynamoDB. Credentials come from the default AWS provider chain
// (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, AWS_PROFILE, SSO, instance role, ...).
const MAX_PAGE_SIZE = 500
const DEFAULT_PAGE_SIZE = 50

const SORT_KEY_OPERATORS = {
  '=': (name, value) => `${name} = ${value}`,
  '<': (name, value) => `${name} < ${value}`,
  '<=': (name, value) => `${name} <= ${value}`,
  '>': (name, value) => `${name} > ${value}`,
  '>=': (name, value) => `${name} >= ${value}`,
  begins_with: (name, value) => `begins_with(${name}, ${value})`,
  between: (name, value, value2) => `${name} BETWEEN ${value} AND ${value2}`,
}

let client = null

// Falls back to the SDK's own lookup (AWS_REGION, then the profile in ~/.aws/config) when unset.
function getConfiguredRegion() {
  return process.env.DYNAMODB_REGION || undefined
}

function getClient() {
  if (!client) {
    client = new DynamoDBClient({
      region: getConfiguredRegion(),
      ...(process.env.DYNAMODB_ENDPOINT ? { endpoint: process.env.DYNAMODB_ENDPOINT } : {}),
    })
  }
  return client
}

function toNumber(numString) {
  const num = Number(numString)
  return Number.isSafeInteger(num) || (Number.isFinite(num) && !Number.isInteger(num)) ? num : numString
}

// Sets and binary values don't survive JSON.stringify, so turn them into arrays and base64 strings.
function toJsonSafe(value) {
  if (value instanceof Set) return [...value].map(toJsonSafe)
  if (value instanceof Uint8Array) return { $binary: Buffer.from(value).toString('base64') }
  if (Array.isArray(value)) return value.map(toJsonSafe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toJsonSafe(entry)]))
  }
  return value
}

function toPlainItem(item) {
  return toJsonSafe(unmarshall(item, { wrapNumbers: toNumber }))
}

function encodeCursor(lastEvaluatedKey) {
  return lastEvaluatedKey ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url') : null
}

function decodeCursor(cursor) {
  if (!cursor) return undefined
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Invalid pagination cursor.')
  }
}

function clampLimit(limit) {
  const parsed = Number.parseInt(limit, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE
  return Math.min(parsed, MAX_PAGE_SIZE)
}

function toPage(response) {
  return {
    items: (response.Items || []).map(toPlainItem),
    count: response.Count || 0,
    scannedCount: response.ScannedCount || 0,
    cursor: encodeCursor(response.LastEvaluatedKey),
  }
}

function summarizeIndex(index, attributeTypes) {
  return {
    name: index.IndexName,
    keySchema: summarizeKeySchema(index.KeySchema, attributeTypes),
    projection: index.Projection?.ProjectionType || null,
    itemCount: index.ItemCount ?? null,
    status: index.IndexStatus || null,
  }
}

function summarizeKeySchema(keySchema = [], attributeTypes) {
  const partitionKey = keySchema.find((key) => key.KeyType === 'HASH')
  const sortKey = keySchema.find((key) => key.KeyType === 'RANGE')
  const describe = (key) => (key ? { name: key.AttributeName, type: attributeTypes[key.AttributeName] || 'S' } : null)
  return { partitionKey: describe(partitionKey), sortKey: describe(sortKey) }
}

export async function listTables() {
  const tables = []
  let ExclusiveStartTableName
  do {
    const response = await getClient().send(new ListTablesCommand({ ExclusiveStartTableName }))
    tables.push(...(response.TableNames || []))
    ExclusiveStartTableName = response.LastEvaluatedTableName
  } while (ExclusiveStartTableName)
  return { tables, region: await getClient().config.region() }
}

export async function describeTable(tableName) {
  const { Table: table } = await getClient().send(new DescribeTableCommand({ TableName: tableName }))
  const attributeTypes = Object.fromEntries((table.AttributeDefinitions || []).map((attr) => [attr.AttributeName, attr.AttributeType]))

  return {
    name: table.TableName,
    status: table.TableStatus,
    itemCount: table.ItemCount ?? null,
    sizeBytes: table.TableSizeBytes ?? null,
    billingMode: table.BillingModeSummary?.BillingMode || 'PROVISIONED',
    createdAt: table.CreationDateTime || null,
    keySchema: summarizeKeySchema(table.KeySchema, attributeTypes),
    globalSecondaryIndexes: (table.GlobalSecondaryIndexes || []).map((index) => summarizeIndex(index, attributeTypes)),
    localSecondaryIndexes: (table.LocalSecondaryIndexes || []).map((index) => summarizeIndex(index, attributeTypes)),
  }
}

export async function scanTable(tableName, { limit, cursor, indexName } = {}) {
  const response = await getClient().send(
    new ScanCommand({
      TableName: tableName,
      IndexName: indexName || undefined,
      Limit: clampLimit(limit),
      ExclusiveStartKey: decodeCursor(cursor),
    }),
  )
  return toPage(response)
}

function toKeyValue(value, type) {
  if (type === 'N') {
    if (value === '' || !Number.isFinite(Number(value))) {
      throw new Error(`Key value "${value}" must be a number.`)
    }
    return { N: String(value) }
  }
  if (type === 'B') return { B: Buffer.from(value, 'base64') }
  return { S: String(value) }
}

export async function queryTable(tableName, { partitionValue, sortOperator, sortValue, sortValue2, indexName, limit, cursor, descending } = {}) {
  if (partitionValue === undefined || partitionValue === null || partitionValue === '') {
    throw new Error('A partition key value is required to query.')
  }

  const table = await describeTable(tableName)
  const index = indexName ? [...table.globalSecondaryIndexes, ...table.localSecondaryIndexes].find((entry) => entry.name === indexName) : null
  if (indexName && !index) {
    throw new Error(`Index "${indexName}" was not found on table "${tableName}".`)
  }

  const { partitionKey, sortKey } = (index || table).keySchema
  const names = { '#pk': partitionKey.name }
  const values = { ':pk': toKeyValue(partitionValue, partitionKey.type) }
  let condition = '#pk = :pk'

  if (sortOperator && sortValue !== undefined && sortValue !== '') {
    const buildSortCondition = SORT_KEY_OPERATORS[sortOperator]
    if (!buildSortCondition) throw new Error(`Unsupported sort key operator "${sortOperator}".`)
    if (!sortKey) throw new Error('This table or index has no sort key.')
    if (sortOperator === 'between' && (sortValue2 === undefined || sortValue2 === '')) {
      throw new Error('"between" needs two sort key values.')
    }

    names['#sk'] = sortKey.name
    values[':sk'] = toKeyValue(sortValue, sortKey.type)
    if (sortOperator === 'between') values[':sk2'] = toKeyValue(sortValue2, sortKey.type)
    condition += ` AND ${buildSortCondition('#sk', ':sk', ':sk2')}`
  }

  const response = await getClient().send(
    new QueryCommand({
      TableName: tableName,
      IndexName: indexName || undefined,
      KeyConditionExpression: condition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ScanIndexForward: !descending,
      Limit: clampLimit(limit),
      ExclusiveStartKey: decodeCursor(cursor),
    }),
  )
  return toPage(response)
}

export default { listTables, describeTable, scanTable, queryTable }
