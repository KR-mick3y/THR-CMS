import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { assertNavigation, findCategory, findPage, removeNode, walkPages } from '../cms/navigation'
import type { NavigationCategory, NavigationNode, NavigationPage, PageStatus } from '../cms/types'
import { assertValidSlug, collisionSafeSlug, nodeId, slugify } from '../cms/slug'
import { docsSrcRoot, navigationPath, readJsonFile, readMarkdown, repoRoot, resolveDocsPath, siteSettingsPath, writeJsonAtomic, writeMarkdown } from '../cms/files'
import { normalizeCmsIcon, type CmsIcon } from './fontawesome-icons'

const exec = promisify(execFile)
const adminSettingsRoot = path.join(process.cwd(), '.cms-private')
const adminGitSettingsPath = path.join(adminSettingsRoot, 'github-settings.json')
const adminSshKeyPath = path.join(adminSettingsRoot, 'github_deploy_key')
const CMS_MANAGED_PATHS = [
  '.gitignore',
  'docs/navigation.json',
  'docs/site-settings.json',
  'docs/.vitepress/config.mts',
  'docs/.vitepress/navigation.ts',
  'docs/.vitepress/theme',
  'docs/src',
  'package.json',
  'package-lock.json',
]

export type SiteSettings = {
  title: string
  description: string
  logo: string
  navLinks: Array<{ label: string; url: string }>
  footerLinks: Array<{ label: string; url: string }>
  githubUrl: string
}

export type GitHubSettings = {
  userName: string
  userEmail: string
  remoteUrl: string
  repoName: string
  sshKeyPath: string
  hasSshKey: boolean
  branch: string
}

export async function loadNavigation(): Promise<NavigationNode[]> {
  return assertNavigation(await readJsonFile<unknown>(navigationPath))
}

export async function saveNavigation(nodes: NavigationNode[]): Promise<void> {
  assertNavigation(nodes)
  await writeJsonAtomic(navigationPath, nodes)
}

export async function getSiteSettings(): Promise<SiteSettings> {
  return normalizeSiteSettings(await readJsonFile<unknown>(siteSettingsPath))
}

export async function updateSiteSettings(input: Partial<SiteSettings>): Promise<SiteSettings> {
  const current = await getSiteSettings()
  const next = normalizeSiteSettings({ ...current, ...input })
  await writeJsonAtomic(siteSettingsPath, next)
  return next
}

export async function listPages(): Promise<Array<NavigationPage & { categoryPath: string[] }>> {
  const nodes = await loadNavigation()
  const pages: Array<NavigationPage & { categoryPath: string[] }> = []
  walkPages(nodes, (page, parents) => pages.push({ ...page, categoryPath: parents.map((parent) => parent.title) }))
  return pages
}

export async function getPage(id: string): Promise<{ page: NavigationPage; markdown: string; frontmatter: Record<string, unknown> }> {
  const nodes = await loadNavigation()
  const page = findPage(nodes, id)
  if (!page) throw new Error('Page not found.')
  const md = await readMarkdown(page.path)
  return { page, markdown: md.content, frontmatter: md.data }
}

export async function createPage(input: { title: string; slug?: string; categoryId?: string; status?: PageStatus; body?: string; authors?: string; icon?: CmsIcon | null }): Promise<NavigationPage> {
  const nodes = await loadNavigation()
  const target = input.categoryId ? childContainerFor(nodes, input.categoryId) : { children: nodes, slugs: [] }
  if (input.categoryId && !target) throw new Error('Parent page or group not found.')
  if (!target) throw new Error('Parent page or group not found.')
  const siblings = target.children
  const used = new Set(siblings.map((node) => node.slug))
  const slug = collisionSafeSlug(input.slug || input.title, used)
  const parentSlugs = target.slugs
  const relativePath = `${[...parentSlugs, `${slug}.md`].join('/')}`
  const page: NavigationPage = {
    id: nodeId('page', [...parentSlugs, slug]),
    type: 'page',
    title: input.title,
    slug,
    path: relativePath,
    url: `/${relativePath}`,
    status: input.status || 'draft',
    icon: normalizeCmsIcon(input.icon),
    children: [],
  }
  siblings.push(page)
  await writeMarkdown(relativePath, withAuthors(frontmatterFor(page), input.authors), input.body || `# ${input.title}\n`)
  await saveNavigation(nodes)
  return page
}

