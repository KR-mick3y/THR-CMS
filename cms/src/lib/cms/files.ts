import { promises as fs } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'

export const repoRoot = path.resolve(process.env.CMS_REPO_ROOT || process.cwd())
export const docsRoot = path.join(repoRoot, 'docs')
export const docsSrcRoot = path.join(docsRoot, 'src')
export const navigationPath = path.join(docsRoot, 'navigation.json')
export const siteSettingsPath = path.join(docsRoot, 'site-settings.json')

export function resolveDocsPath(relativePath: string): string {
  const fullPath = path.resolve(docsSrcRoot, relativePath)
  if (!fullPath.startsWith(`${docsSrcRoot}${path.sep}`) && fullPath !== docsSrcRoot) {
    throw new Error('Path escapes docs/src.')
  }
  return fullPath
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(tmpPath, content, 'utf8')
  await fs.rename(tmpPath, filePath)
}

export async function readMarkdown(relativePath: string): Promise<{ data: Record<string, unknown>; content: string }> {
  const parsed = matter(await fs.readFile(resolveDocsPath(relativePath), 'utf8'))
  return { data: parsed.data, content: parsed.content }
}

export async function writeMarkdown(relativePath: string, data: Record<string, unknown>, content: string): Promise<void> {
  await writeFileAtomic(resolveDocsPath(relativePath), matter.stringify(content, data))
}
