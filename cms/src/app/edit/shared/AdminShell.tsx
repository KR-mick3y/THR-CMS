'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Archive, BookOpen, CheckCircle2, ChevronDown, ChevronRight, Code2, Edit3, ExternalLink, FilePlus2, FolderPlus, GitCompare, Github, Image, LayoutPanelTop, Link2, List, MoreHorizontal, PanelRight, Plus, Quote, Save, Search, Send, Sparkles, TableOfContents, Table2, UserCircle, Video } from 'lucide-react'
import 'highlight.js/styles/github.css'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { CmsIconView, IconPicker } from './IconPicker'
import { documentMarkdown as adapterDocumentMarkdown, ensureEditableTail as adapterEnsureEditableTail, initialParagraphBlock as adapterInitialParagraphBlock, markdownToBlocks as adapterMarkdownToBlocks, stripDocumentTitle as adapterStripDocumentTitle, type EditorBlock, type ListItem, type SlashCommand } from '@/lib/admin/editor-markdown'
import type { CmsIcon } from '@/lib/admin/fontawesome-icons'

const TiptapMarkdownEditor = dynamic(() => import('./TiptapMarkdownEditor'), {
  ssr: false,
  loading: () => <div className="editor-loading">Loading editor...</div>,
})

type Mode = 'pages' | 'new-page' | 'categories' | 'media' | 'settings' | 'me'
type Node = CategoryNode | PageNode
type CategoryNode = { id: string; type: 'category'; title: string; slug: string; icon?: CmsIcon; children: Node[] }
type PageNode = { id: string; type: 'page'; title: string; slug: string; path: string; url: string; status: 'draft' | 'published' | 'archived'; icon?: CmsIcon }
type SiteSettings = { title: string; description: string; logo: string; navLinks: Array<{ label: string; url: string }>; footerLinks: Array<{ label: string; url: string }>; githubUrl: string }
type GitHistoryEntry = { hash: string; shortHash: string; author: string; date: string; message: string; url: string; summary: string; files: Array<{ status: string; path: string }> }
type PageDraft = { page: PageNode; title: string; authors: string; status: PageNode['status']; icon?: CmsIcon; blocks: EditorBlock[] }
type TransformTarget = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6' | 'inlineCode' | 'codeBlock' | 'quote' | 'list'
type SlashMenuItem = { id: SlashCommand; title: string; description: string; icon: React.ReactNode }
type PendingTreeOperation =
  | { id: string; type: 'createPage'; tempId: string; title: string; slug?: string; categoryId?: string; status: PageNode['status']; authors: string; body: string; icon?: CmsIcon }
  | { id: string; type: 'createCategory'; tempId: string; title: string; slug?: string; parentId?: string; icon?: CmsIcon }
  | { id: string; type: 'updatePageMeta'; pageId: string; title: string; slug: string; previousSlug: string; icon?: CmsIcon }
  | { id: string; type: 'updateCategoryMeta'; categoryId: string; title: string; slug: string; previousSlug: string; icon?: CmsIcon }
  | { id: string; type: 'deletePage'; pageId: string; title: string }
  | { id: string; type: 'deleteCategory'; categoryId: string; mode: 'lift' | 'cascade'; title: string }
  | { id: string; type: 'movePage'; pageId: string; title: string; categoryId?: string; beforeId?: string; afterId?: string }
type TreeMetaInput = { title: string; slug: string; icon?: CmsIcon }
type DropTarget =
  | { type: 'root' }
  | { type: 'category'; id: string }
  | { type: 'before'; id: string }
  | { type: 'after'; id: string }
  | null