export async function updatePage(id: string, input: { title?: string; status?: PageStatus; markdown?: string; frontmatter?: Record<string, unknown>; icon?: CmsIcon | null }): Promise<NavigationPage> {
  const nodes = await loadNavigation()
  const page = findPage(nodes, id)
  if (!page) throw new Error('Page not found.')
  if (input.title) page.title = input.title
  if (input.status) page.status = input.status
  if ('icon' in input) {
    const icon = normalizeCmsIcon(input.icon)
    if (icon) page.icon = icon
    else delete page.icon
  }
  const current = await readMarkdown(page.path)
  const data = { ...current.data, ...input.frontmatter, ...frontmatterFor(page), updatedAt: new Date().toISOString() }
  await writeMarkdown(page.path, data, input.markdown ?? current.content)
  await saveNavigation(nodes)
  return page
}

export async function archivePage(id: string): Promise<NavigationPage> {
  return updatePage(id, { status: 'archived' })
}

export async function deletePage(id: string): Promise<void> {
  const nodes = await loadNavigation()
  const page = removeNode(nodes, id)
  if (!page || page.type !== 'page') throw new Error('Page not found.')
  await Promise.all(pagesInNode(page).map(deletePageFiles))
  await saveNavigation(nodes)
}

export async function movePage(id: string, input: { categoryId?: string; beforeId?: string; afterId?: string; slug?: string }): Promise<NavigationPage> {
  const nodes = await loadNavigation()
  const page = removeNode(nodes, id)
  if (!page || page.type !== 'page') throw new Error('Page not found.')
  const target = moveTarget(nodes, input)
  const siblings = target.children
  const used = new Set(siblings.map((node) => node.slug))
  const slug = input.slug || used.has(page.slug) ? collisionSafeSlug(input.slug || page.slug, used) : page.slug
  assertValidSlug(slug)
  const parentSlugs = target.parentSlugs
  const oldPath = resolveDocsPath(page.path)
  const oldMediaPath = mediaDirectoryFor(page)
  page.slug = slug
  page.id = nodeId('page', [...parentSlugs, slug])
  page.path = `${[...parentSlugs, `${slug}.md`].join('/')}`
  page.url = `/${page.path}`
  const newPath = resolveDocsPath(page.path)
  const newMediaPath = mediaDirectoryFor(page)
  await fs.mkdir(path.dirname(newPath), { recursive: true })
  await fs.rename(oldPath, newPath)
  await moveDirectoryIfExists(oldMediaPath, newMediaPath)
  siblings.splice(target.index, 0, page)
  await updateMovedMarkdown(page)
  await saveNavigation(nodes)
  return page
}

export async function createCategory(input: { title: string; slug?: string; parentId?: string; icon?: CmsIcon | null }): Promise<NavigationCategory> {
  const nodes = await loadNavigation()
  const target = input.parentId ? childContainerFor(nodes, input.parentId) : { children: nodes, slugs: [] }
  if (input.parentId && !target) throw new Error('Parent page or group not found.')
  if (!target) throw new Error('Parent page or group not found.')
  const siblings = target.children
  const slug = collisionSafeSlug(input.slug || input.title, new Set(siblings.map((node) => node.slug)))
  const parentSlugs = target.slugs
  const category: NavigationCategory = {
    id: nodeId('category', [...parentSlugs, slug]),
    type: 'category',
    title: input.title,
    slug,
    icon: normalizeCmsIcon(input.icon),
    children: [],
  }
  siblings.push(category)
  await saveNavigation(nodes)
  return category
}

export async function updateCategory(id: string, input: { title?: string; slug?: string; icon?: CmsIcon | null }): Promise<NavigationCategory> {
  const nodes = await loadNavigation()
  const category = findCategory(nodes, id)
  if (!category) throw new Error('Category not found.')
  const oldSlug = category.slug
  if (input.title) category.title = input.title
  if ('icon' in input) {
    const icon = normalizeCmsIcon(input.icon)
    if (icon) category.icon = icon
    else delete category.icon
  }
  if (input.slug && input.slug !== oldSlug) {
    category.slug = assertValidSlug(slugify(input.slug))
    await rewriteCategoryDescendants(nodes)
  }
  await saveNavigation(nodes)
  return category
}

