'use client'

import { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type JSONContent, type NodeViewProps, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CodeBlock from '@tiptap/extension-code-block'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { mergeAttributes, Node } from '@tiptap/core'
import { AlertTriangle, CheckCircle2, Code2, ExternalLink, FilePlus2, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, Image, Info, LayoutPanelTop, Link2, List, ListOrdered, Minus, MoreHorizontal, Plus, Quote, Table2, TableOfContents } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditorBlock, SlashCommand } from '@/lib/admin/editor-markdown'
import { blockId, blocksToMarkdown, clampImageWidth, markdownToBlocks } from '@/lib/admin/editor-markdown'

type UploadResult = { path: string; filename: string; pageId?: string }

type Props = {
  blocks: EditorBlock[]
  documentKey: string
  pageId: string
  editable?: boolean
  onChange: (blocks: EditorBlock[]) => void
  onSnapshotReady?: (snapshot: (() => EditorBlock[]) | null) => void
  uploadAsset: (file: File) => Promise<UploadResult | null>
}

type SlashState = { query: string; left: number; top: number; maxHeight: number } | null
type SlashMenuItem = { id: SlashCommand; slash: string; title: string; description: string; aliases: string[]; icon: React.ReactNode }

export default function TiptapMarkdownEditor({ blocks, documentKey, pageId, editable = true, onChange, onSnapshotReady, uploadAsset }: Props) {
  const [slash, setSlash] = useState<SlashState>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const lastDocumentKeyRef = useRef(documentKey)
  const uploadAssetRef = useRef(uploadAsset)
  const onChangeRef = useRef(onChange)
  const onSnapshotReadyRef = useRef(onSnapshotReady)
  const slashRef = useRef<SlashState>(null)
  const slashIndexRef = useRef(0)
  const editorRef = useRef<NonNullable<ReturnType<typeof useEditor>> | null>(null)
  uploadAssetRef.current = uploadAsset
  onChangeRef.current = onChange
  onSnapshotReadyRef.current = onSnapshotReady
  const uploadViaRef = useCallback((file: File) => uploadAssetRef.current(file), [])

  const extensions = useMemo(() => [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: { target: '_blank', rel: 'noreferrer' },
    }),
    Placeholder.configure({ placeholder: 'Type / for blocks, or use Markdown shortcuts...' }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    ThrCodeBlock,
    ThrNotice.configure({ pageId, uploadAsset: uploadViaRef }),
    ThrImage.configure({ pageId, uploadAsset: uploadViaRef }),
    ThrFile.configure({ uploadAsset: uploadViaRef }),
    ThrTabs.configure({ pageId, uploadAsset: uploadViaRef }),
    ThrToggle.configure({ pageId, uploadAsset: uploadViaRef }),
    ThrEmbed,
    ThrToc,
  ], [pageId, uploadViaRef])

  const editor = useEditor({
    extensions,
    content: blocksToTiptapDocument(blocks),
    editable,
    editorProps: {
      attributes: { class: 'tiptap-document' },
      handlePaste(view, event) {
        if (!editable) return false
        const file = imageFileFromDataTransfer(event.clipboardData)
        if (!file) return false
        event.preventDefault()
        void insertUploadedImage(view, file, uploadAssetRef.current)
        return true
      },
      handleDrop(view, event) {
        if (!editable) return false
        const file = imageFileFromDataTransfer(event.dataTransfer)
        if (!file) return false
        event.preventDefault()
        void insertUploadedImage(view, file, uploadAssetRef.current)
        return true
      },
      handleKeyDown(view, event) {
        if (!editable) return false
        if (event.key === 'Backspace' && isEmptyHeadingSelection(view)) {
          const currentEditor = editorRef.current
          if (!currentEditor) return false
          event.preventDefault()
          currentEditor.chain().focus().setParagraph().run()
          return true
        }
        const currentSlash = slashRef.current
        if (currentSlash && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) {
          const visible = filteredSlashMenuItems(currentSlash.query)
          if (!visible.length) return false
          event.preventDefault()
          if (event.key === 'ArrowDown') {
            setSlashIndex((current) => {
              const next = (current + 1) % visible.length
              slashIndexRef.current = next
              return next
            })
            return true
          }
          if (event.key === 'ArrowUp') {
            setSlashIndex((current) => {
              const next = (current - 1 + visible.length) % visible.length
              slashIndexRef.current = next
              return next
            })
            return true
          }
          const selected = visible[Math.min(slashIndexRef.current, visible.length - 1)] || visible[0]
          const currentEditor = editorRef.current
          if (!currentEditor) return false
          removeSlashQuery(currentEditor)
          insertCommandContent(currentEditor, selected.id)
          setSlash(null)
          setSlashIndex(0)
          return true
        }
        if (event.key === 'Escape') {
          setSlash(null)
          setSlashIndex(0)
          return false
        }
        if (event.key === '/' || event.key.length === 1 || event.key === 'Backspace') {
          requestAnimationFrame(() => {
            const nextSlash = slashStateFromSelection(view)
            setSlash(nextSlash)
            setSlashIndex(0)
          })
        }
        return false
      },
    },
    onUpdate({ editor: currentEditor }) {
      onChangeRef.current(tiptapDocumentToBlocks(currentEditor.getJSON()))
    },
    immediatelyRender: false,
  })

  useEffect(() => {
    if (!editor) return
    editorRef.current = editor
    onSnapshotReadyRef.current?.(() => tiptapDocumentToBlocks(editor.getJSON()))
    editor.setEditable(editable)
    if (!editable) setSlash(null)
    return () => onSnapshotReadyRef.current?.(null)
  }, [editable, editor])

  useEffect(() => {
    slashRef.current = slash
    slashIndexRef.current = slashIndex
  }, [slash, slashIndex])

  useEffect(() => {
    if (!editor || lastDocumentKeyRef.current === documentKey) return
    lastDocumentKeyRef.current = documentKey
    const nextDocument = blocksToTiptapDocument(blocks)
    queueMicrotask(() => {
      if (lastDocumentKeyRef.current !== documentKey) return
      editor.commands.setContent(nextDocument, { emitUpdate: false })
      setSlash(null)
    })
  }, [blocks, documentKey, editor])

  const runSlashCommand = useCallback((command: SlashCommand) => {
    if (!editor || !editable) return
    removeSlashQuery(editor)
    insertCommandContent(editor, command)
    setSlash(null)
    setSlashIndex(0)
    editor.commands.focus()
  }, [editable, editor])

  return (
    <div className={`tiptap-editor-wrap ${editable ? '' : 'locked'}`}>
      <EditorContent editor={editor} />
      {editable && slash && typeof document !== 'undefined'
        ? createPortal(
          <SlashMenu query={slash.query} left={slash.left} top={slash.top} maxHeight={slash.maxHeight} selectedIndex={slashIndex} onSelect={runSlashCommand} />,
          document.body,
        )
        : null}
    </div>
  )
}