export default function AdminShell({ mode, pageId }: { mode: Mode; pageId?: string }) {
  const router = useRouter()
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const blockEditorRef = useRef<HTMLDivElement | null>(null)
  const selectionDragRef = useRef<{ startPageX: number; startPageY: number } | null>(null)
  const editorFieldRefs = useRef(new Map<string, HTMLElement>())
  const pageDraftsRef = useRef(new Map<string, PageDraft>())
  const selectedIdRef = useRef(pageId || '')
  const loadPageRequestRef = useRef(0)
  const pendingEditorFocusRef = useRef('')
  const pendingNewPageGroupRef = useRef('')
  const [csrf, setCsrf] = useState('')
  const [navigation, setNavigation] = useState<Node[]>([])
  const [selectedId, setSelectedId] = useState(pageId || '')
  const [page, setPage] = useState<PageNode | null>(null)
  const [blocks, setBlocks] = useState<EditorBlock[]>([adapterInitialParagraphBlock()])
  const [editorDocumentVersion, setEditorDocumentVersion] = useState(0)
  const [activeBlockId, setActiveBlockId] = useState('')
  const [imageTargetBlockId, setImageTargetBlockId] = useState('')
  const [slashBlockId, setSlashBlockId] = useState('')
  const [slashQuery, setSlashQuery] = useState('')
  const [blockMenuId, setBlockMenuId] = useState('')
  const [treeMenuId, setTreeMenuId] = useState('')
  const [treeInsertMenuId, setTreeInsertMenuId] = useState('')
  const [pageSearch, setPageSearch] = useState('')
  const [draggingPageId, setDraggingPageId] = useState('')
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
  const [pendingTreeOperations, setPendingTreeOperations] = useState<PendingTreeOperation[]>([])
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([])
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [title, setTitle] = useState('')
  const [authors, setAuthors] = useState('')
  const [status, setStatus] = useState<PageNode['status']>('draft')
  const [icon, setIcon] = useState<CmsIcon | undefined>(undefined)
  const [pageSlug, setPageSlug] = useState('')
  const [pageCategoryId, setPageCategoryId] = useState('')
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info')
  const [changeLog, setChangeLog] = useState<GitHistoryEntry[]>([])
  const [changesOpen, setChangesOpen] = useState(false)
  const [changesLoading, setChangesLoading] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [isEditMode, setIsEditMode] = useState(false)
  const [editorView, setEditorView] = useState<'editor' | 'preview'>('editor')
  const [isPublishing, setIsPublishing] = useState(false)
  const [gitSettings, setGitSettings] = useState({ userName: '', userEmail: '', remoteUrl: '', repoName: '', sshKeyPath: '', hasSshKey: false, branch: '' })
  const [siteSettings, setSiteSettings] = useState<SiteSettings>({
    title: 'Documentation',
    description: 'A file-backed documentation site.',
    logo: '/images/logo.svg',
    navLinks: [],
    footerLinks: [
      { label: 'Terms', url: '/policies/terms' },
      { label: 'Privacy', url: '/policies/privacy' },
      { label: 'About', url: '/policies/about' },
    ],
    githubUrl: '',
  })

  const pages = useMemo(() => flattenPages(navigation), [navigation])
  const categories = useMemo(() => flattenCategories(navigation), [navigation])
  const visibleNavigation = useMemo(() => filterNavigation(navigation, pageSearch), [navigation, pageSearch])
  const pageSearchActive = Boolean(pageSearch.trim())
  const pendingDeletedPageIds = useMemo(() => new Set(pendingTreeOperations.filter((operation) => operation.type === 'deletePage').map((operation) => operation.pageId)), [pendingTreeOperations])
  const pendingDeletedCategoryIds = useMemo(() => new Set(pendingTreeOperations.filter((operation) => operation.type === 'deleteCategory').map((operation) => operation.categoryId)), [pendingTreeOperations])
  const activePageId = selectedId || pages[0]?.id || ''
  const siteName = siteSettings.title.trim() || 'Documentation'
  const siteInitials = useMemo(() => initialsForTitle(siteName), [siteName])
  const isCreatingPage = mode === 'new-page' || (mode === 'pages' && !pages.length && !page)
  const queuedEditorPageId = page?.id.startsWith('pending-page-') ? page.id : ''

  function showMessage(text: string, tone: 'info' | 'success' | 'error' = 'info') {
    setMessageTone(tone)
    setMessage(text)
  }

  function requireEditMode(): boolean {
    if (isEditMode) return true
    showMessage('Click Edit before changing pages or groups. Merge will apply queued changes to GitHub.', 'error')
    return false
  }

  function enableEditMode() {
    setIsEditMode(true)
    showMessage('Edit mode enabled. Page and group changes will be queued until Merge.')
  }

  useEffect(() => {
    fetch('/api/admin/session')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => setCsrf(data.csrf))
      .catch(() => router.push('/edit/login'))
    refreshNavigation()
    refreshGitSettings()
    refreshSiteSettings()
  }, [router])

  useEffect(() => {
    const id = pendingEditorFocusRef.current
    if (!id) return
    const element = editorFieldRefs.current.get(id)
    if (!element) return
    pendingEditorFocusRef.current = ''
    focusEditableEnd(element)
  }, [blocks])

  useEffect(() => {
    if (mode !== 'pages' && mode !== 'media') return
    if (!activePageId) return
    loadPage(activePageId)
  }, [activePageId, mode])

  useEffect(() => {
    if (mode !== 'new-page') return
    const pendingGroupId = pendingNewPageGroupRef.current
    pendingNewPageGroupRef.current = ''
    setPage(null)
    setSelectedId('')
    setTitle('')
    setAuthors('')
    setStatus('draft')
    setIcon(undefined)
    setPageSlug('')
    setPageCategoryId(pendingGroupId)
    const initial = adapterInitialParagraphBlock()
    setBlocks([initial])
    setActiveBlockId(initial.id)
  }, [mode])

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    if (!isEditMode || !page) return
    pageDraftsRef.current.set(page.id, {
      page,
      title,
      authors,
      status,
      icon,
      blocks: cloneEditorBlocks(blocks),
    })
  }, [isEditMode, page, title, authors, status, icon, blocks])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isEditMode) return
      if (event.key !== 'Backspace' && event.key !== 'Delete') return
      if (!selectedBlockIds.length || isEditableTarget(event.target)) return
      event.preventDefault()
      deleteSelectedBlocks()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditMode, selectedBlockIds])

  async function refreshNavigation() {
    const response = await fetch('/api/admin/navigation')
    if (response.ok) setNavigation((await response.json()).navigation)
  }

  async function refreshGitSettings() {
    const response = await fetch('/api/admin/github-settings')
    if (response.ok) setGitSettings((await response.json()).settings)
  }

  async function refreshSiteSettings() {
    const response = await fetch('/api/admin/site-settings')
    if (response.ok) setSiteSettings((await response.json()).settings)
  }

  async function loadPage(id: string) {
    const requestId = ++loadPageRequestRef.current
    const draft = pageDraftsRef.current.get(id)
    if (draft) {
      if (requestId !== loadPageRequestRef.current) return
      restorePageDraft(id, draft)
      return
    }
    const response = await fetch(`/api/admin/pages/${encodeURIComponent(id)}`)
    if (requestId !== loadPageRequestRef.current) return
    if (!response.ok) return
    const data = await response.json()
    if (requestId !== loadPageRequestRef.current) return
    const nextBlocks = adapterMarkdownToBlocks(adapterStripDocumentTitle(data.markdown, data.page.title))
    setSelectedId(id)
    setPage(data.page)
    setTitle(data.page.title)
    setAuthors(frontmatterAuthors(data.frontmatter?.authors))
    setStatus(data.page.status)
    setIcon(data.page.icon || data.frontmatter?.icon)
    setBlocks(adapterEnsureEditableTail(nextBlocks))
    setEditorDocumentVersion((current) => current + 1)
    setActiveBlockId(nextBlocks[0]?.id || '')
  }

  function saveCurrentPageDraft() {
    if (!isEditMode || !page) return
    pageDraftsRef.current.set(page.id, {
      page,
      title,
      authors,
      status,
      icon,
      blocks: cloneEditorBlocks(blocks),
    })
  }

  function restorePageDraft(id: string, draft: PageDraft) {
    const nextBlocks = adapterEnsureEditableTail(cloneEditorBlocks(draft.blocks))
    setSelectedId(id)
    setPage(draft.page)
    setTitle(draft.title)
    setAuthors(draft.authors)
    setStatus(draft.status)
    setIcon(draft.icon)
    setBlocks(nextBlocks)
    setEditorDocumentVersion((current) => current + 1)
    setActiveBlockId(nextBlocks[0]?.id || '')
  }

  function selectTreePage(id: string) {
    if (isEditMode) saveCurrentPageDraft()
    setTreeMenuId('')
    setSelectedId(id)
    selectedIdRef.current = id
    window.history.pushState(null, '', `/edit/pages/${encodeURIComponent(id)}`)
    void loadPage(id)
  }

  async function mutate(url: string, body: unknown, method = 'POST') {
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Request failed.')
    return data
  }

  async function savePage() {
    if (!requireEditMode()) return
    if (!page) return
    if (pendingDeletedPageIds.has(page.id)) {
      showMessage('This page is queued for deletion. Merge applies the deletion; saving is disabled for this page.', 'error')
      return
    }
    const markdown = adapterDocumentMarkdown(title, blocks)
    const data = await mutate(`/api/admin/pages/${encodeURIComponent(page.id)}`, { title, status, icon, markdown, frontmatter: { authors } }, 'PATCH')
    setPage(data.page)
    pageDraftsRef.current.delete(page.id)
    showMessage('Saved locally.')
    await refreshNavigation()
  }

  function deleteTreePage(item: PageNode) {
    if (!requireEditMode()) return
    if (pendingDeletedPageIds.has(item.id)) {
      showMessage('This page is already queued for deletion. Merge applies it to the repository.')
      setTreeMenuId('')
      return
    }
    if (!window.confirm(`Queue "${item.title}" for deletion?\n\nThe Markdown file and page assets will be removed only when you click Merge.`)) return
    setPendingTreeOperations((current) => [...current.filter((operation) => !(operation.type === 'deletePage' && operation.pageId === item.id)), { id: pendingOperationId(), type: 'deletePage', pageId: item.id, title: item.title }])
    showMessage('Page deletion queued. Merge applies it to the repository.')
    setTreeMenuId('')
  }

  function deleteTreeCategory(item: CategoryNode, mode: 'lift' | 'cascade') {
    if (!requireEditMode()) return
    const hasChildren = item.children.length > 0
    const prompt = mode === 'cascade'
      ? `Delete "${item.title}" and every page/group inside it? This removes descendant Markdown files and assets.`
      : hasChildren
        ? `Delete only "${item.title}"? Its children will move to the parent group.`
        : `Delete "${item.title}"?`
    if (pendingDeletedCategoryIds.has(item.id)) {
      showMessage('This group is already queued for deletion. Merge applies it to the repository.')
      setTreeMenuId('')
      return
    }
    if (!window.confirm(`${prompt}\n\nThis will be applied only when you click Merge.`)) return
    setPendingTreeOperations((current) => [...current.filter((operation) => !(operation.type === 'deleteCategory' && operation.categoryId === item.id)), { id: pendingOperationId(), type: 'deleteCategory', categoryId: item.id, mode, title: item.title }])
    showMessage(mode === 'cascade' ? 'Group subtree deletion queued. Merge applies it to the repository.' : 'Group deletion queued. Merge applies it to the repository.')
    setTreeMenuId('')
  }

  function moveTreePage(pageIdToMove: string, target: Exclude<DropTarget, null>) {
    if (!requireEditMode()) return
    if (!pageIdToMove || (target.type !== 'root' && pageIdToMove === target.id)) return
    const pageToMove = findNodeById(navigation, pageIdToMove)
    if (!pageToMove || pageToMove.type !== 'page') return
    const request = target.type === 'root'
      ? {}
      : target.type === 'category'
        ? { categoryId: target.id }
        : target.type === 'before'
          ? { beforeId: target.id }
          : { afterId: target.id }
    const movedNavigation = movePageInTree(navigation, pageIdToMove, target)
    setNavigation(movedNavigation)
    setPendingTreeOperations((current) => [...current, { id: pendingOperationId(), type: 'movePage', pageId: pageIdToMove, title: pageToMove.title, ...request }])
    showMessage('Page move queued. Merge applies it to the repository.')
    setDropTarget(null)
    setDraggingPageId('')
  }

  function updateTreeMeta(item: Node, input: TreeMetaInput) {
    if (!requireEditMode()) return
    const nextTitle = input.title.trim()
    const nextSlug = slugifyTitle(input.slug || input.title)
    if (!nextTitle) {
      showMessage('Title is required.', 'error')
      return
    }
    const nextIcon = input.icon
    setNavigation((current) => updateNodeInTree(current, item.id, (node) => ({ ...node, title: nextTitle, slug: nextSlug, icon: nextIcon })))
    if (item.type === 'page') {
      if (page?.id === item.id) {
        setPage((current) => current ? { ...current, title: nextTitle, slug: nextSlug, icon: nextIcon } : current)
        setTitle(nextTitle)
        setIcon(nextIcon)
      }
      setPendingTreeOperations((current) => {
        const existing = current.find((operation) => operation.type === 'updatePageMeta' && operation.pageId === item.id) as Extract<PendingTreeOperation, { type: 'updatePageMeta' }> | undefined
        return [
          ...current.filter((operation) => !(operation.type === 'updatePageMeta' && operation.pageId === item.id)),
          { id: pendingOperationId(), type: 'updatePageMeta', pageId: item.id, title: nextTitle, slug: nextSlug, previousSlug: existing?.previousSlug || item.slug, icon: nextIcon },
        ]
      })
      showMessage('Page title, slug, and icon change queued. Merge applies it to the repository.')
    } else {
      setPendingTreeOperations((current) => {
        const existing = current.find((operation) => operation.type === 'updateCategoryMeta' && operation.categoryId === item.id) as Extract<PendingTreeOperation, { type: 'updateCategoryMeta' }> | undefined
        return [
          ...current.filter((operation) => !(operation.type === 'updateCategoryMeta' && operation.categoryId === item.id)),
          { id: pendingOperationId(), type: 'updateCategoryMeta', categoryId: item.id, title: nextTitle, slug: nextSlug, previousSlug: existing?.previousSlug || item.slug, icon: nextIcon },
        ]
      })
      showMessage('Group title, slug, and icon change queued. Merge applies it to the repository.')
    }
    setTreeMenuId('')
  }

  async function archiveCurrentPage() {
    if (!requireEditMode()) return
    if (!page) return
    const data = await mutate(`/api/admin/pages/${encodeURIComponent(page.id)}`, {}, 'DELETE')
    setPage(data.page)
    setStatus('archived')
    showMessage('Page archived.')
    await refreshNavigation()
  }

  async function queueEditorPage(): Promise<PageNode | null> {
    if (!requireEditMode()) return null
    const nextTitle = title.trim()
    if (!nextTitle) {
      showMessage('Page title is required.', 'error')
      return null
    }
    const slug = pageSlug.trim()
    const categoryId = pageCategoryId || undefined
    const body = adapterDocumentMarkdown(nextTitle, blocks)
    try {
      const data = await mutate('/api/admin/pages', {
        title: nextTitle,
        slug,
        categoryId,
        status,
        authors,
        body,
        icon,
      })
      const newPage = data.page as PageNode
      setPage(newPage)
      setSelectedId(newPage.id)
      setPageSlug(newPage.slug)
      setStatus(newPage.status)
      setIcon(newPage.icon)
      await refreshNavigation()
      showMessage('Draft page saved locally. You can keep editing here or Merge when ready.', 'success')
      router.replace(`/edit/pages/${encodeURIComponent(newPage.id)}`)
      return newPage
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Page creation failed.', 'error')
      return null
    }
  }

  function queueTreeGroup(parentId?: string) {
    if (!requireEditMode()) return
    try {
      const title = 'Untitled group'
      const slug = ''
      const tempId = pendingNodeId('category')
      const newCategory: CategoryNode = { id: tempId, type: 'category', title, slug: slug || slugifyTitle(title), children: [] }
      setNavigation((current) => insertCategoryIntoTree(current, newCategory, parentId) || current)
      setPendingTreeOperations((current) => [...current, { id: pendingOperationId(), type: 'createCategory', tempId, title, slug, parentId }])
      setTreeMenuId(tempId)
      setTreeInsertMenuId('')
      showMessage('Group creation queued. Use the group menu to set title, slug, and icon.')
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Group creation failed.', 'error')
    }
  }

  function startTreePage(parentId?: string) {
    if (!requireEditMode()) return
    pendingNewPageGroupRef.current = parentId || ''
    setPageCategoryId(parentId || '')
    setTreeInsertMenuId('')
    router.push('/edit/pages/new')
  }

  async function uploadMedia(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!requireEditMode()) return
    const form = new FormData(event.currentTarget)
    form.set('pageId', activePageId)
    const response = await fetch('/api/admin/upload', { method: 'POST', headers: { 'x-csrf-token': csrf }, body: form })
    const data = await response.json()
    showMessage(response.ok ? `Uploaded. Markdown link: [${data.filename}](${data.path})` : data.error || 'Upload failed.')
  }

  async function uploadEditorImage(file: File, targetBlockId = imageTargetBlockId || activeBlockId) {
    if (!requireEditMode()) return
    const targetPage = page || await queueEditorPage()
    if (!targetPage) {
      showMessage('Add a page title before uploading images.', 'error')
      return
    }
    const form = new FormData()
    form.set('pageId', targetPage.id)
    form.set('file', file)
    const response = await fetch('/api/admin/upload', { method: 'POST', headers: { 'x-csrf-token': csrf }, body: form })
    const data = await response.json()
    if (!response.ok) {
      showMessage(data.error || 'Image upload failed.')
      return
    }
    updateBlock(targetBlockId, (block) => {
      if (block.type === 'image') return { ...block, src: data.path, alt: data.filename, maxWidth: block.maxWidth || 720, border: Boolean(block.border) }
      if (block.type === 'file') return { ...block, src: data.path, filename: data.filename }
      return block
    })
    showMessage('File uploaded.')
  }

  async function uploadEditorAsset(file: File): Promise<{ path: string; filename: string; pageId?: string } | null> {
    if (!requireEditMode()) return null
    const targetPage = page || await queueEditorPage()
    if (!targetPage) {
      showMessage('Add a page title before uploading files.', 'error')
      return null
    }
    const form = new FormData()
    form.set('pageId', targetPage.id)
    form.set('file', file)
    const response = await fetch('/api/admin/upload', { method: 'POST', headers: { 'x-csrf-token': csrf }, body: form })
    const data = await response.json()
    if (!response.ok) {
      showMessage(data.error || 'Upload failed.')
      return null
    }
    showMessage('File uploaded.')
    return { path: data.path, filename: data.filename, pageId: targetPage.id }
  }

  async function loadChangeLog() {
    setChangesOpen((current) => !current)
    if (changesOpen && changeLog.length) return
    setChangesLoading(true)
    try {
      const response = await fetch('/api/admin/git/history?limit=20')
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not load commit history.')
      setChangeLog(Array.isArray(data.commits) ? data.commits : [])
      showMessage('')
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not load commit history.', 'error')
    } finally {
      setChangesLoading(false)
    }
  }

  async function publishChanges() {
    if (isPublishing) return
    if (!isEditMode) {
      enableEditMode()
      return
    }
    const messageToUse = commitMessage.trim() || `Publish ${title || page?.title || 'CMS changes'}`
    const queuedCount = pendingTreeOperations.length
    const confirmLines = [
      'Merge these CMS changes into the repository?',
      queuedCount ? `${queuedCount} queued page/group operation${queuedCount === 1 ? '' : 's'} will be applied.` : 'No queued page/group operations.',
      page ? `Current page "${title || page.title}" will be saved as published.` : 'No current page content will be saved.',
      `Commit message: ${messageToUse}`,
    ]
    if (!window.confirm(confirmLines.join('\n\n'))) return
    let currentGitSettings = gitSettings
    try {
      currentGitSettings = await loadGitSettingsSnapshot()
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Could not read Git settings.', 'error')
      return
    }
    if (!currentGitSettings.userName || !currentGitSettings.userEmail) {
      showMessage('Git author is not configured. Open My page and set Git author name and email before Merge.', 'error')
      return
    }
    if (!currentGitSettings.repoName) {
      showMessage('GitHub repository is not configured. Open My page and set a repository name before Merge.', 'error')
      return
    }
    if (!currentGitSettings.hasSshKey) {
      showMessage('Git SSH private key is not configured. Open My page and upload the deploy key before Merge.', 'error')
      return
    }

    let appliedTreeOperations = false
    const shouldSaveCurrentPage = Boolean(page && findNodeById(navigation, page.id)?.type === 'page' && !pendingTreeOperations.some((operation) => operation.type === 'deletePage' && operation.pageId === page.id))
    setIsPublishing(true)
    try {
      saveCurrentPageDraft()
      const idMap = await applyPendingTreeOperations()
      appliedTreeOperations = queuedCount > 0
      if (appliedTreeOperations) {
        setPendingTreeOperations([])
        await refreshNavigation()
      }
      const savedDrafts = await saveDraftPagesForPublish(idMap)
      const savedCurrent = page ? savedDrafts.get(idMap.get(page.id) || page.id) : undefined
      if (savedCurrent && shouldSaveCurrentPage) {
        setPage(savedCurrent)
        setStatus(savedCurrent.status)
        await refreshNavigation()
      } else if (page && !shouldSaveCurrentPage) {
        setPage(null)
      }
      const publishResult = await mutate('/api/admin/publish', { message: messageToUse })
      pageDraftsRef.current.clear()
      await refreshNavigation()
      const nextPages = flattenPages(await fetchNavigationSnapshot())
      const preferredPageId = idMap.get(selectedIdRef.current) || selectedIdRef.current
      const nextPage = nextPages.find((candidate) => candidate.id === preferredPageId) || nextPages[0]
      if (nextPage) {
        setSelectedId(nextPage.id)
        selectedIdRef.current = nextPage.id
        router.replace(`/edit/pages/${encodeURIComponent(nextPage.id)}`)
        await loadPage(nextPage.id)
      } else {
        setPage(null)
        setSelectedId('')
        selectedIdRef.current = ''
        setBlocks([adapterInitialParagraphBlock()])
        setTitle('')
        setAuthors('')
        setStatus('draft')
        router.replace('/edit/pages')
      }
      showMessage(publishResult.deployed ? 'Merge, push, and deploy succeeded.' : 'Merge and push succeeded.', 'success')
      setCommitMessage(messageToUse)
      setChangeLog([])
      setChangesOpen(false)
      setPendingTreeOperations([])
      setIsEditMode(false)
    } catch (error) {
      if (appliedTreeOperations) await refreshNavigation()
      const detail = error instanceof Error ? error.message : 'Publish failed.'
      showMessage(appliedTreeOperations ? `Queued page/group operations were applied locally, but Merge failed: ${detail}` : detail, 'error')
    } finally {
      setIsPublishing(false)
    }
  }

  async function saveDraftPagesForPublish(idMap: Map<string, string>): Promise<Map<string, PageNode>> {
    const deletedPageIds = new Set(pendingTreeOperations.filter((operation) => operation.type === 'deletePage').map((operation) => operation.pageId))
    const savedPages = new Map<string, PageNode>()
    const drafts = Array.from(pageDraftsRef.current.values())
    for (const draft of drafts) {
      if (deletedPageIds.has(draft.page.id) || draft.page.id.startsWith('pending-page-')) continue
      const pageIdToSave = idMap.get(draft.page.id) || draft.page.id
      const markdown = adapterDocumentMarkdown(draft.title, draft.blocks)
      const data = await mutate(`/api/admin/pages/${encodeURIComponent(pageIdToSave)}`, {
        title: draft.title,
        status: 'published',
        icon: draft.icon,
        markdown,
        frontmatter: { authors: draft.authors },
      }, 'PATCH')
      if (data.page) savedPages.set(pageIdToSave, data.page)
    }
    return savedPages
  }

  async function applyPendingTreeOperations(): Promise<Map<string, string>> {
    const idMap = new Map<string, string>()
    for (const operation of pendingTreeOperations) {
      if (operation.type === 'createCategory') {
        const parentId = operation.parentId ? idMap.get(operation.parentId) || operation.parentId : undefined
        const data = await mutate('/api/admin/categories', {
          title: operation.title,
          slug: operation.slug || '',
          parentId,
          icon: operation.icon,
        })
        if (data.category?.id) idMap.set(operation.tempId, data.category.id)
      } else if (operation.type === 'createPage') {
        const categoryId = operation.categoryId ? idMap.get(operation.categoryId) || operation.categoryId : undefined
        const data = await mutate('/api/admin/pages', {
          title: operation.title,
          slug: operation.slug || '',
          categoryId,
          status: operation.status,
          authors: operation.authors,
          body: operation.body,
          icon: operation.icon,
        })
        if (data.page?.id) idMap.set(operation.tempId, data.page.id)
      } else if (operation.type === 'updatePageMeta') {
        let pageIdToUpdate = idMap.get(operation.pageId) || operation.pageId
        if (operation.slug !== operation.previousSlug) {
          const moved = await mutate(`/api/admin/pages/${encodeURIComponent(pageIdToUpdate)}/move`, { slug: operation.slug }, 'POST')
          pageIdToUpdate = moved.page?.id || pageIdToUpdate
          if (moved.page?.id) idMap.set(operation.pageId, moved.page.id)
        }
        await mutate(`/api/admin/pages/${encodeURIComponent(pageIdToUpdate)}`, { title: operation.title, icon: operation.icon ?? null }, 'PATCH')
      } else if (operation.type === 'updateCategoryMeta') {
        const categoryIdToUpdate = idMap.get(operation.categoryId) || operation.categoryId
        const data = await mutate(`/api/admin/categories/${encodeURIComponent(categoryIdToUpdate)}`, { title: operation.title, slug: operation.slug, icon: operation.icon ?? null }, 'PATCH')
        if (data.category?.id) idMap.set(operation.categoryId, data.category.id)
      } else if (operation.type === 'deletePage') {
        await mutate(`/api/admin/pages/${encodeURIComponent(idMap.get(operation.pageId) || operation.pageId)}?mode=delete`, {}, 'DELETE')
      } else if (operation.type === 'deleteCategory') {
        await mutate(`/api/admin/categories/${encodeURIComponent(idMap.get(operation.categoryId) || operation.categoryId)}?mode=${operation.mode}`, {}, 'DELETE')
      } else {
        const pageIdToMove = idMap.get(operation.pageId) || operation.pageId
        const body = {
          categoryId: operation.categoryId ? idMap.get(operation.categoryId) || operation.categoryId : undefined,
          beforeId: operation.beforeId ? idMap.get(operation.beforeId) || operation.beforeId : undefined,
          afterId: operation.afterId ? idMap.get(operation.afterId) || operation.afterId : undefined,
        }
        const data = await mutate(`/api/admin/pages/${encodeURIComponent(pageIdToMove)}/move`, body, 'POST')
        if (data.page?.id) idMap.set(operation.pageId, data.page.id)
      }
    }
    return idMap
  }

  async function loadGitSettingsSnapshot(): Promise<typeof gitSettings> {
    const response = await fetch('/api/admin/github-settings')
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Could not read Git settings.')
    setGitSettings(data.settings)
    return data.settings
  }

  async function fetchNavigationSnapshot(): Promise<Node[]> {
    const response = await fetch('/api/admin/navigation')
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Could not reload navigation.')
    const nextNavigation = Array.isArray(data.navigation) ? data.navigation : []
    setNavigation(nextNavigation)
    return nextNavigation
  }

  async function saveGitHubSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const form = new FormData(event.currentTarget)
      const response = await fetch('/api/admin/github-settings', {
        method: 'PATCH',
        headers: { 'x-csrf-token': csrf },
        body: form,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'GitHub settings failed.')
      setGitSettings(data.settings)
      showMessage('GitHub settings saved.')
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'GitHub settings failed.')
    }
  }

  async function changeAdminPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const newPassword = String(form.get('newPassword') || '')
    const confirmPassword = String(form.get('confirmPassword') || '')
    if (newPassword !== confirmPassword) {
      showMessage('New password confirmation does not match.', 'error')
      return
    }
    try {
      const response = await fetch('/api/admin/password', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({
          currentPassword: String(form.get('currentPassword') || ''),
          newPassword,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Password change failed.')
      event.currentTarget.reset()
      showMessage('Admin password changed.', 'success')
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Password change failed.', 'error')
    }
  }

  async function saveSiteSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const cleanLinks = siteSettings.navLinks.filter((link) => link.label.trim() && link.url.trim())
      const cleanFooterLinks = siteSettings.footerLinks.filter((link) => link.label.trim() && link.url.trim())
      const data = await mutate('/api/admin/site-settings', { ...siteSettings, navLinks: cleanLinks, footerLinks: cleanFooterLinks }, 'PATCH')
      setSiteSettings(data.settings)
      showMessage('Site settings saved.')
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Site settings failed.')
    }
  }

  async function uploadSiteLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch('/api/admin/site-settings/logo', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        body: form,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Logo upload failed.')
      setSiteSettings(data.settings)
      showMessage('Logo uploaded and saved.', 'success')
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Logo upload failed.', 'error')
    }
  }

  function updateNavLink(index: number, field: 'label' | 'url', value: string) {
    setSiteSettings((current) => ({
      ...current,
      navLinks: current.navLinks.map((link, currentIndex) => currentIndex === index ? { ...link, [field]: value } : link),
    }))
  }

  function updateFooterLink(index: number, field: 'label' | 'url', value: string) {
    setSiteSettings((current) => ({
      ...current,
      footerLinks: current.footerLinks.map((link, currentIndex) => currentIndex === index ? { ...link, [field]: value } : link),
    }))
  }

  function insertBlock(command: SlashCommand, afterId = activeBlockId) {
    const block = blockForCommand(command)
    const currentIndex = blocks.findIndex((item) => item.id === afterId)
    const index = currentIndex >= 0 ? currentIndex + 1 : blocks.length
    const next = [...blocks.slice(0, index), block, ...blocks.slice(index)]
    setBlocks(next)
    setActiveBlockId(block.id)
    setSlashBlockId('')
    setSlashQuery('')
    if (block.type === 'image') {
      setImageTargetBlockId(block.id)
      requestAnimationFrame(() => imageInputRef.current?.click())
    }
  }

  async function insertPastedImage(afterId: string, file: File) {
    if (!page) {
      showMessage('Save or open a page before pasting images.')
      return
    }
    const block = imageBlock()
    const currentIndex = blocks.findIndex((item) => item.id === afterId)
    const index = currentIndex >= 0 ? currentIndex + 1 : blocks.length
    setBlocks((current) => [...current.slice(0, index), block, ...current.slice(index)])
    setActiveBlockId(block.id)
    setImageTargetBlockId(block.id)
    await uploadEditorImage(file, block.id)
  }

  function insertParagraphAfter(afterId: string) {
    const block = newParagraphBlock()
    const currentIndex = blocks.findIndex((item) => item.id === afterId)
    const index = currentIndex >= 0 ? currentIndex + 1 : blocks.length
    setBlocks((current) => [...current.slice(0, index), block, ...current.slice(index)])
    setActiveBlockId(block.id)
    setBlockMenuId('')
    focusEditorFieldAfterRender(block.id)
  }

  function splitParagraph(id: string, before: string, after: string) {
    const nextBlock = newParagraphBlock(after)
    setBlocks((current) => {
      const index = current.findIndex((block) => block.id === id)
      const block = current[index]
      if (index < 0 || block?.type !== 'paragraph') return current
      const replacement: EditorBlock[] = [{ ...block, content: before }, nextBlock]
      return [...current.slice(0, index), ...replacement, ...current.slice(index + 1)]
    })
    setActiveBlockId(nextBlock.id)
    setBlockMenuId('')
    setSlashBlockId('')
    setSlashQuery('')
    focusEditorFieldAfterRender(nextBlock.id)
  }

  function replaceSlashBlock(command: SlashCommand, blockId: string) {
    const block = blockForCommand(command)
    block.id = blockId
    setBlocks((current) => ensureEditableTail(current.map((item) => item.id === blockId ? block : item)))
    setActiveBlockId(blockId)
    setSlashBlockId('')
    setSlashQuery('')
    if (block.type === 'image') {
      setImageTargetBlockId(blockId)
      requestAnimationFrame(() => imageInputRef.current?.click())
    }
  }

  function updateBlock(id: string, updater: (block: EditorBlock) => EditorBlock | EditorBlock[]) {
    setBlocks((current) => current.flatMap((block) => block.id === id ? updater(block) : [block]))
  }

  function transformBlock(id: string, target: TransformTarget) {
    setBlocks((current) => current.map((block) => {
      if (block.id !== id) return block
      const text = textForBlock(block)
      if (target === 'paragraph') return newParagraphBlock(text)
      if (target === 'inlineCode') return { id, type: 'inlineCode', content: text } satisfies EditorBlock
      if (target === 'codeBlock') return { id, type: 'code', code: text, language: 'plaintext', caption: '', wrap: true } satisfies EditorBlock
      if (target === 'quote') return { id, type: 'quote', content: text } satisfies EditorBlock
      if (target === 'list') {
        const items = text.split('\n').filter(Boolean).map((line) => ({ text: line, level: 0 }))
        return { id, type: 'list', items: items.length ? items : [{ text, level: 0 }] } satisfies EditorBlock
      }
      const level = Number(target.replace('heading', '')) as 1 | 2 | 3 | 4 | 5 | 6
      return { id, type: 'heading', level, content: text } satisfies EditorBlock
    }))
    setBlockMenuId('')
  }

  function revertBlockToMarkdownShortcut(id: string, value: string) {
    setBlocks((current) => current.map((block) => block.id === id ? { id, type: 'paragraph', content: value } : block))
    setActiveBlockId(id)
    setSlashBlockId('')
    setSlashQuery('')
    focusEditorFieldAfterRender(id)
  }

  function deleteBlock(id: string) {
    setBlocks((current) => {
      const index = current.findIndex((block) => block.id === id)
      if (index < 0) return current
      const next = ensureEditableTail(current.filter((block) => block.id !== id))
      const focusTarget = next[Math.min(index, next.length - 1)] || next[0]
      if (focusTarget) focusEditorFieldAfterRender(focusTarget.id)
      return next.length ? next : [newParagraphBlock()]
    })
    setBlockMenuId('')
    setSlashBlockId('')
    setSlashQuery('')
  }

  function deleteSelectedBlocks() {
    setBlocks((current) => {
      const selected = new Set(selectedBlockIds)
      const next = current.filter((block) => !selected.has(block.id))
      const normalized = next.length ? ensureEditableTail(next) : [newParagraphBlock()]
      const focusTarget = normalized.find((block) => block.type === 'paragraph') || normalized[0]
      if (focusTarget) focusEditorFieldAfterRender(focusTarget.id)
      return normalized
    })
    setSelectedBlockIds([])
    setSelectionBox(null)
    setBlockMenuId('')
    setSlashBlockId('')
    setSlashQuery('')
  }

  function startBlockSelection(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || isEditableTarget(event.target)) return
    const editor = blockEditorRef.current
    if (!editor) return
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    const startPageX = event.pageX
    const startPageY = event.pageY
    const start = pagePointToEditorPoint(editor, startPageX, startPageY)
    selectionDragRef.current = { startPageX, startPageY }
    setSelectedBlockIds([])
    setSelectionBox({ left: start.x, top: start.y, width: 0, height: 0 })

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const drag = selectionDragRef.current
      if (!drag) return
      const startPoint = pagePointToEditorPoint(editor, drag.startPageX, drag.startPageY)
      const currentPoint = pagePointToEditorPoint(editor, moveEvent.pageX, moveEvent.pageY)
      const left = Math.min(startPoint.x, currentPoint.x)
      const top = Math.min(startPoint.y, currentPoint.y)
      const box = { left, top, width: Math.abs(currentPoint.x - startPoint.x), height: Math.abs(currentPoint.y - startPoint.y) }
      setSelectionBox(box)
      setSelectedBlockIds(intersectingBlockIds(editor, box))
    }

    const handleMouseUp = () => {
      selectionDragRef.current = null
      setSelectionBox(null)
      editor.focus()
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  function removeEmptyParagraph(id: string) {
    setBlocks((current) => {
      const index = current.findIndex((block) => block.id === id)
      const block = current[index]
      if (index < 0 || block?.type !== 'paragraph' || block.content.trim()) return current
      const next = current.filter((item) => item.id !== id)
      const normalized = next.length ? ensureEditableTail(next) : [newParagraphBlock()]
      const focusTarget = normalized[Math.max(0, index - 1)] || normalized[0]
      if (focusTarget) focusEditorFieldAfterRender(focusTarget.id)
      return normalized
    })
    setSlashBlockId('')
    setSlashQuery('')
  }

  function exitCodeBlock(id: string) {
    const block = newParagraphBlock()
    const currentIndex = blocks.findIndex((item) => item.id === id)
    const index = currentIndex >= 0 ? currentIndex + 1 : blocks.length
    setBlocks((current) => [...current.slice(0, index), block, ...current.slice(index)])
    setActiveBlockId(block.id)
    setSlashBlockId('')
    setSlashQuery('')
    focusEditorFieldAfterRender(block.id)
  }

  function exitListBlock(id: string, itemIndex: number) {
    setBlocks((current) => {
      const blockIndex = current.findIndex((item) => item.id === id)
      const block = current[blockIndex]
      if (blockIndex < 0 || block?.type !== 'list') return current
      const paragraph = newParagraphBlock()
      const beforeItems = block.items.slice(0, itemIndex).filter((item) => item.text.trim())
      const afterItems = block.items.slice(itemIndex + 1).filter((item) => item.text.trim())
      const replacement: EditorBlock[] = []
      if (beforeItems.length) replacement.push({ ...block, items: beforeItems })
      replacement.push(paragraph)
      if (afterItems.length) replacement.push({ id: blockId(), type: 'list', items: afterItems })
      focusEditorFieldAfterRender(paragraph.id)
      return [...current.slice(0, blockIndex), ...replacement, ...current.slice(blockIndex + 1)]
    })
    setSlashBlockId('')
    setSlashQuery('')
  }

  function convertListItemToParagraph(id: string, itemIndex: number) {
    setBlocks((current) => {
      const blockIndex = current.findIndex((item) => item.id === id)
      const block = current[blockIndex]
      if (blockIndex < 0 || block?.type !== 'list') return current
      const listItem = block.items[itemIndex]
      if (!listItem) return current
      const paragraph = newParagraphBlock(listItem.text)
      const beforeItems = block.items.slice(0, itemIndex).filter((item) => item.text.trim())
      const afterItems = block.items.slice(itemIndex + 1).filter((item) => item.text.trim())
      const replacement: EditorBlock[] = []
      if (beforeItems.length) replacement.push({ ...block, items: beforeItems })
      replacement.push(paragraph)
      if (afterItems.length) replacement.push({ id: blockId(), type: 'list', items: afterItems })
      focusEditorFieldAfterRender(paragraph.id)
      return [...current.slice(0, blockIndex), ...replacement, ...current.slice(blockIndex + 1)]
    })
    setSlashBlockId('')
    setSlashQuery('')
  }

  function registerEditorField(id: string, element: HTMLElement | null) {
    if (element) editorFieldRefs.current.set(id, element)
    else editorFieldRefs.current.delete(id)
  }

  function focusEditorFieldAfterRender(id: string) {
    pendingEditorFocusRef.current = id
    requestAnimationFrame(() => {
      if (pendingEditorFocusRef.current !== id) return
      const element = editorFieldRefs.current.get(id)
      if (!element) return
      pendingEditorFocusRef.current = ''
      focusEditableEnd(element)
    })
  }

  return (
    <main className="admin-shell">
      <section className="tree-panel">
        <div className="workspace-title"><span>{siteName}</span><ChevronDown size={14} /></div>
        <nav className="workspace-nav">
          <Link href="/edit/pages"><BookOpen size={15} /> Content</Link>
          <Link href="/edit/settings"><LayoutPanelTop size={15} /> Site settings</Link>
          <Link href="/edit/me"><UserCircle size={15} /> My page</Link>
        </nav>
        <div className="space-card">
          <div><strong>{siteName}</strong><span>Local file-backed space</span></div>
          <button title="Space options"><MoreHorizontal size={16} /></button>
        </div>
        <label className="quick-search">
          <Search size={15} />
          <input
            value={pageSearch}
            onChange={(event) => setPageSearch(event.target.value)}
            placeholder="Search pages"
            type="search"
          />
          {pageSearch ? <button type="button" onClick={() => setPageSearch('')} aria-label="Clear search">×</button> : null}
        </label>
        <div className="panel-header">
          <span>Pages</span>
        </div>
        <div
          className={`root-drop-zone ${isEditMode && draggingPageId ? 'drag-ready' : ''} ${isEditMode && dropTarget?.type === 'root' ? 'drop-target' : ''}`}
          onDragOver={(event) => {
            if (!isEditMode) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setDropTarget({ type: 'root' })
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) return
            if (dropTarget?.type === 'root') setDropTarget(null)
          }}
          onDrop={(event) => {
            if (!isEditMode) return
            event.preventDefault()
            moveTreePage(event.dataTransfer.getData('text/plain') || draggingPageId, { type: 'root' })
          }}
        >
          Move to top level
        </div>
        {!navigation.length ? (
          <div className="empty-tree">
            <strong>No pages yet</strong>
            <span>Use + Insert below to create the first page or group.</span>
          </div>
        ) : null}
        {navigation.length && pageSearchActive && !visibleNavigation.length ? (
          <div className="empty-tree">
            <strong>No results</strong>
            <span>No page or group matches “{pageSearch.trim()}”.</span>
          </div>
        ) : null}
        <Tree
          nodes={visibleNavigation}
          selectedId={activePageId}
          menuId={treeMenuId}
          draggingPageId={draggingPageId}
          dropTarget={dropTarget}
          editable={isEditMode && !pageSearchActive}
          pendingDeletedPageIds={pendingDeletedPageIds}
          pendingDeletedCategoryIds={pendingDeletedCategoryIds}
          onSelect={selectTreePage}
          onMenuToggle={(id) => setTreeMenuId((current) => current === id ? '' : id)}
          onDeletePage={deleteTreePage}
          onDeleteCategory={deleteTreeCategory}
          onUpdateMeta={updateTreeMeta}
          insertMenuId={treeInsertMenuId}
          onInsertMenuToggle={(id) => setTreeInsertMenuId((current) => current === id ? '' : id)}
          onCreatePage={startTreePage}
          onCreateCategory={queueTreeGroup}
          onDragPageStart={(id) => setDraggingPageId(id)}
          onDragPageEnd={() => { setDraggingPageId(''); setDropTarget(null) }}
          onDropTargetChange={setDropTarget}
          onDrop={(pageIdToMove, target) => moveTreePage(pageIdToMove, target)}
        />
      </section>

      <section className="work-panel">
        <div className={`top-bar ${mode === 'pages' || mode === 'new-page' ? '' : 'simple'}`}>
          <div className="crumbs"><span className="crumb-site-mark">{siteInitials.slice(0, 1)}</span><span>/</span><span>{siteName}</span><span>/</span><span>{page?.title || pageTitleForMode(mode)} changes</span><span className="draft-badge">Draft</span></div>
          {mode === 'pages' || mode === 'new-page' ? (
            <>
              <button className="ghost-button" onClick={loadChangeLog}><GitCompare size={16} /> Review Changes</button>
              {!isEditMode ? (
                <button className="merge-button" onClick={enableEditMode} type="button"><Edit3 size={16} /> Edit</button>
              ) : isCreatingPage && !queuedEditorPageId ? (
                <button className="merge-button" onClick={queueEditorPage} type="button"><FilePlus2 size={16} /> Create page</button>
              ) : (
                <button className="merge-button" onClick={publishChanges} disabled={isPublishing}><Send size={16} /> {isPublishing ? 'Merging...' : `Merge${pendingTreeOperations.length ? ` (${pendingTreeOperations.length})` : ''}`} <ChevronDown size={16} /></button>
              )}
              <input placeholder="Commit message" value={commitMessage} disabled={!isEditMode} onChange={(event) => setCommitMessage(event.target.value)} />
            </>
          ) : null}
        </div>
        {(mode === 'pages' || mode === 'new-page') && changesOpen ? <ChangeLogPanel commits={changeLog} loading={changesLoading} /> : null}
        {message ? (
          <div className={`admin-message ${messageTone}`} role="status">
            {message}
          </div>
        ) : null}

        {mode === 'categories' ? (
          <div className="form-grid">
            <h1>Groups</h1>
            <p className="settings-note">Use the + Insert control in the left document tree to create pages and groups.</p>
          </div>
        ) : mode === 'media' ? (
          <form className="form-grid" onSubmit={uploadMedia}>
            <h1>Media</h1>
            <label>Page<select value={activePageId} onChange={(event) => setSelectedId(event.target.value)}>{pages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <label>File<input type="file" name="file" required /></label>
            <button type="submit"><Image size={16} /> Upload</button>
          </form>
        ) : mode === 'settings' ? (
          <form className="site-settings-page" onSubmit={saveSiteSettings}>
            <div className="site-settings-hero">
              <div>
                <span className="profile-kicker">Public wiki</span>
                <h1>Site settings</h1>
                <p>Control the public title, logo, header links, and GitHub shortcut used by the VitePress wiki.</p>
                <label className="site-title-field">Site title<input value={siteSettings.title} onChange={(event) => setSiteSettings({ ...siteSettings, title: event.target.value })} /></label>
              </div>
              <div className="site-logo-preview">
                <img src={`/api/admin/site-settings/logo?path=${encodeURIComponent(siteSettings.logo)}`} alt="" />
                <span>{siteSettings.logo}</span>
              </div>
            </div>

            <div className="site-settings-grid">
              <section className="site-card site-card-wide logo-settings-card">
                <div className="profile-card-heading">
                  <strong>Logo</strong>
                  <span>Upload PNG, JPG, WEBP, SVG, or ICO files. Stored under docs/src/public/images.</span>
                </div>
                <div className="logo-settings-fields">
                  <label>Logo file<input type="file" accept=".png,.jpg,.jpeg,.webp,.svg,.ico,image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon" onChange={uploadSiteLogo} /></label>
                  <label>Logo path<input value={siteSettings.logo} onChange={(event) => setSiteSettings({ ...siteSettings, logo: event.target.value })} placeholder="/images/logo.svg" /></label>
                  <div className="settings-note">Uploading a logo saves the file and updates the logo path immediately. Click Save site settings after editing other fields.</div>
                </div>
              </section>

              <section className="site-card site-card-wide">
                <div className="settings-row-title"><div className="profile-card-heading"><strong>Header links</strong><span>Links shown in the public docs header.</span></div><button type="button" className="ghost-button" onClick={() => setSiteSettings({ ...siteSettings, navLinks: [...siteSettings.navLinks, { label: '', url: '' }] })}><Plus size={15} /> Add link</button></div>
                {siteSettings.navLinks.map((link, index) => (
                  <div className="link-settings-row" key={index}>
                    <input value={link.label} placeholder="Label" onChange={(event) => updateNavLink(index, 'label', event.target.value)} />
                    <input value={link.url} placeholder="https://example.com" onChange={(event) => updateNavLink(index, 'url', event.target.value)} />
                    <button type="button" className="ghost-button danger-text" onClick={() => setSiteSettings({ ...siteSettings, navLinks: siteSettings.navLinks.filter((_, currentIndex) => currentIndex !== index) })}>Remove</button>
                  </div>
                ))}
              </section>

              <section className="site-card site-card-wide">
                <div className="settings-row-title"><div className="profile-card-heading"><strong>Footer links</strong><span>Links shown at the lower-left of public pages.</span></div><button type="button" className="ghost-button" onClick={() => setSiteSettings({ ...siteSettings, footerLinks: [...siteSettings.footerLinks, { label: '', url: '' }] })}><Plus size={15} /> Add link</button></div>
                {siteSettings.footerLinks.map((link, index) => (
                  <div className="link-settings-row" key={index}>
                    <input value={link.label} placeholder="Terms" onChange={(event) => updateFooterLink(index, 'label', event.target.value)} />
                    <input value={link.url} placeholder="/policies/terms or https://example.com" onChange={(event) => updateFooterLink(index, 'url', event.target.value)} />
                    <button type="button" className="ghost-button danger-text" onClick={() => setSiteSettings({ ...siteSettings, footerLinks: siteSettings.footerLinks.filter((_, currentIndex) => currentIndex !== index) })}>Remove</button>
                  </div>
                ))}
              </section>

              <section className="site-card site-card-wide">
                <div className="profile-card-heading">
                  <strong>GitHub shortcut</strong>
                  <span>Controls the GitHub icon link on the public wiki.</span>
                </div>
                <label>GitHub icon URL<input value={siteSettings.githubUrl} onChange={(event) => setSiteSettings({ ...siteSettings, githubUrl: event.target.value })} placeholder="https://github.com/owner/repo" /></label>
              </section>
            </div>

            <div className="profile-actions">
              <button type="submit"><Save size={16} /> Save site settings</button>
            </div>
          </form>
        ) : mode === 'me' ? (
          <div className="profile-settings">
            <div className="profile-hero">
              <div>
                <span className="profile-kicker">Publishing identity</span>
                <h1>My page</h1>
                <p>Configure the Git author, GitHub repository, and deploy key used when CMS changes are merged.</p>
              </div>
              <div className={`profile-status ${gitSettings.hasSshKey ? 'ready' : ''}`}>
                <Github size={22} />
                <strong>{gitSettings.hasSshKey ? 'Key ready' : 'Key required'}</strong>
                <span>{gitSettings.branch || 'unknown branch'}</span>
              </div>
            </div>

            <form className="profile-grid" onSubmit={saveGitHubSettings}>
              <section className="profile-card">
                <div className="profile-card-heading">
                  <strong>Git author</strong>
                  <span>Stored in the public wiki repository git config.</span>
                </div>
                <label>Author name<input name="userName" value={gitSettings.userName} onChange={(event) => setGitSettings({ ...gitSettings, userName: event.target.value })} placeholder="Docs Bot" /></label>
                <label>Author email<input name="userEmail" value={gitSettings.userEmail} onChange={(event) => setGitSettings({ ...gitSettings, userEmail: event.target.value })} placeholder="docs@example.com" /></label>
              </section>

              <section className="profile-card">
                <div className="profile-card-heading">
                  <strong>Repository</strong>
                  <span>Use the owner/repo format for the target GitHub wiki repository.</span>
                </div>
                <label>GitHub repository<input name="repoName" value={gitSettings.repoName} onChange={(event) => setGitSettings({ ...gitSettings, repoName: event.target.value })} placeholder="owner/docs-repo" /></label>
                <div className="profile-meta"><span>Remote</span><code>{gitSettings.remoteUrl || 'not configured'}</code></div>
                <div className="profile-meta"><span>Branch</span><code>{gitSettings.branch || 'unknown'}</code></div>
              </section>

              <section className="profile-card profile-card-wide">
                <div className="profile-card-heading">
                  <strong>Deploy key</strong>
                  <span>The private key is stored inside this CMS repository under a gitignored directory.</span>
                </div>
                <label>SSH private key<input name="sshPrivateKey" type="file" /></label>
                <div className="profile-meta"><span>Stored at</span><code>{gitSettings.hasSshKey ? gitSettings.sshKeyPath : '.cms-private/github_deploy_key'}</code></div>
                <div className="settings-note">The key directory is excluded by `.gitignore` as `.cms-private/`. Add the matching public key to GitHub as a write-enabled deploy key.</div>
              </section>

              <div className="profile-actions">
                <button type="submit"><Save size={16} /> Save GitHub settings</button>
              </div>
            </form>

            <form className="profile-grid" onSubmit={changeAdminPassword}>
              <section className="profile-card profile-card-wide">
                <div className="profile-card-heading">
                  <strong>Admin account</strong>
                  <span>Default login is admin / admin123. Changed passwords are stored under .cms-private/.</span>
                </div>
                <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
                <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={8} required /></label>
                <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required /></label>
              </section>
              <div className="profile-actions">
                <button type="submit"><Save size={16} /> Change password</button>
              </div>
            </form>
          </div>
        ) : (
          <div className="editor-grid">
            <section className="editor-main">
              <div className="document-toolbar">
                <div className="document-title-wrap">
                  <div className="page-hover-actions"><button className="ghost-button" type="button"><MoreHorizontal size={15} /> Page options</button></div>
                  <div className="document-title-line">
                    <CmsIconView icon={icon} fallback={false} />
                    <input className="title-input" value={title} disabled={!isEditMode} onChange={(event) => setTitle(event.target.value)} placeholder="Untitled" />
                  </div>
                </div>
                <div className="toolbar-actions">
                  <div className="editor-view-switch" role="tablist" aria-label="Editor view">
                    <button type="button" className={editorView === 'editor' ? 'active' : ''} onClick={() => setEditorView('editor')}>Editor</button>
                    <button type="button" className={editorView === 'preview' ? 'active' : ''} onClick={() => setEditorView('preview')}>Preview</button>
                  </div>
                  <button className="ghost-button icon-command" type="button" title="View site"><ExternalLink size={16} /></button>
                </div>
              </div>
              {editorView === 'preview' ? (
                <PublicPagePreview page={page} />
              ) : (
                <div className={`block-editor ${isEditMode ? '' : 'locked'}`} ref={blockEditorRef} tabIndex={-1}>
                  <TiptapMarkdownEditor
                    blocks={blocks}
                    documentKey={`${page?.id || 'new'}:${editorDocumentVersion}`}
                    pageId={page?.id || ''}
                    editable={isEditMode}
                    onChange={(nextBlocks) => {
                      if (!isEditMode) return
                      const normalizedBlocks = adapterEnsureEditableTail(nextBlocks)
                      setBlocks(normalizedBlocks)
                      if (page) {
                        pageDraftsRef.current.set(page.id, {
                          page,
                          title,
                          authors,
                          status,
                          icon,
                          blocks: cloneEditorBlocks(normalizedBlocks),
                        })
                      }
                    }}
                    uploadAsset={uploadEditorAsset}
                  />
                </div>
              )}
            </section>
            <aside className="meta-panel">
              <div className="meta-title"><PanelRight size={16} /> Page options</div>
              <label>Icon<IconPicker value={icon} disabled={!isEditMode} onChange={setIcon} /></label>
              {isCreatingPage ? (
                <>
                  <label>Slug<input value={pageSlug} disabled={!isEditMode} onChange={(event) => setPageSlug(event.target.value)} placeholder="optional-page-slug" /></label>
                  <label>Group<select value={pageCategoryId} disabled={!isEditMode} onChange={(event) => setPageCategoryId(event.target.value)}><option value="">Root</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
                </>
              ) : null}
              <label>Status<select value={status} disabled={!isEditMode} onChange={(event) => setStatus(event.target.value as PageNode['status'])}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
              <label>Authors<input value={authors} disabled={!isEditMode} onChange={(event) => setAuthors(event.target.value)} placeholder="github-user, another-user" /></label>
              {isCreatingPage ? (
                <button className="merge-button sidebar-action-button" type="button" disabled={!isEditMode} onClick={queueEditorPage}>
                  <FilePlus2 size={15} /> {queuedEditorPageId ? 'Update page draft' : 'Create page'}
                </button>
              ) : null}
              <div className="meta-row"><span>File path</span><code>{page?.path || 'Choose a tree location to generate the file path.'}</code></div>
              <div className="meta-row"><span>Public URL</span><code>{page?.url || 'Generated when the page is queued.'}</code></div>
            </aside>
          </div>
        )}
      </section>
    </main>
  )
}

