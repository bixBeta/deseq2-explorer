import { useState, useEffect, useRef, useMemo } from 'react'
import Plotly from 'plotly.js-dist-min'

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

// ── UpSet Plot ─────────────────────────────────────────────────────────────────
function UpSetTab({ session }) {
  const [fdr, setFdr]         = useState(0.05)
  const [minLfc, setMinLfc]   = useState(0)
  const [imgSrc, setImgSrc]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  async function generate() {
    setLoading(true); setError(null); setImgSrc(null)
    try {
      const data = await apiFetch('/api/upset', { sessionId: session.sessionId, fdr, minLfc })
      setImgSrc(`data:image/png;base64,${data.image}`)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

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
        <button className="btn-ghost" onClick={generate} disabled={loading}>
          {loading ? 'Generating…' : 'Generate UpSet Plot'}
        </button>
      </div>

      {error && <ErrorBox msg={error} />}

      {imgSrc && (
        <div className="resizable-plot" style={{ width: '100%', height: 520 }}>
          <img src={imgSrc} alt="UpSet plot" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        </div>
      )}

      {!imgSrc && !loading && !error && <Placeholder text='Configure parameters and click "Generate UpSet Plot" to visualize contrast overlaps.' />}
    </div>
  )
}

const DIST_METHODS = ['euclidean', 'pearson', 'spearman', 'kendall', 'manhattan', 'maximum']

// ── Heatmap (interactive via heatmaply → Plotly JSON) ─────────────────────────
function HeatmapTab({ session, annMap, pca, contrasts }) {
  const outerRef = useRef(null)
  const plotRef  = useRef(null)
  const [fdr, setFdr]                 = useState(0.05)
  const [topN, setTopN]               = useState(50)
  const [mode, setMode]               = useState('vst')
  const [clusterRows, setClusterRows] = useState(true)
  const [clusterCols, setClusterCols] = useState(true)
  const [distMethod, setDistMethod]   = useState('pearson')
  const [colorBy, setColorBy]         = useState('group')
  const [geneSet, setGeneSet]         = useState('union')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [hasPlot, setHasPlot]         = useState(false)

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

  // Resize observer
  useEffect(() => {
    if (!outerRef.current || !plotRef.current) return
    const ro = new ResizeObserver(() => {
      if (plotRef.current?._fullLayout) Plotly.Plots.resize(plotRef.current)
    })
    ro.observe(outerRef.current)
    return () => ro.disconnect()
  }, [])

  // Auto-regenerate on any option change when a plot already exists
  const prevOpts = useRef(null)
  useEffect(() => {
    const opts = JSON.stringify({ clusterRows, clusterCols, distMethod, colorBy, geneSet })
    if (prevOpts.current === null) { prevOpts.current = opts; return }
    if (prevOpts.current === opts) return
    prevOpts.current = opts
    if (hasPlot) generate()
  }, [clusterRows, clusterCols, distMethod, colorBy, geneSet])

  async function generate() {
    setLoading(true); setError(null); setHasPlot(false)
    try {
      const data = await apiFetch('/api/heatmap', {
        sessionId: session.sessionId,
        fdr, topN, mode,
        clusterRows, clusterCols,
        distMethod,
        colorBy: colorBy || '',
        geneSet,
      })

      const fig = JSON.parse(data.plotlyJson)
      fig.layout = {
        ...fig.layout,
        paper_bgcolor: 'transparent',
        plot_bgcolor:  'transparent',
        font: { ...(fig.layout?.font || {}), color: '#94a3b8' },
      }
      applySymbolsToFig(fig, annMap)

      await Plotly.react(plotRef.current, fig.data, fig.layout, {
        responsive: true, displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      })
      setHasPlot(true)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const ToggleBtn = ({ val, set, label }) => (
    <button onClick={() => set(v => !v)}
            style={{
              padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)',
              cursor: 'pointer', fontSize: '0.75rem', fontWeight: val ? 600 : 400,
              background: val ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
              color: val ? 'var(--text-1)' : 'var(--text-3)', transition: 'all 0.15s',
            }}>
      {label}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Row 1: FDR, Top N, mode */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-2)' }}>
          FDR
          <input type="number" value={fdr} min={0.001} max={0.5} step={0.01}
                 onChange={e => setFdr(Number(e.target.value))}
                 style={{ width: 65, fontSize: '0.8rem', padding: '2px 6px' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-2)' }}>
          Top N
          <input type="number" value={topN} min={5} max={500} step={5}
                 onChange={e => setTopN(Number(e.target.value))}
                 style={{ width: 65, fontSize: '0.8rem', padding: '2px 6px' }} />
        </label>
        <div style={{ display: 'flex', gap: 2, padding: '2px', borderRadius: 6,
                      background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
          {[['vst', 'Norm Z-score'], ['lfc', 'log₂FC']].map(([k, lbl]) => (
            <button key={k} onClick={() => setMode(k)} style={TAB_BTN(mode === k)}>{lbl}</button>
          ))}
        </div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Genes</span>
        <select value={geneSet} onChange={e => setGeneSet(e.target.value)}
                style={{ fontSize: '0.78rem', padding: '2px 6px', minWidth: 140 }}>
          <option value="union">Union (any contrast)</option>
          <option value="intersection">Intersection (all contrasts)</option>
          {contrasts.map((c, i) => (
            <option key={i} value={c.label ?? c.treatment ?? `Contrast ${i+1}`}>
              {c.label ?? c.treatment ?? `Contrast ${i+1}`} only
            </option>
          ))}
        </select>

        <button className="btn-ghost" onClick={generate} disabled={loading}>
          {loading ? 'Generating…' : 'Generate Heatmap'}
        </button>
      </div>

      {/* Row 2: clustering + annotation — compact inline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Cluster</span>
        <ToggleBtn val={clusterRows} set={setClusterRows} label="Rows" />
        <ToggleBtn val={clusterCols} set={setClusterCols} label="Columns" />

        {(clusterRows || clusterCols) && (
          <>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginLeft: 4 }}>Distance</span>
            <select value={distMethod} onChange={e => setDistMethod(e.target.value)}
                    style={{ fontSize: '0.78rem', padding: '2px 6px' }}>
              {DIST_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </>
        )}

        {metaCols.length > 0 && (
          <>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginLeft: 4 }}>Color by</span>
            <select value={colorBy} onChange={e => setColorBy(e.target.value)}
                    style={{ fontSize: '0.78rem', padding: '2px 6px', minWidth: 110 }}>
              {metaCols.map(col => <option key={col} value={col}>{col}</option>)}
            </select>
            {loading && <span style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>updating…</span>}
          </>
        )}
      </div>

      {error && <ErrorBox msg={error} />}

      <div ref={outerRef} className="resizable-plot"
           style={{ width: '100%', height: 800, display: hasPlot ? 'block' : 'none' }}>
        <div ref={plotRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {!hasPlot && !loading && !error && <Placeholder text='Configure parameters and click "Generate Heatmap" to visualize top DEG expression.' />}
    </div>
  )
}

// ── Gene Explorer (multi-group violin) ────────────────────────────────────────
function GeneExplorer({ session, contrasts, annMap }) {
  const [query, setQuery]       = useState('')
  const [selected, setSelected] = useState(null)
  const [imgSrc, setImgSrc]     = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

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
    try {
      const data = await apiFetch('/api/geneplot/compare', { sessionId: session.sessionId, gene, symbol })
      setImgSrc(`data:image/png;base64,${data.image}`)
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
      <div style={{ flex: 1 }}>
        {loading && <Placeholder text="Generating violin plot…" />}
        {error && <ErrorBox msg={error} />}
        {imgSrc && !loading && (
          <div className="resizable-plot" style={{ width: 600, height: 600 }}>
            <img src={imgSrc} alt={`${selected} expression`}
                 style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          </div>
        )}
        {!selected && !loading && (
          <Placeholder text="Select a gene to plot its normalized expression across all groups." />
        )}
      </div>
    </div>
  )
}

// ── Table Explorer (pivot: gene rows × contrast-grouped stat columns) ─────────
const STAT_COLS = [
  { key: 'baseMean', label: 'baseMean' },
  { key: 'log2FC',   label: 'log₂FC'  },
  { key: 'pvalue',   label: 'pvalue'  },
  { key: 'padj',     label: 'padj'    },
]

function TableExplorer({ contrasts, annMap, annDetails }) {
  const [search, setSearch] = useState('')
  const [fdrCut, setFdrCut] = useState(1)
  const [sortContrast, setSortContrast] = useState(null)   // contrast label or null
  const [sortStat,     setSortStat]     = useState('padj')
  const [sortDir,      setSortDir]      = useState(1)      // 1 asc, -1 desc

  const hasDetails = !!annDetails
  const contrastLabels = useMemo(() =>
    contrasts.map(c => c.label ?? c.treatment ?? 'Contrast'), [contrasts])

  // Build pivot: one row per gene
  const pivotRows = useMemo(() => {
    const map = {}
    contrasts.forEach(c => {
      const lbl = c.label ?? c.treatment ?? 'Contrast'
      ;(c.results || []).forEach(r => {
        if (!r.gene) return
        if (!map[r.gene]) {
          const sym = annMap?.[r.gene]
          const det = annDetails?.[r.gene]
          map[r.gene] = {
            gene:        r.gene,
            symbol:      sym && sym !== 'N/A' && sym !== 'None' ? sym : '',
            description: det?.description ?? '',
            chr:         det?.chr ?? '',
            start:       det?.start ?? null,
            end:         det?.end   ?? null,
            contrasts:   {},
          }
        }
        map[r.gene].contrasts[lbl] = {
          baseMean: r.baseMean, log2FC: r.log2FC,
          lfcSE: r.lfcSE, pvalue: r.pvalue, padj: r.padj,
        }
      })
    })
    return Object.values(map)
  }, [contrasts, annMap, annDetails])

  // Filter
  const filtered = useMemo(() => {
    const lq = search.toLowerCase()
    return pivotRows.filter(r => {
      if (fdrCut < 1) {
        const anySig = contrastLabels.some(l => {
          const p = r.contrasts[l]?.padj
          return p != null && p <= fdrCut
        })
        if (!anySig) return false
      }
      if (!lq) return true
      return r.gene.toLowerCase().includes(lq) || r.symbol.toLowerCase().includes(lq)
    })
  }, [pivotRows, search, fdrCut, contrastLabels])

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

  function toggleSort(cLabel, stat) {
    if (sortContrast === cLabel && sortStat === stat) setSortDir(d => -d)
    else { setSortContrast(cLabel); setSortStat(stat); setSortDir(1) }
  }

  function downloadCSV() {
    const geneHdr  = hasDetails
      ? ['gene_id', 'symbol', 'chr', 'start', 'end', 'description']
      : ['gene_id', 'symbol']
    const statHdrs = contrastLabels.flatMap(l => STAT_COLS.map(s => `${l}__${s.key}`))
    const hdr      = [...geneHdr, ...statHdrs].join(',')
    const body     = sorted.map(r => {
      const gene  = hasDetails
        ? [r.gene, r.symbol, r.chr, r.start ?? '', r.end ?? '', `"${r.description.replace(/"/g,'""')}"`]
        : [r.gene, r.symbol]
      const stats = contrastLabels.flatMap(l => STAT_COLS.map(s => r.contrasts[l]?.[s.key] ?? ''))
      return [...gene, ...stats].join(',')
    }).join('\n')
    const blob = new Blob([hdr + '\n' + body], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href: url, download: 'de_pivot_all_contrasts.csv' }).click()
    URL.revokeObjectURL(url)
  }

  const fmtN   = (v, d = 3) => {
    if (v == null) return '—'
    const n = typeof v === 'number' ? v : Number(v)
    if (!isFinite(n)) return '—'
    return n.toPrecision(d)
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

  // Column widths and left-sticky offsets (px)
  const COL = {
    id:   { w: 140, left: 0   },
    sym:  { w:  90, left: 140 },
    chr:  { w: 150, left: 230 },  // combined Chr:Start-End
    desc: { w: 160, left: 380 },
  }
  const lastFrozenKey = hasDetails ? 'desc' : 'sym'

  // Build sticky-left style for a gene column cell
  // zIndex: 20 body / caller overrides to 22 for header cells
  const freeze = (key, bg = FREEZE_BG, extra = {}) => ({
    position: 'sticky', left: COL[key].left,
    width: COL[key].w, minWidth: COL[key].w, maxWidth: COL[key].w,
    overflow: 'hidden', textOverflow: 'ellipsis',
    zIndex: 20, background: bg, ...extra,
  })
  // Box-shadow used on the right edge of the last frozen column
  const freezeShadow = { boxShadow: '3px 0 6px rgba(0,0,0,0.10)' }

  const TH = ({ children, style = {} }) => (
    <th style={{ padding: '5px 8px', whiteSpace: 'nowrap', fontWeight: 500,
                 fontSize: '0.7rem', borderBottom: GRID, borderRight: GRID,
                 background: 'var(--bg-panel)', color: 'var(--text-3)',
                 ...style }}>
      {children}
    </th>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Controls */}
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
        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
          {sorted.length.toLocaleString()} genes
        </span>
        <button className="btn-ghost" onClick={downloadCSV} style={{ marginLeft: 'auto', fontSize: '0.78rem' }}>
          ↓ CSV
        </button>
      </div>

      {/* Two-level pivot table */}
      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 580,
                    border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.76rem', tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: COL.id.w }} />
            <col style={{ width: COL.sym.w }} />
            {hasDetails && <col style={{ width: COL.chr.w }} />}
            {hasDetails && <col style={{ width: COL.desc.w }} />}
            {contrastLabels.flatMap(lbl => STAT_COLS.map(s => <col key={`${lbl}_${s.key}`} style={{ width: 80 }} />))}
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 22, background: 'var(--bg-panel)' }}>
            {/* Row 1: frozen Gene banner + contrast group headers.
                The tr background fills any gap when contrast headers scroll behind the frozen pane. */}
            <tr style={{ background: 'rgba(var(--accent-rgb),0.06)' }}>
              <th colSpan={hasDetails ? 4 : 2}
                  style={{ ...freeze('id', 'var(--bg-panel)'), zIndex: 22,
                           backgroundImage: 'linear-gradient(rgba(var(--accent-rgb),0.06),rgba(var(--accent-rgb),0.06))',
                           padding: '6px 10px', textAlign: 'left', fontWeight: 600,
                           fontSize: '0.72rem', color: 'var(--text-3)',
                           borderBottom: GRID,
                           borderRight: '2px solid var(--border)',
                           ...freezeShadow }}>
                Gene
              </th>
              {contrastLabels.map((lbl, ci) => (
                <th key={lbl} colSpan={4}
                    style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700,
                             fontSize: '0.72rem', whiteSpace: 'nowrap', color: ACCENT,
                             background: 'rgba(var(--accent-rgb),0.06)',
                             borderBottom: GRID,
                             borderRight: ci < contrastLabels.length - 1 ? '2px solid var(--border)' : GRID }}>
                  {lbl}
                </th>
              ))}
            </tr>
            {/* Row 2: frozen gene sub-headers + sortable stat sub-headers */}
            <tr>
              <TH style={{ ...freeze('id', FREEZE_BG), zIndex: 22, borderRight: GRID }}>Gene ID</TH>
              <TH style={{ ...freeze('sym', FREEZE_BG), zIndex: 22,
                           ...(lastFrozenKey === 'sym' ? { borderRight: '2px solid var(--border)', ...freezeShadow } : { borderRight: GRID }) }}>
                Symbol
              </TH>
              {hasDetails && <TH style={{ ...freeze('chr', FREEZE_BG), zIndex: 22, borderRight: GRID }}>Chr</TH>}
              {hasDetails && <TH style={{ ...freeze('desc', FREEZE_BG), zIndex: 22,
                                          borderRight: '2px solid var(--border)', ...freezeShadow }}>
                Description
              </TH>}
              {contrastLabels.map((lbl, ci) => (
                STAT_COLS.map((s, si) => {
                  const active = sortContrast === lbl && sortStat === s.key
                  const isLast = si === STAT_COLS.length - 1
                  return (
                    <th key={`${lbl}_${s.key}`}
                        onClick={() => toggleSort(lbl, s.key)}
                        style={{ padding: '4px 8px', whiteSpace: 'nowrap', cursor: 'pointer',
                                 fontWeight: active ? 700 : 400, fontSize: '0.68rem',
                                 color: active ? ACCENT_TEXT : 'var(--text-3)',
                                 background: active ? 'rgba(var(--accent-rgb),0.04)' : 'var(--bg-panel)',
                                 borderBottom: GRID,
                                 borderRight: isLast && ci < contrastLabels.length - 1 ? '2px solid var(--border)' : GRID,
                                 userSelect: 'none' }}>
                      {s.label}{active ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
                    </th>
                  )
                })
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 2000).map((r, i) => {
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
                             ...(lastFrozenKey === 'sym'
                               ? { borderRight: '2px solid var(--border)', ...freezeShadow }
                               : { borderRight: GRID }) }}>
                  {symStr || '—'}
                </td>
                {hasDetails && (
                  <td className="frozen-cell" style={{ ...freeze('chr', FREEZE_BG), padding: '4px 8px', color: 'var(--text-3)',
                               whiteSpace: 'nowrap', fontSize: '0.68rem', borderRight: GRID, borderBottom: GRID }}>
                    {chrStr
                      ? `${chrStr}:${typeof r.start === 'number' ? r.start.toLocaleString() : '?'}-${typeof r.end === 'number' ? r.end.toLocaleString() : '?'}`
                      : '—'}
                  </td>
                )}
                {hasDetails && (
                  <td className="frozen-cell" style={{ ...freeze('desc', FREEZE_BG), padding: '4px 8px', color: 'var(--text-3)',
                               fontSize: '0.69rem', overflow: 'hidden', textOverflow: 'ellipsis',
                               whiteSpace: 'nowrap', borderBottom: GRID,
                               borderRight: '2px solid var(--border)', ...freezeShadow }}
                      title={descStr}>
                    {descStr || '—'}
                  </td>
                )}
                {/* ── Contrast stat columns ── */}
                {contrastLabels.map((lbl, ci) => {
                  const s = r.contrasts[lbl]
                  const groupRight = ci < contrastLabels.length - 1
                    ? { borderRight: '2px solid var(--border)' }
                    : { borderRight: GRID }
                  const lfcColor = s?.log2FC > 0 ? '#16a34a' : s?.log2FC < 0 ? '#dc2626' : 'var(--text-2)'
                  return [
                    <td key={`${lbl}_bm`}  style={{ ...base }}>{fmtN(s?.baseMean, 4)}</td>,
                    <td key={`${lbl}_lfc`} style={{ ...base, fontWeight: 500, color: lfcColor }}>{s ? fmtLFC(s.log2FC) : '—'}</td>,
                    <td key={`${lbl}_pv`}  style={{ ...base, color: 'var(--text-3)' }}>{fmtN(s?.pvalue, 3)}</td>,
                    <td key={`${lbl}_pa`}  style={{ ...base, ...groupRight, color: padjColor(s?.padj) }}>{fmtN(s?.padj, 3)}</td>,
                  ]
                })}
              </tr>
              )
            })}
          </tbody>
        </table>
        {sorted.length > 2000 && (
          <div style={{ padding: '8px 14px', textAlign: 'center', fontSize: '0.72rem',
                        color: 'var(--text-3)', borderTop: '1px solid var(--border)' }}>
            Showing first 2,000 of {sorted.length.toLocaleString()} genes — use filters or download CSV
          </div>
        )}
        {sorted.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: '0.82rem' }}>
            No genes match current filters
          </div>
        )}
      </div>
    </div>
  )
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

