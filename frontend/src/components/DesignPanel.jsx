import { useState, useEffect, useMemo } from 'react'

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
  // In append mode always start with a fresh blank row
  if (appending) return [{ id: 0, treatment: '', reference: '' }]
  // New format: contrasts is array of {treatment, reference} objects
  if (design?.contrasts?.length) {
    return design.contrasts.map((c, i) => ({
      id: i,
      treatment: typeof c === 'string' ? c : (c.treatment || ''),
      reference: typeof c === 'string' ? (design.reference || '') : (c.reference || ''),
    }))
  }
  // Old single-contrast format
  if (design?.contrast) return [{ id: 0, treatment: design.contrast, reference: design.reference || '' }]
  return [{ id: 0, treatment: '', reference: '' }]
}

export default function DesignPanel({
  session, parseInfo, metaState, initialDesign, existingResults,
  onResults, onBack,
}) {
  // isAppending = user came back from Results to add more contrasts
  const isAppending = !!(existingResults?.contrasts?.length)

  const [column,     setColumn]     = useState(initialDesign?.column || '')
  const [contrasts,  setContrasts]  = useState(() => initContrasts(initialDesign, isAppending))
  const [params,     setParams]     = useState({ ...DEFAULT_PARAMS, ...(initialDesign?.params || {}) })
  const [notify,     setNotify]     = useState(false)
  const [showParams, setShowParams] = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [status,     setStatus]     = useState(null)

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

  // Auto-select 'group' column (or first available) when columns load
  useEffect(() => {
    if (column || !columns.length || isAppending) return
    const preferred = columns.find(c => c.toLowerCase() === 'group') ?? columns[0]
    setColumn(preferred)
  }, [columns])

  // Reset new-contrast rows when column changes (not in append mode)
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

  // Already-computed labels set for fast lookup
  const existingLabels = useMemo(() => new Set(
    (existingResults?.contrasts || []).map(c => `${c.treatment}|${c.reference}`)
  ), [existingResults])

  // A contrast row is valid when treatment ≠ reference, both non-empty,
  // not already computed, and not a duplicate within the current list
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

  // For each row: treatment options exclude the row's own reference (and vice versa)
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

      // If appending, merge new contrasts; deduplicate by label (new wins)
      let mergedContrasts
      if (isAppending) {
        const newLabels = new Set(data.contrasts.map(c => `${c.treatment}|${c.reference}`))
        const kept = existingResults.contrasts.filter(c => !newLabels.has(`${c.treatment}|${c.reference}`))
        mergedContrasts = [...kept, ...data.contrasts]
      }
      const finalResults = isAppending
        ? { contrasts: mergedContrasts, pca: data.pca, countDist: data.countDist }
        : data

      // Full design deduplicated by label (new wins)
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

  const existingOffset = isAppending ? existingResults.contrasts.length : 0

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
                {/* Row number / dupe indicator */}
                <span className="text-xs font-mono" style={{ color: isDupe ? '#f59e0b' : 'var(--text-4)', textAlign: 'right' }}
                      title={isDupe ? 'Already computed — will be skipped' : ''}>
                  {isDupe ? '!' : existingOffset + idx + 1 + '.'}
                </span>

                {/* Numerator (treatment) */}
                <select value={c.treatment} disabled={!column}
                        onChange={e => updateContrast(c.id, 'treatment', e.target.value)}>
                  <option value="">— numerator —</option>
                  {treatmentOpts(c).map(l => <option key={l} value={l}>{l}</option>)}
                  {c.treatment && !treatmentOpts(c).includes(c.treatment) &&
                    <option value={c.treatment}>{c.treatment}</option>}
                </select>

                {/* vs */}
                <span className="text-xs text-center" style={{ color: 'var(--text-4)' }}>vs</span>

                {/* Denominator (reference) */}
                <select value={c.reference} disabled={!column}
                        onChange={e => updateContrast(c.id, 'reference', e.target.value)}>
                  <option value="">— denominator —</option>
                  {referenceOpts(c).map(l => <option key={l} value={l}>{l}</option>)}
                  {c.reference && !referenceOpts(c).includes(c.reference) &&
                    <option value={c.reference}>{c.reference}</option>}
                </select>

                {/* Remove button */}
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

        {/* DESeq2 Parameters accordion — hidden when appending (use existing params) */}
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
                    <ParamSlider label="Min count per gene" value={params.minCount} min={1} max={20} step={1}
                                 onChange={v => setParams(p => ({ ...p, minCount: v }))} />
                  </div>
                  <div style={{ opacity: params.noFilter ? 0.38 : 1, pointerEvents: params.noFilter ? 'none' : 'auto' }}>
                    <ParamSlider label="Min samples with count" value={params.minSamples} min={1} max={10} step={1}
                                 onChange={v => setParams(p => ({ ...p, minSamples: v }))} />
                  </div>
                </div>

                <div className="flex items-center gap-2" style={{ marginTop: '-4px' }}>
                  <input type="checkbox" id="no-filter-chk" checked={!!params.noFilter}
                         onChange={e => setParams(p => ({ ...p, noFilter: e.target.checked }))}
                         style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }} />
                  <label htmlFor="no-filter-chk" className="label-sm" style={{ cursor: 'pointer', userSelect: 'none' }}>
                    No pre-filtering <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>(Use all genes — Matches TREx Runs)</span>
                  </label>
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
    </div>
  )
}
