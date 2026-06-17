export type PageStatus = 'draft' | 'published' | 'archived'

export type CmsIcon = {
  style: 'solid' | 'regular' | 'brands'
  name: string
}

export type NavigationPage = {
  id: string
  type: 'page'
  title: string
  slug: string
  path: string
  url: string
  status: PageStatus
  icon?: CmsIcon
}

export type NavigationCategory = {
  id: string
  type: 'category'
  title: string
  slug: string
  icon?: CmsIcon
  children: NavigationNode[]
}

export type NavigationNode = NavigationCategory | NavigationPage

export type SidebarItem = {
  text: string
  link?: string
  collapsed?: boolean
  items?: SidebarItem[]
}

export function navigationToSidebar(nodes: NavigationNode[]): SidebarItem[] {
  return nodes
    .map((node) => nodeToSidebar(node))
    .filter((item): item is SidebarItem => Boolean(item))
}

function nodeToSidebar(node: NavigationNode): SidebarItem | null {
  if (node.type === 'page') {
    if (node.status !== 'published') return null
    return { text: sidebarText(node), link: node.url }
  }

  const children = node.children
    .map((child) => nodeToSidebar(child))
    .filter((item): item is SidebarItem => Boolean(item))

  if (!children.length) return null
  return {
    text: sidebarText(node),
    collapsed: true,
    items: children,
  }
}

function sidebarText(node: NavigationNode): string {
  const title = escapeHtml(node.title)
  if (!node.icon) return title
  return `<span class="cms-fa-icon fa-${node.icon.style} fa-${escapeHtml(node.icon.name)}" aria-hidden="true"></span><span>${title}</span>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
