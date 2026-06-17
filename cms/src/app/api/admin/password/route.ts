import { requireCsrf, updateAdminPassword } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'

export async function PATCH(request: Request): Promise<Response> {
  try {
    await requireCsrf(request)
    const body = await request.json()
    await updateAdminPassword({
      currentPassword: String(body.currentPassword || ''),
      newPassword: String(body.newPassword || ''),
    })
    return json({ ok: true })
  } catch (error) {
    return routeError(error)
  }
}
