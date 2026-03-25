import { useState } from 'react'
import ProgressBar from './ProgressBar'

function CopyIdBadge({ sessionId }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(sessionId); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      title="Copy session ID"
      style={{
        background: 'rgba(45,212,191,0.1)', color: '#0f766e',
        border: '1px solid rgba(45,212,191,0.2)',
        borderRadius: 6, padding: '1px 6px', fontSize: '0.68rem',
        fontFamily: 'monospace', cursor: 'pointer', transition: 'all 0.15s',
      }}>
      {copied ? '✓ Copied' : `ID: ${sessionId}`}
    </button>
  )
}

/* ── helpers ── */
function statusBadge(s) {
  if (s.hasResults) return { label: 'Results ready', color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.2)' }
  if (s.hasData)    return { label: 'Data uploaded',  color: 'var(--accent)', bg: 'rgba(var(--accent-rgb),0.1)', border: 'rgba(var(--accent-rgb),0.2)' }
  return              { label: 'Empty',               color: 'var(--text-3)', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.15)' }
}

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

const SESSION_LIMIT = 5

/* ── component ── */
export default function SessionPicker({ auth, initialSessions, onPick, onLogout }) {
  const [sessions, setSessions]   = useState(initialSessions || [])
  const [loading, setLoading]     = useState(null)    // sessionId | 'new' | `${id}-del`
  const [delConfirm, setDelConfirm] = useState(null)  // sessionId awaiting confirmation
  const [error, setError]         = useState(null)
  const [limitError, setLimitError] = useState(false)

  /* ── create new session ── */
  async function handleNew() {
    if (sessions.length >= SESSION_LIMIT) { setLimitError(true); return }
    setLoading('new')
    setError(null)
    try {
      const res = await fetch('/api/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: auth.email, pin: auth.pin }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.limitReached) { setLimitError(true); return }
        throw new Error(data.error || 'Failed to create session')
      }
      onPick({ sessionId: data.sessionId, email: auth.email, isNew: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(null)
    }
  }

  /* ── resume existing session ── */
  async function handleResume(session) {
    setLoading(session.sessionId)
    setError(null)
    try {
      const res = await fetch('/api/session/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: auth.email, pin: auth.pin, sessionId: session.sessionId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load session')
      onPick({ ...data, email: auth.email })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(null)
    }
  }

  /* ── delete session ── */
  async function handleDelete(sessionId) {
    setLoading(sessionId + '-del')
    setError(null)
    try {
      const res = await fetch('/api/session/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: auth.email, pin: auth.pin, sessionId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
      setDelConfirm(null)
      setLimitError(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(null)
    }
  }

  const atLimit = sessions.length >= SESSION_LIMIT

  const resumingId = typeof loading === 'string' && loading !== 'new' && !loading.endsWith('-del') ? loading : null

  return (
    <>
    <ProgressBar active={!!resumingId} label="Loading session…" />
    <div className="w-full max-w-2xl">

      {/* ── header bar ── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold gradient-text">Your Sessions</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{auth.email}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* session counter pill */}
          <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{
                  background: atLimit ? 'rgba(239,68,68,0.1)' : 'rgba(45,212,191,0.1)',
                  color:      atLimit ? '#f87171'              : '#0f766e',
                  border:     `1px solid ${atLimit ? 'rgba(239,68,68,0.2)' : 'rgba(45,212,191,0.2)'}`,
                }}>
            {sessions.length}/{SESSION_LIMIT} sessions
          </span>
          <button onClick={onLogout}
                  className="text-xs px-3 py-1.5 rounded-lg transition-all"
                  style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)' }}>
            Logout
          </button>
        </div>
      </div>

      {/* ── limit warning ── */}
      {limitError && (
        <div className="mb-4 flex items-start gap-2 text-xs px-3 py-2.5 rounded-lg"
             style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
          <span className="mt-0.5 flex-shrink-0">⚠</span>
          <span>
            Session limit reached ({SESSION_LIMIT}/{SESSION_LIMIT}).
            Delete an older session to start a new analysis.
          </span>
        </div>
      )}

      {/* ── generic error ── */}
      {error && (
        <div className="mb-4 text-xs px-3 py-2 rounded-lg"
             style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      {/* ── session list ── */}
      <div className="flex flex-col gap-3 mb-4">
        {sessions.length === 0 ? (
          <div className="glass p-10 text-center rounded-2xl"
               style={{ color: 'var(--text-3)' }}>
            <div className="text-4xl mb-3">📂</div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
              No sessions yet
            </p>
            <p className="text-xs mt-1">
              Click <strong>+ New Analysis</strong> below to get started
            </p>
          </div>
        ) : (
          sessions.map(s => {
            const badge         = statusBadge(s)
            const isLoading     = loading === s.sessionId
            const isDeleting    = loading === s.sessionId + '-del'
            const confirmingDel = delConfirm === s.sessionId

            return (
              <div key={s.sessionId} className="glass p-4 flex items-center gap-3"
                   style={{ borderRadius: '14px' }}>

                {/* status dot */}
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                     style={{ background: badge.color, boxShadow: `0 0 6px ${badge.color}60` }} />

                {/* info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                    {s.name || 'Unnamed Session'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="text-xs px-1.5 py-0.5 rounded-md"
                          style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>
                      {badge.label}
                    </span>
                    {s.design && (
                      <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>
                        {s.design.contrast} vs {s.design.reference}
                      </span>
                    )}
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                      {fmtDate(s.updatedAt)}
                    </span>
                    <CopyIdBadge sessionId={s.sessionId} />
                  </div>
                </div>

                {/* actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {confirmingDel ? (
                    /* delete confirmation */
                    <>
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>Delete?</span>
                      <button onClick={() => handleDelete(s.sessionId)} disabled={isDeleting}
                              className="text-xs px-2.5 py-1 rounded-md transition-all"
                              style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
                        {isDeleting ? '⟳' : 'Yes'}
                      </button>
                      <button onClick={() => setDelConfirm(null)}
                              className="text-xs px-2.5 py-1 rounded-md transition-all"
                              style={{ background: 'var(--bg-card)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                        No
                      </button>
                    </>
                  ) : (
                    /* normal actions */
                    <>
                      <button onClick={() => { setDelConfirm(s.sessionId); setError(null) }}
                              className="text-xs px-2.5 py-1 rounded-md transition-all"
                              style={{ color: 'var(--text-3)', border: '1px solid var(--border)', background: 'transparent' }}>
                        Delete
                      </button>
                      <button onClick={() => handleResume(s)} disabled={isLoading}
                              className="btn-primary text-xs py-1.5 px-3">
                        {isLoading ? <><span className="animate-spin inline-block">⟳</span> Loading…</> : 'Resume →'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* ── new analysis button ── */}
      <button onClick={handleNew}
              disabled={loading === 'new' || atLimit}
              className="w-full btn-primary justify-center"
              style={{ opacity: atLimit ? 0.45 : 1 }}>
        {loading === 'new'
          ? <><span className="animate-spin inline-block">⟳</span> Creating…</>
          : '+ New Analysis'}
      </button>

      {atLimit && (
        <p className="text-center text-xs mt-2" style={{ color: 'var(--text-3)' }}>
          Delete an existing session to unlock a new slot
        </p>
      )}
    </div>
    </>
  )
}
