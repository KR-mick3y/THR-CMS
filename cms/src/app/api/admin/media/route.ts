import { promises as fs } from 'node:fs'
import path from 'node:path'
import { requireSession } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { getPage, mediaDirectoryFor } from '@/lib/admin/repository'
import { docsSrcRoot, resolveDocsPath } from '@/lib/cms/files'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession()
    const url = new URL(request.url)
    const pageId = url.searchParams.get('pageId') || ''
    const src = url.searchParams.get('src') || ''
    if (!pageId || !src) throw new Error('pageId and src are required.')
    if (!src.startsWith('./')) throw new Error('Only page-relative media can be previewed.')

    const { page } = await getPage(pageId)
    const pageDir = path.dirname(resolveDocsPath(page.path))
    let fullPath = path.resolve(pageDir, src)
    if (!fullPath.startsWith(`${docsSrcRoot}${path.sep}`)) throw new Error('Media path escapes docs/src.')

    let data: Buffer
    try {
      data = await fs.readFile(fullPath)
    } catch {
      if (!src.startsWith('./assets/')) throw new Error('Media file not found.')
      fullPath = path.join(mediaDirectoryFor(page), path.basename(src))
      data = await fs.readFile(fullPath)
    }
    const type = MIME[path.extname(fullPath).toLowerCase()] || 'application/octet-stream'
    return new Response(data, { headers: { 'content-type': type, 'cache-control': 'no-store' } })
  } catch (error) {
    return routeError(error)
  }
}
