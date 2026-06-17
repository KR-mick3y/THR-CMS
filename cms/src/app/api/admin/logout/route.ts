import { clearSession, requireCsrf } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'

export async function POST(request: Request): Promise<Response> {
  try {
    await requireCsrf(request)
    await clearSession()
    return json({ ok: true })
  } catch (error) {
    return routeError(error)
  }
}
