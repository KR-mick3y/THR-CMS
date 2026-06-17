const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

export function assertValidSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) {
    throw new Error('Slug must use lowercase letters, numbers, and hyphens only.')
  }
  return slug
}

export function collisionSafeSlug(base: string, used: Set<string>): string {
  const root = assertValidSlug(slugify(base) || 'untitled')
  if (!used.has(root)) return root
  let index = 2
  while (used.has(`${root}-${index}`)) index += 1
  return `${root}-${index}`
}

export function nodeId(prefix: string, pathParts: string[]): string {
  return `${prefix}:${pathParts.join('/')}`
}
