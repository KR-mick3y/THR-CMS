import { getSession } from '@/lib/admin/auth'
import { json } from '@/lib/admin/http'

export async function GET(): Promise<Response> {
  const session = await getSession()
  return json(session ? { authenticated: true, user: session.user, csrf: session.csrf } : { authenticated: false }, {
    status: session ? 200 : 401,
  })
}
