import { useState, useEffect, useRef, useMemo } from 'react'
import Plotly from 'plotly.js-dist-min'

const DEFAULT_PARAMS = {
  alpha: 0.05,
  lfcThreshold: 0,
  minCount: 1,
  minSamples: 2,
  noFilter: false,
  fitType: 'parametric',
  independentFiltering: true,
  cooksCutoff: true,
  ntop: 500,
  ntopAll: false,
}

const SAMPLE_COLORS = [
  '#6366f1','#ec4899','#14b8a6','#f59e0b','#3b82f6',
  '#10b981','#f97316','#8b5cf6','#06b6d4','#84cc16',
  '#f43f5e','#a78bfa','#34d399','#fb923c','#38bdf8',
]

function ParamSlider({ label, value, min, max, step, unit = '', onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="label-sm">{label}</span>
        <span className="text-xs font-mono" style={{ color: 'var(--accent-text)', minWidth: 36, textAlign: 'right' }}>
          {value}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
             onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  )
}

function initContrasts(design, appending) {
  if (appending) return [{ id: 0, treatment: '', reference: '' }]
  if (design?.contrasts?.length) {
    return design.contrasts.map((c, i) => ({
      id: i,
      treatment: typeof c === 'string' ? c : (c.treatment || ''),
      reference: typeof c === 'string' ? (design.reference || '') : (c.reference || ''),
    }))
  }
  if (design?.contrast) return [{ id: 0, treatment: design.contrast, reference: design.reference || '' }]
  return [{ id: 0, treatment: '', reference: '' }]
}