function blocksToTiptapDocument(blocks: EditorBlock[]): JSONContent {
  const content = blocks.filter((block) => block.type !== 'paragraph' || block.content.trim()).map(blockToTiptapNode)
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

function blockToTiptapNode(block: EditorBlock): JSONContent {
  if (block.type === 'paragraph') return { type: 'paragraph', content: inlineTextToContent(block.content) }
  if (block.type === 'inlineCode') return { type: 'paragraph', content: [{ type: 'text', text: block.content, marks: [{ type: 'code' }] }] }
  if (block.type === 'heading') return { type: 'heading', attrs: { level: block.level }, content: inlineTextToContent(block.content) }
  if (block.type === 'quote') return { type: 'blockquote', content: block.content.split('\n').map((line) => ({ type: 'paragraph', content: inlineTextToContent(line) })) }
  if (block.type === 'hr') return { type: 'horizontalRule' }
  if (block.type === 'code') return { type: 'codeBlock', attrs: { language: block.language || 'plaintext', caption: block.caption || '', wrap: block.wrap === true }, content: block.code ? [{ type: 'text', text: block.code }] : undefined }
  if (block.type === 'list') {
    return {
      type: block.ordered ? 'orderedList' : 'bulletList',
      attrs: block.ordered ? { start: block.start || 1 } : undefined,
      content: block.items.length ? block.items.map((item) => ({ type: 'listItem', content: [{ type: 'paragraph', content: inlineTextToContent(item.text) }] })) : [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
    }
  }
  if (block.type === 'table') {
    const rows = block.rows.length ? block.rows : [['Header', 'Header'], ['Value', 'Value']]
    return {
      type: 'table',
      content: rows.map((row, rowIndex) => ({
        type: 'tableRow',
        content: row.map((cell, cellIndex) => ({
          type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
          attrs: block.colWidths?.[cellIndex] ? { colwidth: [block.colWidths[cellIndex]] } : undefined,
          content: [{ type: 'paragraph', content: inlineTextToContent(cell) }],
        })),
      })),
    }
  }
  if (block.type === 'notice') return { type: 'thrNotice', attrs: { variant: block.variant, content: block.content } }
  if (block.type === 'image') return { type: 'thrImage', attrs: { src: block.src, alt: block.alt, caption: block.caption, maxWidth: block.maxWidth, border: block.border } }
  if (block.type === 'file') return { type: 'thrFile', attrs: { src: block.src, filename: block.filename, caption: block.caption } }
  if (block.type === 'link') return { type: 'paragraph', content: [{ type: 'text', text: block.label || block.url || 'Link', marks: [{ type: 'link', attrs: { href: block.url || '#' } }] }] }
  if (block.type === 'toc') return { type: 'thrToc' }
  if (block.type === 'tabs') return { type: 'thrTabs', attrs: { tabs: block.tabs } }
  if (block.type === 'toggle') return { type: 'thrToggle', attrs: { title: block.title, content: block.content } }
  return { type: 'thrEmbed', attrs: { url: block.url, caption: block.caption } }
}

function tiptapDocumentToBlocks(document: JSONContent): EditorBlock[] {
  const nodes = document.content || []
  const blocks = nodes.flatMap(nodeToBlocks)
  return blocks.length ? blocks : [{ id: blockId(), type: 'paragraph', content: '' }]
}

function nodeToBlocks(node: JSONContent): EditorBlock[] {
  if (node.type === 'paragraph') return [{ id: blockId(), type: 'paragraph', content: contentToInlineText(node.content || []) }]
  if (node.type === 'heading') return [{ id: blockId(), type: 'heading', level: normalizeHeadingLevel(node.attrs?.level), content: contentToInlineText(node.content || []) }]
  if (node.type === 'blockquote') return [{ id: blockId(), type: 'quote', content: (node.content || []).map((child) => contentToInlineText(child.content || [])).join('\n') }]
  if (node.type === 'horizontalRule') return [{ id: blockId(), type: 'hr' }]
  if (node.type === 'codeBlock') return [{ id: blockId(), type: 'code', code: contentToPlainText(node.content || []), language: String(node.attrs?.language || 'plaintext'), caption: String(node.attrs?.caption || ''), wrap: node.attrs?.wrap === true }]
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return [{
      id: blockId(),
      type: 'list',
      ordered: node.type === 'orderedList' || undefined,
      start: Number(node.attrs?.start || 1),
      items: listItemsFromTiptap(node),
    }]
  }
  if (node.type === 'table') {
    const rows = (node.content || []).map((row) => (row.content || []).map((cell) => contentToInlineText(cell.content?.[0]?.content || [])))
    const widths = node.content?.[0]?.content?.map((cell) => Number((cell.attrs?.colwidth as number[] | undefined)?.[0] || 180)) || []
    return [{ id: blockId(), type: 'table', rows, caption: '', colWidths: widths }]
  }
  if (node.type === 'thrNotice') return [{ id: blockId(), type: 'notice', variant: noticeVariant(node.attrs?.variant), content: String(node.attrs?.content || '') }]
  if (node.type === 'thrImage') return [{ id: blockId(), type: 'image', src: String(node.attrs?.src || ''), alt: String(node.attrs?.alt || ''), caption: String(node.attrs?.caption || ''), maxWidth: clampImageWidth(Number(node.attrs?.maxWidth || 720)), border: Boolean(node.attrs?.border) }]
  if (node.type === 'thrFile') return [{ id: blockId(), type: 'file', src: String(node.attrs?.src || ''), filename: String(node.attrs?.filename || ''), caption: String(node.attrs?.caption || '') }]
  if (node.type === 'thrToc') return [{ id: blockId(), type: 'toc' }]
  if (node.type === 'thrTabs') return [{ id: blockId(), type: 'tabs', tabs: parseTabsAttr(node.attrs?.tabs) }]
  if (node.type === 'thrToggle') return [{ id: blockId(), type: 'toggle', title: String(node.attrs?.title || 'Toggle'), content: String(node.attrs?.content || '') }]
  if (node.type === 'thrEmbed') return [{ id: blockId(), type: 'embed', url: String(node.attrs?.url || ''), caption: String(node.attrs?.caption || '') }]
  return [{ id: blockId(), type: 'paragraph', content: contentToPlainText(node.content || []) }]
}

function inlineTextToContent(value: string): JSONContent[] | undefined {
  if (!value) return undefined
  const content: JSONContent[] = []
  const pattern = /\[([^\]\n]+)]\((https?:\/\/[^)\s]+)\)|`([^`\n]+)`/gi
  let index = 0
  for (const match of value.matchAll(pattern)) {
    pushText(content, value.slice(index, match.index))
    if (match[1] && match[2]) content.push({ type: 'text', text: unescapeMarkdownLinkLabel(match[1]), marks: [{ type: 'link', attrs: { href: match[2] } }] })
    else if (match[3]) content.push({ type: 'text', text: match[3], marks: [{ type: 'code' }] })
    index = (match.index || 0) + match[0].length
  }
  pushText(content, value.slice(index))
  return content.length ? content : undefined
}

function pushText(content: JSONContent[], text: string): void {
  if (text) content.push({ type: 'text', text })
}

function contentToInlineText(content: JSONContent[]): string {
  return content.map((node) => {
    if (node.type === 'hardBreak') return '\n'
    if (node.type !== 'text') return contentToInlineText(node.content || [])
    const text = node.text || ''
    const link = node.marks?.find((mark) => mark.type === 'link')
    if (link?.attrs?.href) return `[${escapeMarkdownLinkLabel(text)}](${String(link.attrs.href)})`
    if (node.marks?.some((mark) => mark.type === 'code')) return `\`${text}\``
    return text
  }).join('')
}

