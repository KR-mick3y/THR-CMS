import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl
  if (pathname === '/edit/login' || pathname.startsWith('/api/admin/login')) return NextResponse.next()
  if ((pathname.startsWith('/edit') || pathname.startsWith('/api/admin')) && !request.cookies.get('cms_admin')) {
    if (pathname.startsWith('/api/admin')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.redirect(new URL('/edit/login', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/edit/:path*', '/api/admin/:path*'],
}
