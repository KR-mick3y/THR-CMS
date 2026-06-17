'use client'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Search, X } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FONT_AWESOME_FREE_ICONS, cmsIconId, iconDefinitionFor, type CmsIcon } from '@/lib/admin/fontawesome-icons'

type Props = {
  value?: CmsIcon
  disabled?: boolean
  compact?: boolean
  onChange: (icon?: CmsIcon) => void
}

export function IconPicker({ value, disabled, compact = false, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [popoverPosition, setPopoverPosition] = useState({ left: 0, top: 0, width: 420 })
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const selected = value ? FONT_AWESOME_FREE_ICONS.find((icon) => cmsIconId(icon) === cmsIconId(value)) : undefined
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return FONT_AWESOME_FREE_ICONS
      .filter((icon) => !normalized || [icon.name, icon.label, icon.style, ...icon.aliases].join(' ').toLowerCase().includes(normalized))
      .slice(0, 80)
  }, [query])

  useLayoutEffect(() => {
    if (!open) return
    function updatePosition() {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const width = Math.min(420, window.innerWidth - 32)
      const left = Math.max(72, Math.min(rect.left, window.innerWidth - width - 16))
      setPopoverPosition({ left, top: rect.bottom + 6, width })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  return (
    <div className={`icon-picker ${compact ? 'compact' : ''}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <button ref={triggerRef} type="button" className="icon-picker-trigger" disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <CmsIconView icon={value} />
        <span>{selected ? selected.label : 'No icon'}</span>
      </button>
      {value && !disabled ? (
        <button type="button" className="icon-picker-clear" onClick={() => onChange(undefined)} title="Clear icon"><X size={14} /></button>
      ) : null}
      {open && !disabled ? createPortal(
        <div className="icon-picker-popover" style={{ left: popoverPosition.left, top: popoverPosition.top, width: popoverPosition.width }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <div className="icon-picker-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Font Awesome icons" autoFocus />
          </div>
          <div className="icon-picker-grid">
            {results.map((icon) => (
              <button
                key={icon.id}
                type="button"
                className={value && cmsIconId(value) === icon.id ? 'selected' : ''}
                title={`${icon.label} (${icon.style})`}
                onClick={() => {
                  onChange({ style: icon.style, name: icon.name })
                  setOpen(false)
                }}
              >
                <FontAwesomeIcon icon={icon.definition} />
                <span>{icon.name}</span>
                <small>{icon.style}</small>
              </button>
            ))}
          </div>
          {!results.length ? <div className="icon-picker-empty">No icons found.</div> : null}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}

export function CmsIconView({ icon, fallback = true }: { icon?: CmsIcon; fallback?: boolean }) {
  const definition = iconDefinitionFor(icon)
  if (!definition) return fallback ? <span className="cms-icon-placeholder" aria-hidden="true" /> : null
  return <FontAwesomeIcon className="cms-icon" icon={definition} />
}