export async function deleteCategory(id: string): Promise<void> {
  const nodes = await loadNavigation()
  const category = findCategory(nodes, id)
  if (!category) throw new Error('Category not found.')
  const hasActive = category.children.some(hasActiveNode)
  if (hasActive) throw new Error('Category must be empty or contain only archived pages.')
  removeNode(nodes, id)
  await saveNavigation(nodes)
}

export async function deleteCategoryOnly(id: string): Promise<NavigationNode[]> {
  const nodes = await loadNavigation()
  const oldCategoryPath = categoryDirectoryPath(nodes, id)
  const result = removeCategoryAndLiftChildren(nodes, id)
  if (!result) throw new Error('Category not found.')
  await rewriteCategoryDescendants(nodes)
  if (oldCategoryPath) await fs.rm(oldCategoryPath, { force: true, recursive: true })
  await saveNavigation(nodes)
  return nodes
}

export async function deleteCategoryTree(id: string): Promise<void> {
  const nodes = await loadNavigation()
  const oldCategoryPath = categoryDirectoryPath(nodes, id)
  const category = removeNode(nodes, id)
  if (!category || category.type !== 'category') throw new Error('Category not found.')
  const pages = pagesInCategory(category)
  await Promise.all(pages.map(deletePageFiles))
  if (oldCategoryPath) await fs.rm(oldCategoryPath, { force: true, recursive: true })
  await saveNavigation(nodes)
}

export async function reorderCategory(id: string, orderedIds: string[]): Promise<NavigationNode[]> {
  const nodes = await loadNavigation()
  const target = id === 'root' ? { children: nodes } : findCategory(nodes, id)
  if (!target) throw new Error('Category not found.')
  const byId = new Map(target.children.map((node) => [node.id, node]))
  if (orderedIds.length !== target.children.length || orderedIds.some((nodeId) => !byId.has(nodeId))) {
    throw new Error('Reorder payload must contain exactly the current sibling ids.')
  }
  target.children.splice(0, target.children.length, ...orderedIds.map((nodeId) => byId.get(nodeId)!))
  await saveNavigation(nodes)
  return nodes
}

export async function gitDiff(): Promise<string> {
  const { stdout } = await runGit(['diff', '--', ...CMS_MANAGED_PATHS])
  return stdout
}

export type GitHistoryEntry = {
  hash: string
  shortHash: string
  author: string
  date: string
  message: string
  url: string
  files: Array<{ status: string; path: string }>
  summary: string
}

export type PublishResult = {
  output: string
  deployed: boolean
}

export async function gitHistory(limit = 20): Promise<GitHistoryEntry[]> {
  const count = Math.min(Math.max(Number.isFinite(limit) ? Math.floor(limit) : 20, 1), 50)
  const { stdout } = await runGit([
    'log',
    `-${count}`,
    '--date=short',
    '--pretty=format:@@commit@@%H%x1f%h%x1f%an%x1f%ad%x1f%s',
    '--name-status',
    '--',
    ...CMS_MANAGED_PATHS,
  ])
  const repoName = repoNameFromRemote(await gitRemoteUrl()) || (await readAdminGitSettings()).repoName
  return parseGitHistory(stdout, repoName)
}

export async function publish(commitMessage: string): Promise<PublishResult> {
  if (!commitMessage.trim()) throw new Error('Commit message is required.')
  await assertGitIdentity()
  await runGit(['add', ...CMS_MANAGED_PATHS])
  if (!(await hasStagedChanges())) throw new Error('No CMS-managed changes are staged for publish.')
  await runGit(['commit', '-m', commitMessage.trim()])
  const branch = await gitBranch()
  if (!branch) throw new Error('Current Git branch could not be determined.')
  const pushed = await runGit(['push', '-u', 'origin', branch], { useSshKey: true })
  const deployed = await runDeployCommand()
  return {
    output: [pushed.stdout, pushed.stderr, deployed.output].filter(Boolean).join('\n'),
    deployed: deployed.ran,
  }
}