function ChangeLogPanel({ commits, loading }: { commits: GitHistoryEntry[]; loading: boolean }) {
  return (
    <div className="change-log-panel">
      <div className="change-log-header">
        <strong>Recent document changes</strong>
        <span>{loading ? 'Loading...' : `${commits.length} commits`}</span>
      </div>
      {!loading && !commits.length ? <div className="change-log-empty">No CMS commit history found.</div> : null}
      {commits.map((commit) => {
        const content = (
          <>
            <span className="change-log-meta"><strong>{commit.author}</strong><span>{commit.date}</span><code>{commit.shortHash}</code></span>
            <span className="change-log-message">{commit.message}</span>
            <span className="change-log-summary">{commit.summary}</span>
          </>
        )
        return commit.url ? (
          <a key={commit.hash} className="change-log-row" href={commit.url} target="_blank" rel="noreferrer">{content}</a>
        ) : (
          <div key={commit.hash} className="change-log-row">{content}</div>
        )
      })}
    </div>
  )
}

function PublicPagePreview({ page }: { page: PageNode | null }) {
  const url = publicPreviewUrl(page)
  if (!url) {
    return (
      <div className="public-preview-empty">
        <BookOpen size={20} />
        <span>Create and save the page first to preview the public client view.</span>
      </div>
    )
  }
  return (
    <div className="public-preview-frame-wrap">
      <iframe title="Public page preview" className="public-preview-frame" src={url} />
    </div>
  )
}

