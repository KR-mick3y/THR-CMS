import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'

export type AdminSession = {
  user: string
  csrf: string
  exp: number
}

const COOKIE_NAME = 'cms_admin'
const MAX_AGE_SECONDS = 60 * 60 * 8
const DEVELOPMENT_ADMIN_USERNAME = 'admin'
const DEVELOPMENT_ADMIN_PASSWORD_HASH = '$2a$10$cfh7rOErthcDlvSu1vDt6Ock/WY2aSaEoFVzFNa90wkUZoXduTniK'
const adminSettingsRoot = path.join(process.cwd(), '.cms-private')
const adminAuthSettingsPath = path.join(adminSettingsRoot, 'admin-auth.json')
type SessionCookieOptions = {
  httpOnly: boolean
  secure: boolean
  sameSite: 'strict'
  path: string
  maxAge: number
}

export async function verifyAdminPassword(username: string, password: string): Promise<boolean> {
  const localSettings = await readAdminAuthSettings()
  const expectedUser = localSettings.username || process.env.ADMIN_USERNAME || DEVELOPMENT_ADMIN_USERNAME
  const passwordHash = localSettings.passwordHash || process.env.ADMIN_PASSWORD_HASH || DEVELOPMENT_ADMIN_PASSWORD_HASH
  if (!expectedUser || !passwordHash || username !== expectedUser) return false
  return bcrypt.compare(password, passwordHash)
}

export async function updateAdminPassword(input: { currentPassword: string; newPassword: string }): Promise<void> {
  const username = (await readAdminAuthSettings()).username || process.env.ADMIN_USERNAME || DEVELOPMENT_ADMIN_USERNAME
  if (!input.newPassword || input.newPassword.length < 8) throw new Error('New password must be at least 8 characters.')
  const valid = await verifyAdminPassword(username, input.currentPassword)
  if (!valid) throw new Error('Current password is incorrect.')
  await fs.mkdir(adminSettingsRoot, { recursive: true })
  await fs.writeFile(adminAuthSettingsPath, `${JSON.stringify({ username, passwordHash: await bcrypt.hash(input.newPassword, 10) }, null, 2)}\n`, { mode: 0o600 })
}

export async function createSessionCookie(user: string): Promise<{ name: string; value: string; options: SessionCookieOptions }> {
  const session: AdminSession = {
    user,
    csrf: randomBytes(24).toString('base64url'),
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  }
  return {
    name: COOKIE_NAME,
    value: sign(JSON.stringify(session)),
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: MAX_AGE_SECONDS,
    },
  }
}

export async function getSession(): Promise<AdminSession | null> {
  const value = (await cookies()).get(COOKIE_NAME)?.value
  if (!value) return null
  try {
    const payload = JSON.parse(verify(value)) as AdminSession
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export async function clearSession(): Promise<void> {
  ;(await cookies()).delete(COOKIE_NAME)
}

export async function requireSession(): Promise<AdminSession> {
  const session = await getSession()
  if (!session) throw new Response('Unauthorized', { status: 401 })
  return session
}

export async function requireCsrf(request: Request): Promise<AdminSession> {
  const session = await requireSession()
  if (request.headers.get('x-csrf-token') !== session.csrf) {
    throw new Response('Missing or invalid CSRF token.', { status: 403 })
  }
  return session
}

function sign(payload: string): string {
  const body = Buffer.from(payload).toString('base64url')
  return `${body}.${hmac(body)}`
}

function verify(value: string): string {
  const [body, mac] = value.split('.')
  if (!body || !mac) throw new Error('Invalid session.')
  const expected = hmac(body)
  const left = Buffer.from(mac)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error('Invalid session signature.')
  return Buffer.from(body, 'base64url').toString('utf8')
}

function hmac(value: string): string {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('ADMIN_SESSION_SECRET is required in production.')
  return createHmac('sha256', secret || 'development-only-change-me').update(value).digest('base64url')
}

async function readAdminAuthSettings(): Promise<{ username: string; passwordHash: string }> {
  try {
    const parsed = JSON.parse(await fs.readFile(adminAuthSettingsPath, 'utf8')) as { username?: unknown; passwordHash?: unknown }
    return {
      username: typeof parsed.username === 'string' ? parsed.username : '',
      passwordHash: typeof parsed.passwordHash === 'string' ? parsed.passwordHash : '',
    }
  } catch {
    return { username: '', passwordHash: '' }
  }
}
