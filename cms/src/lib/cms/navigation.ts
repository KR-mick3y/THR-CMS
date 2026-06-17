import type { NavigationCategory, NavigationNode, NavigationPage, PageStatus, SidebarItem } from './types'

const VALID_STATUSES = new Set<PageStatus>(['draft', 'published', 'archived'])

export function assertNavigation(value: unknown): NavigationNode[] {
  if (!Array.isArray(value)) throw new Error('navigation.json must contain an array.')
  value.forEach((node) => assertNode(node))
  return value as NavigationNode[]
}

function assertNode(value: unknown): void {
  if (!value || typeof value !== 'object') throw new Error('Navigation node must be an object.')
  const node = value as Record<string, unknown>
  if (node.type === 'category') {
    requireString(node.id, 'category.id')
    requireString(node.title, 'category.title')
    requireString(node.slug, 'category.slug')
    if (node.icon !== undefined) requireIcon(node.icon, 'category.icon')
    if (!Array.isArray(node.children)) throw new Error(`Category ${node.id} children must be an array.`)
    node.children.forEach((child) => assertNode(child))
    return
  }
  if (node.type === 'page') {
    requireString(node.id, 'page.id')
    requireString(node.title, 'page.title')
    requireString(node.slug, 'page.slug')
    requireString(node.path, 'page.path')
    requireString(node.url, 'page.url')
    if (!VALID_STATUSES.has(node.status as PageStatus)) throw new Error(`Invalid page status for ${node.id}.`)
    if (node.icon !== undefined) requireIcon(node.icon, 'page.icon')
    return
  }
  throw new Error('Navigation node type must be category or page.')
}

function requireString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string.`)
}

function requireIcon(value: unknown, field: string): void {
  if (!value || typeof value !== 'object') throw new Error(`${field} must be an object.`)
  const icon = value as Record<string, unknown>
  if (icon.style !== 'solid' && icon.style !== 'regular' && icon.style !== 'brands') throw new Error(`${field}.style is invalid.`)
  if (typeof icon.name !== 'string' || !/^[a-z0-9-]+$/.test(icon.name)) throw new Error(`${field}.name is invalid.`)
}

export function navigationToSidebar(nodes: NavigationNode[]): SidebarItem[] {
  return nodes
    .map((node) => nodeToSidebar(node))
    .filter((item): item is SidebarItem => Boolean(item))
}

function nodeToSidebar(node: NavigationNode): SidebarItem | null {
  if (node.type === 'page') {
    if (node.status !== 'published') return null
    return { text: node.title, link: node.url }
  }

  const children = node.children
    .map((child) => nodeToSidebar(child))
    .filter((item): item is SidebarItem => Boolean(item))

  if (children.length === 0) return null
  return {
    text: node.title,
    collapsed: true,
    items: children,
  }
}

export function findPage(nodes: NavigationNode[], id: string): NavigationPage | null {
  for (const node of nodes) {
    if (node.type === 'page' && node.id === id) return node
    if (node.type === 'category') {
      const found = findPage(node.children, id)
      if (found) return found
    }
  }
  return null
}

export function findCategory(nodes: NavigationNode[], id: string): NavigationCategory | null {
  for (const node of nodes) {
    if (node.type === 'category') {
      if (node.id === id) return node
      const found = findCategory(node.children, id)
      if (found) return found
    }
  }
  return null
}

export function removeNode(nodes: NavigationNode[], id: string): NavigationNode | null {
  const index = nodes.findIndex((node) => node.id === id)
  if (index >= 0) return nodes.splice(index, 1)[0] ?? null
  for (const node of nodes) {
    if (node.type === 'category') {
      const removed = removeNode(node.children, id)
      if (removed) return removed
    }
  }
  return null
}

export function walkPages(nodes: NavigationNode[], visit: (page: NavigationPage, parents: NavigationCategory[]) => void, parents: NavigationCategory[] = []): void {
  for (const node of nodes) {
    if (node.type === 'page') visit(node, parents)
    else walkPages(node.children, visit, [...parents, node])
  }
}
