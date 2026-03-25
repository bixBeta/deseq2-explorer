import { useEffect, useState } from 'react'

export default function GeneViolinModal({ gene, symbol: rawSymbol, session, contrast, column, onClose }) {
  const symbol = (rawSymbol && rawSymbol !== 'None' && rawSymbol !== 'N/A') ? rawSymbol : null
  const [imgSrc,  setImgSrc]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // Fetch plot from R backend
  useEffect(() => {
    if (!gene || !session?.sessionId) return
    setLoading(true); setError(null); setImgSrc(null)

    const controller = new AbortController()
    fetch('/api/geneplot', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.sessionId,
        gene,
        symbol:    symbol || null,
        label:     contrast?.label,
        treatment: contrast?.treatment,
        reference: contrast?.reference,
        column,
      }),
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setImgSrc(`data:image/png;base64,${data.image}`)
        setLoading(false)
      })
      .catch(e => {
        if (e.name !== 'AbortError') { setError(e.message); setLoading(false) }
      })

    return () => controller.abort()
  }, [gene, session, contrast, column])

  // Close on Escape key
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(7,11,20,0.75)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 24,
      }}
    >
      {/* Modal card — stop click propagation so clicking inside doesn't close */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 16,
          padding: 20,
          width: 600,
          maxWidth: '95vw',
          maxHeight: '92vh',
          overflowY: 'auto',
          boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <h3 style={{
              margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1e293b',
              letterSpacing: '0.02em',
            }}>
              {symbol || gene}
              {symbol && (
                <span style={{ marginLeft: 8, fontSize: '0.72rem', color: '#94a3b8',
                               fontFamily: 'monospace', fontWeight: 400 }}>
                  {gene}
                </span>
              )}
            </h3>
            {contrast?.label && (
              <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: '#64748b' }}>
                {contrast.label} · Wilcoxon rank-sum test
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{
              flexShrink: 0,
              background: '#f1f5f9',
              border: '1px solid #e2e8f0',
              borderRadius: 8, padding: '4px 12px',
              cursor: 'pointer', color: '#475569', fontSize: '1rem',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
            onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}
          >
            ✕
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{
            height: 380,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 14,
            color: '#64748b', fontSize: '0.85rem',
          }}>
            <span style={{
              width: 28, height: 28, borderRadius: '50%',
              border: '3px solid rgba(var(--accent-rgb),0.25)',
              borderTopColor: 'var(--accent)',
              display: 'inline-block',
              animation: 'spin 0.8s linear infinite',
            }} />
            Rendering violin plot…
          </div>
        )}

        {/* Error state */}
        {error && (
          <div style={{
            padding: '12px 16px', borderRadius: 10, fontSize: '0.82rem',
            background: '#fef2f2', color: '#dc2626',
            border: '1px solid #fecaca',
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Plot image — no padding/border so it blends flush with white card */}
        {imgSrc && (
          <div className="resizable-plot" style={{ width: '100%', height: 460 }}>
            <img
              src={imgSrc}
              alt={`${gene} violin plot`}
              style={{ width: '100%', height: '100%', objectFit: 'contain',
                       display: 'block' }}
            />
          </div>
        )}

        {/* Footer hint */}
        <p style={{ margin: 0, fontSize: '0.68rem', color: '#94a3b8', textAlign: 'center' }}>
          log₂(counts + 1) · *** p&lt;0.001 · ** p&lt;0.01 · * p&lt;0.05 · ns p≥0.05
        </p>
      </div>

      {/* Spin animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