function contentToPlainText(content: JSONContent[]): string {
  return content.map((node) => node.text || contentToPlainText(node.content || [])).join('')
}

function listItemsFromTiptap(node: JSONContent): Array<{ text: string; level: number }> {
  return (node.content || []).map((item) => ({
    text: contentToInlineText(item.content?.[0]?.content || []),
    level: 0,
  }))
}

function normalizeHeadingLevel(value: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  const level = Number(value)
  return ([1, 2, 3, 4, 5, 6].includes(level) ? level : 2) as 1 | 2 | 3 | 4 | 5 | 6
}

function noticeVariant(value: unknown): 'info' | 'success' | 'warning' | 'danger' {
  return value === 'success' || value === 'warning' || value === 'danger' ? value : 'info'
}

function parseTabsAttr(value: unknown): Array<{ title: string; content: string }> {
  if (!Array.isArray(value)) return [{ title: 'Tab 1', content: '' }]
  return value.map((tab, index) => ({
    title: typeof tab?.title === 'string' ? tab.title : `Tab ${index + 1}`,
    content: typeof tab?.content === 'string' ? tab.content : '',
  }))
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}

function unescapeMarkdownLinkLabel(value: string): string {
  return value.replace(/\\]/g, ']').replace(/\\\\/g, '\\')
}

function imageFileFromDataTransfer(data: DataTransfer | null): File | null {
  if (!data) return null
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile()
  }
  return null
}

async function insertUploadedImage(view: any, file: File, uploadAsset: Props['uploadAsset']) {
  const uploaded = await uploadAsset(file)
  if (!uploaded) return
  const node = view.state.schema.nodes.thrImage.create({ src: uploaded.path, alt: uploaded.filename, caption: '', maxWidth: 720, border: false, pageId: uploaded.pageId || '' })
  view.dispatch(view.state.tr.replaceSelectionWith(node))
}

function isEmptyHeadingSelection(view: { state: { selection: { empty?: boolean; $from: { parent: { type: { name: string }; content?: { size: number } }; parentOffset: number } } } }): boolean {
  const { selection } = view.state
  return Boolean(selection.empty && selection.$from.parent.type.name === 'heading' && selection.$from.parentOffset === 0 && (selection.$from.parent.content?.size || 0) === 0)
}

function slashStateFromSelection(view: { state: { selection: { from: number; $from: { parent: { type: { name: string }; textBetween: (from: number, to: number) => string }; parentOffset: number } } }; coordsAtPos: (pos: number) => { left: number; bottom: number } }): SlashState {
  const { $from, from } = view.state.selection
  if ($from.parent.type.name !== 'paragraph') return null
  const text = $from.parent.textBetween(0, $from.parentOffset)
  const match = text.match(/(?:^|\s)\/([a-z]*)$/i)
  if (!match) return null
  const coords = view.coordsAtPos(from)
  const menuWidth = 360
  const desiredLeft = coords.left
  const desiredTop = coords.bottom
  const left = Math.max(12, Math.min(desiredLeft, window.innerWidth - menuWidth - 16))
  const top = Math.max(12, desiredTop)
  const maxHeight = Math.max(140, window.innerHeight - top - 16)
  return { query: match[1] || '', left, top, maxHeight }
}

function removeSlashQuery(editor: NonNullable<ReturnType<typeof useEditor>>): void {
  const { state } = editor
  const { $from, from } = state.selection
  const text = $from.parent.textBetween(0, $from.parentOffset)
  const match = text.match(/\/[a-z]*$/i)
  if (!match) return
  editor.chain().focus().deleteRange({ from: from - match[0].length, to: from }).run()
}

