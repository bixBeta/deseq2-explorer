import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

// ── Dialog UI ────────────────────────────────────────────────────────────────
function DownloadDialog({ defaultName, ext, onConfirm, onCancel }) {
  const [name, setName] = useState(defaultName)
  const inputRef = useRef(null)

  useEffect(() => {
    // Focus + select all on mount so user can immediately type a new name
    const t = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 30)
    return () => clearTimeout(t)
  }, [])

  const confirm = () => {
    const trimmed = name.trim()
    if (trimmed) onConfirm(trimmed + ext)
  }

  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 200000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: '22px 24px 18px',
          width: 380,
          boxShadow: '0 12px 48px rgba(0,0,0,0.45)',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 13h10M8 3v7M5 7l3 3 3-3" stroke="var(--text-2)" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-1)' }}>Save as</span>
        </div>

        {/* Filename input */}
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-3)',
                        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            File name
          </div>
          <div style={{ display: 'flex', alignItems: 'center', borderRadius: 8,
                        border: '1px solid var(--border)', overflow: 'hidden',
                        background: 'var(--bg-card2)', focusWithin: 'outline' }}>
            <input
              ref={inputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') confirm()
                if (e.key === 'Escape') onCancel()
              }}
              style={{
                flex: 1, padding: '8px 10px', border: 'none', outline: 'none',
                background: 'transparent', fontSize: '0.84rem', color: 'var(--text-1)',
                fontFamily: 'monospace',
              }}
            />
            {ext && (
              <span style={{
                padding: '8px 10px 8px 0', fontSize: '0.82rem', fontFamily: 'monospace',
                color: 'var(--text-4)', userSelect: 'none', whiteSpace: 'nowrap',
              }}>
                {ext}
              </span>
            )}
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '7px 16px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-2)', fontSize: '0.82rem',
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!name.trim()}
            style={{
              padding: '7px 20px', borderRadius: 8, border: 'none',
              background: !name.trim() ? 'var(--bg-card2)' : 'linear-gradient(135deg,#0b446f,#1a6a9f)',
              color: !name.trim() ? 'var(--text-4)' : '#fff',
              fontSize: '0.82rem', fontWeight: 700, cursor: name.trim() ? 'pointer' : 'default',
              transition: 'all 0.12s',
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useDownloadDialog() {
  const [pending, setPending] = useState(null) // { name, ext, onSave }

  // promptDownload(defaultFilename, saveFn)
  // saveFn receives the final filename (with extension) chosen by the user
  const promptDownload = useCallback((defaultFilename, saveFn) => {
    const lastDot = defaultFilename.lastIndexOf('.')
    const name = lastDot > 0 ? defaultFilename.slice(0, lastDot) : defaultFilename
    const ext  = lastDot > 0 ? defaultFilename.slice(lastDot)  : ''
    setPending({ name, ext, onSave: saveFn })
  }, [])

  const dialog = pending ? (
    <DownloadDialog
      key={pending.name}
      defaultName={pending.name}
      ext={pending.ext}
      onConfirm={finalName => { pending.onSave(finalName); setPending(null) }}
      onCancel={() => setPending(null)}
    />
  ) : null

  return { promptDownload, dialog }
}
