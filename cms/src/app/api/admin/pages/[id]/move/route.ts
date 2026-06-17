import { requireCsrf } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { movePage } from '@/lib/admin/repository'

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    await requireCsrf(request)
    return json({ page: await movePage(decodeURIComponent((await context.params).id), await request.json()) })
  } catch (error) {
    return routeError(error)
  }
}