function insertCommandContent(editor: NonNullable<ReturnType<typeof useEditor>>, command: SlashCommand): void {
  if (command === 'heading' || command === 'heading2') editor.chain().focus().toggleHeading({ level: 2 }).run()
  else if (command === 'heading1') editor.chain().focus().toggleHeading({ level: 1 }).run()
  else if (command === 'heading3') editor.chain().focus().toggleHeading({ level: 3 }).run()
  else if (command === 'heading4') editor.chain().focus().toggleHeading({ level: 4 }).run()
  else if (command === 'heading5') editor.chain().focus().toggleHeading({ level: 5 }).run()
  else if (command === 'heading6') editor.chain().focus().toggleHeading({ level: 6 }).run()
  else if (command === 'list' || command === 'bulletList') editor.chain().focus().toggleBulletList().run()
  else if (command === 'orderedList') editor.chain().focus().toggleOrderedList().run()
  else if (command === 'quote') editor.chain().focus().toggleBlockquote().run()
  else if (command === 'code') editor.chain().focus().insertContent({ type: 'text', text: 'code', marks: [{ type: 'code' }] }).run()
  else if (command === 'codeblock') editor.chain().focus().toggleCodeBlock().run()
  else if (command === 'table') editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
  else if (command === 'notice' || command === 'noticeInfo') editor.chain().focus().insertContent({ type: 'thrNotice', attrs: { variant: 'info', content: '' } }).run()
  else if (command === 'noticeSuccess') editor.chain().focus().insertContent({ type: 'thrNotice', attrs: { variant: 'success', content: '' } }).run()
  else if (command === 'noticeWarning') editor.chain().focus().insertContent({ type: 'thrNotice', attrs: { variant: 'warning', content: '' } }).run()
  else if (command === 'noticeDanger') editor.chain().focus().insertContent({ type: 'thrNotice', attrs: { variant: 'danger', content: '' } }).run()
  else if (command === 'image') editor.chain().focus().insertContent({ type: 'thrImage', attrs: { src: '', alt: '', caption: '', maxWidth: 720, border: false } }).run()
  else if (command === 'file') editor.chain().focus().insertContent({ type: 'thrFile', attrs: { src: '', filename: '', caption: '' } }).run()
  else if (command === 'tabs') editor.chain().focus().insertContent({ type: 'thrTabs', attrs: { tabs: [{ title: 'Tab 1', content: '' }, { title: 'Tab 2', content: '' }] } }).run()
  else if (command === 'toggle') editor.chain().focus().insertContent({ type: 'thrToggle', attrs: { title: 'Toggle', content: '' } }).run()
  else if (command === 'toc') editor.chain().focus().insertContent({ type: 'thrToc' }).run()
  else if (command === 'embed') editor.chain().focus().insertContent({ type: 'thrEmbed', attrs: { url: '', caption: '' } }).run()
  else if (command === 'divider') editor.chain().focus().setHorizontalRule().run()
  else if (command === 'link') editor.chain().focus().insertContent({ type: 'text', text: 'Link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }).run()
  else editor.chain().focus().setParagraph().run()
}

function SlashMenu({ query, left, top, maxHeight, selectedIndex, onSelect }: { query: string; left: number; top: number; maxHeight: number; selectedIndex: number; onSelect: (command: SlashCommand) => void }) {
  const visible = filteredSlashMenuItems(query)
  const activeIndex = Math.min(selectedIndex, Math.max(visible.length - 1, 0))
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, query])

  return (
    <div className="slash-menu tiptap-slash-menu" style={{ left, top, maxHeight }}>
      <div className="slash-search">{query ? `/${query}` : 'Search blocks'}</div>
      {visible.map((command, index) => (
        <button
          key={command.id}
          ref={(element) => { itemRefs.current[index] = element }}
          className={index === activeIndex ? 'active' : ''}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(command.id)}
        >
          {command.icon}
          <span><strong>{command.slash}</strong><small>{command.title}{command.description ? ` - ${command.description}` : ''}</small></span>
        </button>
      ))}
    </div>
  )
}

const slashMenuItems: SlashMenuItem[] = [
  { id: 'paragraph', slash: '/text', title: 'Text', description: 'Plain paragraph', aliases: ['paragraph', 'p'], icon: <LayoutPanelTop size={17} /> },
  { id: 'heading1', slash: '/h1', title: 'Heading 1', description: 'Top-level section title', aliases: ['heading', 'heading1', 'title'], icon: <Heading1 size={17} /> },
  { id: 'heading2', slash: '/h2', title: 'Heading 2', description: 'Section heading', aliases: ['heading', 'heading2'], icon: <Heading2 size={17} /> },
  { id: 'heading3', slash: '/h3', title: 'Heading 3', description: 'Subsection heading', aliases: ['heading', 'heading3'], icon: <Heading3 size={17} /> },
  { id: 'heading4', slash: '/h4', title: 'Heading 4', description: 'Small heading', aliases: ['heading', 'heading4'], icon: <Heading4 size={17} /> },
  { id: 'heading5', slash: '/h5', title: 'Heading 5', description: 'Minor heading', aliases: ['heading', 'heading5'], icon: <Heading5 size={17} /> },
  { id: 'heading6', slash: '/h6', title: 'Heading 6', description: 'Label heading', aliases: ['heading', 'heading6'], icon: <Heading6 size={17} /> },
  { id: 'bulletList', slash: '/bulletlist', title: 'Bullet list', description: 'Unordered list', aliases: ['list', 'ul', 'bullet'], icon: <List size={17} /> },
  { id: 'orderedList', slash: '/orderedlist', title: 'Ordered list', description: 'Numbered list', aliases: ['list', 'ol', 'numbered'], icon: <ListOrdered size={17} /> },
  { id: 'quote', slash: '/quote', title: 'Quote', description: 'Blockquote', aliases: ['blockquote', 'citation'], icon: <Quote size={17} /> },
  { id: 'codeblock', slash: '/codeblock', title: 'Code block', description: 'Fenced code block', aliases: ['code', 'pre', 'fence', 'snippet'], icon: <Code2 size={17} /> },
  { id: 'code', slash: '/code', title: 'Inline code', description: 'Inline code text', aliases: ['inlinecode', 'monospace'], icon: <Code2 size={17} /> },
  { id: 'noticeInfo', slash: '/info', title: 'Info notice', description: 'GitHub alert notice', aliases: ['notice', 'alert', 'note'], icon: <Info size={17} /> },
  { id: 'noticeSuccess', slash: '/success', title: 'Success notice', description: 'Positive callout', aliases: ['notice', 'tip', 'alert'], icon: <CheckCircle2 size={17} /> },
  { id: 'noticeWarning', slash: '/warning', title: 'Warning notice', description: 'Warning callout', aliases: ['notice', 'caution', 'alert'], icon: <AlertTriangle size={17} /> },
  { id: 'noticeDanger', slash: '/danger', title: 'Danger notice', description: 'Danger callout', aliases: ['notice', 'error', 'alert'], icon: <AlertTriangle size={17} /> },
  { id: 'toggle', slash: '/toggle', title: 'Toggle', description: 'Collapsible details block', aliases: ['details', 'collapse', 'spoiler'], icon: <Plus size={17} /> },
  { id: 'tabs', slash: '/tabs', title: 'Tabs', description: 'Multi-tab content block', aliases: ['tab', 'multi', 'syntax'], icon: <Plus size={17} /> },
  { id: 'table', slash: '/table', title: 'Table', description: 'Markdown table', aliases: ['columns', 'grid'], icon: <Table2 size={17} /> },
  { id: 'image', slash: '/image', title: 'Image', description: 'Figure with caption/options', aliases: ['img', 'picture', 'figure'], icon: <Image size={17} /> },
  { id: 'file', slash: '/file', title: 'File', description: 'Download attachment link', aliases: ['attachment', 'download', 'asset'], icon: <FilePlus2 size={17} /> },
  { id: 'link', slash: '/link', title: 'Link', description: 'Inline link', aliases: ['url', 'href'], icon: <Link2 size={17} /> },
  { id: 'embed', slash: '/embed', title: 'Embed', description: 'External resource link', aliases: ['video', 'iframe', 'external'], icon: <ExternalLink size={17} /> },
  { id: 'toc', slash: '/toc', title: 'Table of contents', description: '[[toc]] marker', aliases: ['tableofcontents', 'outline'], icon: <TableOfContents size={17} /> },
  { id: 'divider', slash: '/divider', title: 'Divider', description: 'Horizontal rule', aliases: ['hr', 'line', 'separator'], icon: <Minus size={17} /> },
]