export async function getGitHubSettings(): Promise<GitHubSettings> {
  const localSettings = await readAdminGitSettings()
  const [userName, userEmail, remoteUrl, branch] = await Promise.all([
    gitConfigValue('user.name'),
    gitConfigValue('user.email'),
    gitRemoteUrl(),
    gitBranch(),
  ])
  const hasSshKey = await pathExists(adminSshKeyPath)
  return {
    userName,
    userEmail,
    remoteUrl,
    repoName: localSettings.repoName || repoNameFromRemote(remoteUrl),
    sshKeyPath: hasSshKey ? adminSshKeyPath : '',
    hasSshKey,
    branch,
  }
}

export async function updateGitHubSettings(input: { userName?: string; userEmail?: string; remoteUrl?: string; repoName?: string; sshPrivateKey?: string }): Promise<GitHubSettings> {
  const userName = input.userName?.trim()
  const userEmail = input.userEmail?.trim()
  const repoName = normalizeRepoName(input.repoName || input.remoteUrl || '')

  if (userName) await runGit(['config', 'user.name', userName])
  if (userEmail) await runGit(['config', 'user.email', userEmail])
  if (repoName) {
    await setOriginRemote(`git@github.com:${repoName}.git`)
    await writeAdminGitSettings({ repoName })
  }
  if (input.sshPrivateKey?.trim()) {
    await writeAdminSshPrivateKey(input.sshPrivateKey)
  }

  return getGitHubSettings()
}

async function assertGitIdentity(): Promise<void> {
  const [name, email] = await Promise.all([
    gitConfigValue('user.name'),
    gitConfigValue('user.email'),
  ])
  if (!name || !email) {
    throw new Error('Git author is not configured. Run: git config user.name "Your Name" && git config user.email "you@example.com"')
  }
}

async function gitConfigValue(key: string): Promise<string> {
  try {
    const { stdout } = await runGit(['config', '--get', key])
    return stdout.trim()
  } catch {
    return ''
  }
}

async function gitRemoteUrl(): Promise<string> {
  try {
    const { stdout } = await runGit(['remote', 'get-url', 'origin'])
    return stdout.trim()
  } catch {
    return ''
  }
}

async function gitBranch(): Promise<string> {
  try {
    const { stdout } = await runGit(['branch', '--show-current'])
    return stdout.trim()
  } catch {
    return ''
  }
}

function isAllowedGitRemote(value: string): boolean {
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?$/.test(value) || /^git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?$/.test(value)
}

function normalizeSiteSettings(value: unknown): SiteSettings {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const title = stringOrDefault(record.title, 'Documentation')
  const description = stringOrDefault(record.description, 'A file-backed documentation site.')
  const logo = normalizePublicPath(stringOrDefault(record.logo, '/images/logo.svg'))
  const navLinks = normalizeNavLinks(record.navLinks)
  const footerLinks = normalizeFooterLinks(record.footerLinks)
  const githubUrl = normalizeOptionalUrl(stringOrDefault(record.githubUrl, ''), 'GitHub URL')

  return { title, description, logo, navLinks, footerLinks, githubUrl }
}

function normalizeNavLinks(value: unknown): Array<{ label: string; url: string }> {
  return normalizeLinks(value, false)
}

function normalizeLinks(value: unknown, allowRelative: boolean): Array<{ label: string; url: string }> {
  if (!Array.isArray(value)) return []
  return value.slice(0, 6).map((item, index) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const label = stringOrDefault(record.label, `Link ${index + 1}`).slice(0, 40)
    const url = allowRelative ? normalizeOptionalLink(stringOrDefault(record.url, ''), `${label} URL`) : normalizeOptionalUrl(stringOrDefault(record.url, ''), `${label} URL`)
    return label && url ? { label, url } : null
  }).filter((item): item is { label: string; url: string } => Boolean(item))
}

function normalizeFooterLinks(value: unknown): Array<{ label: string; url: string }> {
  const normalized = normalizeLinks(value, true)
  return normalized.length ? normalized : [
    { label: 'Terms', url: '/policies/terms' },
    { label: 'Privacy', url: '/policies/privacy' },
    { label: 'About', url: '/policies/about' },
  ]
}

