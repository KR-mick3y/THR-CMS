export type SlashCommand =
  | 'paragraph'
  | 'heading'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'table'
  | 'image'
  | 'embed'
  | 'code'
  | 'codeblock'
  | 'notice'
  | 'noticeInfo'
  | 'noticeSuccess'
  | 'noticeWarning'
  | 'noticeDanger'
  | 'link'
  | 'toc'
  | 'quote'
  | 'file'
  | 'tabs'
  | 'list'
  | 'bulletList'
  | 'orderedList'
  | 'divider'
  | 'toggle'

export type ListItem = { text: string; level: number }

export type EditorBlock =
  | { id: string; type: 'paragraph'; content: string }
  | { id: string; type: 'heading'; content: string; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { id: string; type: 'inlineCode'; content: string }
  | { id: string; type: 'list'; items: ListItem[]; ordered?: boolean; start?: number }
  | { id: string; type: 'notice'; variant: 'info' | 'success' | 'warning' | 'danger'; content: string }
  | { id: string; type: 'quote'; content: string }
  | { id: string; type: 'table'; rows: string[][]; caption: string; colWidths: number[] }
  | { id: string; type: 'image'; src: string; alt: string; caption: string; maxWidth: number; border: boolean }
  | { id: string; type: 'file'; src: string; filename: string; caption: string }
  | { id: string; type: 'link'; url: string; label: string }
  | { id: string; type: 'toc' }
  | { id: string; type: 'hr' }
  | { id: string; type: 'tabs'; tabs: Array<{ title: string; content: string }> }
  | { id: string; type: 'toggle'; title: string; content: string }
  | { id: string; type: 'embed'; url: string; caption: string }
  | { id: string; type: 'code'; code: string; language: string; caption: string; wrap: boolean }

export function markdownToBlocks(markdown: string): EditorBlock[] {
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

    const htmlCode = parseHtmlCodeBlock(lines, index)
    if (htmlCode) {
      blocks.push({ id: blockId(), type: 'code', language: htmlCode.language, code: htmlCode.code, caption: htmlCode.caption, wrap: false })
      index = htmlCode.nextIndex
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

    if (line.trim() === '::: tabs') {
      const tabs: Array<{ title: string; content: string }> = []
      index += 1
      while (index < lines.length && lines[index]?.trim() !== ':::') {
        const tabStart = tabMarkerMatch(lines[index] ?? '')
        if (tabStart) {
          const title = tabStart.title || `Tab ${tabs.length + 1}`
          const contentLines: string[] = []
          index += 1
          while (index < lines.length && !tabMarkerMatch(lines[index] ?? '') && lines[index]?.trim() !== ':::') {
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

    if (line.trim().toLowerCase() === '<details>') {
      index += 1
      const summary = (lines[index] ?? '').match(/^<summary>(.*)<\/summary>$/i)
      const title = summary ? unescapeHtml(summary[1]) : 'Toggle'
      if (summary) index += 1
      const contentLines: string[] = []
      while (index < lines.length && lines[index]?.trim().toLowerCase() !== '</details>') {
        contentLines.push(lines[index] ?? '')
        index += 1
      }
      if (lines[index]?.trim().toLowerCase() === '</details>') index += 1
      blocks.push({ id: blockId(), type: 'toggle', title, content: contentLines.join('\n').trim() })
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
        const captionMatch = (lines[index] ?? '').match(/^<figcaption>(.*)<\/figcaption>$/)
        if (captionMatch) {
          caption = unescapeHtml(captionMatch[1])
          index += 1
        }
        if ((lines[index] ?? '').trim() === '</figure>') index += 1
        blocks.push(imageBlock({ src: unescapeHtml(image[1]), alt: unescapeHtml(image[2]), caption, maxWidth: Number(figure[2]), border: Boolean(figure[1]) }))
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

    const paragraphLines = [line]
    index += 1
    while (index < lines.length && lines[index]?.trim() && !isBlockStart(lines[index] ?? '', lines[index + 1] ?? '')) {
      paragraphLines.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(newParagraphBlock(paragraphLines.join('\n')))
  }

  return blocks.length ? blocks : [newParagraphBlock()]
}

export function blocksToMarkdown(blocks: EditorBlock[]): string {
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
    if (block.type === 'tabs') return ['::: tabs', ...block.tabs.flatMap((tab) => [`== ${tab.title || 'Tab'}`, tab.content]), ':::'].join('\n')
    if (block.type === 'toggle') return ['<details>', `<summary>${escapeHtml(block.title || 'Toggle')}</summary>`, '', block.content, '</details>'].join('\n')
    if (block.type === 'embed') return [`[Embed](${block.url})`, captionMarkdown(block.caption)].filter(Boolean).join('\n')
    return codeMarkdown(block)
  }).filter(Boolean).join('\n\n') + '\n'
}

export function documentMarkdown(title: string, blocks: EditorBlock[]): string {
  const body = blocksToMarkdown(blocks).trim()
  return [`# ${title.trim() || 'Untitled'}`, body].filter(Boolean).join('\n\n') + '\n'
}

export function stripDocumentTitle(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  const firstContentIndex = lines.findIndex((line) => line.trim())
  if (firstContentIndex < 0) return markdown
  const firstLine = lines[firstContentIndex]?.trim() || ''
  const heading = firstLine.match(/^#\s+(.*)$/)
  if (!heading || heading[1].trim() !== title.trim()) return markdown
  return [...lines.slice(0, firstContentIndex), ...lines.slice(firstContentIndex + 1)].join('\n')
}

export function newParagraphBlock(content = ''): EditorBlock {
  return { id: blockId(), type: 'paragraph', content }
}

export function initialParagraphBlock(): EditorBlock {
  return { id: 'initial-paragraph', type: 'paragraph', content: '' }
}

export function ensureEditableTail(blocks: EditorBlock[]): EditorBlock[] {
  const last = blocks[blocks.length - 1]
  if (last?.type === 'paragraph' && !last.content.trim()) return blocks
  return [...blocks, newParagraphBlock()]
}

export function imageBlock(values: Partial<Extract<EditorBlock, { type: 'image' }>> = {}): Extract<EditorBlock, { type: 'image' }> {
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

export function clampImageWidth(value: number): number {
  if (!Number.isFinite(value)) return 720
  return Math.min(1200, Math.max(160, Math.round(value)))
}

export function blockId(): string {
  return `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isBlockStart(line: string, nextLine: string): boolean {
  return /^```/.test(line)
    || /^(#{1,6})\s+/.test(line)
    || /^\s*(---|\*\*\*|___)\s*$/.test(line)
    || /^\s*-\s+/.test(line)
    || /^\s*\d+\.\s+/.test(line)
    || line.trim() === '[[toc]]'
    || line.trim() === '::: tabs'
    || /^>\s?/.test(line)
    || isTableLine(line)
    || Boolean(nextLine.match(/^(=+|-{2,})\s*$/))
}

function tabMarkerMatch(line: string): { title: string } | null {
  const pluginMarker = line.match(/^={2,}\s+(.*)$/)
  if (pluginMarker) return { title: pluginMarker[1].trim() }
  const legacyMarker = line.match(/^@tab\s+(.*)$/)
  if (legacyMarker) return { title: legacyMarker[1].trim() }
  return null
}

function parseHtmlCodeBlock(lines: string[], startIndex: number): { language: string; code: string; caption: string; nextIndex: number } | null {
  const firstLine = lines[startIndex] ?? ''
  if (!/<pre\b/i.test(firstLine) || !/<code\b/i.test(firstLine)) return null

  const htmlLines: string[] = []
  let index = startIndex
  while (index < lines.length) {
    htmlLines.push(lines[index] ?? '')
    if (/<\/code>\s*<\/pre>/i.test(lines[index] ?? '')) break
    index += 1
  }
  if (index >= lines.length) return null

  const htmlBlock = htmlLines.join('\n')
  const attrs = `${htmlBlock.match(/<pre\b([^>]*)>/i)?.[1] || ''} ${htmlBlock.match(/<code\b([^>]*)>/i)?.[1] || ''}`
  const language = normalizeCodeLanguage(attrs.match(/(?:language|lang)-([A-Za-z0-9_+#.-]+)/i)?.[1] || 'plaintext')
  const caption = unescapeHtml(attrs.match(/data-title="([^"]*)"/i)?.[1] || '')
  const codeHtml = htmlBlock.match(/<code\b[^>]*>([\s\S]*?)<\/code>/i)?.[1] || ''
  const code = unescapeHtml(
    codeHtml
      .replace(/<\/?strong>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(span|em)[^>]*>/gi, '')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/g, '')

  return { language, code, caption, nextIndex: index + 1 }
}

function normalizeCodeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase()
  if (!normalized) return 'plaintext'
  if (normalized === 'sh' || normalized === 'shell') return 'bash'
  if (normalized === 'ps1') return 'powershell'
  if (normalized === 'text' || normalized === 'plain') return 'plaintext'
  return normalized
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
  return normalizeTableWidths(match[1].split(',').map((value) => Number(value.trim())), count)
}

function normalizeTableWidths(widths: number[] | undefined, count: number): number[] {
  return Array.from({ length: count }, (_, index) => Math.max(90, Math.min(640, widths?.[index] || 180)))
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
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function unescapeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
