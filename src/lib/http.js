import { NextResponse } from 'next/server'

export function ok(data, status = 200) {
  return NextResponse.json(data, { status })
}

export function fail(error, status = 500) {
  const message = error instanceof Error ? error.message : 'Internal Server Error'
  return NextResponse.json({ error: { message, status } }, { status })
}