function EditorBlockView(props: {
  block: EditorBlock
  active: boolean
  selected: boolean
  slashOpen: boolean
  slashQuery: string
  onFocus: () => void
  onUpdate: (updater: (block: EditorBlock) => EditorBlock | EditorBlock[]) => void
  onSlash: (query: string) => void
  onSlashClose: () => void
  onSlashSelect: (command: SlashCommand) => void
  onUploadImage: () => void
  onPasteImage: (file: File) => void
  onExitCodeBlock: () => void
  onExitListBlock: (itemIndex: number) => void
  onConvertListItemToParagraph: (itemIndex: number) => void
  onRevertMarkdownShortcut: (value: string) => void
  onDelete: () => void
  onInsertParagraphAfter: () => void
  onSplitParagraph: (before: string, after: string) => void
  onTransform: (target: TransformTarget) => void
  onRemoveEmptyParagraph: () => void
  onRefocus: () => void
  menuOpen: boolean
  onToggleMenu: () => void
  registerField: (element: HTMLElement | null) => void
  pageId: string
}) {
  const { block } = props

  function handlePaste(event: React.ClipboardEvent<HTMLElement>) {
    const file = imageFileFromClipboard(event.clipboardData)
    if (file) {
      event.preventDefault()
      props.onPasteImage(file)
      return
    }

    if (block.type !== 'paragraph') return
    const url = event.clipboardData.getData('text/plain').trim()
    if (!isHttpUrl(url)) return
    const selectionText = window.getSelection()?.toString()
    if (!selectionText?.trim()) return
    const nextContent = linkSelectedText(block.content, selectionText, url)
    if (!nextContent) return
    event.preventDefault()
    props.onUpdate((current) => current.type === 'paragraph' ? { ...current, content: nextContent } : current)
    props.onRefocus()
  }

  return (
    <div className={`editor-block ${props.active ? 'active' : ''} ${props.selected ? 'selected' : ''}`} data-block-id={block.id} onFocus={props.onFocus}>
      {shouldShowBlockMenu(block) ? (
        <div className="block-menu-wrap">
          <button type="button" className="block-menu-button" onClick={props.onToggleMenu} title="Block options"><MoreHorizontal size={15} /></button>
          {props.menuOpen ? (
            <div className="block-menu-popover">
              {isTransformableBlock(block) ? (
                <>
                  <div className="block-menu-label">Turn into</div>
                  <button type="button" onClick={() => props.onTransform('paragraph')}>Text</button>
                  <button type="button" onClick={() => props.onTransform('heading1')}>Heading 1</button>
                  <button type="button" onClick={() => props.onTransform('heading2')}>Heading 2</button>
                  <button type="button" onClick={() => props.onTransform('heading3')}>Heading 3</button>
                  <button type="button" onClick={() => props.onTransform('heading4')}>Heading 4</button>
                  <button type="button" onClick={() => props.onTransform('heading5')}>Heading 5</button>
                  <button type="button" onClick={() => props.onTransform('heading6')}>Heading 6</button>
                  <button type="button" onClick={() => props.onTransform('inlineCode')}>Inline code</button>
                  <button type="button" onClick={() => props.onTransform('codeBlock')}>Code block</button>
                  <button type="button" onClick={() => props.onTransform('quote')}>Quote</button>
                  <button type="button" onClick={() => props.onTransform('list')}>Bulleted list</button>
                  <div className="block-menu-separator" />
                </>
              ) : null}
              <button type="button" onClick={props.onDelete}>Delete</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {block.type === 'paragraph' ? (
        <EditableText
          ref={(element) => props.registerField(element)}
          className="block-text block-paragraph"
          value={block.content}
          placeholder=""
          renderInlineMarkdown
          onChange={(value) => {
            const markdownBlock = blockFromMarkdownShortcut(value, block.id, { live: true })
            if (markdownBlock) {
              props.onUpdate(() => markdownBlock)
              props.onSlashClose()
              props.onRefocus()
              return
            }
            props.onUpdate((current) => current.type === 'paragraph' ? { ...current, content: value } : current)
            const match = value.trim().match(/^\/([a-z]*)$/i)
            if (match) props.onSlash(match[1] || '')
            else props.onSlashClose()
          }}
          onPaste={handlePaste}
          onBeforeInput={(event) => {
            if (event.nativeEvent.inputType !== 'insertText') return
            const data = event.nativeEvent.data
            if (data === ' ') {
              const markdownBlocks = blocksFromMarkdownSpaceShortcutLine(event.currentTarget, block.id)
              if (!markdownBlocks) return
              event.preventDefault()
              event.stopPropagation()
              props.onUpdate(() => markdownBlocks)
              props.onSlashClose()
              props.onRefocus()
              return
            }
            if (data === '`') {
              const markdownBlock = blockFromClosingBacktickShortcut(event.currentTarget.innerText, block.id)
              if (!markdownBlock) return
              event.preventDefault()
              event.stopPropagation()
              props.onUpdate(() => markdownBlock)
              props.onSlashClose()
              props.onRefocus()
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !event.currentTarget.innerText.trim()) {
              event.preventDefault()
              event.stopPropagation()
              props.onRemoveEmptyParagraph()
              return
            }
            if (event.key === '`') {
              const markdownBlock = blockFromClosingBacktickShortcut(event.currentTarget.innerText, block.id)
              if (markdownBlock) {
                event.preventDefault()
                event.stopPropagation()
                props.onUpdate(() => markdownBlock)
                props.onSlashClose()
                props.onRefocus()
                return
              }
            }
            if (event.key === ' ') {
              const markdownBlocks = blocksFromMarkdownSpaceShortcutLine(event.currentTarget, block.id)
              if (markdownBlocks) {
                event.preventDefault()
                event.stopPropagation()
                props.onUpdate(() => markdownBlocks)
                props.onSlashClose()
                props.onRefocus()
                return
              }
            }
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            event.stopPropagation()
            const codeFence = event.currentTarget.innerText.trim().match(/^```(\S*)$/)
            if (codeFence) {
              props.onUpdate(() => ({ id: block.id, type: 'code', code: '', language: codeFence[1] || 'plaintext', caption: '', wrap: true }))
              props.onSlashClose()
              props.onRefocus()
              return
            }
            const listItems = listItemsFromText(event.currentTarget.innerText)
            const orderedList = orderedListItemsFromText(event.currentTarget.innerText)
            if (!listItems && !orderedList) {
              const value = editableElementToMarkdown(event.currentTarget)
              const offset = editableMarkdownOffset(event.currentTarget) ?? value.length
              props.onSplitParagraph(value.slice(0, offset), value.slice(offset).replace(/^\n+/, ''))
              return
            }
            if (orderedList) props.onUpdate(() => ({ id: block.id, type: 'list', ordered: true, start: orderedList.start, items: [...orderedList.items, { text: '', level: orderedList.items[orderedList.items.length - 1]?.level || 0 }] }))
            else props.onUpdate(() => ({ id: block.id, type: 'list', items: [...listItems!, { text: '', level: listItems![listItems!.length - 1]?.level || 0 }] }))
            props.onSlashClose()
            props.onRefocus()
            return
          }}
        />
      ) : null}

      {block.type === 'heading' ? (
        <EditableText
          ref={(element) => props.registerField(element)}
          className={`block-heading heading-level-${block.level}`}
          value={block.content}
          placeholder="Heading"
          onPaste={handlePaste}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              props.onInsertParagraphAfter()
              return
            }
            if (event.key !== 'Backspace' || block.content.trim() || !editableSelectionAtStart(event.currentTarget)) return
            event.preventDefault()
            event.stopPropagation()
            props.onRevertMarkdownShortcut('#'.repeat(block.level))
          }}
          onChange={(value) => props.onUpdate((current) => current.type === 'heading' ? { ...current, content: value } : current)}
        />
      ) : null}

      {block.type === 'inlineCode' ? (
        <EditableText
          ref={(element) => props.registerField(element)}
          className="inline-code-block"
          value={block.content}
          placeholder="code"
          onPaste={handlePaste}
          onChange={(value) => props.onUpdate((current) => current.type === 'inlineCode' ? { ...current, content: value } : current)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            event.stopPropagation()
            props.onInsertParagraphAfter()
          }}
        />
      ) : null}

      {block.type === 'list' ? (
        <EditableList
          ref={(element) => props.registerField(element)}
          items={block.items}
          ordered={Boolean(block.ordered)}
          start={block.start || 1}
          onChange={(items) => props.onUpdate((current) => current.type === 'list' ? { ...current, items } : current)}
          onExitListBlock={props.onExitListBlock}
          onRevertMarkdownShortcut={() => props.onRevertMarkdownShortcut(block.ordered ? `${block.start || 1}.` : '-')}
        />
      ) : null}

      {block.type === 'notice' ? (
        <NoticeEditor
          content={block.content}
          variant={block.variant}
          onChange={(value) => props.onUpdate((current) => current.type === 'notice' ? { ...current, content: value } : current)}
        />
      ) : null}

      {block.type === 'quote' ? (
        <blockquote className="visual-quote">
          <EditableText
            value={block.content}
            placeholder="Quote"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
                props.onInsertParagraphAfter()
                return
              }
              if (event.key !== 'Backspace' || block.content.trim() || !editableSelectionAtStart(event.currentTarget)) return
              event.preventDefault()
              event.stopPropagation()
              props.onRevertMarkdownShortcut('>')
            }}
            onChange={(value) => props.onUpdate((current) => current.type === 'quote' ? { ...current, content: value } : current)}
          />
        </blockquote>
      ) : null}

      {block.type === 'table' ? (
        <div className="visual-table-wrap">
          <table className="visual-table">
            <colgroup>
              {tableColumnWidths(block).map((width, index) => <col key={index} style={{ width }} />)}
            </colgroup>
            <tbody>{block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, cellIndex) => (
                <td key={cellIndex}>
                  <input value={cell} onChange={(event) => props.onUpdate((current) => current.type === 'table' ? updateTableCell(current, rowIndex, cellIndex, event.target.value) : current)} />
                  {rowIndex === 0 ? <span className="column-resizer" onMouseDown={(event) => startTableColumnResize(event, block, cellIndex, props.onUpdate)} /> : null}
                </td>
              ))}</tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}

      {block.type === 'image' ? (
        <figure className={`visual-image ${block.border ? 'with-border' : ''}`} style={{ maxWidth: `${block.maxWidth || 720}px` }}>
          {block.src ? <img src={adminMediaPreviewSrc(props.pageId, block.src)} alt={block.alt} /> : <button type="button" className="ghost-button" onClick={props.onUploadImage}><Image size={16} /> Upload image</button>}
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
          <div className="image-options">
            <label>Max <input type="number" min="160" max="1200" step="40" value={block.maxWidth || 720} onChange={(event) => props.onUpdate((current) => current.type === 'image' ? { ...current, maxWidth: clampImageWidth(Number(event.target.value)) } : current)} /></label>
            <label><input type="checkbox" checked={block.border} onChange={(event) => props.onUpdate((current) => current.type === 'image' ? { ...current, border: event.target.checked } : current)} /> Border</label>
          </div>
        </figure>
      ) : null}

      {block.type === 'file' ? (
        <div className="visual-file">
          {block.src ? <a href={block.src} target="_blank" rel="noreferrer">{block.filename || block.src}</a> : <button type="button" className="ghost-button" onClick={props.onUploadImage}><FilePlus2 size={16} /> Upload file</button>}
          {block.caption ? <span>{block.caption}</span> : null}
        </div>
      ) : null}

      {block.type === 'link' ? (
        <div className="visual-link">
          <input value={block.label} placeholder="Link label" onChange={(event) => props.onUpdate((current) => current.type === 'link' ? { ...current, label: event.target.value } : current)} />
          <input value={block.url} placeholder="https://..." onChange={(event) => props.onUpdate((current) => current.type === 'link' ? { ...current, url: event.target.value } : current)} />
        </div>
      ) : null}

      {block.type === 'toc' ? (
        <div className="visual-toc"><TableOfContents size={18} /> Table of contents</div>
      ) : null}

      {block.type === 'hr' ? (
        <hr className="visual-hr" />
      ) : null}

      {block.type === 'tabs' ? (
        <div className="visual-tabs">
          <div className="visual-tabs-nav">{block.tabs.map((tab, index) => <input key={index} value={tab.title} onChange={(event) => props.onUpdate((current) => current.type === 'tabs' ? { ...current, tabs: current.tabs.map((currentTab, currentIndex) => currentIndex === index ? { ...currentTab, title: event.target.value } : currentTab) } : current)} />)}</div>
          {block.tabs.map((tab, index) => <textarea key={index} value={tab.content} placeholder={`${tab.title} content`} onChange={(event) => props.onUpdate((current) => current.type === 'tabs' ? { ...current, tabs: current.tabs.map((currentTab, currentIndex) => currentIndex === index ? { ...currentTab, content: event.target.value } : currentTab) } : current)} />)}
        </div>
      ) : null}

      {block.type === 'embed' ? (
        <div className="visual-embed">
          <input value={block.url} placeholder="https://..." onChange={(event) => props.onUpdate((current) => current.type === 'embed' ? { ...current, url: event.target.value } : current)} />
          {block.url ? <a href={block.url} target="_blank" rel="noreferrer">{block.url}</a> : null}
        </div>
      ) : null}

      {block.type === 'code' ? (
        <div className={`visual-code ${block.wrap ? 'wrap-code' : 'nowrap-code'}`}>
          {block.caption ? <div className="visual-code-caption">{block.caption}</div> : null}
          <div className="visual-code-header">
            <select value={block.language} onChange={(event) => props.onUpdate((current) => current.type === 'code' ? { ...current, language: event.target.value } : current)}>
              {codeLanguages.map((language) => <option key={language} value={language}>{language}</option>)}
            </select>
            <label><input type="checkbox" checked={block.wrap} onChange={(event) => props.onUpdate((current) => current.type === 'code' ? { ...current, wrap: event.target.checked } : current)} /> Wrap</label>
            <input value={block.caption} placeholder="Caption" onChange={(event) => props.onUpdate((current) => current.type === 'code' ? { ...current, caption: event.target.value } : current)} />
            <span>Command/Ctrl + Enter exits</span>
          </div>
          <EditableText
            ref={(element) => props.registerField(element)}
            className="visual-code-editor"
            value={block.code}
            placeholder="Write code..."
            onKeyDown={(event) => {
              if (event.key === 'Backspace' && !block.code.trim() && editableSelectionAtStart(event.currentTarget)) {
                event.preventDefault()
                event.stopPropagation()
                props.onRevertMarkdownShortcut(block.language && block.language !== 'plaintext' ? `\`\`\`${block.language}` : '```')
                return
              }
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                props.onExitCodeBlock()
              }
            }}
            onChange={(value) => props.onUpdate((current) => current.type === 'code' ? { ...current, code: value } : current)}
          />
        </div>
      ) : null}

      {props.slashOpen ? <SlashMenu query={props.slashQuery} onSelect={props.onSlashSelect} /> : null}
      <button type="button" className="insert-after-button" onClick={props.onInsertParagraphAfter} title="Insert text below"><Plus size={14} /></button>
    </div>
  )
}

const EditableText = forwardRef<HTMLElement, {
  value: string
  className?: string
  placeholder?: string
  renderInlineMarkdown?: boolean
  onChange: (value: string) => void
  onBeforeInput?: (event: React.FormEvent<HTMLElement> & { nativeEvent: InputEvent }) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void
  onPaste?: (event: React.ClipboardEvent<HTMLElement>) => void
}>(({ value, className, placeholder, renderInlineMarkdown, onChange, onBeforeInput, onKeyDown, onPaste }, ref) => {
  const localRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!localRef.current) return
    const currentValue = editableElementToMarkdown(localRef.current)
    if (currentValue === value) return
    if (renderInlineMarkdown) localRef.current.innerHTML = inlineMarkdownToHtml(value)
    else localRef.current.innerText = value
  }, [renderInlineMarkdown, value])

  return (
    <div
      ref={(element) => {
        localRef.current = element
        if (typeof ref === 'function') ref(element)
        else if (ref) (ref as React.MutableRefObject<HTMLElement | null>).current = element
      }}
      className={className}
      contentEditable
      data-placeholder={placeholder}
      onBeforeInput={onBeforeInput}
      onInput={(event) => onChange(renderInlineMarkdown ? editableElementToMarkdown(event.currentTarget) : event.currentTarget.innerText)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      role="textbox"
      spellCheck={false}
      suppressContentEditableWarning
    />
  )
})
EditableText.displayName = 'EditableText'

