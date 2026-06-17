import { requireCsrf, requireSession } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { getSiteSettings, updateSiteSettings } from '@/lib/admin/repository'

export async function GET(): Promise<Response> {
  try {
    await requireSession()
    return json({ settings: await getSiteSettings() })
  } catch (error) {
    return routeError(error)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    await requireCsrf(request)
    return json({ settings: await updateSiteSettings(await request.json()) })
  } catch (error) {
    return routeError(error)
  }
}
