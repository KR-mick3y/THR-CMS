import { requireCsrf, requireSession } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { createPage, listPages } from '@/lib/admin/repository'

export async function GET(): Promise<Response> {
  try {
    await requireSession()
    return json({ pages: await listPages() })
  } catch (error) {
    return routeError(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireCsrf(request)
    const body = await request.json()
    return json({ page: await createPage(body) }, { status: 201 })
  } catch (error) {
    return routeError(error)
  }
}
