import { useEffect, useState } from 'react'

// Simple debounce hook
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

const CTRL_LABEL = {
  fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)',
  letterSpacing: '0.04em', textTransform: 'uppercase',
}

export default function MAPlot({ design, session, annMap }) {
  // ── ggmaplot params ─────────────────────────────────────────────────────────
  const [fdr,  setFdr]  = useState(0.05)
  const [fc,   setFc]   = useState(1.5)
  const [topN, setTopN] = useState(15)
  const [size, setSize] = useState(0.9)

  // ── Download modal state ──────────────────────────────────────────────────────
  const [showDlModal,   setShowDlModal]   = useState(false)
  const [dlFormat,      setDlFormat]      = useState('png')
  const [dlDpi,         setDlDpi]         = useState(300)
  const [downloading,   setDownloading]   = useState(false)

  // ── Image state ──────────────────────────────────────────────────────────────
  const [imgSrc,  setImgSrc]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  // Debounce slider / number values to avoid flooding the R server
  const dFdr  = useDebounce(fdr,  450)
  const dFc   = useDebounce(fc,   450)
  const dTopN = useDebounce(topN, 600)
  const dSize = useDebounce(size, 450)

  // ── Fetch plot from R backend whenever params or contrast change ─────────────
  useEffect(() => {
    if (!session?.sessionId) return

    const label = design?.contrast && design?.reference
      ? `${design.contrast} vs ${design.reference}`
      : null

    setLoading(true)
    setError(null)

    const controller = new AbortController()

    fetch('/api/maplot', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        sessionId: session.sessionId,
        label,
        fdr:    dFdr,
        fc:     dFc,
        topN:   dTopN,
        size:   dSize,
        annMap: annMap || null,
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
        if (e.name !== 'AbortError') {
          setError(e.message)
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [session, design, dFdr, dFc, dTopN, dSize, annMap])

  async function handleDownload() {
    if (!session?.sessionId) return
    setDownloading(true)
    try {
      const label = design?.contrast && design?.reference
        ? `${design.contrast} vs ${design.reference}` : null
      const resp = await fetch('/api/maplot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          label, fdr, fc, topN, size,
          annMap: annMap || null,
          format: dlFormat,
          dlDpi:  dlFormat === 'pdf' ? 300 : dlDpi,
        }),
      })
      const data = await resp.json()
      if (data.error) throw new Error(data.error)
      const mimeTypes = { png: 'image/png', pdf: 'application/pdf', svg: 'image/svg+xml' }
      const byteStr = atob(data.image)
      const arr = new Uint8Array(byteStr.length)
      for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i)
      const blob = new Blob([arr], { type: mimeTypes[dlFormat] })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `maplot.${dlFormat}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Download error:', e)
    } finally {
      setDownloading(false)
    }
  }

  if (!session?.sessionId) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>
        Session not available — please re-run the analysis to view the MA plot.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Controls ── */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>

        {/* FDR (ggmaplot: fdr) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={CTRL_LABEL}>FDR</span>
          <select value={fdr} onChange={e => setFdr(+e.target.value)}
                  style={{ fontSize: '0.78rem', padding: '2px 6px', minWidth: 72 }}>
            {[0.001, 0.01, 0.05, 0.1].map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        {/* FC (ggmaplot: fc) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={CTRL_LABEL}>FC</span>
          <input type="range" min={1} max={6} step={0.1} value={fc}
                 onChange={e => setFc(+e.target.value)} style={{ width: 80 }} />
          <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--accent-text)', minWidth: 34 }}>
            {fc.toFixed(1)}×
          </span>
        </div>

        {/* Top-N labels (ggmaplot: top) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={CTRL_LABEL}>Labels</span>
          <input type="number" min={0} max={50} value={topN}
                 onChange={e => setTopN(Math.max(0, Math.min(50, +e.target.value || 0)))}
                 style={{
                   width: 52, fontSize: '0.78rem', padding: '2px 6px', textAlign: 'center',
                   background: 'var(--bg-card2)', border: '1px solid var(--border)',
                   borderRadius: 6, color: 'var(--text-1)',
                 }} />
        </div>

        {/* Point size (ggmaplot: size) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={CTRL_LABEL}>Size</span>
          <input type="range" min={0.1} max={2} step={0.1} value={size}
                 onChange={e => setSize(+e.target.value)} style={{ width: 70 }} />
          <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--accent-text)', minWidth: 28 }}>
            {size.toFixed(1)}
          </span>
        </div>

        {/* Inline loading badge */}
        {loading && (
          <span style={{
            fontSize: '0.72rem', color: 'var(--text-3)', fontStyle: 'italic',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              border: '2px solid var(--accent)', borderTopColor: 'transparent',
              display: 'inline-block', animation: 'spin 0.7s linear infinite',
            }} />
            Rendering…
          </span>
        )}

      </div>

      {/* ── Download button ── */}
      {imgSrc && (
        <div>
          <button onClick={() => setShowDlModal(true)}
                  style={{
                    padding: '5px 14px', fontSize: '0.78rem', borderRadius: 6,
                    background: 'rgba(var(--accent-rgb),0.12)', color: 'var(--accent-text)',
                    border: '1px solid rgba(var(--accent-rgb),0.3)', cursor: 'pointer',
                  }}>
            ↓ Save Plot
          </button>
        </div>
      )}

      {/* ── Download modal ── */}
      {showDlModal && (
        <div onClick={() => setShowDlModal(false)}
             style={{
               position: 'fixed', inset: 0, zIndex: 1000,
               background: 'rgba(7,11,20,0.6)', backdropFilter: 'blur(4px)',
               display: 'flex', alignItems: 'center', justifyContent: 'center',
             }}>
          <div onClick={e => e.stopPropagation()}
               style={{
                 background: '#fff', borderRadius: 14, padding: 28, width: 320,
                 boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                 display: 'flex', flexDirection: 'column', gap: 16,
               }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>Save MA Plot</h3>
              <button onClick={() => setShowDlModal(false)}
                      style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6,
                               padding: '2px 10px', cursor: 'pointer', color: '#475569' }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Format</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['png', 'pdf', 'svg'].map(fmt => (
                  <button key={fmt} onClick={() => setDlFormat(fmt)}
                          style={{
                            flex: 1, padding: '7px 0', borderRadius: 8, fontSize: '0.8rem',
                            fontWeight: dlFormat === fmt ? 600 : 400,
                            background: dlFormat === fmt ? 'rgba(var(--accent-rgb),0.12)' : '#f8fafc',
                            color: dlFormat === fmt ? 'var(--accent)' : '#64748b',
                            border: dlFormat === fmt ? '1.5px solid rgba(var(--accent-rgb),0.4)' : '1px solid #e2e8f0',
                            cursor: 'pointer', textTransform: 'uppercase',
                          }}>
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {dlFormat === 'png' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Resolution</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[150, 300, 600].map(dpi => (
                    <button key={dpi} onClick={() => setDlDpi(dpi)}
                            style={{
                              flex: 1, padding: '7px 0', borderRadius: 8, fontSize: '0.8rem',
                              fontWeight: dlDpi === dpi ? 600 : 400,
                              background: dlDpi === dpi ? 'rgba(var(--accent-rgb),0.12)' : '#f8fafc',
                              color: dlDpi === dpi ? 'var(--accent)' : '#64748b',
                              border: dlDpi === dpi ? '1.5px solid rgba(var(--accent-rgb),0.4)' : '1px solid #e2e8f0',
                              cursor: 'pointer',
                            }}>
                      {dpi} dpi
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button onClick={async () => { await handleDownload(); setShowDlModal(false) }}
                    disabled={downloading}
                    style={{
                      padding: '10px', borderRadius: 9, fontSize: '0.85rem', fontWeight: 600,
                      background: downloading ? 'rgba(var(--accent-rgb),0.08)' : 'rgba(var(--accent-rgb),0.9)',
                      color: downloading ? 'var(--accent-text)' : '#fff',
                      border: 'none', cursor: downloading ? 'wait' : 'pointer',
                      marginTop: 4,
                    }}>
              {downloading ? '⟳ Saving…' : `↓ Save as ${dlFormat.toUpperCase()}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, fontSize: '0.82rem',
          background: 'rgba(248,113,113,0.08)', color: '#f87171',
          border: '1px solid rgba(248,113,113,0.2)',
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Plot image ── */}
      {imgSrc ? (
        <div className="resizable-plot" style={{ width: 640, height: 640, lineHeight: 0 }}>
          {/* Overlay spinner while updating (keeps old image visible) */}
          {loading && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(3px)',
              borderRadius: 8, zIndex: 1,
            }}>
              <span style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>Updating…</span>
            </div>
          )}
          <img src={imgSrc} alt="MA Plot"
               style={{ width: '100%', height: '100%', objectFit: 'contain',
                        borderRadius: 8, display: 'block' }} />
        </div>
      ) : (
        !error && (
          <div style={{
            height: 480, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-3)', fontSize: '0.85rem',
          }}>
            {loading ? 'Generating plot…' : 'Waiting for data…'}
          </div>
        )
      )}

      {/* Spinner keyframe (injected inline once) */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
