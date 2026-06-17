import { requireSession } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { gitDiff } from '@/lib/admin/repository'

export async function GET(): Promise<Response> {
  try {
    await requireSession()
    return json({ diff: await gitDiff() })
  } catch (error) {
    return routeError(error)
  }
}
