import { requireCsrf } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { deleteCategory, deleteCategoryOnly, deleteCategoryTree, moveCategory, updateCategory } from '@/lib/admin/repository'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    await requireCsrf(request)
    return json({ category: await updateCategory(decodeURIComponent((await context.params).id), await request.json()) })
  } catch (error) {
    return routeError(error)
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    await requireCsrf(request)
    return json({ category: await moveCategory(decodeURIComponent((await context.params).id), await request.json()) })
  } catch (error) {
    return routeError(error)
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    await requireCsrf(request)
    const id = decodeURIComponent((await context.params).id)
    const mode = new URL(request.url).searchParams.get('mode')
    if (mode === 'lift') {
      return json({ navigation: await deleteCategoryOnly(id) })
    }
    if (mode === 'cascade') {
      await deleteCategoryTree(id)
      return json({ ok: true })
    }
    await deleteCategory(id)
    return json({ ok: true })
  } catch (error) {
    return routeError(error)
  }
}