const EditableList = forwardRef<HTMLElement, {
  items: ListItem[]
  ordered: boolean
  start: number
  onChange: (items: ListItem[]) => void
  onExitListBlock: (itemIndex: number) => void
  onRevertMarkdownShortcut: () => void
}>(({ items, ordered, start, onChange, onExitListBlock, onRevertMarkdownShortcut }, ref) => {
  const text = listTextAreaValue(items)
  const markers = items.length ? items : [{ text: '', level: 0 }]
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || document.activeElement === textarea) return
    if (text === '') focusEditableEnd(textarea)
  }, [])

  function updateFromText(value: string) {
    const lines = value.split('\n')
    onChange(lines.map((line, index) => ({ text: line, level: items[index]?.level || 0 })))
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const textarea = event.currentTarget
    const lineIndex = textareaLineIndex(textarea.value, textarea.selectionStart)

    if (event.key === 'Tab') {
      event.preventDefault()
      const nextLevel = event.shiftKey ? Math.max(0, (items[lineIndex]?.level || 0) - 1) : Math.min(6, (items[lineIndex]?.level || 0) + 1)
      onChange(items.map((item, index) => index === lineIndex ? { ...item, level: nextLevel } : item))
      requestAnimationFrame(() => restoreTextareaSelection(textarea, textarea.selectionStart, textarea.selectionEnd))
      return
    }

    if (event.key === 'Backspace' && textarea.selectionStart === 0 && textarea.selectionEnd === 0 && !text.trim()) {
      event.preventDefault()
      onRevertMarkdownShortcut()
      return
    }

    if (event.key !== 'Enter') return
    const line = textarea.value.split('\n')[lineIndex] || ''
    if (line.trim()) return
    if ((items[lineIndex]?.level || 0) > 0) {
      event.preventDefault()
      onChange(items.map((item, index) => index === lineIndex ? { ...item, level: Math.max(0, item.level - 1) } : item))
      return
    }
    event.preventDefault()
    onExitListBlock(lineIndex)
  }

  return (
    <div className={`visual-list ${ordered ? 'ordered-list' : 'unordered-list'}`}>
      <div className="visual-list-markers" aria-hidden="true">
        {markers.map((item, index) => <div key={index} className="visual-list-marker-row" style={{ paddingLeft: item.level * 24 }}>{ordered ? `${start + index}.` : '-'}</div>)}
      </div>
      <textarea
      ref={(element) => {
        textareaRef.current = element
        if (typeof ref === 'function') ref(element)
        else if (ref) (ref as React.MutableRefObject<HTMLElement | null>).current = element
      }}
        className="visual-list-textarea"
        value={text}
        onChange={(event) => updateFromText(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={Math.max(1, markers.length)}
        spellCheck={false}
      />
    </div>
  )
})
EditableList.displayName = 'EditableList'

function NoticeEditor({
  content,
  variant,
  onChange,
}: {
  content: string
  variant: Extract<EditorBlock, { type: 'notice' }>['variant']
  onChange: (value: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null)

  useEffect(() => {
    const selection = pendingSelectionRef.current
    const textarea = textareaRef.current
    if (!selection || !textarea) return
    pendingSelectionRef.current = null
    textarea.focus()
    textarea.setSelectionRange(selection.start, selection.end)
  }, [content])

  return (
    <div className={`visual-notice ${variant}`} style={{ minHeight: estimatedNoticeHeight(content) }}>
      <textarea
        ref={textareaRef}
        className="visual-notice-input"
        style={{ height: estimatedTextareaHeight(content) }}
        value={content}
        placeholder="Notice content"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleNoticeKeyDown}
        rows={1}
        spellCheck={false}
      />
    </div>
  )

  function handleNoticeKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      replaceNoticeSelection(event.currentTarget, '\n')
      return
    }
    if (event.key !== 'Backspace' || event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault()
    deleteNoticeBackward(event.currentTarget)
  }

  function deleteNoticeBackward(textarea: HTMLTextAreaElement): void {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    if (start !== end) {
      const selectedText = textarea.value.slice(start, end)
      if (/^\n+$/.test(selectedText)) {
        replaceNoticeRange(textarea, end - 1, end, '')
        return
      }
      replaceNoticeRange(textarea, start, end, '')
      return
    }
    if (start <= 0) return
    replaceNoticeRange(textarea, start - 1, end, '')
  }

  function replaceNoticeSelection(textarea: HTMLTextAreaElement, replacement: string): void {
    replaceNoticeRange(textarea, textarea.selectionStart, textarea.selectionEnd, replacement)
  }

  function replaceNoticeRange(textarea: HTMLTextAreaElement, start: number, end: number, replacement: string): void {
    const currentValue = textarea.value
    const nextValue = currentValue.slice(0, start) + replacement + currentValue.slice(end)
    const nextPosition = start + replacement.length
    textarea.value = nextValue
    textarea.setSelectionRange(nextPosition, nextPosition)
    pendingSelectionRef.current = { start: nextPosition, end: nextPosition }
    onChange(nextValue)
    requestAnimationFrame(() => {
      const currentTextarea = textareaRef.current
      if (!currentTextarea) return
      currentTextarea.focus()
      currentTextarea.setSelectionRange(nextPosition, nextPosition)
    })
  }
}

function estimatedTextareaHeight(value: string): number {
  return Math.max(64, value.split('\n').length * 24)
}

function estimatedNoticeHeight(value: string): number {
  return estimatedTextareaHeight(value) + 30
}

function listTextAreaValue(items: ListItem[]): string {
  return (items.length ? items : [{ text: '', level: 0 }]).map((item) => item.text).join('\n')
}

function textareaLineIndex(value: string, position: number): number {
  return value.slice(0, position).split('\n').length - 1
}

function restoreTextareaSelection(textarea: HTMLTextAreaElement, start: number, end: number): void {
  textarea.focus()
  textarea.setSelectionRange(start, end)
}

function selectedTextOffsets(element: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null
  const start = textOffsetFromPoint(element, range.startContainer, range.startOffset)
  const end = textOffsetFromPoint(element, range.endContainer, range.endOffset)
  if (start <= end) return { start, end }
  return { start: end, end: start }
}

function editableTextOffset(element: HTMLElement): number | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!range.collapsed || !element.contains(range.startContainer)) return null
  return textOffsetFromPoint(element, range.startContainer, range.startOffset)
}

function editableMarkdownOffset(element: HTMLElement): number | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!range.collapsed || !element.contains(range.startContainer)) return null
  const before = range.cloneRange()
  before.selectNodeContents(element)
  before.setEnd(range.startContainer, range.startOffset)
  return Array.from(before.cloneContents().childNodes).map(nodeToMarkdown).join('').length
}