export default function DesignPanel({
  session, parseInfo, metaState, initialDesign, existingResults,
  onResults, onBack,
}) {
  const isAppending = !!(existingResults?.contrasts?.length)

  const [column,     setColumn]     = useState(initialDesign?.column || '')
  const [contrasts,  setContrasts]  = useState(() => initContrasts(initialDesign, isAppending))
  const [params,     setParams]     = useState({ ...DEFAULT_PARAMS, ...(initialDesign?.params || {}) })
  const [notify,     setNotify]     = useState(false)
  const [showParams, setShowParams] = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [status,     setStatus]     = useState(null)
  const [showDist,   setShowDist]   = useState(false)

  const _cols = parseInfo?.columns
  const columns = Array.isArray(_cols) ? _cols
                : typeof _cols === 'string' ? [_cols]
                : (_cols && typeof _cols === 'object') ? Object.values(_cols)
                : []

  const levelOptions = useMemo(() => {
    if (!column || !metaState?.rows) return []
    const active = metaState.rows.filter(r => metaState.selected?.has(r.sample))
    return [...new Set(active.map(r => r[column]).filter(Boolean))].sort()
  }, [column, metaState])

  const nSamples = metaState
    ? [...(metaState.selected || [])].length
    : parseInfo?.sampleCount

  useEffect(() => {
    if (column || !columns.length || isAppending) return
    const preferred = columns.find(c => c.toLowerCase() === 'group') ?? columns[0]
    setColumn(preferred)
  }, [columns])

  useEffect(() => {
    if (!initialDesign && !isAppending) {
      setContrasts([{ id: 0, treatment: '', reference: '' }])
    }
  }, [column])

  function addContrast() {
    setContrasts(prev => [...prev, { id: Date.now(), treatment: '', reference: '' }])
  }
  function removeContrast(id) {
    setContrasts(prev => prev.length > 1 ? prev.filter(c => c.id !== id) : prev)
  }
  function updateContrast(id, field, value) {
    setContrasts(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  const existingLabels = useMemo(() => new Set(
    (existingResults?.contrasts || []).map(c => `${c.treatment}|${c.reference}`)
  ), [existingResults])

  const validContrasts = contrasts.reduce((acc, c) => {
    const key = `${c.treatment}|${c.reference}`
    if (
      c.treatment && c.reference && c.treatment !== c.reference &&
      !existingLabels.has(key) &&
      !acc.seen.has(key)
    ) {
      acc.seen.add(key)
      acc.list.push(c)
    }
    return acc
  }, { seen: new Set(), list: [] }).list
  const canRun = column && validContrasts.length > 0

  function treatmentOpts(c) { return levelOptions.filter(l => l !== c.reference) }
  function referenceOpts(c) { return levelOptions.filter(l => l !== c.treatment) }

  async function run() {
    setLoading(true); setError(null)
    setStatus(`Running DESeq2 (${validContrasts.length} contrast${validContrasts.length !== 1 ? 's' : ''})… this may take a minute`)
    try {
      const keepSamples = metaState ? [...(metaState.selected || [])] : null
      const editedMeta  = metaState?.rows || null
      const res = await fetch('/api/deseq2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId:  session.sessionId,
          column,
          contrasts:  validContrasts.map(c => ({ treatment: c.treatment, reference: c.reference })),
          keepSamples, editedMeta, params, notify,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'DESeq2 failed')

      let mergedContrasts
      if (isAppending) {
        const newLabels = new Set(data.contrasts.map(c => `${c.treatment}|${c.reference}`))
        const kept = existingResults.contrasts.filter(c => !newLabels.has(`${c.treatment}|${c.reference}`))
        mergedContrasts = [...kept, ...data.contrasts]
      }
      const finalResults = isAppending
        ? { contrasts: mergedContrasts, pca: data.pca, countDist: data.countDist }
        : data

      const seen = new Set()
      const allContrastDefs = [
        ...(existingResults?.contrasts || []).map(c => ({ treatment: c.treatment, reference: c.reference })),
        ...validContrasts.map(c => ({ treatment: c.treatment, reference: c.reference })),
      ].filter(c => {
        const key = `${c.treatment}|${c.reference}`
        if (seen.has(key)) return false
        seen.add(key); return true
      })
      onResults(finalResults, { column, contrasts: allContrastDefs, params })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false); setStatus(null)
    }
  }

  async function downloadFilteredCounts() {
    try {
      const r = await fetch('/api/export-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId:  session.sessionId,
          minCount:   params.minCount,
          minSamples: params.minSamples,
        }),
      })
      if (!r.ok) throw new Error('Export failed')
      const text = await r.text()
      const blob = new Blob([text], { type: 'text/csv' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `filtered_counts_minCount${params.minCount}_minSamp${params.minSamples}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e.message)
    }
  }

  const existingOffset = isAppending ? existingResults.contrasts.length : 0
  const canPreview = !!session?.sessionId && !params.noFilter

  return (
    <div className="w-full" style={{ maxWidth: 580 }}>
      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold mb-1 gradient-text">
          {isAppending ? 'Add Contrasts' : 'DESeq2 Design'}
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          {parseInfo?.geneCount?.toLocaleString()} genes · {nSamples} samples
          {isAppending && (
            <span style={{ marginLeft: 8, color: 'var(--text-3)' }}>
              · {existingResults.contrasts.length} already computed
            </span>
          )}
        </p>
      </div>

      <div className="glass p-6 flex flex-col gap-5">

        {/* ── Already-computed contrasts list (append mode only) ── */}
        {isAppending && (
          <div>
            <p className="label-sm mb-2" style={{ color: 'var(--text-3)' }}>Already computed</p>
            <div className="flex flex-col gap-1.5 mb-4">
              {existingResults.contrasts.map((c, i) => (
                <div key={i} className="glass2 px-3 py-2 rounded-lg flex items-center gap-2"
                     style={{ opacity: 0.65 }}>
                  <span style={{ color: '#34d399', fontSize: '0.75rem' }}>✓</span>
                  <span className="text-xs font-mono" style={{ color: 'var(--text-2)', flex: 1 }}>
                    {c.label ?? `${c.treatment} vs ${c.reference}`}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-4)' }}>
                    {c.summary?.total != null ? `${c.summary.total} DEGs` : ''}
                  </span>
                </div>
              ))}
            </div>
            <p className="label-sm mb-2">New contrasts to add</p>
          </div>
        )}

        {/* Column selector */}
        <div>
          <label className="label-sm block mb-1.5">Condition Column</label>
          <select value={column} onChange={e => setColumn(e.target.value)} disabled={isAppending}>
            <option value="">— select column —</option>
            {columns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {isAppending && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-4)' }}>
              Locked while appending contrasts.
            </p>
          )}
        </div>

        {/* Pairwise contrast rows */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label-sm">
              Contrasts
              <span style={{ color: 'var(--text-4)', fontWeight: 400, textTransform: 'none',
                             letterSpacing: 0, marginLeft: 6 }}>
                (any pairwise)
              </span>
            </label>
            <button onClick={addContrast} disabled={!column || contrasts.length >= 8}
                    className="text-xs px-2.5 py-1 rounded-md transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)',
                      border: '1px solid var(--border)',
                      opacity: (!column || contrasts.length >= 8) ? 0.4 : 1,
                      cursor: (!column || contrasts.length >= 8) ? 'not-allowed' : 'pointer',
                    }}>
              + Add
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {contrasts.map((c, idx) => {
              const key = `${c.treatment}|${c.reference}`
              const isDupe = !!(c.treatment && c.reference && (
                existingLabels.has(key) ||
                contrasts.findIndex(o => `${o.treatment}|${o.reference}` === key) !== idx
              ))
              return (
              <div key={c.id} style={{
                display: 'grid',
                gridTemplateColumns: '18px 1fr 28px 1fr 24px',
                alignItems: 'center', gap: 6,
                opacity: isDupe ? 0.5 : 1,
              }}>
                <span className="text-xs font-mono" style={{ color: isDupe ? '#f59e0b' : 'var(--text-4)', textAlign: 'right' }}
                      title={isDupe ? 'Already computed — will be skipped' : ''}>
                  {isDupe ? '!' : existingOffset + idx + 1 + '.'}
                </span>
                <select value={c.treatment} disabled={!column}
                        onChange={e => updateContrast(c.id, 'treatment', e.target.value)}>
                  <option value="">— numerator —</option>
                  {treatmentOpts(c).map(l => <option key={l} value={l}>{l}</option>)}
                  {c.treatment && !treatmentOpts(c).includes(c.treatment) &&
                    <option value={c.treatment}>{c.treatment}</option>}
                </select>
                <span className="text-xs text-center" style={{ color: 'var(--text-4)' }}>vs</span>
                <select value={c.reference} disabled={!column}
                        onChange={e => updateContrast(c.id, 'reference', e.target.value)}>
                  <option value="">— denominator —</option>
                  {referenceOpts(c).map(l => <option key={l} value={l}>{l}</option>)}
                  {c.reference && !referenceOpts(c).includes(c.reference) &&
                    <option value={c.reference}>{c.reference}</option>}
                </select>
                <button onClick={() => removeContrast(c.id)} disabled={contrasts.length === 1}
                        style={{
                          background: 'transparent', border: 'none',
                          cursor: contrasts.length === 1 ? 'not-allowed' : 'pointer',
                          color: contrasts.length === 1 ? 'var(--text-4)' : '#f87171',
                          padding: '2px 4px', fontSize: '1rem', lineHeight: 1,
                          opacity: contrasts.length === 1 ? 0.3 : 1, flexShrink: 0,
                        }}>
                  ×
                </button>
              </div>
            )})}
          </div>
        </div>

        {/* Formula preview */}
        {validContrasts.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {validContrasts.map((c, i) => (
              <div key={i} className="glass2 px-3 py-1.5 text-xs font-mono"
                   style={{ color: 'var(--text-3)', fontFamily: "'JetBrains Mono', monospace" }}>
                {'results(dds, contrast = c('}
                <span style={{ color: 'var(--accent-text)' }}>"{column}"</span>
                {', '}
                <span style={{ color: '#34d399' }}>"{c.treatment}"</span>
                {', '}
                <span style={{ color: '#fb923c' }}>"{c.reference}"</span>
                {')), alpha = '}
                <span style={{ color: '#60a5fa' }}>{params.alpha}</span>
              </div>
            ))}
          </div>
        )}

        {/* DESeq2 Parameters accordion */}
        {!isAppending && (
          <div>
            <button className="accordion-btn" onClick={() => setShowParams(p => !p)}>
              <span className="label-sm">DESeq2 Parameters</span>
              <span style={{ transform: showParams ? 'rotate(180deg)' : 'none',
                             transition: 'transform 0.2s', fontSize: '0.75rem' }}>▾</span>
            </button>

            {showParams && (
              <div className="flex flex-col gap-4 pt-3 pb-1">
                <div className="grid grid-cols-2 gap-4">
                  <ParamSlider label="Alpha (p-value)" value={params.alpha} min={0.01} max={0.2} step={0.01}
                               onChange={v => setParams(p => ({ ...p, alpha: v }))} />
                  <ParamSlider label="LFC Threshold" value={params.lfcThreshold} min={0} max={2} step={0.1}
                               onChange={v => setParams(p => ({ ...p, lfcThreshold: v }))} />
                  <div style={{ opacity: params.noFilter ? 0.38 : 1, pointerEvents: params.noFilter ? 'none' : 'auto' }}>
                    <ParamSlider label="Min count per gene" value={params.minCount} min={1} max={50} step={1}
                                 onChange={v => setParams(p => ({ ...p, minCount: v }))} />
                  </div>
                  <div style={{ opacity: params.noFilter ? 0.38 : 1, pointerEvents: params.noFilter ? 'none' : 'auto' }}>
                    <ParamSlider label="Min samples with count" value={params.minSamples} min={1} max={20} step={1}
                                 onChange={v => setParams(p => ({ ...p, minSamples: v }))} />
                  </div>
                </div>

                {/* No-filter checkbox + preview / download buttons */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              marginTop: '-4px', gap: 8 }}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="no-filter-chk" checked={!!params.noFilter}
                           onChange={e => setParams(p => ({ ...p, noFilter: e.target.checked }))}
                           style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }} />
                    <label htmlFor="no-filter-chk" className="label-sm" style={{ cursor: 'pointer', userSelect: 'none' }}>
                      No pre-filtering <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>(Matches TREx Runs)</span>
                    </label>
                  </div>
                  {canPreview && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => setShowDist(true)}
                        title="Preview count distribution"
                        style={{
                          fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20,
                          border: '1px solid var(--border)', background: 'var(--bg-card2)',
                          color: 'var(--text-2)', cursor: 'pointer', display: 'flex',
                          alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                        }}>
                        📊 Preview
                      </button>
                      <button
                        onClick={downloadFilteredCounts}
                        title="Download filtered counts matrix as CSV"
                        style={{
                          fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20,
                          border: '1px solid var(--border)', background: 'var(--bg-card2)',
                          color: 'var(--text-2)', cursor: 'pointer', display: 'flex',
                          alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                        }}>
                        ⬇ Counts
                      </button>
                    </div>
                  )}
                </div>

                {/* ── PCA ── */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                  <p className="label-sm mb-3" style={{ color: 'var(--text-3)', letterSpacing: '0.05em' }}>PCA</p>
                  <div style={{ opacity: params.ntopAll ? 0.38 : 1, pointerEvents: params.ntopAll ? 'none' : 'auto' }}>
                    <ParamSlider label="Top N variable genes (ntop)" value={params.ntop}
                                 min={100} max={5000} step={100}
                                 onChange={v => setParams(p => ({ ...p, ntop: v }))} />
                  </div>
                  <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
                    <input type="checkbox" id="ntop-all-chk" checked={!!params.ntopAll}
                           onChange={e => setParams(p => ({ ...p, ntopAll: e.target.checked }))}
                           style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }} />
                    <label htmlFor="ntop-all-chk" className="label-sm" style={{ cursor: 'pointer', userSelect: 'none' }}>
                      Use all variable genes <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>(ignore ntop — use every gene)</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="label-sm block mb-1.5">Dispersion fit type</label>
                  <select value={params.fitType} onChange={e => setParams(p => ({ ...p, fitType: e.target.value }))}>
                    <option value="parametric">parametric</option>
                    <option value="local">local</option>
                    <option value="mean">mean</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="label-sm">Independent filtering</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-4)' }}>Optimize power by filtering low-count genes</p>
                    </div>
                    <label className="toggle">
                      <input type="checkbox" checked={params.independentFiltering}
                             onChange={e => setParams(p => ({ ...p, independentFiltering: e.target.checked }))} />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="label-sm">Cook's cutoff</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-4)' }}>Flag genes with outlier samples</p>
                    </div>
                    <label className="toggle">
                      <input type="checkbox" checked={params.cooksCutoff}
                             onChange={e => setParams(p => ({ ...p, cooksCutoff: e.target.checked }))} />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                </div>

                <button onClick={() => setParams(DEFAULT_PARAMS)}
                        className="text-xs self-end px-3 py-1 rounded-md"
                        style={{ color: 'var(--text-3)', border: '1px solid var(--border)',
                                 background: 'transparent', cursor: 'pointer' }}>
                  Reset defaults
                </button>
              </div>
            )}
          </div>
        )}

        {/* Email notification */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>Email notification</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Get notified when analysis completes</p>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>

        {/* Error / status */}
        {error && (
          <div className="text-xs px-3 py-2 rounded-lg"
               style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171',
                        border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}
        {status && (
          <div className="text-xs px-3 py-2 rounded-lg flex items-center gap-2"
               style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)',
                        border: '1px solid var(--border)' }}>
            <span className="animate-spin inline-block">⟳</span> {status}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {nSamples >= 100 && !loading && (
            <div style={{ padding:'9px 13px', borderRadius:8, fontSize:'0.74rem', lineHeight:1.55,
              background:'rgba(251,191,36,0.07)', border:'1px solid rgba(251,191,36,0.25)',
              color:'#d97706', display:'flex', gap:8, alignItems:'flex-start' }}>
              <span style={{ flexShrink:0 }}>⏱</span>
              <span>
                <strong>{nSamples} samples detected.</strong>{' '}
                DESeq2 fitting may take{' '}
                {nSamples >= 200 ? '15–30 minutes' : '5–15 minutes'}.
                Do not close this tab.
                {params.noFilter && <> Unchecking <strong>No Pre-filtering</strong> will significantly speed things up.</>}
              </span>
            </div>
          )}
          {onBack && (
            <button className="btn-ghost" onClick={onBack}>
              {isAppending ? '← Results' : '← Samples'}
            </button>
          )}
          <button className="btn-primary flex-1 justify-center" onClick={run}
                  disabled={!canRun || loading}>
            {loading
              ? <><span className="animate-spin inline-block">⟳</span> Running DESeq2…</>
              : isAppending
                ? `Add ${validContrasts.length} contrast${validContrasts.length !== 1 ? 's' : ''} →`
                : `Run DESeq2 (${validContrasts.length} contrast${validContrasts.length !== 1 ? 's' : ''}) →`
            }
          </button>
        </div>
      </div>

      {/* Pre-filter distribution modal */}
      {showDist && (
        <PreFilterModal
          session={session}
          minCount={params.minCount}
          minSamples={params.minSamples}
          onClose={() => setShowDist(false)}
        />
      )}
    </div>
  )
}

// ── Pre-filter distribution modal ─────────────────────────────────────────────
function PreFilterModal({ session, minCount, minSamples, onClose }) {
  const [distData,  setDistData]  = useState(null)
  const [fetching,  setFetching]  = useState(true)
  const [fetchErr,  setFetchErr]  = useState(null)
  const [pos,       setPos]       = useState(null)
  const [size,      setSize]      = useState({
    w: Math.min(window.innerWidth  * 0.85, 980),
    h: Math.min(window.innerHeight * 0.80, 760),
  })

  const plotRef     = useRef(null)
  const modalRef    = useRef(null)
  const dragRef     = useRef(null)
  const resizeRef   = useRef(null)
  const wasDragged  = useRef(false)
  const didRender   = useRef(false)

  // ── Fetch distribution data once ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/prefilter-dist', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ sessionId: session.sessionId }),
        })
        const d = await r.json()
        if (cancelled) return
        if (d.error) throw new Error(d.error)
        setDistData(d)
      } catch (e) {
        if (!cancelled) setFetchErr(e.message)
      } finally {
        if (!cancelled) setFetching(false)
      }
    })()
    return () => { cancelled = true }
  }, [session.sessionId])

  // ── Initial chart render once data arrives ────────────────────────────────────
  useEffect(() => {
    if (!distData || !plotRef.current || didRender.current) return
    didRender.current = true
    renderChart(distData, minCount, size.h)
  }, [distData])

  // ── Update threshold line live as minCount changes (cheap relayout) ───────────
  useEffect(() => {
    if (!distData || !plotRef.current?._fullLayout) return
    const x = Math.log2(minCount + 1)
    Plotly.relayout(plotRef.current, {
      'shapes[0].x0': x,
      'shapes[0].x1': x,
      'annotations[0].x': x,
      'annotations[0].text': `≥ ${minCount} counts`,
    })
  }, [minCount, distData])

  // ── Re-render on resize ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!distData || !plotRef.current?._fullLayout) return
    Plotly.relayout(plotRef.current, { height: chartHeight(size.h) })
  }, [size.h, distData])

  function chartHeight(h) { return Math.max(260, h - 110) }

  function renderChart(data, mc, h) {
    const { kdes } = data
    const isLight   = document.body.classList.contains('light')
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-3').trim() || '#94a3b8'
    const gridColor = isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.10)'
    const showLegend = kdes.length <= 20

    const allX  = kdes.flatMap(k => k.x)
    const xMax  = Math.max(...allX) * 1.02

    // Nice count labels on log2(count+1) axis
    const niceC = [0,1,2,5,10,20,50,100,200,500,1000,2000,5000,10000,20000,50000]
    const tvVals = niceC.filter(v => Math.log2(v + 1) <= xMax)
    const tickvals = tvVals.map(v => Math.log2(v + 1))
    const ticktext = tvVals.map(v => String(v))

    const x = Math.log2(mc + 1)

    const traces = kdes.map((kde, i) => ({
      x: kde.x,
      y: kde.y,
      customdata: kde.x.map(v => Math.pow(2, v) - 1),
      type: 'scatter', mode: 'lines', name: kde.sample,
      line: { color: SAMPLE_COLORS[i % SAMPLE_COLORS.length], width: 1.5, shape: 'spline' },
      opacity: 0.72,
      showlegend: showLegend,
      hovertemplate: `<b>${kde.sample}</b><br>count ≈ %{customdata:.0f}<extra></extra>`,
    }))

    const layout = {
      height: chartHeight(h),
      margin: { t: 28, r: showLegend ? 150 : 16, b: 54, l: 62 },
      plot_bgcolor: 'transparent',
      paper_bgcolor: 'transparent',
      xaxis: {
        title:    { text: 'raw count  (log₂(count + 1) scale)', font: { size: 9 } },
        color:    textColor,
        gridcolor: gridColor,
        showgrid: true,
        zeroline: false,
        tickfont: { size: 8 },
        range:    [0, xMax],
        tickvals,
        ticktext,
      },
      yaxis: {
        title:    { text: 'Density', font: { size: 9 } },
        color:    textColor,
        gridcolor: gridColor,
        showgrid: true,
        zeroline: false,
        tickfont: { size: 8 },
      },
      legend: {
        font: { size: 8, color: textColor },
        bgcolor: 'transparent',
        x: 1.01, y: 1, xanchor: 'left',
      },
      hovermode: 'x unified',
      shapes: [{
        type: 'line', x0: x, x1: x, y0: 0, y1: 1, yref: 'paper',
        line: { color: '#f43f5e', width: 2, dash: 'dash' },
      }],
      annotations: [{
        x, y: 0.97, yref: 'paper', xanchor: 'left',
        text: `≥ ${mc} counts`,
        font: { size: 8, color: '#f87171' },
        showarrow: false,
        bgcolor: 'rgba(0,0,0,0)',
      }],
    }

    Plotly.react(plotRef.current, traces, layout, {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['select2d', 'lasso2d'],
    })
  }

  // ── Genes retained from lookup table (instant) ────────────────────────────────
  const genesRetained = useMemo(() => {
    if (!distData?.thresholdTable) return null
    const mcIdx = Math.min(Math.max(minCount, 1), 50) - 1
    const msIdx = Math.min(Math.max(minSamples, 1), distData.nSamples, 20) - 1
    return distData.thresholdTable[mcIdx]?.[msIdx] ?? null
  }, [distData, minCount, minSamples])

  const pct = distData && genesRetained != null
    ? Math.round(genesRetained / distData.nGenes * 100)
    : null

  // ── Drag ─────────────────────────────────────────────────────────────────────
  const startDrag = (e) => {
    if (e.target.closest('button')) return
    if (!pos && modalRef.current) {
      const r = modalRef.current.getBoundingClientRect()
      setPos({ x: r.left, y: r.top })
    }
    const rect = modalRef.current.getBoundingClientRect()
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top }
    wasDragged.current = false
    const onMove = ev => {
      wasDragged.current = true
      setPos({ x: dragRef.current.ox + ev.clientX - dragRef.current.sx,
               y: dragRef.current.oy + ev.clientY - dragRef.current.sy })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setTimeout(() => { wasDragged.current = false }, 0)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    e.preventDefault()
  }

  // ── Resize ───────────────────────────────────────────────────────────────────
  const startResize = (e) => {
    const rect = modalRef.current.getBoundingClientRect()
    resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: rect.width, oh: rect.height }
    wasDragged.current = true
    const onMove = ev => {
      setSize({
        w: Math.max(600, resizeRef.current.ow + ev.clientX - resizeRef.current.sx),
        h: Math.max(420, resizeRef.current.oh + ev.clientY - resizeRef.current.sy),
      })
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setTimeout(() => { wasDragged.current = false }, 0)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    e.preventDefault(); e.stopPropagation()
  }

  const modalStyle = {
    position: 'fixed',
    zIndex: 101001,
    background: 'var(--bg-panel)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    boxShadow: '0 8px 60px rgba(0,0,0,0.5)',
    width:  size.w,
    height: size.h,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    ...(pos
      ? { left: pos.x, top: pos.y }
      : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }),
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 101000, background: 'rgba(0,0,0,0.5)' }}
      onClick={() => { if (!wasDragged.current) onClose() }}
    >
      <div ref={modalRef} style={modalStyle} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div
          onMouseDown={startDrag}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            cursor: 'grab', userSelect: 'none', flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-1)' }}>
            Raw Count Distribution
          </span>
          {distData && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-4)' }}>
              {distData.nSamples} samples · {distData.nGenes.toLocaleString()} genes total
            </span>
          )}
          {/* Genes retained badge */}
          {genesRetained != null && (
            <span style={{
              marginLeft: 4,
              fontSize: '0.72rem', fontWeight: 600,
              padding: '2px 10px', borderRadius: 20,
              background: 'rgba(52,211,153,0.12)',
              border: '1px solid rgba(52,211,153,0.3)',
              color: '#34d399',
            }}>
              ✓ {genesRetained.toLocaleString()} retained ({pct}%) · {(distData.nGenes - genesRetained).toLocaleString()} removed
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-4)', fontStyle: 'italic' }}>
            minCount = {minCount} · minSamples = {minSamples}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-3)', fontSize: '1.2rem', lineHeight: 1, padding: '0 4px',
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {fetching && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
            }}>
              <span style={{
                width: 36, height: 36, borderRadius: '50%',
                border: '3px solid rgba(var(--accent-rgb),0.2)',
                borderTopColor: 'var(--accent)',
                display: 'inline-block', animation: 'pf-spin 0.7s linear infinite',
              }} />
              <span style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>Computing distributions…</span>
            </div>
          )}
          {fetchErr && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: '0.82rem', color: '#f87171' }}>⚠ {fetchErr}</span>
            </div>
          )}
          <div ref={plotRef} style={{ width: '100%', height: '100%',
                                      visibility: distData ? 'visible' : 'hidden' }} />
        </div>

        {/* Footer hint */}
        <div style={{
          padding: '6px 16px', borderTop: '1px solid var(--border)',
          fontSize: '0.68rem', color: 'var(--text-4)', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span>Red dashed line = current minCount threshold on log₂(count+1) scale.</span>
          <span>Adjust sliders in the panel to update live.</span>
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={startResize}
          style={{
            position: 'absolute', right: 4, bottom: 4, width: 16, height: 16,
            cursor: 'se-resize', color: 'var(--text-4)', fontSize: '0.7rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            userSelect: 'none',
          }}
        >⊿</div>
      </div>
      <style>{`@keyframes pf-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
