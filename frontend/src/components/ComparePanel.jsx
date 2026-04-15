import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Plotly from 'plotly.js-dist-min'
import { useDownloadDialog } from './DownloadDialog'
import { useRegisterPlot } from '../context/PlotRegistryContext'

// ── Mouse-follow tooltip (portaled to body to escape stacking contexts) ────────
function useTooltip() {
  const [tip, setTip] = useState({ text: '', x: 0, y: 0, visible: false })
  const show = useCallback((text, e) => {
    setTip({ text, x: e.clientX + 14, y: e.clientY + 14, visible: true })
  }, [])
  const move = useCallback(e => {
    setTip(prev => prev.visible ? { ...prev, x: e.clientX + 14, y: e.clientY + 14 } : prev)
  }, [])
  const hide = useCallback(() => setTip(prev => ({ ...prev, visible: false })), [])
  const node = tip.visible ? createPortal(
    <div style={{
      position: 'fixed', left: tip.x, top: tip.y, zIndex: 99999, pointerEvents: 'none',
      background: '#1e293b', color: '#f1f5f9', fontSize: '0.72rem', padding: '6px 10px',
      borderRadius: 6, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.12)', maxWidth: 420, whiteSpace: 'pre-wrap',
      lineHeight: 1.5,
    }}>{tip.text}</div>,
    document.body
  ) : null
  return { show, move, hide, node }
}

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ── Shared fetch helper ────────────────────────────────────────────────────────
async function apiFetch(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

const TAB_BTN = (active) => ({
  padding: '4px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
  fontSize: '0.78rem', fontWeight: active ? 600 : 400,
  background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
  color: active ? 'var(--text-1)' : 'var(--text-3)',
  transition: 'all 0.15s',
})

// Replace gene IDs with symbols in a Plotly figure's axis tick labels
function applySymbolsToFig(fig, annMap) {
  if (!annMap || !fig?.layout) return fig
  const replace = (arr) => Array.isArray(arr) ? arr.map(v => annMap[v] || v) : arr
  const axes = Object.keys(fig.layout).filter(k => /^[xy]axis/.test(k))
  axes.forEach(ax => {
    if (fig.layout[ax]?.ticktext) fig.layout[ax].ticktext = replace(fig.layout[ax].ticktext)
  })
  // Also patch any text arrays on traces (heatmap y/x)
  if (fig.data) {
    fig.data.forEach(trace => {
      if (trace.y) trace.y = replace(trace.y)
    })
  }
  return fig
}

// Rename sample names in heatmap x-axis (columns) using sampleLabels map
function applySampleLabelsToFig(fig, sampleLabels) {
  if (!sampleLabels || !Object.keys(sampleLabels).length || !fig) return fig
  const rename = (v) => (typeof v === 'string' ? (sampleLabels[v] ?? v) : v)
  // x-axis tick labels
  if (fig.layout) {
    Object.keys(fig.layout).filter(k => /^xaxis/.test(k)).forEach(ax => {
      if (fig.layout[ax]?.ticktext) fig.layout[ax].ticktext = fig.layout[ax].ticktext.map(rename)
    })
  }
  // heatmap trace x values
  if (fig.data) {
    fig.data.forEach(trace => {
      if (trace.x) trace.x = trace.x.map(rename)
    })
  }
  return fig
}

// ── UpSet Plot ─────────────────────────────────────────────────────────────────
function UpSetTab({ session, contrasts }) {
  const [fdr, setFdr]         = useState(0.05)
  const [minLfc, setMinLfc]   = useState(0)
  const [imgSrc, setImgSrc]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const dFdr    = useDebounce(fdr,    600)
  const dMinLfc = useDebounce(minLfc, 600)

  useEffect(() => {
    if (!session?.sessionId || !contrasts?.length) return
    setLoading(true); setError(null); setImgSrc(null)
    const activeLabels = contrasts.map(c => c.label ?? `${c.treatment}|${c.reference}`)
    apiFetch('/api/upset', { sessionId: session.sessionId, fdr: dFdr, minLfc: dMinLfc, activeLabels })
      .then(data => { setImgSrc(`data:image/png;base64,${data.image}`) })
      .catch(e  => { setError(e.message) })
      .finally(() => setLoading(false))
  }, [session, contrasts, dFdr, dMinLfc])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-2)' }}>
          FDR cutoff
          <input type="number" value={fdr} min={0.001} max={0.5} step={0.01}
                 onChange={e => setFdr(Number(e.target.value))}
                 style={{ width: 70, fontSize: '0.8rem', padding: '2px 6px' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-2)' }}>
          Min |LFC|
          <input type="number" value={minLfc} min={0} max={10} step={0.1}
                 onChange={e => setMinLfc(Number(e.target.value))}
                 style={{ width: 70, fontSize: '0.8rem', padding: '2px 6px' }} />
        </label>
        {loading && <span style={{ fontSize: '0.78rem', color: 'var(--text-3)', fontStyle: 'italic' }}>Generating…</span>}
      </div>

      {error && <ErrorBox msg={error} />}

      {imgSrc && (
        <div className="resizable-plot" style={{ width: '100%', height: 520 }}>
          <img src={imgSrc} alt="UpSet plot" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        </div>
      )}

      {!imgSrc && !loading && !error && <Placeholder text="Waiting for data…" />}
    </div>
  )
}

const HEATMAP_PRESETS = [
  { label: 'Blue–White–Red',   colors: ['#1565C0', '#ffffff', '#B71C1C'] },
  { label: 'Purple–White–Org', colors: ['#6A1B9A', '#ffffff', '#E65100'] },
  { label: 'Green–White–Red',  colors: ['#1B5E20', '#ffffff', '#B71C1C'] },
  { label: 'Navy–White–Gold',  colors: ['#0D1B4B', '#ffffff', '#F9A825'] },
  { label: 'Teal–Black–Pink',  colors: ['#00695C', '#000000', '#AD1457'] },
  { label: 'RdYlBu',           colors: ['#2166AC', '#FFFFBF', '#D73027'] },
]

function PaletteRow({ palette, setPalette }) {
  // drafts: live swatch preview; setPalette is debounced via timer so drag doesn't spam regen
  const [drafts, setDrafts] = useState(palette)
  const commitTimer = useRef(null)
  useEffect(() => { setDrafts(palette) }, [palette])

  const labels = ['Low', 'Mid', 'High']

  function handleColorChange(i, val) {
    const next = [...drafts]; next[i] = val
    setDrafts(next)
    // debounce the commit so regen only fires after user stops dragging
    clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => setPalette(next), 600)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      {/* Preset chips — commit immediately */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {HEATMAP_PRESETS.map(p => {
          const active = JSON.stringify(p.colors) === JSON.stringify(palette)
          return (
            <button key={p.label} onClick={() => { clearTimeout(commitTimer.current); setPalette(p.colors) }}
                    title={p.label}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 0,
                      padding: 0, border: active ? '2px solid var(--accent)' : '2px solid transparent',
                      borderRadius: 5, cursor: 'pointer', overflow: 'hidden', height: 18,
                    }}>
              {p.colors.map((c, i) => (
                <span key={i} style={{ width: 14, height: 18, background: c, display: 'block' }} />
              ))}
            </button>
          )
        })}
      </div>

      {/* Custom pickers */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {drafts.map((col, i) => (
          <label key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
            <span style={{ fontSize: '0.62rem', color: 'var(--text-3)', textTransform: 'uppercase' }}>{labels[i]}</span>
            <div style={{ position: 'relative', width: 28, height: 28 }}>
              <span style={{
                display: 'block', width: 28, height: 28, borderRadius: 5,
                background: col, border: '2px solid var(--border)', cursor: 'pointer',
              }} />
              <input type="color" value={col}
                     onInput={e => handleColorChange(i, e.target.value)}
                     onChange={e => handleColorChange(i, e.target.value)}
                     style={{
                       position: 'absolute', inset: 0, opacity: 0,
                       width: '100%', height: '100%', cursor: 'pointer',
                     }} />
            </div>
            <input type="text" value={col} maxLength={7}
                   onChange={e => {
                     if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) {
                       const next = [...drafts]; next[i] = e.target.value; setDrafts(next)
                       if (e.target.value.length === 7) { clearTimeout(commitTimer.current); setPalette(next) }
                     }
                   }}
                   style={{
                     width: 60, fontSize: '0.65rem', padding: '1px 4px', textAlign: 'center',
                     fontFamily: 'monospace', background: 'var(--bg-card2)',
                     border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-1)',
                   }} />
          </label>
        ))}
      </div>
    </div>
  )
}

const DIST_METHODS = ['euclidean', 'pearson', 'spearman', 'kendall', 'manhattan', 'maximum']

