import { createSessionCookie, verifyAdminPassword } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { cookies } from 'next/headers'

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json()
    const username = String(body.username || '')
    const password = String(body.password || '')
    if (!(await verifyAdminPassword(username, password))) {
      return json({ error: 'Invalid credentials.' }, { status: 401 })
    }
    const sessionCookie = await createSessionCookie(username)
    ;(await cookies()).set(sessionCookie.name, sessionCookie.value, sessionCookie.options)
    return json({ ok: true })
  } catch (error) {
    return routeError(error)
  }
}
