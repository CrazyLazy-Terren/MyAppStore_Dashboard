import appStoreConnect from '@/lib/appStoreConnect'
import { ok, fail } from '@/lib/http'

export async function GET() {
  try {
    const apps = await appStoreConnect.listApps()
    return ok({ data: apps })
  } catch (error) {
    return fail(error)
  }
}