// ── Heatmap (interactive via heatmaply → Plotly JSON) ─────────────────────────
function HeatmapTab({ session, annMap, pca, contrasts, sampleLabels = {} }) {
  const { promptDownload, dialog: dlDialog } = useDownloadDialog()
  const outerRef = useRef(null)
  const plotRef  = useRef(null)

  const heatmapCaptureRef = useRef(null)
  heatmapCaptureRef.current = () => {
    if (!plotRef.current?._fullLayout) return null
    return Plotly.toImage(plotRef.current, { format: 'png', width: 900, height: 800 })
  }
  useRegisterPlot('heatmap', 'Heatmap', 'Compare', heatmapCaptureRef)

  const [fdr, setFdr]                 = useState(0.05)
  const [minLfc, setMinLfc]           = useState(0)
  const [topN, setTopN]               = useState(50)
  const [geneSet, setGeneSet]         = useState('union')
  const mode = 'vst'
  const [clusterRows, setClusterRows] = useState(true)
  const [clusterCols, setClusterCols] = useState(true)
  const [distMethod, setDistMethod]   = useState('pearson')
  const [colorBy, setColorBy]         = useState('group')

  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [hasPlot, setHasPlot]         = useState(false)
  const [palette, setPalette]         = useState(['#1565C0', '#ffffff', '#B71C1C'])
  const [annGroups, setAnnGroups]     = useState([])
  const [annColors, setAnnColors]     = useState({})

  // Derive metadata columns from PCA scores (same source as CountsPlot)
  const metaCols = useMemo(() => {
    if (!pca?.scores?.length) return []
    return Object.keys(pca.scores[0]).filter(k => k !== 'sample' && !/^PC\d+$/.test(k))
  }, [pca])

  // If 'group' isn't a real column, fall back to the first available column
  useEffect(() => {
    if (!metaCols.length) return
    if (!metaCols.includes(colorBy)) setColorBy(metaCols[0])
  }, [metaCols])

  // Reset annotation colors when the column changes
  useEffect(() => { setAnnGroups([]); setAnnColors({}) }, [colorBy])

  // Resize observer
  useEffect(() => {
    if (!outerRef.current || !plotRef.current) return
    const ro = new ResizeObserver(() => {
      if (plotRef.current?._fullLayout) Plotly.Plots.resize(plotRef.current)
    })
    ro.observe(outerRef.current)
    return () => ro.disconnect()
  }, [])

  // Active contrast labels sent to backend
  const activeLabels = useMemo(
    () => (contrasts || []).map(c => c.label ?? `${c.treatment}|${c.reference}`),
    [contrasts]
  )


  async function generate() {
    setLoading(true); setError(null); setHasPlot(false)
    try {
      const data = await apiFetch('/api/heatmap', {
        sessionId: session.sessionId,
        fdr, minLfc, topN, mode,
        clusterRows, clusterCols,
        distMethod,
        colorBy: colorBy || '',
        geneSet,
        activeLabels,
        palette,
        annColors: Object.keys(annColors).length ? annColors : null,
      })

      const fig = JSON.parse(data.plotlyJson)
      const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-2').trim() || '#475569'
      const hlabel = { bgcolor: '#1e293b', bordercolor: '#334155', font: { color: '#e2e8f0', size: 12 } }
      // Apply hoverlabel per-trace so it cannot be overridden by heatmaply trace defaults
      fig.data = fig.data.map(trace => ({ ...trace, hoverlabel: hlabel }))
      fig.layout = {
        ...fig.layout,
        paper_bgcolor: 'transparent',
        plot_bgcolor:  'transparent',
        font: { ...(fig.layout?.font || {}), color: textColor },
        hoverlabel: hlabel,
      }
      applySymbolsToFig(fig, annMap)
      applySampleLabelsToFig(fig, sampleLabels)

      await Plotly.react(plotRef.current, fig.data, fig.layout, {
        responsive: true, displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      })
      setHasPlot(true)
      // Populate annotation color pickers from backend response
      if (data.annGroups?.length) {
        const defaults = ['#800020', '#228B22', '#C9A227', '#555555', '#4E6E8E', '#A0522D', '#BF5700', '#4B0082']
        setAnnGroups(data.annGroups)
        setAnnColors(prev => {
          const next = { ...prev }
          data.annGroups.forEach((g, i) => { if (!next[g]) next[g] = defaults[i % defaults.length] })
          return next
        })
      }
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  // Compact toggle switch component
  const Switch = ({ val, set, label }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}>
      <div onClick={() => set(v => !v)}
           style={{
             width: 34, height: 18, borderRadius: 9, position: 'relative', cursor: 'pointer',
             background: val ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
             border: `1px solid ${val ? 'var(--accent)' : 'var(--border)'}`,
             transition: 'background 0.2s, border-color 0.2s',
             flexShrink: 0,
           }}>
        <div style={{
          position: 'absolute', top: 1, left: val ? 15 : 1,
          width: 14, height: 14, borderRadius: '50%',
          background: val ? '#fff' : 'rgba(255,255,255,0.5)',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>
      <span style={{ fontSize: '0.78rem', color: val ? 'var(--text-1)' : 'var(--text-3)', fontWeight: val ? 500 : 400 }}>
        {label}
      </span>
    </label>
  )

  const ControlGroup = ({ label, children }) => (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '8px 12px', borderRadius: 8,
      background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
      minWidth: 0,
    }}>
      <span style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.06em',
                     color: 'var(--text-3)', textTransform: 'uppercase' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>{children}</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Control bar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'start' }}>

        {/* Cutoffs */}
        <ControlGroup label="Cutoffs">
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: 'var(--text-2)' }}>
            FDR
            <input type="number" value={fdr} min={0.001} max={0.5} step={0.01}
                   onChange={e => setFdr(Number(e.target.value))}
                   style={{ width: 58, fontSize: '0.78rem', padding: '2px 6px' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: 'var(--text-2)' }}>
            |FC| ≥
            <input type="number" value={minLfc} min={0} max={10} step={0.1}
                   onChange={e => setMinLfc(Number(e.target.value))}
                   style={{ width: 52, fontSize: '0.78rem', padding: '2px 6px' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: 'var(--text-2)' }}>
            Top N
            <input type="number" value={topN} min={5} max={500} step={5}
                   onChange={e => setTopN(Number(e.target.value))}
                   style={{ width: 58, fontSize: '0.78rem', padding: '2px 6px' }} />
          </label>
          <select value={geneSet} onChange={e => setGeneSet(e.target.value)}
                  style={{ fontSize: '0.78rem', padding: '3px 8px', minWidth: 150 }}>
            <option value="union">All contrasts (union)</option>
            <option value="intersection">All contrasts (intersect)</option>
            {contrasts.map((c, i) => (
              <option key={i} value={c.label ?? c.treatment ?? `Contrast ${i+1}`}>
                {c.label ?? c.treatment ?? `Contrast ${i+1}`} only
              </option>
            ))}
          </select>
        </ControlGroup>

        {/* Annotation */}
        {metaCols.length > 0 && (
          <ControlGroup label="Annotation">
            <select value={colorBy} onChange={e => setColorBy(e.target.value)}
                    style={{ fontSize: '0.78rem', padding: '3px 8px', minWidth: 120 }}>
              {metaCols.map(col => <option key={col} value={col}>{col}</option>)}
            </select>
            {loading && <span style={{ fontSize: '0.7rem', color: 'var(--text-3)', animation: 'pulse 1s infinite' }}>updating…</span>}
            {annGroups.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
                {annGroups.map((grp, i) => (
                  <label key={grp} title={`Click to change color for "${grp}"`}
                         style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input type="color" value={annColors[grp] || '#999999'}
                           onChange={e => setAnnColors(prev => ({ ...prev, [grp]: e.target.value }))}
                           style={{ width: 18, height: 18, padding: 0, border: '1px solid var(--border)',
                                    borderRadius: 3, cursor: 'pointer', background: 'none' }} />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-2)',
                                   maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {grp}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </ControlGroup>
        )}

        {/* Clustering */}
        <ControlGroup label="Clustering">
          <Switch val={clusterRows} set={setClusterRows} label="Rows" />
          <Switch val={clusterCols} set={setClusterCols} label="Columns" />
          {(clusterRows || clusterCols) && (
            <select value={distMethod} onChange={e => setDistMethod(e.target.value)}
                    style={{ fontSize: '0.78rem', padding: '3px 8px', minWidth: 110 }}>
              {DIST_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </ControlGroup>

        {/* Palette — spans both columns */}
        <div style={{ gridColumn: '1 / -1' }}>
          <ControlGroup label="Palette">
            <PaletteRow palette={palette} setPalette={setPalette} />
          </ControlGroup>
        </div>

        {/* Generate — spans both columns, aligned right */}
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn-primary" onClick={generate} disabled={loading}
                  style={{ whiteSpace: 'nowrap' }}>
            {loading ? '⏳ Generating…' : '▶ Generate Heatmap'}
          </button>
        </div>
      </div>

      {error && <ErrorBox msg={error} />}

      {hasPlot && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => promptDownload('heatmap.png', name =>
              Plotly.downloadImage(plotRef.current, { format: 'png', filename: name.replace(/\.png$/i,''), width: 1600, height: 1200, scale: 2 })
            )}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem',
              background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
              color: 'var(--text-2)', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.12)'; e.currentTarget.style.color = 'var(--accent)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'var(--text-2)' }}>
            ↓ Export PNG
          </button>
        </div>
      )}
      {dlDialog}

      <div ref={outerRef} className="resizable-plot"
           style={{ width: '100%', height: 800, display: hasPlot ? 'block' : 'none' }}>
        <div ref={plotRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {!hasPlot && !loading && !error && <Placeholder text='Configure parameters and click "Generate Heatmap" to visualize top DEG expression.' />}
    </div>
  )
}

// Safely unwrap a value that might be a named R object { "key": val } or a plain scalar
function scalarVal(v) {
  if (v == null) return null
  if (typeof v === 'number' || typeof v === 'string') return v
  if (typeof v === 'object') {
    const vals = Object.values(v)
    return vals.length > 0 ? vals[0] : null
  }
  return v
}

