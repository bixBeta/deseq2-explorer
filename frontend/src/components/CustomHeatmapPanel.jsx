import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Plotly from 'plotly.js-dist-min'
import { useRegisterPlot } from '../context/PlotRegistryContext'
import { useDownloadDialog } from './DownloadDialog'

// ── Helpers (self-contained copies from ComparePanel) ──────────────────────────

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

async function apiFetch(path, body) {
  const res = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

function applySymbolsToFig(fig, annMap) {
  if (!annMap || !fig?.layout) return fig
  const replace = arr => Array.isArray(arr) ? arr.map(v => annMap[v] || v) : arr
  Object.keys(fig.layout).filter(k => /^[xy]axis/.test(k)).forEach(ax => {
    if (fig.layout[ax]?.ticktext) fig.layout[ax].ticktext = replace(fig.layout[ax].ticktext)
  })
  if (fig.data) fig.data.forEach(trace => { if (trace.y) trace.y = replace(trace.y) })
  return fig
}

function applySampleLabelsToFig(fig, sampleLabels) {
  if (!sampleLabels || !Object.keys(sampleLabels).length || !fig) return fig
  const rename = v => typeof v === 'string' ? (sampleLabels[v] ?? v) : v
  if (fig.layout) {
    Object.keys(fig.layout).filter(k => /^xaxis/.test(k)).forEach(ax => {
      if (fig.layout[ax]?.ticktext) fig.layout[ax].ticktext = fig.layout[ax].ticktext.map(rename)
    })
  }
  if (fig.data) fig.data.forEach(trace => { if (trace.x) trace.x = trace.x.map(rename) })
  return fig
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
  const [drafts, setDrafts] = useState(palette)
  const commitTimer = useRef(null)
  useEffect(() => { setDrafts(palette) }, [palette])
  const labels = ['Low', 'Mid', 'High']
  function handleColorChange(i, val) {
    const next = [...drafts]; next[i] = val; setDrafts(next)
    clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => setPalette(next), 600)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {HEATMAP_PRESETS.map(p => {
          const active = JSON.stringify(p.colors) === JSON.stringify(palette)
          return (
            <button key={p.label} onClick={() => { clearTimeout(commitTimer.current); setPalette(p.colors) }}
                    title={p.label}
                    style={{ display: 'flex', padding: 0,
                             border: active ? '2px solid var(--accent)' : '2px solid transparent',
                             borderRadius: 5, cursor: 'pointer', overflow: 'hidden', height: 18 }}>
              {p.colors.map((c, i) => (
                <span key={i} style={{ width: 14, height: 18, background: c, display: 'block' }} />
              ))}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {drafts.map((col, i) => (
          <label key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
            <span style={{ fontSize: '0.62rem', color: 'var(--text-3)', textTransform: 'uppercase' }}>{labels[i]}</span>
            <div style={{ position: 'relative', width: 28, height: 28 }}>
              <span style={{ display: 'block', width: 28, height: 28, borderRadius: 5,
                             background: col, border: '2px solid var(--border)', cursor: 'pointer' }} />
              <input type="color" value={col}
                     onInput={e => handleColorChange(i, e.target.value)}
                     onChange={e => handleColorChange(i, e.target.value)}
                     style={{ position: 'absolute', inset: 0, opacity: 0,
                              width: '100%', height: '100%', cursor: 'pointer' }} />
            </div>
            <input type="text" value={col} maxLength={7}
                   onChange={e => {
                     if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) {
                       const next = [...drafts]; next[i] = e.target.value; setDrafts(next)
                       if (e.target.value.length === 7) { clearTimeout(commitTimer.current); setPalette(next) }
                     }
                   }}
                   style={{ width: 60, fontSize: '0.65rem', padding: '1px 4px', textAlign: 'center',
                            fontFamily: 'monospace', background: 'var(--bg-card2)',
                            border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-1)' }} />
          </label>
        ))}
      </div>
    </div>
  )
}

const DIST_METHODS = ['euclidean', 'pearson', 'spearman', 'kendall', 'manhattan', 'maximum']

// ── Private sub-components ─────────────────────────────────────────────────────

function SidebarSection({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.07em',
                     textTransform: 'uppercase', color: 'var(--text-3)' }}>
        {label}
      </span>
      {children}
    </div>
  )
}

function GeneChip({ id, symbol, onRemove }) {
  const display = typeof symbol === 'string' && symbol && symbol !== 'N/A' && symbol !== 'None'
    ? symbol : id
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 6px', borderRadius: 999,
      background: 'rgba(var(--accent-rgb),0.12)',
      border: '1px solid rgba(var(--accent-rgb),0.25)',
      fontSize: '0.68rem', color: 'var(--text-2)',
      maxWidth: 120,
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={id}>{display}</span>
      <button onClick={() => onRemove(id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                       color: 'var(--text-3)', padding: 0, lineHeight: 1,
                       fontSize: '0.8rem', flexShrink: 0 }}>×</button>
    </span>
  )
}

function PillToggle({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.04)',
                  borderRadius: 6, border: '1px solid var(--border)', padding: '2px 3px' }}>
      {options.map(([val, lbl]) => (
        <button key={val} onClick={() => onChange(val)}
                style={{
                  fontSize: '0.72rem', padding: '2px 10px', borderRadius: 4,
                  border: 'none', cursor: 'pointer',
                  background: value === val ? 'var(--accent)' : 'transparent',
                  color:      value === val ? '#fff'          : 'var(--text-3)',
                  fontWeight: value === val ? 600 : 400,
                  transition: 'background 0.15s, color 0.15s', whiteSpace: 'nowrap',
                }}>
          {lbl}
        </button>
      ))}
    </div>
  )
}

