import { promises as fs } from 'node:fs'
import path from 'node:path'
import { requireCsrf, requireSession } from '@/lib/admin/auth'
import { json, routeError } from '@/lib/admin/http'
import { getSiteSettings, updateSiteSettings } from '@/lib/admin/repository'
import { docsSrcRoot } from '@/lib/cms/files'
import { slugify } from '@/lib/cms/slug'

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico'])
const MAX_BYTES = 2 * 1024 * 1024
const publicImagesRoot = path.join(docsSrcRoot, 'public', 'images')

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession()
    const currentSettings = await getSiteSettings()
    const requestedPath = new URL(request.url).searchParams.get('path') || currentSettings.logo
    const filePath = resolvePublicImagePath(requestedPath)
    const ext = path.extname(filePath).toLowerCase()
    return new Response(await fs.readFile(filePath), {
      headers: { 'content-type': contentType(ext), 'cache-control': 'no-store' },
    })
  } catch (error) {
    return routeError(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireCsrf(request)
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new Error('Logo file is required.')
    if (file.size > MAX_BYTES) throw new Error('Logo file exceeds 2MB.')
    const ext = path.extname(file.name).toLowerCase()
    if (!ALLOWED.has(ext)) throw new Error('Unsupported logo file type.')

    await fs.mkdir(publicImagesRoot, { recursive: true })
    const base = slugify(path.basename(file.name, ext)) || 'logo'
    const filename = await collisionSafeFile(publicImagesRoot, base, ext)
    await fs.writeFile(path.join(publicImagesRoot, filename), Buffer.from(await file.arrayBuffer()))

    const publicPath = `/images/${filename}`
    const settings = await updateSiteSettings({ logo: publicPath })
    return json({ path: publicPath, settings })
  } catch (error) {
    return routeError(error)
  }
}

function resolvePublicImagePath(publicPath: string): string {
  if (!publicPath.startsWith('/images/') || publicPath.includes('..')) throw new Error('Logo path is not a public image path.')
  const filePath = path.resolve(publicImagesRoot, publicPath.replace(/^\/images\//, ''))
  if (!filePath.startsWith(`${publicImagesRoot}${path.sep}`)) throw new Error('Logo path escapes public images.')
  return filePath
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

function contentType(ext: string): string {
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.ico') return 'image/x-icon'
  return 'image/png'
}