// ── Gene Explorer modal (draggable + resizable) ───────────────────────────────
function GeneExplorerModal({ imgSrc, selected, annMap, groupSummary, contrastStats, onClose }) {
  const cardRef  = useRef(null)
  const [size, setSize] = useState({ width: 1060, height: 720 })
  const [pos,  setPos]  = useState(null) // null until centred on first render

  // Centre on mount
  useEffect(() => {
    setPos({
      x: Math.max(0, Math.round((window.innerWidth  - 1060) / 2)),
      y: Math.max(0, Math.round((window.innerHeight - 720)  / 2)),
    })
  }, [])

  // Drag — header is the handle
  function onDragStart(e) {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX - (pos?.x ?? 0)
    const startY = e.clientY - (pos?.y ?? 0)
    function onMove(e) {
      setPos({
        x: Math.max(0, Math.min(window.innerWidth  - size.width,  e.clientX - startX)),
        y: Math.max(0, Math.min(window.innerHeight - 60,           e.clientY - startY)),
      })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
  }

  // Resize — bottom-right corner handle
  function onResizeStart(e) {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX, startY = e.clientY
    const startW = cardRef.current?.offsetWidth  ?? size.width
    const startH = cardRef.current?.offsetHeight ?? size.height
    function onMove(e) {
      setSize({
        width:  Math.max(560, Math.min(startW + e.clientX - startX, Math.floor(window.innerWidth  * 0.97))),
        height: Math.max(400, Math.min(startH + e.clientY - startY, Math.floor(window.innerHeight * 0.97))),
      })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
      window.addEventListener('click', e => e.stopPropagation(), { capture: true, once: true })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
  }

  if (!pos) return null

  const sym = annMap?.[selected]
  const displayName = (typeof sym === 'string' && sym !== 'N/A' && sym !== 'None')
    ? `${sym} · ${selected}` : selected

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 101000, pointerEvents: 'none' }}>
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)',
                    backdropFilter: 'blur(4px)', pointerEvents: 'auto' }}
           onClick={onClose} />

      {/* Modal card */}
      <div ref={cardRef}
           style={{ position: 'absolute', left: pos.x, top: pos.y,
                    width: size.width, height: size.height,
                    background: 'var(--bg-panel)', borderRadius: 16,
                    border: '1px solid var(--border)',
                    boxShadow: '0 8px 60px rgba(0,0,0,0.45)',
                    display: 'flex', flexDirection: 'column',
                    pointerEvents: 'auto', overflow: 'hidden', boxSizing: 'border-box' }}
           onClick={e => e.stopPropagation()}>

        {/* Header — drag handle */}
        <div onMouseDown={onDragStart}
             style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 16px', cursor: 'grab', flexShrink: 0, userSelect: 'none',
                      borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-1)',
                         overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName}
            <span style={{ fontWeight: 400, color: 'var(--text-3)', marginLeft: 8, fontSize: '0.72rem' }}>
              normalized expression · drag to move · corner to resize
            </span>
          </span>
          <button onClick={onClose}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                           color: 'var(--text-3)', fontSize: '1.3rem', lineHeight: 1, flexShrink: 0 }}>
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'auto', padding: '12px 20px 20px' }}>
          {/* Tables side-by-side — top */}
          {(groupSummary?.length > 0 || contrastStats?.length > 0) && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 16 }}>
              {groupSummary?.length > 0 && (
                <div style={{ flex: '1 1 240px', minWidth: 200 }}>
                  <p style={{ margin: '0 0 5px', fontSize: '0.68rem', fontWeight: 700,
                              color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Normalized Counts Summary
                  </p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem',
                                  border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
                    <thead>
                      <tr style={{ background: 'rgba(var(--accent-rgb),0.06)' }}>
                        {['Group', 'n', 'Mean', 'Median', 'SD'].map(h => (
                          <th key={h} style={{ padding: '4px 8px', textAlign: h === 'Group' ? 'left' : 'right',
                                               fontWeight: 600, fontSize: '0.66rem', color: 'var(--text-3)',
                                               borderBottom: '1px solid var(--border)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groupSummary.map((row, i) => (
                        <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                          <td style={{ padding: '4px 8px', fontWeight: 600, color: 'var(--accent-text)' }}>{row.group}</td>
                          {[row.n, row.mean, row.median, row.sd].map((v, j) => (
                            <td key={j} style={{ padding: '4px 8px', textAlign: 'right',
                                                 fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-1)' }}>
                              {v != null ? v : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {contrastStats?.length > 0 && (
                <div style={{ flex: '2 1 380px', minWidth: 300 }}>
                  <p style={{ margin: '0 0 5px', fontSize: '0.68rem', fontWeight: 700,
                              color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    DESeq2 Results
                  </p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem',
                                  border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
                    <thead>
                      <tr style={{ background: 'rgba(var(--accent-rgb),0.06)' }}>
                        {['Contrast', 'baseMean', 'log₂FC', 'lfcSE', 'p-value', 'padj'].map(h => (
                          <th key={h} style={{ padding: '4px 8px', textAlign: h === 'Contrast' ? 'left' : 'right',
                                               fontWeight: 600, fontSize: '0.66rem', color: 'var(--text-3)',
                                               borderBottom: '1px solid var(--border)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {contrastStats.map((ct, i) => (
                        <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                          <td style={{ padding: '4px 8px', fontWeight: 600, color: 'var(--accent-text)',
                                       fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{ct.contrast}</td>
                          {(() => {
                            const bm   = scalarVal(ct.baseMean)
                            const lfc  = scalarVal(ct.log2FC)
                            const se   = scalarVal(ct.lfcSE)
                            const pv   = scalarVal(ct.pvalue)
                            const padj = scalarVal(ct.padj)
                            return [
                              bm   != null ? Number(bm).toLocaleString() : '—',
                              lfc  != null ? lfc  : '—',
                              se   != null ? se   : '—',
                              pv   != null ? pv   : '—',
                              padj != null ? padj : '—',
                            ].map((val, j) => (
                              <td key={j} style={{
                                padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.72rem',
                                color: j === 4 && padj != null ? (Number(padj) < 0.05 ? '#4ade80' : '#f87171') : 'var(--text-1)',
                                fontWeight: j === 4 ? 600 : 400,
                              }}>{String(val)}</td>
                            ))
                          })()}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Image — bottom */}
          <div style={{ display: 'block', width: '100%' }}>
            <img src={imgSrc} alt={`${selected} expression`}
                 style={{ width: '100%', maxHeight: Math.max(200, size.height - 220),
                          objectFit: 'contain', objectPosition: 'left',
                          display: 'block', borderRadius: 8 }} />
          </div>
        </div>

        {/* Resize handle — bottom-right corner */}
        <div onMouseDown={onResizeStart}
             style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18,
                      cursor: 'se-resize', zIndex: 1,
                      background: 'linear-gradient(135deg, transparent 50%, var(--border) 50%)',
                      borderBottomRightRadius: 16 }} />
      </div>
    </div>
  )
}

// ── Gene Explorer (multi-group violin) ────────────────────────────────────────
function GeneExplorer({ session, contrasts, annMap }) {
  const [query, setQuery]             = useState('')
  const [selected, setSelected]       = useState(null)
  const [imgSrc, setImgSrc]           = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [groupSummary, setGroupSummary]   = useState(null)
  const [contrastStats, setContrastStats] = useState(null)
  const [fullscreen, setFullscreen]   = useState(false)

  // Escape key closes fullscreen
  useEffect(() => {
    if (!fullscreen) return
    const h = e => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [fullscreen])

  // Build sorted gene list with optional symbol lookup
  const genes = useMemo(() => {
    const geneSet = new Set()
    contrasts.forEach(c => (c.results || []).forEach(r => { if (r.gene) geneSet.add(r.gene) }))
    return [...geneSet].sort()
  }, [contrasts])

  const filtered = useMemo(() => {
    if (!query) return genes.slice(0, 150)
    const lq = query.toLowerCase()
    return genes.filter(g => {
      if (g.toLowerCase().includes(lq)) return true
      const sym = annMap?.[g]
      return sym && sym.toLowerCase().includes(lq)
    }).slice(0, 150)
  }, [genes, query, annMap])

  async function plot(gene) {
    const _s = annMap?.[gene]
    const symbol = (typeof _s === 'string' && _s !== 'N/A' && _s !== 'None') ? _s : null
    setSelected(gene); setLoading(true); setError(null); setImgSrc(null)
    setGroupSummary(null); setContrastStats(null)
    try {
      const data = await apiFetch('/api/geneplot/compare', { sessionId: session.sessionId, gene, symbol })
      setImgSrc(`data:image/png;base64,${data.image}`)
      if (data.groupSummary)  setGroupSummary(data.groupSummary)
      if (data.contrastStats) setContrastStats(data.contrastStats)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      {/* Gene list */}
      <div style={{ width: 230, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input value={query} onChange={e => setQuery(e.target.value)}
               placeholder="Search gene or symbol…" style={{ fontSize: '0.8rem' }} />
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', maxHeight: 520 }}>
          {filtered.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-3)', fontSize: '0.78rem' }}>No genes found</div>
          )}
          {filtered.map(g => {
            const _sym = annMap?.[g]
            const sym = (typeof _sym === 'string' && _sym !== 'N/A' && _sym !== 'None') ? _sym : null
            const isSelected = g === selected
            return (
              <button key={g} onClick={() => plot(g)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '5px 10px',
                        background: isSelected ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                        color: isSelected ? 'var(--accent-text)' : 'var(--text-2)',
                        border: 'none', borderBottom: '1px solid var(--border)',
                        cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1,
                      }}>
                {sym && (
                  <span style={{ fontSize: '0.78rem', fontWeight: isSelected ? 600 : 500 }}>{sym}</span>
                )}
                <span style={{ fontSize: '0.68rem', fontFamily: 'monospace',
                               color: isSelected ? 'var(--accent-text)' : 'var(--text-3)', lineHeight: 1.3 }}>
                  {g}
                </span>
              </button>
            )
          })}
        </div>
        {genes.length > 150 && (
          <span style={{ fontSize: '0.68rem', color: 'var(--text-3)', textAlign: 'center' }}>
            {genes.length.toLocaleString()} genes — type to filter
          </span>
        )}
      </div>

      {/* Plot area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {loading && <Placeholder text="Generating violin plot…" />}
        {error && <ErrorBox msg={error} />}
        {!selected && !loading && (
          <Placeholder text="Select a gene to plot its normalized expression across all groups." />
        )}

        {/* Per-group normalized count summary — top */}
        {groupSummary && groupSummary.length > 0 && (
          <div>
            <p style={{ margin: '0 0 5px', fontSize: '0.72rem', fontWeight: 600,
                        color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Normalized Counts Summary
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem',
                            border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: 'rgba(var(--accent-rgb),0.06)', color: 'var(--text-3)' }}>
                  {['Group', 'n', 'Mean', 'Median', 'SD'].map(h => (
                    <th key={h} style={{ padding: '5px 10px', textAlign: h === 'Group' ? 'left' : 'right',
                                         fontWeight: 600, fontSize: '0.7rem', borderBottom: '1px solid var(--border)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupSummary.map((row, i) => (
                  <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                    <td style={{ padding: '5px 10px', fontWeight: 600, color: 'var(--accent-text)' }}>{row.group}</td>
                    {[row.n, row.mean, row.median, row.sd].map((v, j) => (
                      <td key={j} style={{ padding: '5px 10px', textAlign: 'right',
                                           color: 'var(--text-1)', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {v != null ? v : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Per-contrast DESeq2 stats — top */}
        {contrastStats && contrastStats.length > 0 && (
          <div>
            <p style={{ margin: '0 0 5px', fontSize: '0.72rem', fontWeight: 600,
                        color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              DESeq2 Results
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem',
                            border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: 'rgba(var(--accent-rgb),0.06)', color: 'var(--text-3)' }}>
                  {['Contrast', 'baseMean', 'log₂FC', 'lfcSE', 'p-value', 'padj'].map(h => (
                    <th key={h} style={{ padding: '5px 10px', textAlign: h === 'Contrast' ? 'left' : 'right',
                                         fontWeight: 600, fontSize: '0.7rem', borderBottom: '1px solid var(--border)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contrastStats.map((ct, i) => (
                  <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                    <td style={{ padding: '5px 10px', fontWeight: 600, color: 'var(--accent-text)',
                                 fontSize: '0.72rem' }}>{ct.contrast}</td>
                    {(() => {
                      const bm    = scalarVal(ct.baseMean)
                      const lfc   = scalarVal(ct.log2FC)
                      const se    = scalarVal(ct.lfcSE)
                      const pv    = scalarVal(ct.pvalue)
                      const padj  = scalarVal(ct.padj)
                      return [
                        bm   != null ? Number(bm).toLocaleString() : '—',
                        lfc  != null ? lfc  : '—',
                        se   != null ? se   : '—',
                        pv   != null ? pv   : '—',
                        padj != null ? padj : '—',
                      ].map((val, j) => (
                        <td key={j} style={{
                          padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.75rem',
                          color: j === 4 && padj != null
                            ? (Number(padj) < 0.05 ? '#4ade80' : '#f87171')
                            : 'var(--text-1)',
                          fontWeight: j === 4 ? 600 : 400,
                        }}>
                          {String(val)}
                        </td>
                      ))
                    })()}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Plot — bottom */}
        {imgSrc && !loading && (
          <div style={{ position: 'relative', display: 'block', width: '100%' }}>
            <img src={imgSrc} alt={`${selected} expression`}
                 style={{ width: '100%', maxHeight: 520, objectFit: 'contain', objectPosition: 'left',
                          display: 'block', borderRadius: 10, border: '1px solid var(--border)' }} />
            <button onClick={() => setFullscreen(true)}
                    title="Expand (Esc to close)"
                    style={{ position: 'absolute', top: 8, right: 8,
                             fontSize: '0.68rem', padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                             background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
                             color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.18)',
                             fontWeight: 600, letterSpacing: '0.03em' }}>
              ⤢ Expand
            </button>
          </div>
        )}
      </div>

      {/* Draggable + resizable modal */}
      {fullscreen && imgSrc && createPortal(
        <GeneExplorerModal
          imgSrc={imgSrc}
          selected={selected}
          annMap={annMap}
          groupSummary={groupSummary}
          contrastStats={contrastStats}
          onClose={() => setFullscreen(false)}
        />,
        document.body
      )}
    </div>
  )
}

// ── Table Explorer (pivot: gene rows × contrast-grouped stat columns) ─────────
const STAT_COLS = [
  { key: 'log2FC',  label: 'log₂FC'  },
  { key: 'pvalue',  label: 'pvalue'  },
  { key: 'padj',    label: 'padj'    },
]

const PAGE_SIZES = [25, 50, 100, 200]

function TableExplorer({ contrasts, annMap, annDetails }) {
  const { promptDownload, dialog } = useDownloadDialog()
  const [search,        setSearch]        = useState('')
  const [fdrCut,        setFdrCut]        = useState(1)
  const [sortContrast,  setSortContrast]  = useState(null)
  const [sortStat,      setSortStat]      = useState('padj')
  const [sortDir,       setSortDir]       = useState(1)      // 1 asc, -1 desc
  const [page,          setPage]          = useState(1)
  const [showAnnGroup,  setShowAnnGroup]  = useState(false)
  const [pinnedExpr,    setPinnedExpr]    = useState(false)  // pin expression block to frozen pane
  const [fullscreen,    setFullscreen]    = useState(false)
  const { show: showTip, move: moveTip, hide: hideTip, node: tipNode } = useTooltip()

  // Exit fullscreen on Escape
  useEffect(() => {
    if (!fullscreen) return
    const handler = e => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fullscreen])
  const [pageSize,      setPageSize]      = useState(50)
  const [showAdvanced,  setShowAdvanced]  = useState(false)
  const [minBaseMean,    setMinBaseMean]    = useState('')
  const [minAbsLFC,      setMinAbsLFC]      = useState('')
  const [direction,      setDirection]      = useState('any') // 'any' | 'up' | 'down'
  const [filterContrast, setFilterContrast] = useState(null)  // null = follow sort contrast
  const hasDetails = !!annDetails

  // Single-pass scan of annDetails to determine which optional columns are available.
  // Wrapped in useMemo so it only re-runs when annDetails changes, not on every render.
  const { hasCoords, hasDesc, hasBiotype, hasOrthologs, hasLocus, hasHumanGeneId } = useMemo(() => {
    if (!annDetails) return { hasCoords: false, hasDesc: false, hasBiotype: false, hasOrthologs: false, hasLocus: false, hasHumanGeneId: false }
    let hasCoords = false, hasDesc = false, hasBiotype = false, hasOrthologs = false, hasLocus = false, hasHumanGeneId = false
    for (const d of Object.values(annDetails)) {
      if (d?.chr)           hasCoords      = true
      if (d?.description)   hasDesc        = true
      if (d?.biotype)       hasBiotype     = true
      if (d?.humanOrtholog) hasOrthologs   = true
      if (d?.locus)         hasLocus       = true
      if (d?.humanGeneId)   hasHumanGeneId = true
      if (hasCoords && hasDesc && hasBiotype && hasOrthologs && hasLocus && hasHumanGeneId) break
    }
    return { hasCoords, hasDesc, hasBiotype, hasOrthologs, hasLocus, hasHumanGeneId }
  }, [annDetails])

  // Annotation columns are all gated behind the Expand toggle
  const hasAnnGroup = hasCoords || hasLocus || hasDesc || hasBiotype || hasOrthologs || hasHumanGeneId
  const visCoords   = hasCoords      && showAnnGroup
  const visLocus    = hasLocus       && showAnnGroup
  const visDesc     = hasDesc        && showAnnGroup
  const visBiotype  = hasBiotype     && showAnnGroup
  const visOrtho    = hasOrthologs   && showAnnGroup
  const visHGid     = hasHumanGeneId && showAnnGroup

  const contrastLabels = useMemo(() =>
    contrasts.map(c => c.label ?? c.treatment ?? 'Contrast'), [contrasts])

  // Unique group names across all contrasts — deduplicated, preserving order
  const uniqueGroups = useMemo(() => {
    const seen = new Set()
    const groups = []
    contrasts.forEach(ct => {
      const lbl = ct.label ?? ct.treatment ?? 'Contrast'
      const trt = ct.treatment ?? 'trt'
      const ref = ct.reference ?? 'ref'
      if (!seen.has(trt)) { seen.add(trt); groups.push({ name: trt, contrastLabel: lbl, which: 'meanTreatment' }) }
      if (!seen.has(ref)) { seen.add(ref); groups.push({ name: ref, contrastLabel: lbl, which: 'meanReference' }) }
    })
    return groups
  }, [contrasts])

  // Build pivot: one row per gene
  const pivotRows = useMemo(() => {
    // Guard: coerce a value to a plain string; returns '' for objects/null/undefined
    const toStr = v => (v == null || typeof v === 'object') ? '' : String(v)

    const map = {}
    contrasts.forEach(c => {
      const lbl = c.label ?? c.treatment ?? 'Contrast'
      ;(c.results || []).forEach(r => {
        if (!r.gene) return
        if (!map[r.gene]) {
          const sym = annMap?.[r.gene]
          const det = annDetails?.[r.gene]
          const symStr = toStr(sym)
          map[r.gene] = {
            gene:          r.gene,
            symbol:        symStr && symStr !== 'N/A' && symStr !== 'None' ? symStr : '',
            description:   toStr(det?.description),
            chr:           toStr(det?.chr),
            start:         det?.start ?? null,
            end:           det?.end   ?? null,
            biotype:       toStr(det?.biotype),
            locus:         toStr(det?.locus),
            humanGeneId:   toStr(det?.humanGeneId),
            humanOrtholog: toStr(det?.humanOrtholog),
            baseMean:      r.baseMean ?? null,
            contrasts:     {},
          }
        }
        map[r.gene].contrasts[lbl] = {
          baseMean: r.baseMean, log2FC: r.log2FC,
          lfcSE: r.lfcSE, pvalue: r.pvalue, padj: r.padj,
          meanTreatment: r.meanTreatment ?? null,
          meanReference: r.meanReference ?? null,
        }
      })
    })
    return Object.values(map)
  }, [contrasts, annMap, annDetails])

  // Filter
  const filtered = useMemo(() => {
    const lq          = search.toLowerCase()
    const filterLabel = filterContrast ?? sortContrast ?? contrastLabels[0]
    const bmMin       = minBaseMean !== '' ? Number(minBaseMean) : null
    const lfcMin      = minAbsLFC   !== '' ? Number(minAbsLFC)   : null

    return pivotRows.filter(r => {
      // Text search
      if (lq && !r.gene.toLowerCase().includes(lq) && !r.symbol.toLowerCase().includes(lq)) return false

      // FDR: any contrast
      if (fdrCut < 1) {
        const anySig = contrastLabels.some(l => {
          const p = r.contrasts[l]?.padj
          return p != null && p <= fdrCut
        })
        if (!anySig) return false
      }

      // Advanced filters applied to the active sort contrast
      const s = r.contrasts[filterLabel]
      if (bmMin  != null && (s?.baseMean == null || s.baseMean < bmMin))           return false
      if (lfcMin != null && (s?.log2FC   == null || Math.abs(s.log2FC) < lfcMin)) return false
      if (direction === 'up'   && (s?.log2FC == null || s.log2FC <= 0)) return false
      if (direction === 'down' && (s?.log2FC == null || s.log2FC >= 0)) return false

      return true
    })
  }, [pivotRows, search, fdrCut, contrastLabels, sortContrast, filterContrast, minBaseMean, minAbsLFC, direction])

  // Sort
  const sorted = useMemo(() => {
    const label = sortContrast ?? contrastLabels[0]
    return [...filtered].sort((a, b) => {
      const av = a.contrasts[label]?.[sortStat]
      const bv = b.contrasts[label]?.[sortStat]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return sortDir * (av - bv)
    })
  }, [filtered, sortContrast, sortStat, sortDir, contrastLabels])

  // Reset to page 1 whenever filters or sort change
  useEffect(() => { setPage(1) }, [search, fdrCut, sortContrast, sortStat, sortDir, filterContrast, minBaseMean, minAbsLFC, direction])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  function toggleSort(cLabel, stat) {
    if (sortContrast === cLabel && sortStat === stat) setSortDir(d => -d)
    else { setSortContrast(cLabel); setSortStat(stat); setSortDir(1) }
  }

  function downloadCSV() {
    const geneHdr = [
      'gene_id', 'symbol',
      ...(hasCoords      ? ['chr', 'start', 'end']  : []),
      ...(hasLocus       ? ['locus']               : []),
      ...(hasDesc        ? ['description']         : []),
      ...(hasBiotype     ? ['biotype']             : []),
      ...(hasOrthologs   ? ['human_ortholog']      : []),
      ...(hasHumanGeneId ? ['human_gene_id']       : []),
    ]
    const FULL_STAT_KEYS = ['baseMean', 'meanTreatment', 'meanReference', 'log2FC', 'pvalue', 'padj']
    const statHdrs = contrasts.flatMap(ct => {
      const l = ct.label ?? ct.treatment ?? 'Contrast'
      return FULL_STAT_KEYS.map(k => {
        if (k === 'meanTreatment') return `${l}__mean_${ct.treatment ?? 'trt'}`
        if (k === 'meanReference') return `${l}__mean_${ct.reference ?? 'ref'}`
        return `${l}__${k}`
      })
    })
    const hdr      = [...geneHdr, ...statHdrs].join(',')
    const body     = sorted.map(r => {
      const gene = [
        r.gene, r.symbol,
        ...(hasCoords      ? [r.chr ?? '', r.start ?? '', r.end ?? '']         : []),
        ...(hasLocus       ? [r.locus ?? '']                                  : []),
        ...(hasDesc        ? [`"${(r.description || '').replace(/"/g,'""')}"` ] : []),
        ...(hasBiotype     ? [r.biotype ?? '']                                : []),
        ...(hasOrthologs   ? [r.humanOrtholog ?? '']                          : []),
        ...(hasHumanGeneId ? [r.humanGeneId ?? '']                            : []),
      ]
      const stats = contrasts.flatMap(ct => {
        const l = ct.label ?? ct.treatment ?? 'Contrast'
        return FULL_STAT_KEYS.map(k => r.contrasts[l]?.[k] ?? '')
      })
      return [...gene, ...stats].join(',')
    }).join('\n')
    const blob = new Blob([hdr + '\n' + body], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const doSave = name => { Object.assign(document.createElement('a'), { href: url, download: name }).click(); URL.revokeObjectURL(url) }
    promptDownload('de_pivot_all_contrasts.csv', doSave)
  }

  function downloadFilteredCSV() {
    const geneHdr = [
      'gene_id', 'symbol',
      ...(hasCoords      ? ['chr', 'start', 'end']  : []),
      ...(hasLocus       ? ['locus']               : []),
      ...(hasDesc        ? ['description']         : []),
      ...(hasBiotype     ? ['biotype']             : []),
      ...(hasOrthologs   ? ['human_ortholog']      : []),
      ...(hasHumanGeneId ? ['human_gene_id']       : []),
    ]
    const FULL_STAT_KEYS = ['baseMean', 'meanTreatment', 'meanReference', 'log2FC', 'pvalue', 'padj']
    const statHdrs = contrasts.flatMap(ct => {
      const l = ct.label ?? ct.treatment ?? 'Contrast'
      return FULL_STAT_KEYS.map(k => {
        if (k === 'meanTreatment') return `${l}__mean_${ct.treatment ?? 'trt'}`
        if (k === 'meanReference') return `${l}__mean_${ct.reference ?? 'ref'}`
        return `${l}__${k}`
      })
    })
    const hdr  = [...geneHdr, ...statHdrs].join(',')
    const body = sorted.map(r => {
      const gene = [
        r.gene, r.symbol,
        ...(hasCoords      ? [r.chr ?? '', r.start ?? '', r.end ?? '']         : []),
        ...(hasLocus       ? [r.locus ?? '']                                  : []),
        ...(hasDesc        ? [`"${(r.description || '').replace(/"/g,'""')}"` ] : []),
        ...(hasBiotype     ? [r.biotype ?? '']                                : []),
        ...(hasOrthologs   ? [r.humanOrtholog ?? '']                          : []),
        ...(hasHumanGeneId ? [r.humanGeneId ?? '']                            : []),
      ]
      const stats = contrasts.flatMap(ct => {
        const l = ct.label ?? ct.treatment ?? 'Contrast'
        return FULL_STAT_KEYS.map(k => r.contrasts[l]?.[k] ?? '')
      })
      return [...gene, ...stats].join(',')
    }).join('\n')
    const blob = new Blob([hdr + '\n' + body], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const doSave = name => { Object.assign(document.createElement('a'), { href: url, download: name }).click(); URL.revokeObjectURL(url) }
    promptDownload(`de_pivot_filtered_${sorted.length}genes.csv`, doSave)
  }

  const fmtN   = (v, d = 3) => {
    if (v == null) return '—'
    const n = typeof v === 'number' ? v : Number(v)
    if (!isFinite(n)) return '—'
    return n.toPrecision(d)
  }
  const fmtP   = (v) => {
    if (v == null) return '—'
    const n = typeof v === 'number' ? v : Number(v)
    if (!isFinite(n)) return '—'
    return n < 0.0001 ? n.toExponential(2) : n.toPrecision(3)
  }
  const fmtLFC = (v) => {
    if (v == null) return '—'
    const n = typeof v === 'number' ? v : Number(v)
    if (!isFinite(n)) return '—'
    return (n > 0 ? '+' : '') + n.toFixed(3)
  }
  const padjColor = (v) => v == null ? 'var(--text-3)' : v < 0.001 ? '#f87171' : v < 0.01 ? '#fb923c' : v < 0.05 ? '#facc15' : 'var(--text-3)'

  // ── Freeze-pane layout constants ──────────────────────────────────────────
  const GRID        = '1px solid var(--border)'
  const FREEZE_BG   = 'var(--bg-panel)'
  const ACCENT      = 'var(--accent)'
  const ACCENT_TEXT = 'var(--accent-text)'

  // Column widths (px) — left offsets computed dynamically below
  const COL_W = { id: 140, sym: 90, chr: 150, locus: 140, desc: 160, biotype: 110, ortho: 130, hgid: 140 }

  // Compute left offsets based on which optional columns are actually present
  const { COL, lastFrozenKey, frozenColCount, tableWidth } = useMemo(() => {
    let off = 0
    const C = {}
    C.id  = { w: COL_W.id,   left: off }; off += COL_W.id
    C.sym = { w: COL_W.sym,  left: off }; off += COL_W.sym
    if (visCoords)  { C.chr     = { w: COL_W.chr,     left: off }; off += COL_W.chr     }
    if (visLocus)   { C.locus   = { w: COL_W.locus,   left: off }; off += COL_W.locus   }
    if (visDesc)    { C.desc    = { w: COL_W.desc,    left: off }; off += COL_W.desc    }
    if (visBiotype) { C.biotype = { w: COL_W.biotype, left: off }; off += COL_W.biotype }
    if (visOrtho)   { C.ortho   = { w: COL_W.ortho,   left: off }; off += COL_W.ortho   }
    if (visHGid)    { C.hgid    = { w: COL_W.hgid,    left: off }; off += COL_W.hgid    }

    // baseMean — once per gene (frozen)
    C.bm = { w: 80, left: off }; off += 80

    // per-contrast group averages — frozen
    uniqueGroups.forEach((g, gi) => {
      C[`avg_${gi}`] = { w: 105, left: off }; off += 105
    })

    const lastKey    = uniqueGroups.length > 0 ? `avg_${uniqueGroups.length - 1}` : 'bm'
    const colCnt     = 2 + (visCoords?1:0) + (visLocus?1:0) + (visDesc?1:0) + (visBiotype?1:0) + (visOrtho?1:0) + (visHGid?1:0) + 1 + uniqueGroups.length
    // Total table width = all frozen cols + scrollable stat cols (80px each)
    const statColPx  = contrasts.length * STAT_COLS.length * 80
    const tableWidth = off + statColPx
    return { COL: C, lastFrozenKey: lastKey, frozenColCount: colCnt, tableWidth }
  }, [visCoords, visLocus, visDesc, visBiotype, visOrtho, visHGid, uniqueGroups, contrasts])

  // Build sticky-left style for a gene column cell
  // zIndex: 20 body / caller overrides to 22 for header cells
  const freeze = (key, bg = FREEZE_BG, extra = {}) => ({
    position: 'sticky', left: COL[key].left,
    width: COL[key].w, minWidth: COL[key].w, maxWidth: COL[key].w,
    overflow: 'hidden', textOverflow: 'ellipsis',
    zIndex: 20, background: bg, ...extra,
  })
  // Expression columns (baseMean + avg group cols) are only sticky when user has pinned them
  const exprFreeze = (key, bg = FREEZE_BG, extra = {}) =>
    pinnedExpr
      ? freeze(key, bg, extra)
      : { width: COL[key]?.w, minWidth: COL[key]?.w, maxWidth: COL[key]?.w,
          overflow: 'hidden', textOverflow: 'ellipsis', ...extra }
  const TH = ({ children, style = {} }) => (
    <th style={{ padding: '5px 8px', whiteSpace: 'nowrap', fontWeight: 500,
                 fontSize: '0.7rem', borderBottom: GRID, borderRight: GRID,
                 background: 'var(--bg-panel)', color: 'var(--text-3)',
                 ...style }}>
      {children}
    </th>
  )

  const _inner = (
    <div style={fullscreen ? {
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'var(--bg-panel)', padding: '16px 20px',
      display: 'flex', flexDirection: 'column', gap: 10,
      overflow: 'hidden',
    } : { display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ── Main controls bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
               placeholder="Search gene ID or symbol…"
               style={{ fontSize: '0.8rem', padding: '4px 10px', width: 210 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: 'var(--text-2)' }}>
          FDR ≤
          <select value={fdrCut} onChange={e => setFdrCut(Number(e.target.value))}
                  style={{ fontSize: '0.78rem', padding: '3px 6px' }}>
            <option value={1}>All genes</option>
            <option value={0.05}>0.05</option>
            <option value={0.01}>0.01</option>
            <option value={0.001}>0.001</option>
          </select>
        </label>
        <button
          onClick={() => setShowAdvanced(v => !v)}
          style={{
            fontSize: '0.75rem', padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
            background: showAdvanced ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
            color: showAdvanced ? 'var(--accent-text)' : 'var(--text-3)',
            border: '1px solid var(--border)',
          }}>
          {showAdvanced ? '▲' : '▼'} Filters
          {(minBaseMean !== '' || minAbsLFC !== '' || direction !== 'any' || filterContrast) && (
            <span style={{ marginLeft: 5, background: 'var(--accent)', color: '#fff',
                           borderRadius: 10, padding: '0 5px', fontSize: '0.65rem' }}>
              {[minBaseMean !== '', minAbsLFC !== '', direction !== 'any', !!filterContrast].filter(Boolean).length}
            </span>
          )}
        </button>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
          {sorted.length.toLocaleString()} genes
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn-ghost" onClick={downloadCSV} style={{ fontSize: '0.78rem' }}
                  title="Download all genes (no filters)">
            ↓ All CSV
          </button>
          <button className="btn-ghost" onClick={downloadFilteredCSV} style={{ fontSize: '0.78rem' }}
                  title={`Download filtered view (${sorted.length.toLocaleString()} genes)`}
                  disabled={sorted.length === 0}>
            ↓ Filtered CSV
          </button>
          <button className="btn-ghost" onClick={() => setFullscreen(v => !v)}
                  title={fullscreen ? 'Exit fullscreen (Esc)' : 'Expand to fullscreen'}
                  style={{ fontSize: '0.82rem', padding: '3px 8px' }}>
            {fullscreen ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      {dialog}

      {/* ── Advanced filters panel ── */}
      {showAdvanced && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
          padding: '10px 14px', borderRadius: 8,
          background: 'rgba(var(--accent-rgb),0.04)', border: '1px solid var(--border)',
          fontSize: '0.78rem', color: 'var(--text-2)',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            baseMean ≥
            <input type="number" min={0} value={minBaseMean}
                   onChange={e => setMinBaseMean(e.target.value)}
                   placeholder="e.g. 10"
                   style={{ width: 80, fontSize: '0.78rem', padding: '2px 6px' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            |log₂FC| ≥
            <input type="number" min={0} step={0.1} value={minAbsLFC}
                   onChange={e => setMinAbsLFC(e.target.value)}
                   placeholder="e.g. 1"
                   style={{ width: 80, fontSize: '0.78rem', padding: '2px 6px' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            Direction
            <select value={direction} onChange={e => setDirection(e.target.value)}
                    style={{ fontSize: '0.78rem', padding: '2px 6px' }}>
              <option value="any">Any</option>
              <option value="up">Up only</option>
              <option value="down">Down only</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            Contrast
            <select value={filterContrast ?? ''} onChange={e => setFilterContrast(e.target.value || null)}
                    style={{ fontSize: '0.78rem', padding: '2px 6px' }}>
              <option value="">Follow sort</option>
              {contrastLabels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          {(minBaseMean !== '' || minAbsLFC !== '' || direction !== 'any' || filterContrast) && (
            <button onClick={() => { setMinBaseMean(''); setMinAbsLFC(''); setDirection('any'); setFilterContrast(null) }}
                    style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 5, cursor: 'pointer',
                             background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)' }}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* Two-level pivot table */}
      <div style={{ overflowX: 'auto', overflowY: 'auto',
                    maxHeight: fullscreen ? 'calc(100vh - 120px)' : 580,
                    flex: fullscreen ? '1 1 0' : undefined,
                    border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.76rem', tableLayout: 'fixed', width: tableWidth, minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: COL.id.w }} />
            <col style={{ width: COL.sym.w }} />
            {visCoords  && <col style={{ width: COL.chr?.w     ?? 150 }} />}
            {visLocus   && <col style={{ width: COL.locus?.w   ?? 140 }} />}
            {visDesc    && <col style={{ width: COL.desc?.w    ?? 160 }} />}
            {visBiotype && <col style={{ width: COL.biotype?.w ?? 110 }} />}
            {visOrtho   && <col style={{ width: COL.ortho?.w   ?? 130 }} />}
            {visHGid    && <col style={{ width: COL.hgid?.w    ?? 140 }} />}
            <col style={{ width: COL.bm?.w ?? 80 }} />
            {uniqueGroups.map((_, gi) => (
              <col key={`avg_${gi}`} style={{ width: COL[`avg_${gi}`]?.w ?? 105 }} />
            ))}
            {contrastLabels.flatMap(lbl => STAT_COLS.map(s => <col key={`${lbl}_${s.key}`} style={{ width: 80 }} />))}
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 22, background: 'var(--bg-panel)' }}>
            {/* Row 1: frozen Gene banner + contrast group headers.
                The tr background fills any gap when contrast headers scroll behind the frozen pane. */}
            <tr style={{ background: 'rgba(var(--accent-rgb),0.06)' }}>
              {/* Gene ID + Symbol (+ annotation cols when expanded) */}
              <th colSpan={2 + (visCoords?1:0)+(visLocus?1:0)+(visDesc?1:0)+(visBiotype?1:0)+(visOrtho?1:0)+(visHGid?1:0)}
                  style={{ ...freeze('id', 'var(--bg-panel)'), zIndex: 22,
                           backgroundImage: 'linear-gradient(rgba(var(--accent-rgb),0.06),rgba(var(--accent-rgb),0.06))',
                           padding: '4px 10px', textAlign: 'left', fontWeight: 600,
                           fontSize: '0.72rem', color: 'var(--text-3)',
                           borderBottom: GRID,
                           ...(!pinnedExpr
                             ? { borderRight: '2px solid var(--border)', boxShadow: '3px 0 6px rgba(0,0,0,0.10)' }
                             : { borderRight: GRID }) }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  Gene
                  {hasAnnGroup && (
                    <button
                      onClick={() => setShowAnnGroup(v => !v)}
                      title={showAnnGroup ? 'Collapse annotation columns' : 'Expand annotation columns'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '2px 7px', borderRadius: 4, cursor: 'pointer',
                        fontSize: '0.68rem', fontWeight: 600,
                        background: showAnnGroup ? 'rgba(var(--accent-rgb),0.1)' : 'rgba(255,255,255,0.06)',
                        color: showAnnGroup ? 'var(--accent-text)' : 'var(--text-3)',
                        border: `1px solid ${showAnnGroup ? 'rgba(var(--accent-rgb),0.3)' : 'var(--border)'}`,
                      }}>
                      {showAnnGroup ? '⊟ Collapse' : '⊞ Expand'}
                    </button>
                  )}
                </span>
              </th>
              {/* Expression banner — covers baseMean + unique group averages */}
              <th colSpan={1 + uniqueGroups.length}
                  style={{
                    ...(pinnedExpr ? { position: 'sticky', left: COL.bm?.left ?? 0, zIndex: 22 } : {}),
                    background: 'var(--bg-panel)',
                    backgroundImage: 'linear-gradient(rgba(var(--accent-rgb),0.06),rgba(var(--accent-rgb),0.06))',
                    padding: '6px 10px', textAlign: 'center', fontWeight: 600,
                    fontSize: '0.72rem', color: 'var(--text-3)',
                    borderBottom: GRID,
                    ...(pinnedExpr
                      ? { borderRight: '2px solid var(--border)', boxShadow: '3px 0 6px rgba(0,0,0,0.10)' }
                      : { borderRight: GRID }),
                  }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  Expression
                  <button
                    onClick={() => setPinnedExpr(v => !v)}
                    title={pinnedExpr ? 'Unpin expression columns' : 'Pin expression columns to frozen pane'}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
                      fontSize: '0.72rem', lineHeight: 1, opacity: pinnedExpr ? 1 : 0.45,
                      color: pinnedExpr ? 'var(--accent-text)' : 'var(--text-3)',
                      transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = pinnedExpr ? '1' : '0.45' }}
                  >📌</button>
                </span>
              </th>
              {contrasts.map((ct, ci) => {
                const lbl = ct.label ?? ct.treatment ?? 'Contrast'
                return (
                  <th key={lbl} colSpan={STAT_COLS.length}
                      style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700,
                               fontSize: '0.72rem', whiteSpace: 'nowrap', color: ACCENT,
                               background: 'rgba(var(--accent-rgb),0.06)',
                               borderBottom: GRID,
                               borderRight: ci < contrasts.length - 1 ? '2px solid var(--border)' : GRID }}>
                    {lbl}
                  </th>
                )
              })}
            </tr>
            {/* Row 2: frozen gene sub-headers + frozen expression sub-headers + sortable stat sub-headers */}
            <tr>
              <TH style={{ ...freeze('id', FREEZE_BG), zIndex: 22, borderRight: GRID }}>Gene ID</TH>
              <TH style={{ ...freeze('sym', FREEZE_BG), zIndex: 22,
                           ...(!pinnedExpr
                             ? { borderRight: '2px solid var(--border)', boxShadow: '3px 0 6px rgba(0,0,0,0.10)' }
                             : { borderRight: GRID }) }}>
                Symbol
              </TH>
              {visCoords  && <TH style={{ ...freeze('chr',     FREEZE_BG), zIndex: 22, borderRight: GRID }}>Chr</TH>}
              {visLocus   && <TH style={{ ...freeze('locus',   FREEZE_BG), zIndex: 22,
                                          ...(visDesc||visBiotype||visOrtho||visHGid ? {borderRight:GRID} : {borderRight:GRID}) }}>Locus</TH>}
              {visDesc    && <TH style={{ ...freeze('desc',    FREEZE_BG), zIndex: 22,
                                          ...(visBiotype||visOrtho||visHGid ? {borderRight:GRID} : {borderRight:GRID}) }}>Description</TH>}
              {visBiotype && <TH style={{ ...freeze('biotype', FREEZE_BG), zIndex: 22, color: '#0369a1',
                                          ...(visOrtho||visHGid ? {borderRight:GRID} : {borderRight:GRID}) }}>Biotype</TH>}
              {visOrtho   && <TH style={{ ...freeze('ortho',   FREEZE_BG), zIndex: 22, color: '#7c3aed',
                                          ...(visHGid ? {borderRight:GRID} : {borderRight:GRID}) }}>Human Ortholog</TH>}
              {visHGid    && <TH style={{ ...freeze('hgid',    FREEZE_BG), zIndex: 22, color: '#7c3aed',
                                          borderRight: GRID }}>Human Gene ID</TH>}
              {/* Expression sub-headers — sticky only when pinned */}
              <TH style={{ ...exprFreeze('bm', FREEZE_BG), zIndex: pinnedExpr ? 22 : 0, borderRight: GRID }}>baseMean</TH>
              {uniqueGroups.map((g, gi) => (
                <TH key={`avg_${gi}`} style={{ ...exprFreeze(`avg_${gi}`, FREEZE_BG), zIndex: pinnedExpr ? 22 : 0,
                  ...(gi === uniqueGroups.length - 1 && pinnedExpr
                    ? { borderRight: '2px solid var(--border)', boxShadow: '3px 0 6px rgba(0,0,0,0.10)' }
                    : { borderRight: GRID }) }}>
                  Avg: {g.name}
                </TH>
              ))}
              {contrasts.map((ct, ci) => {
                const lbl = ct.label ?? ct.treatment ?? 'Contrast'
                return STAT_COLS.map((s, si) => {
                  const active  = sortContrast === lbl && sortStat === s.key
                  const isLast  = si === STAT_COLS.length - 1
                  return (
                    <th key={`${lbl}_${s.key}`}
                        onClick={() => toggleSort(lbl, s.key)}
                        style={{ padding: '4px 8px',
                                 whiteSpace: 'nowrap',
                                 wordBreak: 'break-word', cursor: 'pointer',
                                 fontWeight: active ? 700 : 400, fontSize: '0.68rem',
                                 color: active ? ACCENT_TEXT : 'var(--text-3)',
                                 background: active ? 'rgba(var(--accent-rgb),0.04)' : 'var(--bg-panel)',
                                 borderBottom: GRID,
                                 borderRight: isLast && ci < contrasts.length - 1 ? '2px solid var(--border)' : GRID,
                                 userSelect: 'none' }}>
                      {s.label}{active ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
                    </th>
                  )
                })
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => {
              const gStr   = typeof r.gene === 'string' ? r.gene : String(r.gene ?? '')
              const symStr = typeof r.symbol      === 'string' ? r.symbol      : ''
              const chrStr = typeof r.chr         === 'string' ? r.chr         : ''
              const descStr = typeof r.description === 'string' ? r.description : ''
              const rowBg  = i % 2 === 0 ? 'var(--bg-panel)' : 'rgba(var(--accent-rgb),0.025)'
              const base   = { padding: '4px 8px', textAlign: 'right', fontSize: '0.7rem', whiteSpace: 'nowrap', borderBottom: GRID, borderRight: GRID, position: 'relative', zIndex: 0 }
              return (
              <tr key={gStr || i} className="de-row" style={{ background: rowBg }}>
                {/* ── Frozen gene columns — always opaque background so scrolling content can't bleed through ── */}
                <td className="frozen-cell" style={{ ...freeze('id', FREEZE_BG), padding: '4px 8px', fontFamily: 'monospace',
                             fontSize: '0.7rem', color: 'var(--text-3)', whiteSpace: 'nowrap',
                             borderRight: GRID, borderBottom: GRID }}>
                  {gStr}
                </td>
                <td className="frozen-cell" style={{ ...freeze('sym', FREEZE_BG), padding: '4px 8px',
                             fontWeight: symStr ? 500 : 400,
                             color: symStr ? 'var(--text-1)' : 'var(--text-3)', whiteSpace: 'nowrap',
                             borderBottom: GRID,
                             ...(!pinnedExpr
                               ? { borderRight: '2px solid var(--border)', boxShadow: '3px 0 6px rgba(0,0,0,0.10)' }
                               : { borderRight: GRID }) }}>
                  {symStr || '—'}
                </td>
                {visCoords && (
                  <td className="frozen-cell" style={{ ...freeze('chr', FREEZE_BG), padding: '4px 8px', color: 'var(--text-3)',
                               whiteSpace: 'nowrap', fontSize: '0.68rem', borderRight: GRID, borderBottom: GRID }}>
                    {chrStr
                      ? `${chrStr}:${typeof r.start === 'number' ? r.start.toLocaleString() : '?'}-${typeof r.end === 'number' ? r.end.toLocaleString() : '?'}`
                      : '—'}
                  </td>
                )}
                {visLocus && (
                  <td className="frozen-cell"
                      onMouseEnter={r.locus ? e => showTip(r.locus, e) : undefined}
                      onMouseMove={r.locus ? moveTip : undefined}
                      onMouseLeave={r.locus ? hideTip : undefined}
                      style={{ ...freeze('locus', FREEZE_BG), padding: '4px 8px', color: 'var(--text-3)',
                               whiteSpace: 'nowrap', fontSize: '0.68rem', borderBottom: GRID,
                               cursor: r.locus ? 'default' : undefined, borderRight: GRID }}>
                    {typeof r.locus === 'string' && r.locus ? r.locus : '—'}
                  </td>
                )}
                {visDesc && (
                  <td className="frozen-cell"
                      onMouseEnter={descStr ? e => showTip(descStr, e) : undefined}
                      onMouseMove={descStr ? moveTip : undefined}
                      onMouseLeave={descStr ? hideTip : undefined}
                      style={{ ...freeze('desc', FREEZE_BG), padding: '4px 8px', color: 'var(--text-3)',
                               fontSize: '0.69rem', overflow: 'hidden', textOverflow: 'ellipsis',
                               whiteSpace: 'nowrap', borderBottom: GRID, borderRight: GRID }}>
                    {descStr || '—'}
                  </td>
                )}
                {visBiotype && (
                  <td className="frozen-cell" style={{ ...freeze('biotype', FREEZE_BG), padding: '4px 8px',
                               fontSize: '0.68rem', color: '#0369a1', whiteSpace: 'nowrap',
                               overflow: 'hidden', textOverflow: 'ellipsis', borderBottom: GRID,
                               borderRight: GRID }}>
                    {typeof r.biotype === 'string' && r.biotype ? r.biotype.replace(/_/g, ' ') : '—'}
                  </td>
                )}
                {visOrtho && (
                  <td className="frozen-cell" style={{ ...freeze('ortho', FREEZE_BG), padding: '4px 8px',
                               fontSize: '0.7rem', fontWeight: r.humanOrtholog ? 500 : 400,
                               color: r.humanOrtholog ? '#7c3aed' : 'var(--text-3)',
                               whiteSpace: 'nowrap', borderBottom: GRID, borderRight: GRID }}>
                    {typeof r.humanOrtholog === 'string' && r.humanOrtholog ? r.humanOrtholog : '—'}
                  </td>
                )}
                {visHGid && (
                  <td className="frozen-cell" style={{ ...freeze('hgid', FREEZE_BG), padding: '4px 8px',
                               fontSize: '0.68rem', fontFamily: 'monospace',
                               color: r.humanGeneId ? '#7c3aed' : 'var(--text-3)',
                               whiteSpace: 'nowrap', borderBottom: GRID, borderRight: GRID }}>
                    {typeof r.humanGeneId === 'string' && r.humanGeneId ? r.humanGeneId : '—'}
                  </td>
                )}
                {/* ── Expression columns: baseMean + per-contrast averages — sticky only when pinned ── */}
                <td style={{ ...exprFreeze('bm', FREEZE_BG), padding: '4px 8px',
                    color: 'var(--text-2)', textAlign: 'right', fontSize: '0.7rem',
                    whiteSpace: 'nowrap', borderBottom: GRID, borderRight: GRID }}>
                  {fmtN(r.baseMean, 4)}
                </td>
                {uniqueGroups.map((g, gi) => {
                  const s = r.contrasts[g.contrastLabel]
                  return (
                    <td key={`avg_${gi}`}
                        style={{ ...exprFreeze(`avg_${gi}`, FREEZE_BG), padding: '4px 8px',
                                 color: 'var(--text-2)', textAlign: 'right', fontSize: '0.7rem',
                                 whiteSpace: 'nowrap', borderBottom: GRID,
                                 ...(gi === uniqueGroups.length - 1 && pinnedExpr
                                   ? { borderRight: '2px solid var(--border)', boxShadow: '3px 0 6px rgba(0,0,0,0.10)' }
                                   : { borderRight: GRID }) }}>
                      {fmtN(s?.[g.which], 4)}
                    </td>
                  )
                })}
                {/* ── Contrast stat columns ── */}
                {contrastLabels.map((lbl, ci) => {
                  const s = r.contrasts[lbl]
                  const groupRight = ci < contrastLabels.length - 1
                    ? { borderRight: '2px solid var(--border)' }
                    : { borderRight: GRID }
                  const lfcColor = s?.log2FC > 0 ? '#16a34a' : s?.log2FC < 0 ? '#dc2626' : 'var(--text-2)'
                  return STAT_COLS.map((sc, si) => {
                    const isLast = si === STAT_COLS.length - 1
                    const cellStyle = {
                      ...base,
                      ...(isLast ? groupRight : {}),
                      ...(sc.key === 'log2FC' ? { fontWeight: 500, color: lfcColor } : {}),
                      ...(sc.key === 'padj'   ? { color: padjColor(s?.padj) }        : {}),
                      ...(sc.key === 'pvalue' ? { color: 'var(--text-3)' }           : {}),
                    }
                    const val =
                      sc.key === 'log2FC' ? (s ? fmtLFC(s.log2FC) : '—') :
                      sc.key === 'pvalue' ? fmtP(s?.pvalue)               :
                      sc.key === 'padj'   ? fmtP(s?.padj)                 : '—'
                    return <td key={`${lbl}_${sc.key}`} style={cellStyle}>{val}</td>
                  })
                })}
              </tr>
              )
            })}
          </tbody>
        </table>
        {tipNode}
        {sorted.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: '0.82rem' }}>
            No genes match current filters
          </div>
        )}

        {/* ── Pagination footer ── */}
        {sorted.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            padding: '7px 12px', borderTop: '1px solid var(--border)',
            fontSize: '0.72rem', color: 'var(--text-3)', background: 'var(--bg-panel)',
            position: 'sticky', bottom: 0, zIndex: 25,
          }}>
            {/* Page nav */}
            {[
              { label: '«', to: 1,            disabled: safePage === 1 },
              { label: '‹', to: safePage - 1, disabled: safePage === 1 },
              { label: '›', to: safePage + 1, disabled: safePage === totalPages },
              { label: '»', to: totalPages,   disabled: safePage === totalPages },
            ].map(btn => (
              <button key={btn.label} onClick={() => setPage(btn.to)} disabled={btn.disabled}
                      style={{
                        padding: '2px 7px', borderRadius: 5, cursor: btn.disabled ? 'default' : 'pointer',
                        border: '1px solid var(--border)', fontSize: '0.78rem',
                        background: 'transparent', color: btn.disabled ? 'var(--text-3)' : 'var(--text-2)',
                        opacity: btn.disabled ? 0.4 : 1,
                      }}>
                {btn.label}
              </button>
            ))}
            <span style={{ margin: '0 4px' }}>
              Rows {((safePage - 1) * pageSize + 1).toLocaleString()}–{Math.min(safePage * pageSize, sorted.length).toLocaleString()} of {sorted.length.toLocaleString()}
            </span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
                    style={{ fontSize: '0.72rem', padding: '1px 4px', marginLeft: 4, width: '15%' }}>
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n} / page</option>)}
            </select>
            <span style={{ marginLeft: 'auto' }}>Page {safePage} of {totalPages}</span>
          </div>
        )}
      </div>
    </div>
  )
  return fullscreen ? createPortal(_inner, document.body) : _inner
}

// ── Small helpers ──────────────────────────────────────────────────────────────
function ErrorBox({ msg }) {
  return (
    <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(248,113,113,0.1)',
                  border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: '0.82rem' }}>
      {msg}
    </div>
  )
}

function Placeholder({ text }) {
  return (
    <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>
      {text}
    </div>
  )
}

// ── Main ComparePanel ──────────────────────────────────────────────────────────
const SUB_TABS = [
  { key: 'upset',   label: 'UpSet Plot',     icon: '⊗' },
  { key: 'heatmap', label: 'Heatmap',        icon: '▦' },
  { key: 'genes',   label: 'Gene Explorer',  icon: '♩' },
  { key: 'table',   label: 'Table Explorer', icon: '▤' },
]

// Tabs available for single-contrast view (UpSet needs ≥2)
const SINGLE_TABS = SUB_TABS.filter(t => t.key !== 'upset')

const contrastKey = c => c.label ?? `${c.treatment}|${c.reference}`

export default function ComparePanel({ session, contrasts, annMap, annDetails, pca, sampleLabels = {} }) {
  const [subTab,      setSubTab]     = useState('upset')
  // Set of contrast keys currently included in the view
  const [activeKeys, setActiveKeys] = useState(() => new Set((contrasts || []).map(contrastKey)))

  // When new contrasts arrive (new run), add them to activeKeys automatically
  const prevContrastKeys = useRef(new Set())
  useEffect(() => {
    const incoming = new Set((contrasts || []).map(contrastKey))
    const newOnes  = [...incoming].filter(k => !prevContrastKeys.current.has(k))
    if (newOnes.length > 0) setActiveKeys(prev => new Set([...prev, ...newOnes]))
    prevContrastKeys.current = incoming
  }, [contrasts])

  if (!contrasts || contrasts.length === 0) {
    return <Placeholder text="Run at least one contrast to enable analysis." />
  }

  const activeContrasts = contrasts.filter(c => activeKeys.has(contrastKey(c)))
  const singleActive    = activeContrasts.length === 1
  const activeTabs      = singleActive ? SINGLE_TABS : SUB_TABS
  const effectiveTab    = singleActive && subTab === 'upset' ? 'heatmap' : subTab

  const toggleKey = key =>
    setActiveKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) { if (next.size > 1) next.delete(key) } // keep at least 1
      else next.add(key)
      return next
    })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)' }}>
        {activeTabs.map(t => {
          const active = effectiveTab === t.key
          return (
            <button key={t.key} onClick={() => setSubTab(t.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px', cursor: 'pointer',
                      background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                      color: active ? 'var(--text-1)' : 'var(--text-3)',
                      borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                      fontWeight: active ? 600 : 400,
                      fontSize: '0.82rem', border: 'none',
                      borderRadius: '6px 6px 0 0', whiteSpace: 'nowrap',
                      transition: 'color 0.15s, background 0.15s',
                    }}>
              <span style={{ fontFamily: 'monospace', fontSize: '0.88rem' }}>{t.icon}</span>
              {t.label}
            </button>
          )
        })}
        <span style={{ marginLeft: 'auto', alignSelf: 'center', paddingRight: 4,
                       fontSize: '0.72rem', color: 'var(--text-3)' }}>
          {activeContrasts.length}/{contrasts.length} {contrasts.length === 1 ? 'contrast' : 'contrasts'}
        </span>
      </div>

      {/* Contrast toggle chips — click to include/exclude */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
          Contrasts:
        </span>
        {contrasts.map((c, i) => {
          const key    = contrastKey(c)
          const on     = activeKeys.has(key)
          const isLast = on && activeContrasts.length === 1
          return (
            <button key={i} onClick={() => toggleKey(key)}
                    title={on ? (isLast ? 'At least one contrast required' : 'Click to remove') : 'Click to add'}
                    style={{
                      padding: '2px 10px', borderRadius: 99, fontSize: '0.72rem',
                      cursor: isLast ? 'not-allowed' : 'pointer',
                      background: on ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)',
                      color:      on ? 'var(--accent-text)'    : 'var(--text-3)',
                      border:     on ? '1px solid rgba(99,102,241,0.4)' : '1px dashed var(--border)',
                      opacity:    isLast ? 0.5 : 1,
                      transition: 'all 0.15s',
                    }}>
              {c.label ?? c.treatment ?? `Contrast ${i + 1}`}
              <span style={{ marginLeft: 5, fontSize: '0.65rem', opacity: 0.7 }}>
                {on ? '✕' : '+'}
              </span>
            </button>
          )
        })}
      </div>

      {/* Single-contrast notice */}
      {singleActive && (
        <div style={{ padding: '7px 12px', borderRadius: 8, fontSize: '0.74rem',
                      background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                      color: 'var(--text-3)' }}>
          UpSet Plot requires ≥ 2 active contrasts. Heatmap, Gene Explorer, and Table Explorer are available.
        </div>
      )}

      <div style={{ display: effectiveTab === 'upset'   ? 'block' : 'none' }}><UpSetTab   session={session} contrasts={activeContrasts} /></div>
      <div style={{ display: effectiveTab === 'heatmap' ? 'block' : 'none' }}><HeatmapTab session={session} annMap={annMap} pca={pca} contrasts={activeContrasts} sampleLabels={sampleLabels} /></div>
      <div style={{ display: effectiveTab === 'genes'   ? 'block' : 'none' }}><GeneExplorer session={session} contrasts={activeContrasts} annMap={annMap} /></div>
      <div style={{ display: effectiveTab === 'table'   ? 'block' : 'none' }}><TableExplorer contrasts={activeContrasts} annMap={annMap} annDetails={annDetails} /></div>
    </div>
  )
}