function filteredSlashMenuItems(query: string): SlashMenuItem[] {
  return slashMenuItems.filter((command) => slashCommandMatches(command, query))
}

function slashCommandMatches(command: SlashMenuItem, query: string): boolean {
  const normalized = query.trim().toLowerCase().replace(/^\//, '')
  if (!normalized) return true
  const haystack = [command.id, command.slash.replace(/^\//, ''), command.title, command.description, ...command.aliases].join(' ').toLowerCase()
  return haystack.includes(normalized)
}

const ThrNotice = Node.create<{ pageId: string; uploadAsset: Props['uploadAsset'] }>({
  name: 'thrNotice',
  group: 'block',
  atom: true,
  addOptions() { return { pageId: '', uploadAsset: async () => null } },
  addAttributes() {
    return { variant: { default: 'info' }, content: { default: '' } }
  },
  parseHTML() { return [{ tag: 'div[data-thr-notice]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-thr-notice': '' })] },
  addNodeView() { return ReactNodeViewRenderer((props) => <NoticeNodeView {...props} pageId={this.options.pageId} uploadAsset={this.options.uploadAsset} />) }
})

function NoticeNodeView({ node, updateAttributes, editor, deleteNode, pageId, uploadAsset }: NodeViewProps & { pageId: string; uploadAsset: Props['uploadAsset'] }) {
  const variant = noticeVariant(node.attrs.variant)
  const locked = !editor.isEditable
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <NodeViewWrapper className={`visual-notice ${variant}`}>
      {!locked ? (
        <div className="visual-notice-menu-wrap" contentEditable={false}>
          <button type="button" className="visual-notice-menu-button" onClick={() => setMenuOpen((current) => !current)} title="Notice options">
            <MoreHorizontal size={15} />
          </button>
          {menuOpen ? (
            <div className="visual-notice-menu" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
              {(['info', 'success', 'warning', 'danger'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={variant === option ? 'active' : ''}
                  onClick={() => {
                    updateAttributes({ variant: option })
                    setMenuOpen(false)
                  }}
                >
                  {option === 'info' ? 'Info' : option === 'success' ? 'Success' : option === 'warning' ? 'Warning' : 'Danger'}
                </button>
              ))}
              <button type="button" className="visual-menu-danger" onClick={deleteNode}>Delete</button>
            </div>
          ) : null}
        </div>
      ) : null}
      <NestedMarkdownSlot
        value={String(node.attrs.content || '')}
        disabled={locked}
        documentKey={`notice-${node.attrs.variant}`}
        pageId={pageId}
        uploadAsset={uploadAsset}
        onChange={(content) => updateAttributes({ content })}
      />
    </NodeViewWrapper>
  )
}

const codeLanguageOptions = [
  'plaintext',
  'bash',
  'sh',
  'powershell',
  'javascript',
  'typescript',
  'python',
  'ruby',
  'go',
  'java',
  'c',
  'cpp',
  'csharp',
  'php',
  'sql',
  'json',
  'yaml',
  'xml',
  'html',
  'css',
  'dockerfile',
  'markdown',
]

const ThrCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: 'plaintext',
        parseHTML: (element) => {
          const className = element.querySelector('code')?.className || ''
          return className.replace(/^language-/, '') || 'plaintext'
        },
      },
      caption: { default: '' },
      wrap: { default: false },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView)
  },
})