function textOffsetFromPoint(element: HTMLElement, node: globalThis.Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(element)
  try {
    range.setEnd(node, offset)
  } catch {
    return 0
  }
  return range.toString().length
}

function setTextSelection(element: HTMLElement, start: number, end: number): void {
  element.focus()
  const startPoint = textPointFromOffset(element, start)
  const endPoint = textPointFromOffset(element, end)
  const range = document.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function textPointFromOffset(element: HTMLElement, targetOffset: number): { node: globalThis.Node; offset: number } {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let currentOffset = 0
  let node = walker.nextNode()
  while (node) {
    const length = node.textContent?.length || 0
    if (currentOffset + length >= targetOffset) {
      return { node, offset: Math.max(0, targetOffset - currentOffset) }
    }
    currentOffset += length
    node = walker.nextNode()
  }
  return { node: element, offset: element.childNodes.length }
}

function listItemsToHtml(items: ListItem[], ordered: boolean, start: number): string {
  return (items.length ? items : [{ text: '', level: 0 }]).map((item, index) => {
    const marker = ordered ? `${start + index}.` : '-'
    return `<div class="visual-list-line" data-level="${item.level}" style="padding-left: ${item.level * 24}px;"><span class="visual-list-marker" contenteditable="false">${marker}</span><span class="visual-list-text">${escapeHtml(item.text) || '<br>'}</span></div>`
  }).join('')
}

function listElementToItems(element: HTMLElement): ListItem[] {
  const items = Array.from(element.querySelectorAll('.visual-list-line'))
    .filter((child): child is HTMLElement => child instanceof HTMLElement)
    .map((child) => ({
      text: listLineText(child),
      level: Number(child.dataset.level || Math.round((parseFloat(child.style.paddingLeft || '0') || 0) / 24)),
    }))
  return items.length ? items : [{ text: element.innerText.trim(), level: 0 }]
}

function listLineText(line: HTMLElement): string {
  const text = line.querySelector('.visual-list-text')
  if (!(text instanceof HTMLElement)) return ''
  return Array.from(text.childNodes).map((node) => node.nodeType === Node.TEXT_NODE ? node.textContent || '' : '').join('').replace(/\n$/g, '')
}

function sameListItems(left: ListItem[], right: ListItem[]): boolean {
  if (left.length !== right.length) return false
  return left.every((item, index) => item.text === right[index]?.text && item.level === right[index]?.level)
}

function currentListItemIndex(element: HTMLElement): number {
  const selection = window.getSelection()
  const node = selection?.anchorNode
  if (node === element) {
    const offset = Math.max(0, Math.min(selection?.anchorOffset || 0, element.querySelectorAll('.visual-list-line').length - 1))
    return offset
  }
  const start = node instanceof HTMLElement ? node : node?.parentElement
  const item = start?.closest('.visual-list-line')
  if (!item || !element.contains(item)) return 0
  return Array.from(element.querySelectorAll('.visual-list-line')).indexOf(item)
}

function focusListItemEnd(element: HTMLElement, index: number): void {
  const item = element.querySelectorAll('.visual-list-line')[index]
  if (!(item instanceof HTMLElement)) {
    element.focus()
    return
  }
  const text = item.querySelector('.visual-list-text')
  if (!(text instanceof HTMLElement)) return
  const range = document.createRange()
  range.selectNodeContents(text)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

type ListTextRange = {
  startIndex: number
  startOffset: number
  endIndex: number
  endOffset: number
}

function listSelectedRange(element: HTMLElement): ListTextRange | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (range.collapsed || !element.contains(range.startContainer) || !element.contains(range.endContainer)) return null
  const start = listTextPoint(element, range.startContainer, range.startOffset)
  const end = listTextPoint(element, range.endContainer, range.endOffset)
  if (!start || !end) return null
  if (start.index > end.index || (start.index === end.index && start.offset > end.offset)) {
    return { startIndex: end.index, startOffset: end.offset, endIndex: start.index, endOffset: start.offset }
  }
  return { startIndex: start.index, startOffset: start.offset, endIndex: end.index, endOffset: end.offset }
}

function listTextPoint(element: HTMLElement, node: globalThis.Node, offset: number): { index: number; offset: number } | null {
  const start = node instanceof HTMLElement ? node : node.parentNode instanceof HTMLElement ? node.parentNode : null
  const text = start?.closest('.visual-list-text')
  const line = start?.closest('.visual-list-line')
  if (!text || !line || !element.contains(text)) return null
  const index = Array.from(element.querySelectorAll('.visual-list-line')).indexOf(line)
  if (index < 0) return null
  const before = document.createRange()
  before.selectNodeContents(text)
  try {
    before.setEnd(node, offset)
  } catch {
    return null
  }
  return { index, offset: before.toString().length }
}

function deleteListRange(items: ListItem[], range: ListTextRange): ListItem[] {
  const startItem = items[range.startIndex]
  const endItem = items[range.endIndex]
  if (!startItem || !endItem) return items
  if (range.startIndex === range.endIndex) {
    return items.map((item, index) => index === range.startIndex ? { ...item, text: item.text.slice(0, range.startOffset) + item.text.slice(range.endOffset) } : item)
  }
  const merged: ListItem = {
    ...startItem,
    text: startItem.text.slice(0, range.startOffset) + endItem.text.slice(range.endOffset),
  }
  return [...items.slice(0, range.startIndex), merged, ...items.slice(range.endIndex + 1)]
}

function listSelectionAtItemTextStart(element: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  if (!range.collapsed || !element.contains(range.startContainer)) return false
  const start = range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement
  const text = start?.closest('.visual-list-text')
  if (!text || !element.contains(text)) return false
  const before = range.cloneRange()
  before.selectNodeContents(text)
  before.setEnd(range.startContainer, range.startOffset)
  return before.toString().length === 0
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(value)
}

function linkSelectedText(content: string, selectedText: string, url: string): string {
  const label = selectedText.trim()
  if (!label) return ''
  const index = content.indexOf(selectedText)
  if (index < 0) return ''
  return `${content.slice(0, index)}[${escapeMarkdownLinkLabel(label)}](${url})${content.slice(index + selectedText.length)}`
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}

function inlineMarkdownToHtml(value: string): string {
  const parts: string[] = []
  let index = 0
  const pattern = /\[([^\]\n]+)]\((https?:\/\/[^)\s]+)\)|`([^`\n]+)`/gi
  for (const match of value.matchAll(pattern)) {
    parts.push(escapeHtml(value.slice(index, match.index)))
    if (match[1] && match[2]) {
      parts.push(`<a href="${escapeHtml(match[2])}" target="_blank" rel="noreferrer">${escapeHtml(unescapeMarkdownLinkLabel(match[1]))}</a>`)
    } else if (match[3]) {
      parts.push(`<code>${escapeHtml(match[3])}</code>`)
    }
    index = (match.index || 0) + match[0].length
  }
  parts.push(escapeHtml(value.slice(index)))
  return parts.join('').replace(/\n/g, '<br>')
}

function editableElementToMarkdown(element: HTMLElement): string {
  return Array.from(element.childNodes).map(nodeToMarkdown).join('')
}

function nodeToMarkdown(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
  if (!(node instanceof HTMLElement)) return ''
  if (node.tagName === 'BR') return '\n'
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') || ''
    return href ? `[${escapeMarkdownLinkLabel(node.innerText)}](${href})` : node.innerText
  }
  if (node.tagName === 'CODE') return `\`${node.innerText}\``
  return Array.from(node.childNodes).map(nodeToMarkdown).join('')
}

function unescapeMarkdownLinkLabel(value: string): string {
  return value.replace(/\\]/g, ']').replace(/\\\\/g, '\\')
}

function editableSelectionAtStart(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.selectionStart === 0 && element.selectionEnd === 0
  }
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  if (!range.collapsed || !element.contains(range.startContainer)) return false
  const before = range.cloneRange()
  before.selectNodeContents(element)
  before.setEnd(range.startContainer, range.startOffset)
  return before.toString().length === 0
}

function focusEditableEnd(element: HTMLElement | undefined): void {
  if (!element) return
  element.focus()
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const end = element.value.length
    element.setSelectionRange(end, end)
    return
  }
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function Tree({
  nodes,
  selectedId,
  menuId,
  draggingPageId,
  dropTarget,
  editable,
  pendingDeletedPageIds,
  pendingDeletedCategoryIds,
  onSelect,
  onMenuToggle,
  onDeletePage,
  onDeleteCategory,
  onUpdateMeta,
  insertMenuId,
  onInsertMenuToggle,
  onCreatePage,
  onCreateCategory,
  onDragPageStart,
  onDragPageEnd,
  onDropTargetChange,
  onDrop,
}: {
  nodes: Node[]
  selectedId: string
  menuId: string
  draggingPageId: string
  dropTarget: DropTarget
  editable: boolean
  pendingDeletedPageIds: Set<string>
  pendingDeletedCategoryIds: Set<string>
  onSelect: (id: string) => void
  onMenuToggle: (id: string) => void
  onDeletePage: (item: PageNode) => void
  onDeleteCategory: (item: CategoryNode, mode: 'lift' | 'cascade') => void
  onUpdateMeta: (item: Node, input: TreeMetaInput) => void
  insertMenuId: string
  onInsertMenuToggle: (id: string) => void
  onCreatePage: (parentId?: string) => void
  onCreateCategory: (parentId?: string) => void
  onDragPageStart: (id: string) => void
  onDragPageEnd: () => void
  onDropTargetChange: (target: DropTarget) => void
  onDrop: (pageIdToMove: string, target: Exclude<DropTarget, null>) => void
}) {
  return (
    <ul className="tree">
      {nodes.map((node) => (
        <li key={node.id}>
          {node.type === 'page' ? (
            <div
              className={`tree-row page-row ${node.id === selectedId ? 'selected' : ''} ${pendingDeletedPageIds.has(node.id) ? 'pending-delete' : ''} ${editable && draggingPageId === node.id ? 'dragging' : ''} ${editable && dropTarget?.type === 'before' && dropTarget.id === node.id ? 'drop-before' : ''} ${editable && dropTarget?.type === 'after' && dropTarget.id === node.id ? 'drop-after' : ''}`}
              draggable={editable && !pendingDeletedPageIds.has(node.id)}
              onDragStart={(event) => {
                if (!editable || pendingDeletedPageIds.has(node.id)) return
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', node.id)
                onDragPageStart(node.id)
              }}
              onDragOver={(event) => {
                if (!editable || pendingDeletedPageIds.has(node.id)) return
                event.preventDefault()
                event.stopPropagation()
                event.dataTransfer.dropEffect = 'move'
                onDropTargetChange(pageDropTargetFromPointer(event, node.id))
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) return
                if (dropTarget?.type !== 'root' && dropTarget?.id === node.id) onDropTargetChange(null)
              }}
              onDrop={(event) => {
                if (!editable) return
                const pageIdToMove = event.dataTransfer.getData('text/plain') || draggingPageId
                if (!pageIdToMove || pageIdToMove === node.id) return
                event.preventDefault()
                event.stopPropagation()
                onDrop(pageIdToMove, pageDropTargetFromPointer(event, node.id))
              }}
              onDragEnd={onDragPageEnd}
            >
              <button
                className={node.id === selectedId ? 'selected' : ''}
                draggable={editable && !pendingDeletedPageIds.has(node.id)}
                onClick={() => onSelect(node.id)}
                onDragStart={(event) => {
                  if (!editable || pendingDeletedPageIds.has(node.id)) return
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', node.id)
                  onDragPageStart(node.id)
                }}
                onDragEnd={onDragPageEnd}
              >
                <CmsIconView icon={node.icon} fallback={false} />
                <span>{node.title}</span>
                {pendingDeletedPageIds.has(node.id) ? <small className="tree-pending-label">Delete queued</small> : null}
              </button>
              {editable ? (
                <div className="tree-actions">
                  <button type="button" className="tree-action-button" onClick={(event) => { event.stopPropagation(); onMenuToggle(node.id) }} title="Page options"><MoreHorizontal size={14} /></button>
                  {menuId === node.id ? (
                    <div className="tree-menu" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                      <TreeMetaForm node={node} onSave={(input) => onUpdateMeta(node, input)} />
                      <button type="button" className="danger-text" onClick={() => onDeletePage(node)}>{pendingDeletedPageIds.has(node.id) ? 'Delete queued' : 'Delete page'}</button>
                    </div>
                  ) : null}
                </div>
              ) : <div />}
            </div>
          ) : (
            <div className="category-drop-wrap">
              <div
                className={`tree-row category-row ${pendingDeletedCategoryIds.has(node.id) ? 'pending-delete' : ''} ${editable && dropTarget?.type === 'category' && dropTarget.id === node.id ? 'drop-inside' : ''}`}
                onDragOver={(event) => {
                  if (!editable || pendingDeletedCategoryIds.has(node.id)) return
                  event.preventDefault()
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = 'move'
                  onDropTargetChange({ type: 'category', id: node.id })
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) return
                  if (dropTarget?.type !== 'root' && dropTarget?.id === node.id) onDropTargetChange(null)
                }}
                onDrop={(event) => {
                  if (!editable || pendingDeletedCategoryIds.has(node.id)) return
                  const pageIdToMove = event.dataTransfer.getData('text/plain') || draggingPageId
                  if (!pageIdToMove) return
                  event.preventDefault()
                  event.stopPropagation()
                  onDrop(pageIdToMove, { type: 'category', id: node.id })
                }}
              >
                <span className="category-label"><CmsIconView icon={node.icon} fallback={false} /><span>{node.title}</span>{pendingDeletedCategoryIds.has(node.id) ? <small className="tree-pending-label">Delete queued</small> : null}</span>
                {editable ? (
                  <div className="tree-actions">
                    <button type="button" className="tree-action-button" onClick={(event) => { event.stopPropagation(); onMenuToggle(node.id) }} title="Group options"><MoreHorizontal size={14} /></button>
                    {menuId === node.id ? (
                      <div className="tree-menu" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                        <TreeMetaForm node={node} onSave={(input) => onUpdateMeta(node, input)} />
                        <button type="button" onClick={() => onDeleteCategory(node, 'lift')}>{node.children.length ? 'Delete group only' : 'Delete group'}</button>
                        {node.children.length ? <button type="button" className="danger-text" onClick={() => onDeleteCategory(node, 'cascade')}>Delete group and contents</button> : null}
                      </div>
                    ) : null}
                  </div>
                ) : <div />}
              </div>
              <Tree
                nodes={node.children}
                selectedId={selectedId}
                menuId={menuId}
                draggingPageId={draggingPageId}
                dropTarget={dropTarget}
                editable={editable}
                pendingDeletedPageIds={pendingDeletedPageIds}
                pendingDeletedCategoryIds={pendingDeletedCategoryIds}
                onSelect={onSelect}
                onMenuToggle={onMenuToggle}
                onDeletePage={onDeletePage}
                onDeleteCategory={onDeleteCategory}
                onUpdateMeta={onUpdateMeta}
                insertMenuId={insertMenuId}
                onInsertMenuToggle={onInsertMenuToggle}
                onCreatePage={onCreatePage}
                onCreateCategory={onCreateCategory}
                onDragPageStart={onDragPageStart}
                onDragPageEnd={onDragPageEnd}
                onDropTargetChange={onDropTargetChange}
                onDrop={onDrop}
              />
              {editable ? (
                <TreeInsertControl
                  open={insertMenuId === `insert-${node.id}`}
                  onToggle={() => onInsertMenuToggle(`insert-${node.id}`)}
                  onCreatePage={() => onCreatePage(node.id)}
                  onCreateCategory={() => onCreateCategory(node.id)}
                />
              ) : null}
            </div>
          )}
        </li>
      ))}
      {editable ? (
        <li>
          <TreeInsertControl
            open={insertMenuId === 'insert-root'}
            onToggle={() => onInsertMenuToggle('insert-root')}
            onCreatePage={() => onCreatePage()}
            onCreateCategory={() => onCreateCategory()}
          />
        </li>
      ) : null}
    </ul>
  )
}

function TreeInsertControl({ open, onToggle, onCreatePage, onCreateCategory }: { open: boolean; onToggle: () => void; onCreatePage: () => void; onCreateCategory: () => void }) {
  function run(action: () => void) {
    onToggle()
    action()
  }

  return (
    <div className={`tree-insert-control ${open ? 'open' : ''}`}>
      <button type="button" className="tree-insert-button" onClick={(event) => { event.stopPropagation(); onToggle() }} aria-label="Insert">
        <Plus size={15} />
        <span>Insert</span>
      </button>
      {open ? (
        <div className="tree-insert-menu" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => run(onCreatePage)}><FilePlus2 size={15} /> Page</button>
          <button type="button" onClick={() => run(onCreateCategory)}><FolderPlus size={15} /> Group</button>
        </div>
      ) : null}
    </div>
  )
}

