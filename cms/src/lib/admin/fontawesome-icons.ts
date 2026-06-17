import { fab } from '@fortawesome/free-brands-svg-icons'
import { far } from '@fortawesome/free-regular-svg-icons'
import { fas } from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition, IconPack, IconPrefix } from '@fortawesome/fontawesome-svg-core'

export type FontAwesomeStyle = 'solid' | 'regular' | 'brands'

export type CmsIcon = {
  style: FontAwesomeStyle
  name: string
}

export type FontAwesomeChoice = CmsIcon & {
  id: string
  label: string
  aliases: string[]
  definition: IconDefinition
}

const PREFIX_TO_STYLE: Partial<Record<IconPrefix, FontAwesomeStyle>> = {
  fas: 'solid',
  far: 'regular',
  fab: 'brands',
}

const STYLE_TO_PREFIX: Record<FontAwesomeStyle, IconPrefix> = {
  solid: 'fas',
  regular: 'far',
  brands: 'fab',
}

const ICON_NAME_PATTERN = /^[a-z0-9-]+$/

export const FONT_AWESOME_STYLES: FontAwesomeStyle[] = ['solid', 'regular', 'brands']

export const FONT_AWESOME_FREE_ICONS: FontAwesomeChoice[] = [
  ...choicesFromPack(fas),
  ...choicesFromPack(far),
  ...choicesFromPack(fab),
].sort((left, right) => `${left.style}:${left.name}`.localeCompare(`${right.style}:${right.name}`))

const ICON_LOOKUP = new Map(FONT_AWESOME_FREE_ICONS.map((icon) => [icon.id, icon]))

export function normalizeCmsIcon(value: unknown): CmsIcon | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const style = record.style
  const name = record.name
  if (!isFontAwesomeStyle(style) || typeof name !== 'string') return undefined
  const cleanName = name.trim().toLowerCase()
  if (!ICON_NAME_PATTERN.test(cleanName)) return undefined
  return { style, name: cleanName }
}

export function cmsIconId(icon: CmsIcon): string {
  return `${icon.style}:${icon.name}`
}

export function iconDefinitionFor(icon: CmsIcon | undefined): IconDefinition | undefined {
  return icon ? ICON_LOOKUP.get(cmsIconId(icon))?.definition : undefined
}

export function iconCssClasses(icon: CmsIcon | undefined): string {
  if (!icon) return ''
  return `fa-${icon.style} fa-${icon.name}`
}

export function iconPrefixForStyle(style: FontAwesomeStyle): IconPrefix {
  return STYLE_TO_PREFIX[style]
}

function choicesFromPack(pack: IconPack): FontAwesomeChoice[] {
  const byId = new Map<string, FontAwesomeChoice>()
  for (const value of Object.values(pack)) {
    if (!isIconDefinition(value)) continue
    const style = PREFIX_TO_STYLE[value.prefix]
    if (!style) continue
    const icon: FontAwesomeChoice = {
      id: `${style}:${value.iconName}`,
      style,
      name: value.iconName,
      label: labelFromName(value.iconName),
      aliases: aliasesFromDefinition(value),
      definition: value,
    }
    byId.set(icon.id, icon)
  }
  return [...byId.values()]
}

function isIconDefinition(value: unknown): value is IconDefinition {
  return Boolean(value && typeof value === 'object' && 'iconName' in value && 'prefix' in value && 'icon' in value)
}

function isFontAwesomeStyle(value: unknown): value is FontAwesomeStyle {
  return value === 'solid' || value === 'regular' || value === 'brands'
}

function labelFromName(name: string): string {
  return name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function aliasesFromDefinition(definition: IconDefinition): string[] {
  const aliases = definition.icon?.[2]
  if (!Array.isArray(aliases)) return []
  return aliases.map((alias) => String(alias)).filter(Boolean)
}