function CodeBlockNodeView({ node, updateAttributes, editor, deleteNode }: NodeViewProps) {
  const locked = !editor.isEditable
  const [menuOpen, setMenuOpen] = useState(false)
  const language = String(node.attrs.language || 'plaintext')
  const caption = String(node.attrs.caption || '')
  const wrap = node.attrs.wrap !== false

  return (
    <NodeViewWrapper className={`visual-code tiptap-code-block ${wrap ? '' : 'nowrap-code'}`}>
      {caption ? <div className="visual-code-caption" contentEditable={false}>{caption}</div> : null}
      {!locked ? (
        <div className="visual-code-menu-wrap" contentEditable={false}>
          <button type="button" className="visual-code-menu-button" onClick={() => setMenuOpen((current) => !current)} title="Code options">
            <MoreHorizontal size={15} />
          </button>
          {menuOpen ? (
            <div className="visual-code-menu" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
              <label>
                <span>Language</span>
                <select value={language} onChange={(event) => updateAttributes({ language: event.target.value })}>
                  {codeLanguageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span>Caption</span>
                <input value={caption} onChange={(event) => updateAttributes({ caption: event.target.value })} placeholder="Caption" />
              </label>
              <label className="visual-code-check">
                <input type="checkbox" checked={wrap} onChange={(event) => updateAttributes({ wrap: event.target.checked })} />
                Wrap lines
              </label>
              <button type="button" className="visual-menu-danger" onClick={deleteNode}>Delete</button>
            </div>
          ) : null}
        </div>
      ) : null}
      <pre className="visual-code-pre"><NodeViewContent className="visual-code-editor" /></pre>
    </NodeViewWrapper>
  )
}

const ThrImage = Node.create<{ pageId: string; uploadAsset: Props['uploadAsset'] }>({
  name: 'thrImage',
  group: 'block',
  atom: true,
  addOptions() { return { pageId: '', uploadAsset: async () => null } },
  addAttributes() {
    return { src: { default: '' }, alt: { default: '' }, caption: { default: '' }, maxWidth: { default: 720 }, border: { default: false }, pageId: { default: '' } }
  },
  parseHTML() { return [{ tag: 'figure[data-thr-image]' }] },
  renderHTML({ HTMLAttributes }) { return ['figure', mergeAttributes(HTMLAttributes, { 'data-thr-image': '' })] },
  addNodeView() { return ReactNodeViewRenderer((props) => <ImageNodeView {...props} pageId={this.options.pageId} uploadAsset={this.options.uploadAsset} />) }
})

function ImageNodeView({ node, updateAttributes, editor, deleteNode, pageId, uploadAsset }: NodeViewProps & { pageId: string; uploadAsset: Props['uploadAsset'] }) {
  const src = String(node.attrs.src || '')
  const locked = !editor.isEditable
  const previewPageId = String(node.attrs.pageId || pageId || '')
  const [menuOpen, setMenuOpen] = useState(false)
  async function upload(file: File | undefined) {
    if (!file || locked) return
    const uploaded = await uploadAsset(file)
    if (uploaded) updateAttributes({ src: uploaded.path, alt: uploaded.filename, pageId: uploaded.pageId || pageId || '' })
  }
  return (
    <NodeViewWrapper as="figure" className={`visual-image ${node.attrs.border ? 'with-border' : ''}`} style={{ maxWidth: `${clampImageWidth(Number(node.attrs.maxWidth || 720))}px` }}>
      {src ? <img src={adminMediaPreviewSrc(previewPageId, src)} alt={String(node.attrs.alt || '')} /> : (
        <label className={`visual-empty-asset ${locked ? 'disabled' : ''}`}>
          <Image size={16} /> Upload image
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden disabled={locked} onChange={(event) => void upload(event.target.files?.[0])} />
        </label>
      )}
      {!locked && src ? (
        <div className="visual-image-menu-wrap" contentEditable={false}>
          <button type="button" className="visual-image-menu-button" onClick={() => setMenuOpen((current) => !current)} title="Image options"><MoreHorizontal size={15} /></button>
          {menuOpen ? (
            <div className="visual-image-menu" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
              <label><span>Caption</span><input value={String(node.attrs.caption || '')} onChange={(event) => updateAttributes({ caption: event.target.value })} placeholder="Caption" /></label>
              <label className="visual-image-check"><input type="checkbox" checked={Boolean(node.attrs.border)} onChange={(event) => updateAttributes({ border: event.target.checked })} /> Border</label>
              <button type="button" className="visual-menu-danger" onClick={deleteNode}>Delete</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {node.attrs.caption ? <figcaption>{String(node.attrs.caption)}</figcaption> : null}
    </NodeViewWrapper>
  )
}

const ThrFile = Node.create<{ uploadAsset: Props['uploadAsset'] }>({
  name: 'thrFile',
  group: 'block',
  atom: true,
  addOptions() { return { uploadAsset: async () => null } },
  addAttributes() { return { src: { default: '' }, filename: { default: '' }, caption: { default: '' } } },
  parseHTML() { return [{ tag: 'div[data-thr-file]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-thr-file': '' })] },
  addNodeView() { return ReactNodeViewRenderer((props) => <FileNodeView {...props} uploadAsset={this.options.uploadAsset} />) }
})

function FileNodeView({ node, updateAttributes, editor, deleteNode, uploadAsset }: NodeViewProps & { uploadAsset: Props['uploadAsset'] }) {
  const locked = !editor.isEditable
  const [menuOpen, setMenuOpen] = useState(false)
  async function upload(file: File | undefined) {
    if (!file || locked) return
    const uploaded = await uploadAsset(file)
    if (uploaded) updateAttributes({ src: uploaded.path, filename: uploaded.filename })
  }
  return (
    <NodeViewWrapper className="visual-file">
      {!locked ? <BlockDeleteMenu open={menuOpen} setOpen={setMenuOpen} onDelete={deleteNode} /> : null}
      <label className={`ghost-button visual-upload-button ${locked ? 'disabled' : ''}`}>
        <FilePlus2 size={16} /> Upload file
        <input type="file" hidden disabled={locked} onChange={(event) => void upload(event.target.files?.[0])} />
      </label>
      <input value={String(node.attrs.filename || '')} disabled={locked} placeholder="filename.ext" onChange={(event) => updateAttributes({ filename: event.target.value })} />
      <input value={String(node.attrs.src || '')} disabled={locked} placeholder="./assets/file.ext" onChange={(event) => updateAttributes({ src: event.target.value })} />
      <input value={String(node.attrs.caption || '')} disabled={locked} placeholder="Caption" onChange={(event) => updateAttributes({ caption: event.target.value })} />
    </NodeViewWrapper>
  )
}

const ThrTabs = Node.create<{ pageId: string; uploadAsset: Props['uploadAsset'] }>({
  name: 'thrTabs',
  group: 'block',
  atom: true,
  addOptions() { return { pageId: '', uploadAsset: async () => null } },
  addAttributes() { return { tabs: { default: [{ title: 'Tab 1', content: '' }, { title: 'Tab 2', content: '' }] } } },
  parseHTML() { return [{ tag: 'div[data-thr-tabs]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-thr-tabs': '' })] },
  addNodeView() { return ReactNodeViewRenderer((props) => <TabsNodeView {...props} pageId={this.options.pageId} uploadAsset={this.options.uploadAsset} />) }
})

function TabsNodeView({ node, updateAttributes, editor, deleteNode, pageId, uploadAsset }: NodeViewProps & { pageId: string; uploadAsset: Props['uploadAsset'] }) {
  const tabs = parseTabsAttr(node.attrs.tabs)
  const locked = !editor.isEditable
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const safeIndex = Math.min(activeIndex, Math.max(tabs.length - 1, 0))
  const activeTab = tabs[safeIndex] || { title: 'Tab 1', content: '' }

  function setTabs(nextTabs: Array<{ title: string; content: string }>) {
    updateAttributes({ tabs: nextTabs.length ? nextTabs : [{ title: 'Tab 1', content: '' }] })
  }

  return (
    <NodeViewWrapper className="visual-tabs">
      {!locked ? <BlockDeleteMenu open={menuOpen} setOpen={setMenuOpen} onDelete={deleteNode} /> : null}
      <div className="visual-tabs-nav">{tabs.map((tab, index) => (
        <button key={index} type="button" className={index === safeIndex ? 'active' : ''} onClick={() => setActiveIndex(index)}>
          <input
            value={tab.title}
            disabled={locked}
            onClick={(event) => { event.stopPropagation(); setActiveIndex(index) }}
            onFocus={() => setActiveIndex(index)}
            onChange={(event) => setTabs(tabs.map((item, currentIndex) => currentIndex === index ? { ...item, title: event.target.value } : item))}
          />
          {!locked && tabs.length > 1 ? <span onClick={(event) => { event.stopPropagation(); setTabs(tabs.filter((_, currentIndex) => currentIndex !== index)); setActiveIndex(Math.max(0, index - 1)) }}>×</span> : null}
        </button>
      ))}
        {!locked ? <button type="button" className="visual-tabs-add" onClick={() => { setTabs([...tabs, { title: `Tab ${tabs.length + 1}`, content: '' }]); setActiveIndex(tabs.length) }}>+</button> : null}
      </div>
      <NestedMarkdownSlot
        value={activeTab.content}
        disabled={locked}
        documentKey={`tabs-${safeIndex}-${activeTab.title}`}
        pageId={pageId}
        uploadAsset={uploadAsset}
        onChange={(content) => setTabs(tabs.map((item, currentIndex) => currentIndex === safeIndex ? { ...item, content } : item))}
      />
    </NodeViewWrapper>
  )
}

const ThrToggle = Node.create<{ pageId: string; uploadAsset: Props['uploadAsset'] }>({
  name: 'thrToggle',
  group: 'block',
  atom: true,
  addOptions() { return { pageId: '', uploadAsset: async () => null } },
  addAttributes() { return { title: { default: 'Toggle' }, content: { default: '' } } },
  parseHTML() { return [{ tag: 'details[data-thr-toggle]' }] },
  renderHTML({ HTMLAttributes }) { return ['details', mergeAttributes(HTMLAttributes, { 'data-thr-toggle': '' })] },
  addNodeView() { return ReactNodeViewRenderer((props) => <ToggleNodeView {...props} pageId={this.options.pageId} uploadAsset={this.options.uploadAsset} />) }
})

function ToggleNodeView({ node, updateAttributes, editor, deleteNode, pageId, uploadAsset }: NodeViewProps & { pageId: string; uploadAsset: Props['uploadAsset'] }) {
  const locked = !editor.isEditable
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <NodeViewWrapper className="visual-toggle">
      {!locked ? <BlockDeleteMenu open={menuOpen} setOpen={setMenuOpen} onDelete={deleteNode} /> : null}
      <input value={String(node.attrs.title || '')} disabled={locked} placeholder="Toggle title" onChange={(event) => updateAttributes({ title: event.target.value })} />
      <NestedMarkdownSlot
        value={String(node.attrs.content || '')}
        disabled={locked}
        documentKey={`toggle-${node.attrs.title}`}
        pageId={pageId}
        uploadAsset={uploadAsset}
        onChange={(content) => updateAttributes({ content })}
      />
    </NodeViewWrapper>
  )
}

function NestedMarkdownSlot({ value, disabled, documentKey, pageId, uploadAsset, onChange }: { value: string; disabled: boolean; documentKey: string; pageId: string; uploadAsset: Props['uploadAsset']; onChange: (value: string) => void }) {
  const initialBlocks = useMemo(() => markdownToBlocks(value), [documentKey])
  const handleChange = useCallback((nextBlocks: EditorBlock[]) => {
    onChange(blocksToMarkdown(nextBlocks).trimEnd())
  }, [onChange])

  return (
    <div className="nested-tiptap-slot" contentEditable={false}>
      <TiptapMarkdownEditor
        blocks={initialBlocks}
        documentKey={documentKey}
        pageId={pageId}
        editable={!disabled}
        onChange={handleChange}
        uploadAsset={uploadAsset}
      />
    </div>
  )
}

function SlashTextarea({ value, disabled, placeholder, onChange }: { value: string; disabled: boolean; placeholder?: string; onChange: (value: string) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [slash, setSlash] = useState<SlashState>(null)
  const [slashIndex, setSlashIndex] = useState(0)

  function updateSlash(element: HTMLTextAreaElement) {
    const state = textareaSlashState(element)
    setSlash(state)
    setSlashIndex(0)
  }

  function insert(command: SlashCommand) {
    const element = textareaRef.current
    if (!element) return
    const selectionStart = element.selectionStart
    const before = value.slice(0, selectionStart)
    const after = value.slice(element.selectionEnd)
    const match = before.match(/\/[a-z]*$/i)
    const slashStart = match ? selectionStart - match[0].length : selectionStart
    const snippet = textareaCommandSnippet(command)
    const next = `${value.slice(0, slashStart)}${snippet}${after}`
    onChange(next)
    setSlash(null)
    setSlashIndex(0)
    requestAnimationFrame(() => {
      element.focus()
      const cursor = slashStart + textareaSnippetCursorOffset(snippet)
      element.setSelectionRange(cursor, cursor)
    })
  }

  return (
    <div className="slash-textarea-wrap" contentEditable={false}>
      <textarea
        ref={textareaRef}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value)
          updateSlash(event.target)
        }}
        onKeyDown={(event) => {
          if (disabled) return
          if (slash && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) {
            const visible = filteredSlashMenuItems(slash.query)
            if (!visible.length) return
            event.preventDefault()
            if (event.key === 'ArrowDown') setSlashIndex((current) => (current + 1) % visible.length)
            else if (event.key === 'ArrowUp') setSlashIndex((current) => (current - 1 + visible.length) % visible.length)
            else insert(visible[Math.min(slashIndex, visible.length - 1)]?.id || visible[0].id)
            return
          }
          if (event.key === 'Escape') {
            setSlash(null)
            return
          }
          if (event.key === '/' || event.key.length === 1 || event.key === 'Backspace') {
            requestAnimationFrame(() => {
              if (textareaRef.current) updateSlash(textareaRef.current)
            })
          }
        }}
      />
      {!disabled && slash && typeof document !== 'undefined'
        ? createPortal(
          <SlashMenu query={slash.query} left={slash.left} top={slash.top} maxHeight={slash.maxHeight} selectedIndex={slashIndex} onSelect={insert} />,
          document.body,
        )
        : null}
    </div>
  )
}