function Switch({ val, set, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}>
      <div onClick={() => set(v => !v)}
           style={{ width: 34, height: 18, borderRadius: 9, position: 'relative', cursor: 'pointer',
                    background: val ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
                    border: `1px solid ${val ? 'var(--accent)' : 'var(--border)'}`,
                    transition: 'background 0.2s, border-color 0.2s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 1, left: val ? 15 : 1, width: 14, height: 14,
                      borderRadius: '50%', background: val ? '#fff' : 'rgba(255,255,255,0.5)',
                      transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
      </div>
      <span style={{ fontSize: '0.78rem', color: val ? 'var(--text-1)' : 'var(--text-3)', fontWeight: val ? 500 : 400 }}>
        {label}
      </span>
    </label>
  )
}

function ControlGroup({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px',
                  background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
                  borderRadius: 8 }}>
      <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.07em',
                     textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 2 }}>
        {label}
      </span>
      {children}
    </div>
  )
}

function ErrorBox({ msg }) {
  return (
    <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: '0.82rem',
                  background: 'rgba(248,113,113,0.08)', color: '#f87171',
                  border: '1px solid rgba(248,113,113,0.25)' }}>
      ⚠ {msg}
    </div>
  )
}

function Placeholder({ text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                  minHeight: 220, color: 'var(--text-3)', fontSize: '0.82rem',
                  fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
      {text}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CustomHeatmapPanel({
  session, contrastList, active, annMap, sampleLabels = {}, pca, design,
}) {
  const { promptDownload, dialog: dlDialog } = useDownloadDialog()
  const outerRef = useRef(null)
  const plotRef  = useRef(null)

  const captureRef     = useRef(null)
  const figDataRef     = useRef(null)   // cache last fig for re-render on expand toggle
  const floatRef       = useRef(null)   // the floating panel DOM node
  const plotWrapperRef = useRef(null)   // outer sizing wrapper (for width resize)

  captureRef.current = () => {
    if (!plotRef.current?._fullLayout) return null
    return Plotly.toImage(plotRef.current, { format: 'png', width: 900, height: 800 })
  }
  useRegisterPlot('custom-heatmap', 'Custom Heatmap', 'Custom Heatmap', captureRef)

  // ── Gene list state ──────────────────────────────────────────────────────────
  const [geneList,       setGeneList]       = useState([])
  // Section 1 — cutoff builder
  const [filterContrast, setFilterContrast] = useState('')
  const [fdrCut,         setFdrCut]         = useState(0.05)
  const [minLfc,         setMinLfc]         = useState(0)
  const [minBm,          setMinBm]          = useState(0)
  // Section 3 — search
  const [searchQuery,    setSearchQuery]    = useState('')
  // Section 4 — paste
  const [pasteText,      setPasteText]      = useState('')
  const [pasteOpen,      setPasteOpen]      = useState(false)

  // ── Visualization controls ───────────────────────────────────────────────────
  const [exprMode,      setExprMode]      = useState('norm')
  const [sampleScope,   setSampleScope]   = useState('all')
  const [scopeContrast, setScopeContrast] = useState('')
  const [clusterRows,   setClusterRows]   = useState(true)
  const [clusterCols,   setClusterCols]   = useState(true)
  const [distMethod,    setDistMethod]    = useState('pearson')
  const [colorBy,       setColorBy]       = useState('group')
  const [palette,       setPalette]       = useState(['#2166AC', '#FFFFBF', '#D73027'])  // RdYlBu
  const [annColors,     setAnnColors]     = useState({})
  const [annGroups,     setAnnGroups]     = useState([])
  const [topN,          setTopN]          = useState(100)

  // ── Plot state ───────────────────────────────────────────────────────────────
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [hasPlot,      setHasPlot]      = useState(false)
  const [plotLabel,    setPlotLabel]    = useState('')
const [fullscreen,   setFullscreen]   = useState(false)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [plotHeight,   setPlotHeight]   = useState(800)
  const [plotWidth,    setPlotWidth]    = useState(null)   // null = 100% of panel

  // ── Initialise contrast selectors from contrastList ─────────────────────────
  useEffect(() => {
    if (!contrastList?.length) return
    if (!filterContrast) setFilterContrast(contrastList[0].label ?? '')
    if (!scopeContrast)  setScopeContrast(contrastList[0].label ?? '')
  }, [contrastList])

  // ── metaCols for colorBy ──────────────────────────────────────────────────────
  const metaCols = useMemo(() => {
    if (!pca?.scores?.length) return []
    return Object.keys(pca.scores[0]).filter(k => k !== 'sample' && !/^PC\d+$/.test(k))
  }, [pca])

  useEffect(() => {
    if (!metaCols.length) return
    if (!metaCols.includes(colorBy)) setColorBy(metaCols[0])
  }, [metaCols])

  useEffect(() => { setAnnGroups([]); setAnnColors({}) }, [colorBy])

  // ── Escape key exits fullscreen ───────────────────────────────────────────────
  useEffect(() => {
    if (!fullscreen) return
    const handler = e => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fullscreen])

  // ── Re-render + resize when fullscreen toggles (prevents state loss on expand) ─
  useEffect(() => {
    // Re-render from cached fig so plot doesn't disappear after DOM move via portal
    if (!figDataRef.current || !plotRef.current) return
    const cssVal = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
    Plotly.react(plotRef.current, figDataRef.current.data, figDataRef.current.layout, {
      responsive: true, displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      modebar: { bgcolor: cssVal('--bg-card2') || 'rgba(0,0,0,0.06)',
                 color: cssVal('--text-2') || '#555', activecolor: cssVal('--text-1') || '#111' },
    }).then(() => setTimeout(() => {
      if (plotRef.current?._fullLayout) Plotly.Plots.resize(plotRef.current)
    }, 100))
  }, [fullscreen])

  // ── Resize observer (outer plot container + floating panel) ───────────────────
  useEffect(() => {
    const targets = [outerRef.current, floatRef.current].filter(Boolean)
    if (!targets.length || !plotRef.current) return
    const ro = new ResizeObserver(() => {
      if (plotRef.current?._fullLayout) Plotly.Plots.resize(plotRef.current)
    })
    targets.forEach(t => ro.observe(t))
    return () => ro.disconnect()
  }, [fullscreen])   // re-subscribe when floatRef attaches on fullscreen enter

  // ── Reverse map: symbol → geneId (used by addFromPaste) ─────────────────────
  const revMap = useMemo(() => {
    if (!annMap) return {}
    const m = {}
    Object.entries(annMap).forEach(([id, sym]) => { if (sym && sym !== 'N/A' && sym !== 'None') m[sym] = id })
    return m
  }, [annMap])

  // ── Derived values ────────────────────────────────────────────────────────────

  const matchingGeneCount = useMemo(() => {
    const c = contrastList?.find(c => c.label === filterContrast)
    if (!c?.results) return 0
    return c.results.filter(r =>
      r.padj != null && r.padj < fdrCut &&
      Math.abs(r.log2FC ?? 0) >= minLfc &&
      (r.baseMean ?? 0) >= minBm
    ).length
  }, [contrastList, filterContrast, fdrCut, minLfc, minBm])

  const dSearch = useDebounce(searchQuery, 250)
  const searchResults = useMemo(() => {
    if (!dSearch || !annMap) return []
    const q = dSearch.toLowerCase()
    return Object.entries(annMap)
      .filter(([id, sym]) =>
        id.toLowerCase().includes(q) ||
        (typeof sym === 'string' && sym.toLowerCase().includes(q))
      )
      .slice(0, 50)
  }, [dSearch, annMap])

  const sampleSubset = useMemo(() => {
    if (sampleScope !== 'contrast' || !scopeContrast || !design?.column) return null
    const c = contrastList?.find(c => c.label === scopeContrast)
    if (!c) return null
    return (pca?.scores || [])
      .filter(s => s[design.column] === c.treatment || s[design.column] === c.reference)
      .map(s => s.sample)
  }, [sampleScope, scopeContrast, contrastList, pca, design])

  // ── Plot resize handles ───────────────────────────────────────────────────────

  const handlePlotResizeStart = useCallback(e => {
    e.preventDefault()
    const startY  = e.clientY
    const outerEl = outerRef.current
    if (!outerEl) return
    const startH = outerEl.getBoundingClientRect().height

    document.body.classList.add('plot-resizing')

    const onMove = ev => {
      const newH = Math.max(300, startH + (ev.clientY - startY))
      outerEl.style.height = `${newH}px`      // direct DOM — no re-render per frame
    }
    const onUp = ev => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('plot-resizing')
      setPlotHeight(Math.max(300, startH + (ev.clientY - startY)))
      setTimeout(() => {
        if (plotRef.current?._fullLayout) Plotly.Plots.resize(plotRef.current)
      }, 50)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const handlePlotWidthResizeStart = useCallback(e => {
    e.preventDefault()
    const startX   = e.clientX
    const wrapEl   = plotWrapperRef.current
    if (!wrapEl) return
    const startW = wrapEl.getBoundingClientRect().width

    document.body.classList.add('plot-resizing-h')

    const onMove = ev => {
      const newW = Math.max(300, startW + (ev.clientX - startX))
      wrapEl.style.width = `${newW}px`        // direct DOM — no re-render per frame
    }
    const onUp = ev => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('plot-resizing-h')
      setPlotWidth(Math.max(300, startW + (ev.clientX - startX)))
      setTimeout(() => {
        if (plotRef.current?._fullLayout) Plotly.Plots.resize(plotRef.current)
      }, 50)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // ── Gene accumulation ─────────────────────────────────────────────────────────

  function addFromFilters() {
    const c = contrastList?.find(c => c.label === filterContrast)
    if (!c?.results) return
    const ids = c.results
      .filter(r => r.padj != null && r.padj < fdrCut &&
                   Math.abs(r.log2FC ?? 0) >= minLfc && (r.baseMean ?? 0) >= minBm)
      .map(r => r.gene)
    setGeneList(prev => [...new Set([...prev, ...ids])])
  }

  function addFromPaste() {
    const tokens = pasteText.split(/[\n,\r\t ]+/).map(t => t.trim()).filter(Boolean)
    const resolved = tokens.map(tok =>
      annMap && tok in annMap ? tok   // exact geneId
        : revMap[tok] ? revMap[tok]   // symbol → geneId
        : tok                         // pass through — backend resolves
    )
    setGeneList(prev => [...new Set([...prev, ...resolved])])
    setPasteText(''); setPasteOpen(false)
  }

  const addFromSearch = useCallback(geneId => {
    setGeneList(prev => prev.includes(geneId) ? prev : [...prev, geneId])
    setSearchQuery('')
  }, [])

  const removeGene = useCallback(id => setGeneList(prev => prev.filter(g => g !== id)), [])
  const clearAll   = useCallback(() => setGeneList([]), [])

  // ── Generate heatmap ─────────────────────────────────────────────────────────

  async function generate() {
    if (!geneList.length) { setError('Add at least one gene before generating.'); return }
    setLoading(true); setError(null); setHasPlot(false)
    try {
      const label = `Custom gene set (${geneList.length} genes)`
      const body = {
        sessionId:    session.sessionId,
        customGenes:  geneList,
        annMap:       annMap || null,
        pathwayLabel: label,
        mode:         exprMode,
        clusterRows,  clusterCols, distMethod,
        colorBy:      colorBy || '',
        topN, palette,
        annColors: Object.keys(annColors).length ? annColors : null,
        activeLabels: (contrastList || []).map(c => c.label ?? `${c.treatment}|${c.reference}`),
      }
      if (sampleSubset?.length) body.sampleSubset = sampleSubset

      const data = await apiFetch('/api/heatmap', body)

      const fig = JSON.parse(data.plotlyJson)
      const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-2').trim() || '#475569'
      const hlabel = { bgcolor: '#1e293b', bordercolor: '#334155', font: { color: '#e2e8f0', size: 12 } }
      fig.data = fig.data.map(trace => ({ ...trace, hoverlabel: hlabel }))
      // Strip explicit width/height from backend layout so Plotly fills the flex cell
      // and never bleeds over the right drag handle.
      // eslint-disable-next-line no-unused-vars
      const { width: _bw, height: _bh, ...baseLayout } = fig.layout ?? {}
      fig.layout = { ...baseLayout, autosize: true,
                     paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
                     font: { ...(baseLayout?.font || {}), color: textColor }, hoverlabel: hlabel }
      applySymbolsToFig(fig, annMap)
      applySampleLabelsToFig(fig, sampleLabels)

      const cssVal = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
      const plotConfig = {
        responsive: true, displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        modebar: {
          bgcolor:     cssVal('--bg-card2') || 'rgba(0,0,0,0.06)',
          color:       cssVal('--text-2')   || '#555555',
          activecolor: cssVal('--text-1')   || '#111111',
        },
      }
      figDataRef.current = { data: fig.data, layout: fig.layout }
      // Show the wrapper first so plotRef has real dimensions when Plotly measures it
      setHasPlot(true)
      setPlotLabel(label)
      // Let the browser paint the wrapper before reacting
      await new Promise(r => requestAnimationFrame(r))
      await Plotly.react(plotRef.current, fig.data, fig.layout, plotConfig)
      setTimeout(() => {
        if (plotRef.current?._fullLayout) Plotly.Plots.resize(plotRef.current)
      }, 50)

      // Update annotation colour pickers
      if (data.annGroups?.length) {
        const defaults = ['#800020','#228B22','#C9A227','#555555','#4E6E8E','#A0522D','#BF5700','#4B0082']
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

  // ── Render ───────────────────────────────────────────────────────────────────

  const inputSm = {
    fontSize: '0.78rem', padding: '2px 6px',
    background: 'var(--bg-card2)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text-1)', width: 64,
  }

  const _inner = (
    /* Outer element: full-screen overlay in fullscreen, bare flex-row otherwise */
    <div ref={floatRef} style={fullscreen ? {
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'var(--bg-panel)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    } : { display: 'flex', gap: 0, minHeight: 600 }}>

      {/* ── Slim header bar (fullscreen only) ────────────────────────────────── */}
      {fullscreen && (
        <div style={{
          padding: '7px 16px', flexShrink: 0,
          background: 'rgba(255,255,255,0.03)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-1)' }}>
            Custom Heatmap
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>
            Press <kbd style={{ padding: '0 4px', background: 'rgba(255,255,255,0.08)',
              border: '1px solid var(--border)', borderRadius: 3, fontFamily: 'monospace' }}>Esc</kbd> or
          </span>
          <button onClick={() => setFullscreen(false)}
                  style={{ fontSize: '0.72rem', padding: '3px 12px', borderRadius: 5, cursor: 'pointer',
                           background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)' }}>
            ⊠ Exit fullscreen
          </button>
        </div>
      )}

      {/* ── Content row: sidebar + right panel ───────────────────────────────── */}
      {/* In fullscreen → flex row that fills remaining height; otherwise → display:contents */}
      <div style={fullscreen
        ? { flex: 1, display: 'flex', overflow: 'hidden', padding: '12px 20px 12px 16px' }
        : { display: 'contents' }}>

      {/* ── LEFT SIDEBAR: Gene Set Builder ──────────────────────────────────── */}
      <div style={{
        width: 272, flexShrink: 0, borderRight: '1px solid var(--border)',
        paddingRight: 16, paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 16,
        overflowY: 'auto',
      }}>

        {/* Section 1: Cutoff Filters */}
        <SidebarSection label="From Cutoff Filters">
          <select value={filterContrast} onChange={e => setFilterContrast(e.target.value)}
                  style={{ fontSize: '0.75rem', padding: '3px 6px', width: '100%' }}>
            {(contrastList || []).map(c => (
              <option key={c.label} value={c.label}>{c.label ?? c.treatment}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4,
                            fontSize: '0.72rem', color: 'var(--text-2)' }}>
              FDR
              <select value={fdrCut} onChange={e => setFdrCut(+e.target.value)}
                      style={{ fontSize: '0.72rem', padding: '2px 4px' }}>
                {[0.001,0.01,0.05,0.1].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4,
                            fontSize: '0.72rem', color: 'var(--text-2)' }}>
              |LFC|≥
              <input type="number" value={minLfc} min={0} max={10} step={0.1}
                     onChange={e => setMinLfc(+e.target.value)}
                     style={{ ...inputSm, width: 48 }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4,
                            fontSize: '0.72rem', color: 'var(--text-2)' }}>
              BM≥
              <input type="number" value={minBm} min={0} step={1}
                     onChange={e => setMinBm(+e.target.value)}
                     style={{ ...inputSm, width: 56 }} />
            </label>
          </div>
          <button onClick={addFromFilters} disabled={matchingGeneCount === 0}
                  style={{
                    padding: '5px 10px', fontSize: '0.75rem', borderRadius: 6, cursor: 'pointer',
                    background: matchingGeneCount > 0 ? 'rgba(var(--accent-rgb),0.15)' : 'rgba(255,255,255,0.04)',
                    color: matchingGeneCount > 0 ? 'var(--accent-text)' : 'var(--text-3)',
                    border: `1px solid ${matchingGeneCount > 0 ? 'rgba(var(--accent-rgb),0.3)' : 'var(--border)'}`,
                    fontWeight: 500, transition: 'all 0.15s',
                  }}>
            + Add {matchingGeneCount.toLocaleString()} gene{matchingGeneCount !== 1 ? 's' : ''}
          </button>
        </SidebarSection>

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--border)' }} />

        {/* Section 2: Gene Chip List */}
        <SidebarSection label={`Gene List (${geneList.length})`}>
          {geneList.length > 0 && (
            <button onClick={clearAll}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                             fontSize: '0.68rem', color: 'var(--text-3)', padding: 0,
                             textDecoration: 'underline', alignSelf: 'flex-end' }}>
              Clear all
            </button>
          )}
          {geneList.length === 0
            ? <em style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>No genes added yet</em>
            : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4,
                            maxHeight: 200, overflowY: 'auto', paddingRight: 2 }}>
                {geneList.map(id => (
                  <GeneChip key={id} id={id} symbol={annMap?.[id]} onRemove={removeGene} />
                ))}
              </div>
            )
          }
        </SidebarSection>

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--border)' }} />

        {/* Section 3: Search & Add */}
        <SidebarSection label="Search &amp; Add">
          <div style={{ position: 'relative' }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                   placeholder="Gene ID or symbol…"
                   style={{ width: '100%', fontSize: '0.75rem', padding: '4px 8px',
                            background: 'var(--bg-card2)', border: '1px solid var(--border)',
                            borderRadius: 6, color: 'var(--text-1)', boxSizing: 'border-box' }} />
            {searchResults.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                background: 'var(--bg-panel)', border: '1px solid var(--border)',
                borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                maxHeight: 200, overflowY: 'auto', marginTop: 2,
              }}>
                {searchResults.map(([geneId, sym]) => (
                  <button key={geneId} onClick={() => addFromSearch(geneId)}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            width: '100%', padding: '5px 10px', border: 'none', cursor: 'pointer',
                            background: 'none', textAlign: 'left', gap: 8,
                          }}
                          className="dropdown-item">
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-1)', fontWeight: 500 }}>
                      {typeof sym === 'string' && sym ? sym : geneId}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-3)',
                                   fontFamily: 'monospace', flexShrink: 0 }}>
                      {geneId}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </SidebarSection>

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--border)' }} />

        {/* Section 4: Paste Genes */}
        <SidebarSection label="Paste Genes">
          {!pasteOpen ? (
            <button onClick={() => setPasteOpen(true)}
                    style={{ background: 'none', border: '1px dashed var(--border)', cursor: 'pointer',
                             fontSize: '0.75rem', color: 'var(--text-3)', padding: '6px 10px',
                             borderRadius: 6, textAlign: 'left', transition: 'color 0.15s' }}>
              Paste / bulk add…
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
                        placeholder={'One gene per line, or comma-separated\nAccepts gene IDs or symbols'}
                        rows={5}
                        style={{ width: '100%', fontSize: '0.72rem', padding: '6px 8px', resize: 'vertical',
                                 background: 'var(--bg-card2)', border: '1px solid var(--border)',
                                 borderRadius: 6, color: 'var(--text-1)', boxSizing: 'border-box',
                                 fontFamily: 'monospace' }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={addFromPaste} disabled={!pasteText.trim()}
                        style={{ flex: 1, padding: '5px 0', fontSize: '0.75rem', borderRadius: 6,
                                 cursor: pasteText.trim() ? 'pointer' : 'not-allowed',
                                 background: 'var(--accent)', color: '#fff', border: 'none',
                                 fontWeight: 600, opacity: pasteText.trim() ? 1 : 0.5 }}>
                  Add
                </button>
                <button onClick={() => { setPasteOpen(false); setPasteText('') }}
                        style={{ padding: '5px 10px', fontSize: '0.75rem', borderRadius: 6,
                                 background: 'none', border: '1px solid var(--border)',
                                 color: 'var(--text-3)', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </SidebarSection>

        {/* Footer: gene count */}
        <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Total genes in set</span>
          <span className="stat-chip" style={{ color: 'var(--accent)' }}>
            {geneList.length.toLocaleString()}
          </span>
        </div>
      </div>

      {/* ── RIGHT PANEL: Controls + Plot ─────────────────────────────────────── */}
      <div style={{ flex: 1, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 12,
                    minWidth: 0, overflowY: fullscreen ? 'auto' : 'visible',
                    overflowX: plotWidth ? 'auto' : 'visible' }}>

        {/* Controls collapsible header */}
        <button onClick={() => setControlsOpen(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                  borderRadius: controlsOpen ? '8px 8px 0 0' : 8, padding: '7px 14px',
                  cursor: 'pointer', color: 'var(--text-2)', fontSize: '0.78rem',
                  fontWeight: 500, transition: 'border-radius 0.15s',
                }}>
          <span style={{
            display: 'inline-block', transition: 'transform 0.2s',
            transform: controlsOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            fontSize: '0.7rem', color: 'var(--text-3)',
          }}>▶</span>
          Plot Controls
          <span style={{
            marginLeft: 'auto', fontSize: '0.82rem', color: 'var(--text-3)',
            display: 'inline-block', transition: 'transform 0.2s',
            transform: controlsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }}>▾</span>
        </button>

        {/* Controls grid */}
        <div style={{
          display: controlsOpen ? 'grid' : 'none',
          gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'start',
          border: '1px solid var(--border)', borderTop: 'none',
          borderRadius: '0 0 8px 8px', padding: '12px 8px 8px',
        }}>

          {/* Sample scope */}
          <ControlGroup label="Sample Scope">
            <PillToggle
              options={[['all', 'All Samples'], ['contrast', 'Contrast-limited']]}
              value={sampleScope}
              onChange={setSampleScope}
            />
            {sampleScope === 'contrast' && (
              <select value={scopeContrast} onChange={e => setScopeContrast(e.target.value)}
                      style={{ fontSize: '0.78rem', padding: '3px 8px', marginTop: 2 }}>
                {(contrastList || []).map(c => (
                  <option key={c.label} value={c.label}>{c.label ?? c.treatment}</option>
                ))}
              </select>
            )}
            {sampleScope === 'contrast' && !design?.column && (
              <span style={{ fontSize: '0.68rem', color: '#f87171' }}>
                ⚠ Sample column not available for this session
              </span>
            )}
          </ControlGroup>

          {/* Expression */}
          <ControlGroup label="Expression">
            <PillToggle
              options={[['norm', 'Norm. counts'], ['vst', 'VST']]}
              value={exprMode}
              onChange={setExprMode}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 5,
                            fontSize: '0.78rem', color: 'var(--text-2)', marginTop: 2 }}>
              Top N
              <input type="number" value={topN} min={5} max={500} step={5}
                     onChange={e => setTopN(Number(e.target.value))}
                     style={{ ...inputSm, width: 58 }} />
            </label>
          </ControlGroup>

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

          {/* Annotation */}
          {metaCols.length > 0 && (
            <ControlGroup label="Annotation">
              <select value={colorBy} onChange={e => setColorBy(e.target.value)}
                      style={{ fontSize: '0.78rem', padding: '3px 8px', minWidth: 120 }}>
                {metaCols.map(col => <option key={col} value={col}>{col}</option>)}
              </select>
              {annGroups.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
                  {annGroups.map(grp => (
                    <label key={grp} title={`Click to change color for "${grp}"`}
                           style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <input type="color" value={annColors[grp] || '#999999'}
                             onChange={e => setAnnColors(prev => ({ ...prev, [grp]: e.target.value }))}
                             style={{ width: 18, height: 18, padding: 0,
                                      border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer' }} />
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

          {/* Palette — full width */}
          <div style={{ gridColumn: '1 / -1' }}>
            <ControlGroup label="Palette">
              <PaletteRow palette={palette} setPalette={setPalette} />
            </ControlGroup>
          </div>

        </div>

        {/* Action buttons — always visible, outside the collapsible section */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setFullscreen(v => !v)}
                  title={fullscreen ? 'Exit fullscreen (Esc)' : 'Expand to fullscreen'}
                  style={{ padding: '7px 14px', fontSize: '0.8rem', borderRadius: 8,
                           background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)',
                           border: '1px solid var(--border)', cursor: 'pointer' }}>
            {fullscreen ? '⊠ Collapse' : '⊡ Expand'}
          </button>
          {hasPlot && (
            <button onClick={() => promptDownload('custom-heatmap.png', name =>
              Plotly.downloadImage(plotRef.current, {
                format: 'png', filename: name.replace(/\.png$/i, ''),
                width: 1600, height: 1200, scale: 2,
              })
            )}
                    style={{ padding: '7px 16px', fontSize: '0.8rem', borderRadius: 8,
                             background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)',
                             border: '1px solid var(--border)', cursor: 'pointer' }}>
              ↓ Export PNG
            </button>
          )}
          <button onClick={generate} disabled={loading || geneList.length === 0}
                  style={{
                    padding: '7px 20px', fontSize: '0.82rem', borderRadius: 8, fontWeight: 600,
                    background: loading || !geneList.length ? 'rgba(255,255,255,0.06)' : 'var(--accent)',
                    color: loading || !geneList.length ? 'var(--text-3)' : '#fff',
                    border: 'none', cursor: loading || !geneList.length ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s, color 0.15s',
                  }}>
            {loading ? '⏳ Generating…' : '▶ Generate Heatmap'}
          </button>
        </div>

        {/* Error */}
        {error && <ErrorBox msg={error} />}

        {/* Placeholder */}
        {!hasPlot && !loading && !error && (
          <Placeholder text='Build a gene set using the left panel, then click "Generate Heatmap".' />
        )}

        {/* Loading spinner */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', minHeight: 300, gap: 14 }}>
            <span style={{ width: 40, height: 40, borderRadius: '50%',
                           border: '3px solid rgba(var(--accent-rgb),0.2)',
                           borderTopColor: 'var(--accent)', display: 'inline-block',
                           animation: 'spin 0.7s linear infinite' }} />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-3)', fontStyle: 'italic' }}>
              Building heatmap…
            </span>
          </div>
        )}

        {/* Plot + two-axis resize handles — always mounted so plotRef is never null */}
        <div ref={plotWrapperRef} style={{
          display: hasPlot ? 'flex' : 'none', flexDirection: 'column',
          width: plotWidth ?? '100%',
          alignSelf: 'flex-start', flexShrink: 0,
        }}>
            {/* Plot row: plot + right handle */}
            <div style={{ display: 'flex', alignItems: 'stretch' }}>
              <div ref={outerRef} style={{ flex: 1, height: plotHeight, minHeight: 300 }}>
                <div ref={plotRef} style={{ width: '100%', height: '100%', minHeight: 300 }} />
              </div>

              {/* Right drag handle */}
              <div
                onMouseDown={handlePlotWidthResizeStart}
                title="Drag to resize width"
                style={{
                  width: 10, cursor: 'ew-resize', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border)', borderLeft: 'none',
                  borderRadius: '0 6px 0 0',
                  userSelect: 'none', transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.12)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
              >
                <span style={{
                  fontSize: '0.5rem', color: 'var(--text-3)',
                  writingMode: 'vertical-lr', letterSpacing: 3, lineHeight: 1, pointerEvents: 'none',
                }}>▾▾</span>
              </div>
            </div>

            {/* Bottom drag handle */}
            <div
              onMouseDown={handlePlotResizeStart}
              title="Drag to resize height"
              style={{
                width: '100%', height: 10, cursor: 'ns-resize', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border)', borderTop: 'none',
                borderRadius: '0 0 6px 6px',
                userSelect: 'none', transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.12)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
            >
              <span style={{ fontSize: '0.5rem', color: 'var(--text-3)', letterSpacing: 3,
                             lineHeight: 1, pointerEvents: 'none' }}>▾▾</span>
            </div>
          </div>
      </div>

      </div>{/* end content-row wrapper (display:contents in normal mode) */}


      {dlDialog}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .dropdown-item:hover { background: rgba(var(--accent-rgb),0.08) !important; }
        .plot-resizing,   .plot-resizing   * { cursor: ns-resize !important; user-select: none !important; }
        .plot-resizing-h, .plot-resizing-h * { cursor: ew-resize !important; user-select: none !important; }
      `}</style>
    </div>
  )

  return fullscreen ? createPortal(_inner, document.body) : _inner
}
