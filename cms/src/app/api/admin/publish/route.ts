import { requireCsrf } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { publish } from '@/lib/admin/repository'

export async function POST(request: Request): Promise<Response> {
  try {
    await requireCsrf(request)
    const body = await request.json()
    return json({ output: await publish(String(body.message || '')) })
  } catch (error) {
    return routeError(error)
  }
}