function textareaSlashState(element: HTMLTextAreaElement): SlashState {
  const before = element.value.slice(0, element.selectionStart)
  const match = before.match(/(?:^|\s)\/([a-z]*)$/i)
  if (!match) return null
  const rect = element.getBoundingClientRect()
  const menuWidth = 360
  const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight || '20') || 20
  const lineCount = before.split('\n').length
  const top = Math.min(rect.bottom, rect.top + (lineCount * lineHeight) - element.scrollTop + 4)
  const left = Math.max(12, Math.min(rect.left + 16, window.innerWidth - menuWidth - 16))
  const maxHeight = Math.max(140, window.innerHeight - top - 16)
  return { query: match[1] || '', left, top, maxHeight }
}

function textareaCommandSnippet(command: SlashCommand): string {
  if (command === 'heading1') return '# '
  if (command === 'heading' || command === 'heading2') return '## '
  if (command === 'heading3') return '### '
  if (command === 'heading4') return '#### '
  if (command === 'heading5') return '##### '
  if (command === 'heading6') return '###### '
  if (command === 'bulletList' || command === 'list') return '- '
  if (command === 'orderedList') return '1. '
  if (command === 'quote') return '> '
  if (command === 'code') return '`code`'
  if (command === 'codeblock') return '```plaintext\n\n```'
  if (command === 'table') return '| Header | Header |\n| --- | --- |\n| Value | Value |'
  if (command === 'image') return '![image](./assets/image.png)'
  if (command === 'file') return '[file](./assets/file.pdf)'
  if (command === 'link') return '[Link](https://example.com)'
  if (command === 'toc') return '[[toc]]'
  if (command === 'divider') return '---'
  if (command === 'notice' || command === 'noticeInfo') return '> [!INFO]\n> '
  if (command === 'noticeSuccess') return '> [!SUCCESS]\n> '
  if (command === 'noticeWarning') return '> [!WARNING]\n> '
  if (command === 'noticeDanger') return '> [!DANGER]\n> '
  if (command === 'tabs') return '::: tabs\n== Tab 1\n\n== Tab 2\n\n:::'
  if (command === 'toggle') return '<details>\n<summary>Toggle</summary>\n\n\n</details>'
  if (command === 'embed') return '[Embed](https://example.com)'
  return ''
}

