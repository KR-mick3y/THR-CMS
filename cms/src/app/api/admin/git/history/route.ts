import { requireSession } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { gitHistory } from '@/lib/admin/repository'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession()
    const limit = Number(new URL(request.url).searchParams.get('limit') || 20)
    return json({ commits: await gitHistory(limit) })
  } catch (error) {
    return routeError(error)
  }
}