function normalizeOptionalLink(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^\/(?!\/)[a-zA-Z0-9/_\- .?#=&%]*$/.test(trimmed) && !trimmed.includes('..')) return trimmed
  return normalizeOptionalUrl(trimmed, label)
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizePublicPath(value: string): string {
  const trimmed = value.trim()
  if (!/^\/[a-zA-Z0-9/_\- .]+$/.test(trimmed) || trimmed.includes('..')) {
    throw new Error('Logo path must be a public absolute path like /images/logo.png.')
  }
  return trimmed
}

function normalizeOptionalUrl(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error()
    return parsed.toString()
  } catch {
    throw new Error(`${label} must be a valid http or https URL.`)
  }
}

async function readAdminGitSettings(): Promise<{ repoName: string }> {
  try {
    const parsed = JSON.parse(await fs.readFile(adminGitSettingsPath, 'utf8')) as { repoName?: unknown }
    return { repoName: typeof parsed.repoName === 'string' ? parsed.repoName : '' }
  } catch {
    return { repoName: '' }
  }
}

async function writeAdminGitSettings(settings: { repoName: string }): Promise<void> {
  await fs.mkdir(adminSettingsRoot, { recursive: true, mode: 0o700 })
  await fs.writeFile(adminGitSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await fs.chmod(adminGitSettingsPath, 0o600)
}

async function writeAdminSshPrivateKey(value: string): Promise<void> {
  const normalized = value.replace(/\r\n/g, '\n').trimEnd()
  if (!/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----\n[\s\S]+-----END [A-Z0-9 ]*PRIVATE KEY-----$/.test(normalized)) {
    throw new Error('SSH private key must be a valid PEM private key file.')
  }
  await fs.mkdir(adminSettingsRoot, { recursive: true, mode: 0o700 })
  await fs.writeFile(adminSshKeyPath, `${normalized}\n`, { encoding: 'utf8', mode: 0o600 })
  await fs.chmod(adminSshKeyPath, 0o600)
}

function normalizeRepoName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const fromUrl = repoNameFromRemote(trimmed)
  const repoName = fromUrl || trimmed.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoName)) {
    throw new Error('Repository name must use owner/repo format, for example owner/docs-repo.')
  }
  return repoName
}

function repoNameFromRemote(remoteUrl: string): string {
  const ssh = remoteUrl.match(/^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\.git)?$/)
  if (ssh) return ssh[1]
  const https = remoteUrl.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\.git)?\/?$/)
  if (https) return https[1]
  return ''
}

function parseGitHistory(output: string, repoName: string): GitHistoryEntry[] {
  const entries: GitHistoryEntry[] = []
  let current: GitHistoryEntry | null = null
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line) continue
    if (line.startsWith('@@commit@@')) {
      if (current) {
        current.summary = summarizeChangedFiles(current.files)
        entries.push(current)
      }
      const [hash = '', shortHash = '', author = '', date = '', message = ''] = line.slice('@@commit@@'.length).split('\x1f')
      current = {
        hash,
        shortHash,
        author,
        date,
        message,
        url: repoName && hash ? `https://github.com/${repoName}/commit/${hash}` : '',
        files: [],
        summary: '',
      }
      continue
    }
    if (!current) continue
    const [status = '', ...pathParts] = line.split(/\s+/)
    const filePath = pathParts[pathParts.length - 1] || ''
    if (filePath) current.files.push({ status: statusLabel(status), path: filePath })
  }
  if (current) {
    current.summary = summarizeChangedFiles(current.files)
    entries.push(current)
  }
  return entries
}

function statusLabel(status: string): string {
  const prefix = status[0]
  if (prefix === 'A') return 'added'
  if (prefix === 'M') return 'updated'
  if (prefix === 'D') return 'deleted'
  if (prefix === 'R') return 'renamed'
  if (prefix === 'C') return 'copied'
  return 'changed'
}

function summarizeChangedFiles(files: Array<{ status: string; path: string }>): string {
  if (!files.length) return 'No file details recorded.'
  const docs = files.filter((file) => file.path.startsWith('docs/src/'))
  const nav = files.some((file) => file.path === 'docs/navigation.json')
  const site = files.some((file) => file.path === 'docs/site-settings.json')
  const targets = (docs.length ? docs : files).slice(0, 3).map((file) => `${file.status} ${displayCmsPath(file.path)}`)
  const extra = files.length > targets.length ? ` and ${files.length - targets.length} more` : ''
  const metadata = [nav ? 'navigation' : '', site ? 'site settings' : ''].filter(Boolean).join(', ')
  return `${targets.join(', ')}${extra}${metadata ? `; ${metadata} changed` : ''}`
}