function TreeMetaForm({ node, onSave }: { node: Node; onSave: (input: TreeMetaInput) => void }) {
  const [title, setTitle] = useState(node.title)
  const [slug, setSlug] = useState(node.slug)
  const [icon, setIcon] = useState<CmsIcon | undefined>(node.icon)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    onSave({ title, slug, icon })
  }

  return (
    <form className="tree-edit-form" onSubmit={submit}>
      <strong>Edit title &amp; slug</strong>
      <label>
        <span>Title</span>
        <div className="tree-title-edit-row">
          <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
          <IconPicker value={icon} compact onChange={setIcon} />
        </div>
      </label>
      <label>
        <span>Slug</span>
        <input value={slug} onChange={(event) => setSlug(event.target.value)} onBlur={() => setSlug(slugifyTitle(slug || title))} />
      </label>
      <button type="submit" className="tree-save-button">Save changes</button>
    </form>
  )
}

function SlashMenu({ query, onSelect }: { query: string; onSelect: (command: SlashCommand) => void }) {
  const allCommands: SlashMenuItem[] = [
    { id: 'code', title: 'Code block', description: '', icon: <Code2 size={17} /> },
    { id: 'embed', title: 'Codepen', description: '', icon: <LayoutPanelTop size={17} /> },
    { id: 'tabs', title: 'Multi-syntax code', description: 'With tabs and code blocks', icon: <Code2 size={17} /> },
    { id: 'list', title: 'Task list', description: '', icon: <List size={17} /> },
    { id: 'embed', title: 'Arcade', description: '', icon: <Sparkles size={17} /> },
    { id: 'embed', title: 'OpenAPI', description: '', icon: <Link2 size={17} /> },
    { id: 'table', title: 'Columns', description: '', icon: <LayoutPanelTop size={17} /> },
    { id: 'embed', title: 'Embed a URL...', description: '', icon: <ExternalLink size={17} /> },
    { id: 'notice', title: 'Conditional content', description: 'Upgrade', icon: <AlertTriangle size={17} /> },
    { id: 'quote', title: 'Expandable', description: '', icon: <Quote size={17} /> },
    { id: 'list', title: 'Ordered list', description: '', icon: <List size={17} /> },
    { id: 'table', title: 'API reference', description: 'With table, tabs and code', icon: <Link2 size={17} /> },
    { id: 'paragraph', title: 'Text', description: '', icon: <BookOpen size={17} /> },
    { id: 'heading', title: 'Heading', description: '', icon: <LayoutPanelTop size={17} /> },
    { id: 'image', title: 'Image', description: '', icon: <Image size={17} /> },
    { id: 'file', title: 'File upload', description: '', icon: <FilePlus2 size={17} /> },
    { id: 'link', title: 'Link', description: '', icon: <Link2 size={17} /> },
    { id: 'toc', title: 'Table of contents', description: '', icon: <TableOfContents size={17} /> },
  ]
  const commands = allCommands.filter((command) => command.title.toLowerCase().includes(query.toLowerCase()) || command.id.includes(query.toLowerCase()))
  return (
    <div className="slash-menu">
      <div className="slash-search">{query || 'Search blocks'}</div>
      {commands.map((command, index) => (
        <button key={`${command.title}-${index}`} type="button" onClick={() => onSelect(command.id)}>
          {command.icon}
          <span><strong>{command.title}</strong>{command.description ? <small>{command.description}</small> : null}</span>
        </button>
      ))}
    </div>
  )
}

const codeLanguages = ['bash', 'javascript', 'typescript', 'python', 'java', 'go', 'rust', 'php', 'ruby', 'sql', 'json', 'yaml', 'html', 'css', 'powershell', 'plaintext']

function blockForCommand(command: SlashCommand): EditorBlock {
  if (command === 'heading') return { id: blockId(), type: 'heading', content: '', level: 2 }
  if (command === 'list') return { id: blockId(), type: 'list', items: [{ text: '', level: 0 }] }
  if (command === 'notice') return { id: blockId(), type: 'notice', variant: 'info', content: '' }
  if (command === 'quote') return { id: blockId(), type: 'quote', content: '' }
  if (command === 'table') return { id: blockId(), type: 'table', rows: [['Header', 'Header'], ['Value', 'Value']], caption: '', colWidths: [180, 180] }
  if (command === 'image') return { id: blockId(), type: 'image', src: '', alt: '', caption: '', maxWidth: 720, border: false }
  if (command === 'file') return { id: blockId(), type: 'file', src: '', filename: '', caption: '' }
  if (command === 'link') return { id: blockId(), type: 'link', url: '', label: '' }
  if (command === 'toc') return { id: blockId(), type: 'toc' }
  if (command === 'tabs') return { id: blockId(), type: 'tabs', tabs: [{ title: 'Tab 1', content: '' }, { title: 'Tab 2', content: '' }] }
  if (command === 'embed') return { id: blockId(), type: 'embed', url: '', caption: '' }
  if (command === 'code') return { id: blockId(), type: 'code', code: '', language: 'bash', caption: '', wrap: true }
  return newParagraphBlock()
}

function imageBlock(values: Partial<Extract<EditorBlock, { type: 'image' }>> = {}): Extract<EditorBlock, { type: 'image' }> {
  return {
    id: values.id || blockId(),
    type: 'image',
    src: values.src || '',
    alt: values.alt || '',
    caption: values.caption || '',
    maxWidth: clampImageWidth(values.maxWidth || 720),
    border: Boolean(values.border),
  }
}

function clampImageWidth(value: number): number {
  if (!Number.isFinite(value)) return 720
  return Math.min(1200, Math.max(160, Math.round(value)))
}

function listItemsFromText(value: string, options: { live?: boolean } = {}): ListItem[] | null {
  if (value === '- ' || (!options.live && value === '-')) return [{ text: '', level: 0 }]
  const lines = value.split('\n').filter((line) => line.trim())
  if (!lines.length) return null
  const items = lines.map((line) => line.match(/^(\s*)-\s*(.*)$/))
  if (items.some((item) => !item)) return null
  return items.map((item) => ({
    level: Math.floor((item?.[1] || '').replace(/\t/g, '  ').length / 2),
    text: item?.[2] || '',
  }))
}

