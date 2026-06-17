import { promises as fs } from 'node:fs'
import path from 'node:path'
import { requireCsrf } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { getPage, mediaDirectoryFor } from '@/lib/admin/repository'
import { resolveDocsPath } from '@/lib/cms/files'
import { slugify } from '@/lib/cms/slug'

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.txt', '.csv'])
const MAX_BYTES = 5 * 1024 * 1024

export async function POST(request: Request): Promise<Response> {
  try {
    await requireCsrf(request)
    const form = await request.formData()
    const pageId = String(form.get('pageId') || '')
    const file = form.get('file')
    if (!(file instanceof File)) throw new Error('file is required.')
    if (file.size > MAX_BYTES) throw new Error('File exceeds 5MB.')
    const ext = path.extname(file.name).toLowerCase()
    if (!ALLOWED.has(ext)) throw new Error('Unsupported file type.')
    const { page } = await getPage(pageId)
    const dir = mediaDirectoryFor(page)
    await fs.mkdir(dir, { recursive: true })
    const base = slugify(path.basename(file.name, ext)) || 'asset'
    const filename = await collisionSafeFile(dir, base, ext)
    const fullPath = path.join(dir, filename)
    await fs.writeFile(fullPath, Buffer.from(await file.arrayBuffer()))
    const markdownPath = path.relative(path.dirname(resolveDocsPath(page.path)), fullPath).split(path.sep).join('/')
    return json({ path: `./${markdownPath}`, filename })
  } catch (error) {
    return routeError(error)
  }
}

async function collisionSafeFile(dir: string, base: string, ext: string): Promise<string> {
  let name = `${base}${ext}`
  let index = 2
  while (true) {
    try {
      await fs.access(path.join(dir, name))
      name = `${base}-${index}${ext}`
      index += 1
    } catch {
      return name
    }
  }
}
