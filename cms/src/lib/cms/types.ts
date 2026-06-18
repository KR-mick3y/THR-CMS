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
  children?: NavigationNode[]
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
