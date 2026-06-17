import { requireCsrf, requireSession } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { createCategory, loadNavigation } from '@/lib/admin/repository'

export async function GET(): Promise<Response> {
  try {
    await requireSession()
    return json({ navigation: await loadNavigation() })
  } catch (error) {
    return routeError(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireCsrf(request)
    return json({ category: await createCategory(await request.json()) }, { status: 201 })
  } catch (error) {
    return routeError(error)
  }
}