function blockFromMarkdownSpaceShortcut(value: string, id: string): EditorBlock | null {
  const shortcut = value.trim()
  const heading = shortcut.match(/^(#{1,6})$/)
  if (heading) return { id, type: 'heading', level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, content: '' }

  if (shortcut === '-') return { id, type: 'list', items: [{ text: '', level: 0 }] }
  const ordered = shortcut.match(/^(\d+)\.?$/)
  if (ordered) return { id, type: 'list', ordered: true, start: Number(ordered[1]), items: [{ text: '', level: 0 }] }
  if (shortcut === '>') return { id, type: 'quote', content: '' }

  const codeFence = shortcut.match(/^```(\S*)$/)
  if (codeFence) return { id, type: 'code', language: codeFence[1] || 'plaintext', code: '', caption: '', wrap: true }

  return null
}

function blocksFromMarkdownSpaceShortcutLine(element: HTMLElement, id: string): EditorBlock[] | null {
  const value = element.innerText.replace(/\n$/, '')
  const offset = editableTextOffset(element)
  if (offset === null) return null
  const lineStart = value.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
  const lineEndIndex = value.indexOf('\n', offset)
  const lineEnd = lineEndIndex < 0 ? value.length : lineEndIndex
  const line = value.slice(lineStart, offset)
  if (value.slice(offset, lineEnd).trim()) return null
  const shortcutBlock = blockFromMarkdownSpaceShortcut(line, id)
  if (!shortcutBlock) return null

  const before = value.slice(0, lineStart).replace(/\n$/, '')
  const after = value.slice(lineEnd).replace(/^\n/, '')
  const blocks: EditorBlock[] = []
  if (before) blocks.push({ id: blockId(), type: 'paragraph', content: before })
  blocks.push(shortcutBlock)
  if (after) blocks.push({ id: blockId(), type: 'paragraph', content: after })
  return blocks
}

function blockFromClosingBacktickShortcut(value: string, id: string): EditorBlock | null {
  const inlineCode = value.match(/^`([^`\n]+)$/)
  if (inlineCode) return { id, type: 'inlineCode', content: inlineCode[1] }
  return null
}

function blockFromMarkdownShortcut(value: string, id: string, options: { live?: boolean } = {}): EditorBlock | null {
  const heading = value.match(/^(#{1,6})\s(.*)$/)
  if (heading) return { id, type: 'heading', level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, content: heading[2] }

  if (/^\s*(---|\*\*\*|___)\s*$/.test(value)) return { id, type: 'hr' }

  const completedFence = value.match(/^```(\S*)\n([\s\S]*)\n```$/)
  if (completedFence) return { id, type: 'code', language: completedFence[1] || 'plaintext', code: completedFence[2], caption: '', wrap: true }

  if (!options.live) {
    const inlineCode = value.match(/^`([^`\n]+)`$/) || value.match(/^```([^`\n]+)```$/)
    if (inlineCode) return { id, type: 'inlineCode', content: inlineCode[1] }
  }

  const table = tableBlockFromText(value, id)
  if (table) return table

  return null
}

function orderedListItemsFromText(value: string): { start: number; items: ListItem[] } | null {
  const lines = value.split('\n').filter((line) => line.trim())
  if (!lines.length) return null
  const items = lines.map((line) => line.match(/^(\s*)(\d+)\.\s+(.*)$/))
  if (items.some((item) => !item)) return null
  return {
    start: Number(items[0]?.[2] || 1),
    items: items.map((item) => ({
      level: Math.floor((item?.[1] || '').replace(/\t/g, '  ').length / 2),
      text: item?.[3] || '',
    })),
  }
}

function tableBlockFromText(value: string, id = blockId()): Extract<EditorBlock, { type: 'table' }> | null {
  const lines = value.split('\n').filter((line) => line.trim())
  if (lines.length < 2 || !isTableLine(lines[0]) || !isTableSeparator(lines[1])) return null
  const rows = [splitTableLine(lines[0]), ...lines.slice(2).filter(isTableLine).map(splitTableLine)]
  const normalizedRows = rows.length > 1 ? rows : [...rows, rows[0].map(() => '')]
  return { id, type: 'table', rows: normalizedRows, caption: '', colWidths: normalizedRows[0].map(() => 180) }
}

function shouldShowBlockMenu(block: EditorBlock): boolean {
  if (block.type !== 'paragraph') return true
  return Boolean(block.content.trim())
}

function isTransformableBlock(block: EditorBlock): boolean {
  return block.type === 'paragraph' || block.type === 'heading' || block.type === 'list' || block.type === 'inlineCode' || block.type === 'quote'
}

function textForBlock(block: EditorBlock): string {
  if (block.type === 'paragraph') return block.content
  if (block.type === 'heading') return block.content
  if (block.type === 'inlineCode') return block.content
  if (block.type === 'quote') return block.content
  if (block.type === 'hr') return '---'
  if (block.type === 'list') return block.items.map((item) => item.text).join('\n')
  if ('caption' in block && typeof block.caption === 'string') return block.caption
  return ''
}

function imageFileFromClipboard(data: DataTransfer): File | null {
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    return item.getAsFile()
  }
  return null
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, select, button, a, [contenteditable="true"], .block-menu-popover, .block-menu-wrap'))
}

function intersectingBlockIds(editor: HTMLElement, box: { left: number; top: number; width: number; height: number }): string[] {
  const editorRect = editor.getBoundingClientRect()
  return Array.from(editor.querySelectorAll<HTMLElement>('.editor-block[data-block-id]'))
    .filter((block) => {
      const rect = block.getBoundingClientRect()
      const local = {
        left: rect.left - editorRect.left,
        top: rect.top - editorRect.top,
        width: rect.width,
        height: rect.height,
      }
      return rectanglesIntersect(box, local)
    })
    .map((block) => block.dataset.blockId || '')
    .filter(Boolean)
}

function pagePointToEditorPoint(editor: HTMLElement, pageX: number, pageY: number): { x: number; y: number } {
  const rect = editor.getBoundingClientRect()
  return {
    x: pageX - (rect.left + window.scrollX),
    y: pageY - (rect.top + window.scrollY),
  }
}

function rectanglesIntersect(a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top
}

function newParagraphBlock(content = ''): EditorBlock {
  return { id: blockId(), type: 'paragraph', content }
}

function initialParagraphBlock(): EditorBlock {
  return { id: 'initial-paragraph', type: 'paragraph', content: '' }
}

function ensureEditableTail(blocks: EditorBlock[]): EditorBlock[] {
  const last = blocks[blocks.length - 1]
  if (last?.type === 'paragraph' && !last.content.trim()) return blocks
  return [...blocks, newParagraphBlock()]
}

function blockId(): string {
  return `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function updateTableCell(block: Extract<EditorBlock, { type: 'table' }>, rowIndex: number, cellIndex: number, value: string): EditorBlock {
  const columnCount = Math.max(block.rows[0]?.length || 0, cellIndex + 1)
  return {
    ...block,
    rows: block.rows.map((row, currentRow) => currentRow === rowIndex ? row.map((cell, currentCell) => currentCell === cellIndex ? value : cell) : row),
    colWidths: normalizeTableWidths(block.colWidths, columnCount),
  }
}

function tableColumnWidths(block: Extract<EditorBlock, { type: 'table' }>): number[] {
  return normalizeTableWidths(block.colWidths, block.rows[0]?.length || 0)
}

function normalizeTableWidths(widths: number[] | undefined, count: number): number[] {
  return Array.from({ length: count }, (_, index) => Math.max(90, Math.min(640, widths?.[index] || 180)))
}

function startTableColumnResize(
  event: React.MouseEvent<HTMLElement>,
  block: Extract<EditorBlock, { type: 'table' }>,
  columnIndex: number,
  onUpdate: (updater: (block: EditorBlock) => EditorBlock) => void,
) {
  event.preventDefault()
  event.stopPropagation()
  const startX = event.clientX
  const widths = tableColumnWidths(block)
  const startWidth = widths[columnIndex] || 180
  const onMove = (moveEvent: MouseEvent) => {
    const nextWidth = Math.max(90, Math.min(640, startWidth + moveEvent.clientX - startX))
    onUpdate((current) => current.type === 'table' ? { ...current, colWidths: widths.map((width, index) => index === columnIndex ? nextWidth : width) } : current)
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function markdownToBlocks(markdown: string): EditorBlock[] {
  const lines = markdown.split('\n')
  const blocks: EditorBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }

    const codeStart = line.match(/^```(\S*)(.*)$/)
    if (codeStart) {
      const language = codeStart[1] || 'plaintext'
      const codeOptions = parseCodeOptions(codeStart[2] || '')
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      const caption = parseCaption(lines[index] ?? '')
      if (caption) index += 1
      blocks.push({ id: blockId(), type: 'code', language, code: codeLines.join('\n'), caption: caption || codeOptions.caption, wrap: codeOptions.wrap })
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      blocks.push({ id: blockId(), type: 'heading', level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, content: heading[2] })
      index += 1
      continue
    }

    const altHeading = lines[index + 1]?.match(/^(=+|-{2,})\s*$/)
    if (line.trim() && altHeading) {
      blocks.push({ id: blockId(), type: 'heading', level: altHeading[1].startsWith('=') ? 1 : 2, content: line.trim() })
      index += 2
      continue
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push({ id: blockId(), type: 'hr' })
      index += 1
      continue
    }

    if (line.trim() === '[[toc]]') {
      blocks.push({ id: blockId(), type: 'toc' })
      index += 1
      continue
    }

    const notice = line.match(/^>\s*\[!(INFO|SUCCESS|WARNING|DANGER|CAUTION|TIP)]/i)
    if (notice) {
      const contentLines: string[] = []
      const variant = notice[1].toLowerCase() === 'tip' ? 'success' : notice[1].toLowerCase() === 'caution' ? 'danger' : notice[1].toLowerCase()
      while (index < lines.length && /^>/.test(lines[index] ?? '')) {
        contentLines.push((lines[index] ?? '').replace(/^>\s?/, '').replace(/^\[![^\]]+]\s*/, ''))
        index += 1
      }
      blocks.push({ id: blockId(), type: 'notice', variant: variant as Extract<EditorBlock, { type: 'notice' }>['variant'], content: contentLines.join('\n').trim() })
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>/.test(lines[index] ?? '')) {
        quoteLines.push((lines[index] ?? '').replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({ id: blockId(), type: 'quote', content: quoteLines.join('\n') })
      continue
    }

    if (/^\s*-\s+/.test(line)) {
      const items: ListItem[] = []
      while (index < lines.length && /^\s*-\s+/.test(lines[index] ?? '')) {
        const item = (lines[index] ?? '').match(/^(\s*)-\s+(.*)$/)
        if (item) items.push({ level: Math.floor(item[1].replace(/\t/g, '  ').length / 2), text: item[2] })
        index += 1
      }
      blocks.push({ id: blockId(), type: 'list', items })
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ListItem[] = []
      const first = line.match(/^\s*(\d+)\.\s+/)
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? '')) {
        const item = (lines[index] ?? '').match(/^(\s*)\d+\.\s+(.*)$/)
        if (item) items.push({ level: Math.floor(item[1].replace(/\t/g, '  ').length / 2), text: item[2] })
        index += 1
      }
      blocks.push({ id: blockId(), type: 'list', ordered: true, start: Number(first?.[1] || 1), items })
      continue
    }

    const figure = line.match(/^<figure class="cms-image(?:\s+(cms-image-bordered))?" style="--cms-image-max-width:\s*(\d+)px;">$/)
    if (figure) {
      const imageLine = lines[index + 1] ?? ''
      const image = imageLine.match(/^<img src="([^"]*)" alt="([^"]*)" \/>$/)
      if (image) {
        index += 2
        let caption = ''
        const captionLine = lines[index] ?? ''
        const captionMatch = captionLine.match(/^<figcaption>(.*)<\/figcaption>$/)
        if (captionMatch) {
          caption = unescapeHtml(captionMatch[1])
          index += 1
        }
        if ((lines[index] ?? '').trim() === '</figure>') index += 1
        blocks.push(imageBlock({
          src: unescapeHtml(image[1]),
          alt: unescapeHtml(image[2]),
          caption,
          maxWidth: Number(figure[2]),
          border: Boolean(figure[1]),
        }))
        continue
      }
    }

    const image = line.match(/^!\[(.*)]\((.*)\)$/)
    if (image) {
      index += 1
      const caption = parseCaption(lines[index] ?? '')
      if (caption) index += 1
      blocks.push(imageBlock({ alt: image[1], src: image[2], caption }))
      continue
    }

    const inlineCode = line.match(/^`([^`\n]+)`$/)
    if (inlineCode) {
      blocks.push({ id: blockId(), type: 'inlineCode', content: inlineCode[1] })
      index += 1
      continue
    }

    const file = line.match(/^\[📎\s*(.*)]\((.*)\)$/)
    if (file) {
      index += 1
      const caption = parseCaption(lines[index] ?? '')
      if (caption) index += 1
      blocks.push({ id: blockId(), type: 'file', filename: file[1], src: file[2], caption })
      continue
    }

    if (isTableLine(line) && isTableSeparator(lines[index + 1] ?? '')) {
      const rows: string[][] = [splitTableLine(line)]
      index += 2
      while (index < lines.length && isTableLine(lines[index] ?? '')) {
        rows.push(splitTableLine(lines[index] ?? ''))
        index += 1
      }
      const caption = parseCaption(lines[index] ?? '')
      if (caption) index += 1
      const widths = parseTableWidths(lines[index] ?? '', rows[0].length)
      if (widths) index += 1
      blocks.push({ id: blockId(), type: 'table', rows, caption, colWidths: widths || rows[0].map(() => 180) })
      continue
    }

    const embed = line.match(/^\[Embed]\((.*)\)$/)
    if (embed) {
      index += 1
      const caption = parseCaption(lines[index] ?? '')
      if (caption) index += 1
      blocks.push({ id: blockId(), type: 'embed', url: embed[1], caption })
      continue
    }

    const link = line.match(/^\[(.*)]\((https?:\/\/.*)\)$/)
    if (link) {
      blocks.push({ id: blockId(), type: 'link', label: link[1], url: link[2] })
      index += 1
      continue
    }

    if (line.trim() === '::: tabs') {
      const tabs: Array<{ title: string; content: string }> = []
      index += 1
      while (index < lines.length && lines[index]?.trim() !== ':::') {
        const tabStart = (lines[index] ?? '').match(/^@tab\s+(.*)$/)
        if (tabStart) {
          const title = tabStart[1] || `Tab ${tabs.length + 1}`
          const contentLines: string[] = []
          index += 1
          while (index < lines.length && !/^@tab\s+/.test(lines[index] ?? '') && lines[index]?.trim() !== ':::') {
            contentLines.push(lines[index] ?? '')
            index += 1
          }
          tabs.push({ title, content: contentLines.join('\n').trim() })
          continue
        }
        index += 1
      }
      if (lines[index]?.trim() === ':::') index += 1
      blocks.push({ id: blockId(), type: 'tabs', tabs: tabs.length ? tabs : [{ title: 'Tab 1', content: '' }] })
      continue
    }

    const paragraphLines = [line]
    index += 1
    while (index < lines.length && lines[index]?.trim() && !/^```/.test(lines[index] ?? '') && !/^(#{1,6})\s+/.test(lines[index] ?? '') && !/^\s*(---|\*\*\*|___)\s*$/.test(lines[index] ?? '') && !/^\s*-\s+/.test(lines[index] ?? '') && !/^\s*\d+\.\s+/.test(lines[index] ?? '') && !isTableLine(lines[index] ?? '')) {
      paragraphLines.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(newParagraphBlock(paragraphLines.join('\n')))
  }

  return blocks.length ? blocks : [newParagraphBlock()]
}

function blocksToMarkdown(blocks: EditorBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'paragraph') return block.content.trim()
    if (block.type === 'inlineCode') return `\`${block.content.trim()}\``
    if (block.type === 'heading') return `${'#'.repeat(block.level)} ${block.content.trim()}`
    if (block.type === 'list') return block.items.filter((item) => item.text.trim()).map((item, index) => `${'  '.repeat(item.level)}${block.ordered ? `${(block.start || 1) + index}.` : '-'} ${item.text}`).join('\n')
    if (block.type === 'notice') return [`> [!${block.variant.toUpperCase()}]`, ...block.content.split('\n').map((line) => `> ${line}`)].join('\n')
    if (block.type === 'quote') return block.content.split('\n').map((line) => `> ${line}`).join('\n')
    if (block.type === 'table') {
      const rows = block.rows.length ? block.rows : [['Header', 'Header']]
      const header = tableLine(rows[0])
      const separator = tableLine(rows[0].map(() => '---'))
      const body = rows.slice(1).map(tableLine).join('\n')
      return [header, separator, body, captionMarkdown(block.caption), tableWidthsMarkdown(block.colWidths)].filter(Boolean).join('\n')
    }
    if (block.type === 'image') return imageMarkdown(block)
    if (block.type === 'file') return [`[📎 ${block.filename || 'Download file'}](${block.src || ''})`, captionMarkdown(block.caption)].filter(Boolean).join('\n')
    if (block.type === 'link') return `[${block.label || block.url || 'Link'}](${block.url || '#'})`
    if (block.type === 'toc') return '[[toc]]'
    if (block.type === 'hr') return '---'
    if (block.type === 'tabs') return ['::: tabs', ...block.tabs.flatMap((tab) => [`@tab ${tab.title}`, tab.content]), ':::'].join('\n')
    if (block.type === 'toggle') return ['<details>', `<summary>${escapeHtml(block.title || 'Toggle')}</summary>`, '', block.content, '</details>'].join('\n')
    if (block.type === 'embed') return [`[Embed](${block.url})`, captionMarkdown(block.caption)].filter(Boolean).join('\n')
    return codeMarkdown(block)
  }).filter(Boolean).join('\n\n') + '\n'
}

function documentMarkdown(title: string, blocks: EditorBlock[]): string {
  const body = blocksToMarkdown(blocks).trim()
  return [`# ${title.trim() || 'Untitled'}`, body].filter(Boolean).join('\n\n') + '\n'
}

function stripDocumentTitle(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  const firstContentIndex = lines.findIndex((line) => line.trim())
  if (firstContentIndex < 0) return markdown
  const firstLine = lines[firstContentIndex]?.trim() || ''
  const heading = firstLine.match(/^#\s+(.*)$/)
  if (!heading) return markdown
  if (heading[1].trim() !== title.trim()) return markdown
  return [...lines.slice(0, firstContentIndex), ...lines.slice(firstContentIndex + 1)].join('\n')
}

function tableLine(row: string[]): string {
  return `| ${row.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`
}

function isTableLine(line: string): boolean {
  return /^\|.*\|$/.test(line.trim())
}

function isTableSeparator(line: string): boolean {
  return /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim())
}

function splitTableLine(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function parseCaption(line: string): string {
  const match = line.trim().match(/^\*(.*)\*$/)
  return match ? match[1] : ''
}

function captionMarkdown(caption: string): string {
  return caption.trim() ? `*${caption.trim()}*` : ''
}

function tableWidthsMarkdown(widths: number[] | undefined): string {
  const normalized = normalizeTableWidths(widths, widths?.length || 0)
  return normalized.length ? `<!-- cms-table-widths:${normalized.join(',')} -->` : ''
}

function parseTableWidths(line: string, count: number): number[] | null {
  const match = line.trim().match(/^<!--\s*cms-table-widths:([\d,\s]+)\s*-->$/)
  if (!match) return null
  const widths = match[1].split(',').map((value) => Number(value.trim()))
  return normalizeTableWidths(widths, count)
}

function codeMarkdown(block: Extract<EditorBlock, { type: 'code' }>): string {
  const options = [
    block.caption.trim() ? `caption="${block.caption.trim().replace(/"/g, '\\"')}"` : '',
    block.wrap ? '' : 'nowrap',
  ].filter(Boolean).join(' ')
  const info = [block.language || 'plaintext', options].filter(Boolean).join(' ')
  return [`\`\`\`${info}`, block.code, '```'].join('\n')
}

function parseCodeOptions(info: string): { caption: string; wrap: boolean } {
  const caption = info.match(/caption="((?:\\"|[^"])*)"/)
  return {
    caption: caption ? caption[1].replace(/\\"/g, '"') : '',
    wrap: !/\bnowrap\b/.test(info),
  }
}

function imageMarkdown(block: Extract<EditorBlock, { type: 'image' }>): string {
  const classes = ['cms-image', block.border ? 'cms-image-bordered' : ''].filter(Boolean).join(' ')
  const lines = [
    `<figure class="${classes}" style="--cms-image-max-width: ${clampImageWidth(block.maxWidth)}px;">`,
    `<img src="${escapeHtml(block.src || '')}" alt="${escapeHtml(block.alt || 'image')}" />`,
  ]
  if (block.caption.trim()) lines.push(`<figcaption>${escapeHtml(block.caption.trim())}</figcaption>`)
  lines.push('</figure>')
  return lines.join('\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function flattenPages(nodes: Node[]): PageNode[] {
  return nodes.flatMap((node) => node.type === 'page' ? [node] : flattenPages(node.children))
}

function flattenCategories(nodes: Node[], prefix = ''): Array<{ id: string; label: string }> {
  return nodes.flatMap((node) => {
    if (node.type === 'page') return []
    const label = prefix ? `${prefix} / ${node.title}` : node.title
    return [{ id: node.id, label }, ...flattenCategories(node.children, label)]
  })
}

function filterNavigation(nodes: Node[], query: string, parents: string[] = []): Node[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return nodes

  return nodes.flatMap<Node>((node) => {
    if (node.type === 'page') {
      const haystack = [
        node.title,
        node.slug,
        node.path,
        node.url,
        node.status,
        ...parents,
      ].join(' ').toLowerCase()
      return haystack.includes(normalized) ? [{ ...node }] : []
    }

    const nextParents = [...parents, node.title, node.slug]
    const filteredChildren = filterNavigation(node.children, normalized, nextParents)
    const categoryHaystack = [node.title, node.slug, ...parents].join(' ').toLowerCase()
    if (categoryHaystack.includes(normalized)) return [{ ...node, children: cloneNavigation(node.children) }]
    if (filteredChildren.length) return [{ ...node, children: filteredChildren }]
    return []
  })
}

function cloneNavigation(nodes: Node[]): Node[] {
  return nodes.map((node) => node.type === 'category' ? { ...node, children: cloneNavigation(node.children) } : { ...node })
}

function removeNodeFromTree(nodes: Node[], id: string): { nodes: Node[]; removed: Node | null } {
  let removed: Node | null = null
  const nextNodes = nodes.flatMap<Node>((node): Node[] => {
    if (node.id === id) {
      removed = node
      return []
    }
    if (node.type === 'category') {
      const result = removeNodeFromTree(node.children, id)
      if (result.removed) removed = result.removed
      return [{ ...node, children: result.nodes }]
    }
    return [node]
  })
  return { nodes: nextNodes, removed }
}

function updateNodeInTree(nodes: Node[], id: string, updater: (node: Node) => Node): Node[] {
  return nodes.map((node) => {
    if (node.id === id) return updater(node)
    if (node.type === 'category') return { ...node, children: updateNodeInTree(node.children, id, updater) }
    return node
  })
}

function liftCategoryFromTree(nodes: Node[], id: string): Node[] {
  return nodes.flatMap<Node>((node): Node[] => {
    if (node.type === 'category' && node.id === id) return cloneNavigation(node.children)
    if (node.type === 'category') return [{ ...node, children: liftCategoryFromTree(node.children, id) }]
    return [node]
  })
}

function findNodeById(nodes: Node[], id: string): Node | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.type === 'category') {
      const found = findNodeById(node.children, id)
      if (found) return found
    }
  }
  return null
}

function movePageInTree(nodes: Node[], pageId: string, target: Exclude<DropTarget, null>): Node[] {
  const { nodes: withoutPage, removed } = removeNodeFromTree(cloneNavigation(nodes), pageId)
  if (!removed || removed.type !== 'page') return nodes
  const inserted = insertPageIntoTree(withoutPage, removed, target)
  return inserted || nodes
}

function insertPageIntoTree(nodes: Node[], page: PageNode, target: Exclude<DropTarget, null>): Node[] | null {
  if (target.type === 'root') return [...nodes, page]

  if (target.type === 'category') {
    let matched = false
    const nextNodes = nodes.map((node) => {
      if (node.type !== 'category') return node
      if (node.id === target.id) {
        matched = true
        return { ...node, children: [...node.children, page] }
      }
      const nextChildren = insertPageIntoTree(node.children, page, target)
      if (!nextChildren) return node
      matched = true
      return { ...node, children: nextChildren }
    })
    return matched ? nextNodes : null
  }

  const targetIndex = nodes.findIndex((node) => node.id === target.id)
  if (targetIndex >= 0) {
    const insertionIndex = target.type === 'before' ? targetIndex : targetIndex + 1
    return [...nodes.slice(0, insertionIndex), page, ...nodes.slice(insertionIndex)]
  }

  let matched = false
  const nextNodes = nodes.map((node) => {
    if (node.type !== 'category') return node
    const nextChildren = insertPageIntoTree(node.children, page, target)
    if (!nextChildren) return node
    matched = true
    return { ...node, children: nextChildren }
  })
  return matched ? nextNodes : null
}

function insertCategoryIntoTree(nodes: Node[], category: CategoryNode, parentId?: string): Node[] | null {
  if (!parentId) return [...nodes, category]
  let matched = false
  const nextNodes = nodes.map((node) => {
    if (node.type !== 'category') return node
    if (node.id === parentId) {
      matched = true
      return { ...node, children: [...node.children, category] }
    }
    const nextChildren = insertCategoryIntoTree(node.children, category, parentId)
    if (!nextChildren) return node
    matched = true
    return { ...node, children: nextChildren }
  })
  return matched ? nextNodes : null
}

function pageDropTargetFromPointer(event: React.DragEvent<HTMLElement>, id: string): Exclude<DropTarget, null> {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? { type: 'before', id } : { type: 'after', id }
}

function pendingOperationId(): string {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function pendingNodeId(type: 'page' | 'category'): string {
  return `pending-${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function slugifyTitle(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  return slug || 'untitled'
}

function frontmatterAuthors(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'string') return value
  return ''
}

function cloneEditorBlocks(blocks: EditorBlock[]): EditorBlock[] {
  return JSON.parse(JSON.stringify(blocks)) as EditorBlock[]
}

function initialsForTitle(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return 'D'
  const initials = words.length === 1
    ? Array.from(words[0]).slice(0, 2).join('')
    : words.slice(0, 2).map((word) => Array.from(word)[0]).join('')
  return initials.toUpperCase()
}

function adminMediaPreviewSrc(pageId: string, src: string): string {
  if (!pageId || !src.startsWith('./')) return src
  return `/api/admin/media?pageId=${encodeURIComponent(pageId)}&src=${encodeURIComponent(src)}`
}

function publicPreviewUrl(page: PageNode | null): string {
  if (!page?.url) return ''
  const base = (process.env.NEXT_PUBLIC_DOCS_PREVIEW_URL || 'http://localhost:5174').replace(/\/$/, '')
  const rawPath = page.url.startsWith('/') ? page.url : `/${page.url}`
  const path = rawPath.replace(/\.md($|[?#])/, '$1')
  return `${base}${path}`
}

function pageTitleForMode(mode: Mode): string {
  if (mode === 'new-page') return 'New page'
  if (mode === 'categories') return 'Groups'
  if (mode === 'media') return 'Media'
  if (mode === 'settings') return 'Settings'
  if (mode === 'me') return 'My page'
  return 'Pages'
}