function displayCmsPath(filePath: string): string {
  return filePath
    .replace(/^docs\/src\//, '')
    .replace(/^docs\//, '')
    .replace(/\.md$/, '')
}

async function setOriginRemote(remoteUrl: string): Promise<void> {
  if (!isAllowedGitRemote(remoteUrl)) throw new Error('Remote URL must be a GitHub SSH or HTTPS URL.')
  const current = await gitRemoteUrl()
  if (current) await runGit(['remote', 'set-url', 'origin', remoteUrl])
  else await runGit(['remote', 'add', 'origin', remoteUrl])
}

async function hasStagedChanges(): Promise<boolean> {
  try {
    await runGit(['diff', '--cached', '--quiet', '--', ...CMS_MANAGED_PATHS])
    return false
  } catch {
    return true
  }
}

async function gitSshEnvironment(): Promise<NodeJS.ProcessEnv> {
  if (!(await pathExists(adminSshKeyPath))) return process.env
  return {
    ...process.env,
    GIT_SSH_COMMAND: `ssh -i ${shellQuote(adminSshKeyPath)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

async function runDeployCommand(): Promise<{ ran: boolean; output: string }> {
  const command = process.env.CMS_DEPLOY_COMMAND?.trim()
  if (!command) return { ran: false, output: '' }
  try {
    const { stdout, stderr } = await exec('/bin/sh', ['-lc', command], {
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: Number(process.env.CMS_DEPLOY_TIMEOUT_MS || 600_000),
    })
    return { ran: true, output: [stdout, stderr].filter(Boolean).join('\n') }
  } catch (error) {
    const deployError = error as Error & { stdout?: string; stderr?: string }
    const detail = [deployError.message, deployError.stderr, deployError.stdout].filter(Boolean).join('\n').trim()
    throw new Error(`Deploy command failed after git push.\n${detail || command}`)
  }
}

async function runGit(args: string[], options: { useSshKey?: boolean } = {}): Promise<{ stdout: string; stderr: string }> {
  try {
    return await exec('git', args, { cwd: repoRoot, env: options.useSshKey ? await gitSshEnvironment() : process.env })
  } catch (error) {
    const gitError = error as Error & { stdout?: string; stderr?: string }
    const detail = [gitError.message, gitError.stderr, gitError.stdout].filter(Boolean).join('\n').trim()
    throw new Error(detail || `git ${args.join(' ')} failed.`)
  }
}

function frontmatterFor(page: NavigationPage): Record<string, unknown> {
  const data: Record<string, unknown> = {
    title: page.title,
    status: page.status,
    updatedAt: new Date().toISOString(),
  }
  if (page.icon) data.icon = page.icon
  return data
}

function withAuthors(data: Record<string, unknown>, authors?: string): Record<string, unknown> {
  const cleanAuthors = authors?.split(',').map((author) => author.trim()).filter(Boolean).join(', ')
  return cleanAuthors ? { ...data, authors: cleanAuthors } : data
}

function categorySlugs(nodes: NavigationNode[], id: string, parents: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'category') {
      const current = [...parents, node.slug]
      if (node.id === id) return current
      const found = categorySlugs(node.children, id, current)
      if (found.length) return found
      continue
    }
    const pageChildren = node.children || []
    const found = categorySlugs(pageChildren, id, [...parents, node.slug])
    if (found.length) return found
  }
  return []
}

function moveTarget(nodes: NavigationNode[], input: { categoryId?: string; beforeId?: string; afterId?: string }): { children: NavigationNode[]; parentSlugs: string[]; index: number } {
  if (input.beforeId || input.afterId) {
    const targetId = input.beforeId || input.afterId || ''
    const container = findNodeContainer(nodes, targetId)
    if (!container) throw new Error('Drop target not found.')
    const targetIndex = container.children.findIndex((node) => node.id === targetId)
    if (targetIndex < 0) throw new Error('Drop target not found.')
    return {
      children: container.children,
      parentSlugs: container.parentSlugs,
      index: input.beforeId ? targetIndex : targetIndex + 1,
    }
  }

  if (!input.categoryId) return { children: nodes, parentSlugs: [], index: nodes.length }
  const target = childContainerFor(nodes, input.categoryId)
  if (!target) throw new Error('Parent page or group not found.')
  return { children: target.children, parentSlugs: target.slugs, index: target.children.length }
}

function findNodeContainer(nodes: NavigationNode[], id: string, parentSlugs: string[] = []): { children: NavigationNode[]; parentSlugs: string[] } | null {
  if (nodes.some((node) => node.id === id)) return { children: nodes, parentSlugs }
  for (const node of nodes) {
    const children = node.type === 'category' ? node.children : node.children || []
    if (!children.length) continue
    const found = findNodeContainer(children, id, [...parentSlugs, node.slug])
    if (found) return found
  }
  return null
}

function categoryDirectoryPath(nodes: NavigationNode[], id: string): string {
  const slugs = categorySlugs(nodes, id)
  return slugs.length ? path.join(docsSrcRoot, ...slugs) : ''
}

function removeCategoryAndLiftChildren(nodes: NavigationNode[], id: string): NavigationCategory | null {
  const index = nodes.findIndex((node) => node.type === 'category' && node.id === id)
  if (index >= 0) {
    const [removed] = nodes.splice(index, 1)
    if (!removed || removed.type !== 'category') return null
    nodes.splice(index, 0, ...removed.children)
    return removed
  }

  for (const node of nodes) {
    if (node.type !== 'category') continue
    const removed = removeCategoryAndLiftChildren(node.children, id)
    if (removed) return removed
  }
  return null
}

function pagesInCategory(category: NavigationCategory): NavigationPage[] {
  return category.children.flatMap(pagesInNode)
}

function pagesInNode(node: NavigationNode): NavigationPage[] {
  if (node.type === 'category') return pagesInCategory(node)
  return [node, ...(node.children || []).flatMap(pagesInNode)]
}

function hasActiveNode(node: NavigationNode): boolean {
  if (node.type === 'category') return node.children.some(hasActiveNode)
  return node.status !== 'archived' || (node.children || []).some(hasActiveNode)
}

function childContainerFor(nodes: NavigationNode[], id: string, parents: string[] = []): { children: NavigationNode[]; slugs: string[] } | null {
  for (const node of nodes) {
    const current = [...parents, node.slug]
    if (node.id === id) {
      if (node.type === 'category') return { children: node.children, slugs: current }
      node.children ||= []
      return { children: node.children, slugs: current }
    }
    const children = node.type === 'category' ? node.children : node.children || []
    const found = childContainerFor(children, id, current)
    if (found) return found
  }
  return null
}

async function deletePageFiles(page: NavigationPage): Promise<void> {
  await fs.rm(resolveDocsPath(page.path), { force: true })
  await fs.rm(mediaDirectoryFor(page), { force: true, recursive: true })
}

async function moveDirectoryIfExists(from: string, to: string): Promise<void> {
  if (from === to || !(await pathExists(from))) return
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.rm(to, { force: true, recursive: true })
  await fs.rename(from, to)
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function updateMovedMarkdown(page: NavigationPage): Promise<void> {
  const current = await readMarkdown(page.path)
  await writeMarkdown(page.path, { ...current.data, ...frontmatterFor(page) }, current.content)
}

async function rewriteCategoryDescendants(nodes: NavigationNode[], parents: string[] = []): Promise<void> {
  for (const node of nodes) {
    if (node.type === 'category') {
      node.id = nodeId('category', [...parents, node.slug])
      await rewriteCategoryDescendants(node.children, [...parents, node.slug])
    } else {
      const oldPath = resolveDocsPath(node.path)
      const oldMediaPath = mediaDirectoryFor(node)
      node.id = nodeId('page', [...parents, node.slug])
      node.path = `${[...parents, `${node.slug}.md`].join('/')}`
      node.url = `/${node.path}`
      const newPath = resolveDocsPath(node.path)
      const newMediaPath = mediaDirectoryFor(node)
      if (oldPath !== newPath) {
        await fs.mkdir(path.dirname(newPath), { recursive: true })
        await fs.rename(oldPath, newPath)
        await moveDirectoryIfExists(oldMediaPath, newMediaPath)
      }
      await updateMovedMarkdown(node)
      if (node.children?.length) await rewriteCategoryDescendants(node.children, [...parents, node.slug])
    }
  }
}

export function mediaDirectoryFor(page: NavigationPage): string {
  const base = page.path.replace(/\.md$/, '')
  return path.join(docsSrcRoot, path.dirname(base), path.basename(base), 'assets')
}
