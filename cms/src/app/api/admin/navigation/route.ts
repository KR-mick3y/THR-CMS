import { requireSession } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { loadNavigation } from '@/lib/admin/repository'

export async function GET(): Promise<Response> {
  try {
    await requireSession()
    return json({ navigation: await loadNavigation() })
  } catch (error) {
    return routeError(error)
  }
}