function textareaSnippetCursorOffset(snippet: string): number {
  const codeFence = snippet.indexOf('\n\n```')
  if (codeFence >= 0) return codeFence + 1
  const tabs = snippet.indexOf('\n\n== Tab 2')
  if (tabs >= 0) return tabs - 1
  const details = snippet.indexOf('\n\n\n</details>')
  if (details >= 0) return details + 2
  return snippet.length
}

const ThrEmbed = Node.create({
  name: 'thrEmbed',
  group: 'block',
  atom: true,
  addAttributes() { return { url: { default: '' }, caption: { default: '' } } },
  parseHTML() { return [{ tag: 'div[data-thr-embed]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-thr-embed': '' })] },
  addNodeView() { return ReactNodeViewRenderer(EmbedNodeView) }
})

function EmbedNodeView({ node, updateAttributes, editor, deleteNode }: NodeViewProps) {
  const locked = !editor.isEditable
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <NodeViewWrapper className="visual-embed">
      {!locked ? <BlockDeleteMenu open={menuOpen} setOpen={setMenuOpen} onDelete={deleteNode} /> : null}
      <input value={String(node.attrs.url || '')} disabled={locked} placeholder="https://..." onChange={(event) => updateAttributes({ url: event.target.value })} />
      <input value={String(node.attrs.caption || '')} disabled={locked} placeholder="Caption" onChange={(event) => updateAttributes({ caption: event.target.value })} />
    </NodeViewWrapper>
  )
}

const ThrToc = Node.create({
  name: 'thrToc',
  group: 'block',
  atom: true,
  parseHTML() { return [{ tag: 'div[data-thr-toc]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-thr-toc': '' })] },
  addNodeView() {
    return ReactNodeViewRenderer(TocNodeView)
  }
})

function TocNodeView({ editor, deleteNode }: NodeViewProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <NodeViewWrapper className="visual-toc">
      {editor.isEditable ? <BlockDeleteMenu open={menuOpen} setOpen={setMenuOpen} onDelete={deleteNode} /> : null}
      <TableOfContents size={18} /> Table of contents
    </NodeViewWrapper>
  )
}

function BlockDeleteMenu({ open, setOpen, onDelete }: { open: boolean; setOpen: (open: boolean) => void; onDelete: () => void }) {
  return (
    <div className="visual-block-menu-wrap" contentEditable={false}>
      <button type="button" className="visual-block-menu-button" onClick={() => setOpen(!open)} title="Block options">
        <MoreHorizontal size={15} />
      </button>
      {open ? (
        <div className="visual-block-menu" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <button type="button" className="visual-menu-danger" onClick={onDelete}>Delete</button>
        </div>
      ) : null}
    </div>
  )
}

function adminMediaPreviewSrc(pageId: string, src: string): string {
  if (!pageId || !src.startsWith('./')) return src
  return `/api/admin/media?pageId=${encodeURIComponent(pageId)}&src=${encodeURIComponent(src)}`
}