export default function ComparePanel({ session, contrasts, annMap, annDetails, pca }) {
  const [subTab, setSubTab] = useState('upset')

  if (!contrasts || contrasts.length < 2) {
    return <Placeholder text="Run at least 2 contrasts to enable comparative analysis." />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)' }}>
        {SUB_TABS.map(t => {
          const active = subTab === t.key
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
          {contrasts.length} contrasts
        </span>
      </div>

      {/* Contrast chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {contrasts.map((c, i) => (
          <span key={i} style={{
            padding: '2px 10px', borderRadius: 99, fontSize: '0.72rem',
            background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)',
            border: '1px solid var(--border)',
          }}>
            {c.label ?? c.treatment ?? `Contrast ${i + 1}`}
          </span>
        ))}
      </div>

      <div style={{ display: subTab === 'upset'   ? 'block' : 'none' }}><UpSetTab   session={session} /></div>
      <div style={{ display: subTab === 'heatmap' ? 'block' : 'none' }}><HeatmapTab session={session} annMap={annMap} pca={pca} contrasts={contrasts} /></div>
      <div style={{ display: subTab === 'genes'   ? 'block' : 'none' }}><GeneExplorer session={session} contrasts={contrasts} annMap={annMap} /></div>
      <div style={{ display: subTab === 'table'   ? 'block' : 'none' }}><TableExplorer contrasts={contrasts} annMap={annMap} annDetails={annDetails} /></div>
    </div>
  )
}
