import { requireCsrf, requireSession } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { archivePage, deletePage, getPage, updatePage } from '@/lib/admin/repository'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    await requireSession()
    return json(await getPage(decodeURIComponent((await context.params).id)))
  } catch (error) {
    return routeError(error)
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    await requireCsrf(request)
    const id = decodeURIComponent((await context.params).id)
    return json({ page: await updatePage(id, await request.json()) })
  } catch (error) {
    return routeError(error)
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    await requireCsrf(request)
    const id = decodeURIComponent((await context.params).id)
    const mode = new URL(request.url).searchParams.get('mode')
    if (mode === 'delete') {
      await deletePage(id)
      return json({ ok: true })
    }
    return json({ page: await archivePage(id) })
  } catch (error) {
    return routeError(error)
  }
}
