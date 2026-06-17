import { requireCsrf } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { reorderCategory } from '@/lib/admin/repository'

export async function POST(request: Request): Promise<Response> {
  try {
    await requireCsrf(request)
    const body = await request.json()
    return json({ navigation: await reorderCategory(String(body.id || 'root'), body.orderedIds || []) })
  } catch (error) {
    return routeError(error)
  }
}
