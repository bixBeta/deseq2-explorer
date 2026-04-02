import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import Plotly from 'plotly.js-dist-min'

// ── Emerald palette (scoped to this component via data-accent="emerald") ──────
const EM = {
  accent:  '#059669',
  accent2: '#10b981',
  text:    '#34d399',
  muted:   'rgba(5,150,105,0.13)',
  border:  'rgba(5,150,105,0.28)',
  up:      '#10b981',
  down:    '#f43f5e',
}

// ── Constants ─────────────────────────────────────────────────────────────────
const COLLECTIONS = [
  { id: 'H',  sub: null,               key: 'H',      label: 'Hallmarks',    icon: '★', desc: '50 hallmark gene sets — highly curated' },
  { id: 'C2', sub: 'CP:KEGG_LEGACY',  key: 'KEGG',   label: 'KEGG',         icon: '⬡', desc: 'KEGG canonical pathways' },
  { id: 'C2', sub: 'CP:REACTOME',     key: 'REACT',  label: 'Reactome',     icon: '◎', desc: 'Reactome biological pathways' },
  { id: 'C2', sub: 'CP:WIKIPATHWAYS', key: 'WIKI',   label: 'WikiPathways', icon: '◈', desc: 'Community-curated pathways' },
  { id: 'C5', sub: 'GO:BP',           key: 'GOBP',   label: 'GO: BP',       icon: '●', desc: 'GO Biological Process (large — may take ~60s)' },
  { id: 'C5', sub: 'GO:MF',           key: 'GOMF',   label: 'GO: MF',       icon: '◆', desc: 'GO Molecular Function' },
  { id: 'C5', sub: 'GO:CC',           key: 'GOCC',   label: 'GO: CC',       icon: '▲', desc: 'GO Cellular Component' },
  { id: 'C6', sub: null,              key: 'C6',     label: 'Oncogenic',    icon: '⬟', desc: 'Oncogenic signatures (C6)' },
  { id: 'C7', sub: 'IMMUNESIGDB',     key: 'IMMUNE', label: 'ImmuneSigDB',  icon: '⬡', desc: 'Curated immune cell signatures (C7)' },
  { id: 'C8', sub: null,              key: 'C8',     label: 'Cell Types',   icon: '◉', desc: 'Cell type gene signatures (C8)' },
]

const SPECIES = [
  'Homo sapiens', 'Mus musculus', 'Rattus norvegicus',
  'Danio rerio', 'Drosophila melanogaster', 'Caenorhabditis elegans',
]

const RANK_METHODS = [
  { value: 'log2FC',         label: 'log₂ Fold Change',           hint: 'Simple, interpretable' },
  { value: 'stat',           label: 'Wald Statistic',             hint: 'Accounts for LFC uncertainty' },
  { value: 'signed_logpadj', label: 'sign(FC) × −log₁₀(padj)',   hint: 'Significance-weighted ranking' },
]

// ── Label style ───────────────────────────────────────────────────────────────
const LBL = {
  fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: EM.text,
}

// ── Section divider ───────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{ ...LBL, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <div style={{ flex: 1, height: 1, background: EM.border }} />
      {children}
      <div style={{ flex: 1, height: 1, background: EM.border }} />
    </div>
  )
}

// ── Density plot with cutoff line ─────────────────────────────────────────────
function DensityPlot({ histData, cutoffLog }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!histData || !ref.current) return
    const { hist } = histData
    const trace = {
      x: hist.x, y: hist.y, type: 'bar',
      marker: { color: 'rgba(16,185,129,0.3)', line: { color: 'rgba(16,185,129,0.55)', width: 0.5 } },
      hovertemplate: 'log₁p(median): %{x:.2f}<br>Genes: %{y}<extra></extra>',
    }
    const layout = {
      height: 130, margin: { t: 4, r: 6, b: 28, l: 36 },
      xaxis: { title: { text: 'log₁p(row median)', font: { size: 9 } }, color: 'var(--text-3)', gridcolor: 'var(--border)', zeroline: false, tickfont: { size: 8 } },
      yaxis: { color: 'var(--text-3)', gridcolor: 'var(--border)', tickfont: { size: 8 } },
      plot_bgcolor: 'transparent', paper_bgcolor: 'transparent', bargap: 0,
      shapes: [{
        type: 'line', x0: cutoffLog, x1: cutoffLog, y0: 0, y1: 1, yref: 'paper',
        line: { color: '#f43f5e', width: 2, dash: 'dash' },
      }],
    }
    Plotly.react(ref.current, [trace], layout, { displayModeBar: false, responsive: true })
  }, [histData, cutoffLog])

  return <div ref={ref} style={{ width: '100%' }} />
}

// ── Collection grid ───────────────────────────────────────────────────────────
function CollectionGrid({ selected, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
      {COLLECTIONS.map(c => {
        const active = selected.key === c.key
        return (
          <button key={c.key} onClick={() => onChange(c)} title={c.desc}
            style={{
              padding: '6px 8px', borderRadius: 7, cursor: 'pointer', textAlign: 'left',
              background: active ? EM.muted : 'var(--bg-card2)',
              border: `1px solid ${active ? EM.border : 'var(--border)'}`,
              color: active ? EM.text : 'var(--text-2)',
              boxShadow: active ? `0 0 0 1.5px ${EM.accent}55` : 'none',
              transition: 'all 0.12s',
            }}>
            <div style={{ fontSize: '0.82rem', marginBottom: 1 }}>{c.icon} {c.label}</div>
            <div style={{ fontSize: '0.62rem', color: active ? 'rgba(52,211,153,0.7)' : 'var(--text-3)', lineHeight: 1.3 }}>
              {c.desc.split('—')[0].trim()}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── NES bar cell ──────────────────────────────────────────────────────────────
function NESBar({ nes, maxAbs }) {
  const pct = Math.min((Math.abs(nes) / maxAbs) * 46, 46)
  return (
    <div style={{ position: 'relative', width: 90, height: 18, display: 'flex', alignItems: 'center' }}>
      {/* Centre line */}
      <div style={{ position: 'absolute', left: '50%', top: '15%', width: 1, height: '70%', background: 'var(--border)' }} />
      {/* Bar */}
      <div style={{
        position: 'absolute',
        width: `${pct}%`, height: '55%', top: '22%',
        left: nes > 0 ? '50%' : `${50 - pct}%`,
        background: nes > 0 ? 'rgba(16,185,129,0.55)' : 'rgba(244,63,94,0.55)',
        borderRadius: 2, transition: 'width 0.2s',
      }} />
      {/* Value */}
      <span style={{
        position: 'absolute', right: nes > 0 ? 0 : undefined, left: nes <= 0 ? 0 : undefined,
        fontSize: '0.68rem', fontFamily: 'monospace',
        color: nes > 0 ? EM.up : EM.down, fontWeight: 600,
      }}>
        {nes > 0 ? '+' : ''}{nes.toFixed(2)}
      </span>
    </div>
  )
}

// ── Results table ─────────────────────────────────────────────────────────────
function ResultsTable({ results, onPathwayClick, selectedPathway }) {
  const [sortKey,  setSortKey]  = useState('padj')
  const [sortAsc,  setSortAsc]  = useState(true)
  const [dirFilter, setDirFilter] = useState('all')  // 'all'|'up'|'down'
  const [query,    setQuery]    = useState('')
  const [page,     setPage]     = useState(0)
  const PER_PAGE = 30

  const maxAbs = useMemo(() => Math.max(...results.map(r => Math.abs(r.NES || 0)), 1), [results])

  const filtered = useMemo(() => {
    let r = results
    if (dirFilter === 'up')   r = r.filter(x => (x.NES || 0) > 0)
    if (dirFilter === 'down') r = r.filter(x => (x.NES || 0) < 0)
    if (query) {
      const q = query.toLowerCase()
      r = r.filter(x => x.pathway?.toLowerCase().includes(q))
    }
    return [...r].sort((a, b) => {
      const av = a[sortKey] ?? Infinity, bv = b[sortKey] ?? Infinity
      return sortAsc ? av - bv : bv - av
    })
  }, [results, dirFilter, query, sortKey, sortAsc])

  const pages = Math.ceil(filtered.length / PER_PAGE)
  const pageData = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE)

  function toggleSort(key) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
    setPage(0)
  }

  const thStyle = (key) => ({
    padding: '7px 10px', textAlign: 'left', cursor: 'pointer',
    fontSize: '0.67rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
    color: sortKey === key ? EM.text : 'var(--text-3)',
    userSelect: 'none', whiteSpace: 'nowrap', background: 'var(--bg-card2)',
    borderBottom: `2px solid ${sortKey === key ? EM.accent : 'var(--border)'}`,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Direction filter */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${EM.border}` }}>
          {[['all','All'], ['up','↑ Enriched'], ['down','↓ Depleted']].map(([v, l]) => (
            <button key={v} onClick={() => { setDirFilter(v); setPage(0) }}
              style={{
                padding: '4px 10px', border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600,
                background: dirFilter === v ? EM.accent : 'var(--bg-card2)',
                color: dirFilter === v ? '#fff' : 'var(--text-3)',
                transition: 'background 0.12s',
              }}>{l}</button>
          ))}
        </div>

        {/* Search */}
        <input
          value={query} onChange={e => { setQuery(e.target.value); setPage(0) }}
          placeholder="Search pathways…"
          style={{
            flex: 1, minWidth: 160, padding: '4px 10px', fontSize: '0.78rem',
            background: 'var(--bg-card2)', border: `1px solid ${EM.border}`,
            borderRadius: 8, color: 'var(--text-1)',
          }}
        />

        <span style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginLeft: 'auto' }}>
          {filtered.length} pathways
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: 10, border: `1px solid ${EM.border}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr>
              <th style={thStyle('pathway')} onClick={() => toggleSort('pathway')}>
                Pathway {sortKey === 'pathway' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th style={{ ...thStyle('NES'), cursor: 'pointer' }} onClick={() => toggleSort('NES')}>
                NES {sortKey === 'NES' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th style={thStyle('padj')} onClick={() => toggleSort('padj')}>
                padj {sortKey === 'padj' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th style={thStyle('size')} onClick={() => toggleSort('size')}>
                Size {sortKey === 'size' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th style={{ ...thStyle('leadingEdgeN'), cursor: 'default' }}>Leading Edge</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((r, i) => {
              const isSelected = selectedPathway === r.pathway
              const fmtName = r.pathway?.replace(/_/g, ' ').replace(/^[A-Z0-9]+\s+/, '') ?? r.pathway
              return (
                <tr key={r.pathway ?? i}
                  onClick={() => onPathwayClick(r)}
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? EM.muted : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                    borderLeft: isSelected ? `3px solid ${EM.accent}` : '3px solid transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(5,150,105,0.06)' }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}
                >
                  <td style={{ padding: '7px 10px', color: 'var(--text-1)', maxWidth: 340 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.pathway}>
                      {fmtName}
                    </div>
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <NESBar nes={r.NES ?? 0} maxAbs={maxAbs} />
                  </td>
                  <td style={{
                    padding: '7px 10px', fontFamily: 'monospace', fontSize: '0.72rem',
                    color: r.padj < 0.05 ? EM.text : r.padj < 0.25 ? 'var(--text-2)' : 'var(--text-3)',
                  }}>
                    {r.padj < 0.001 ? r.padj.toExponential(1) : r.padj?.toFixed(3)}
                  </td>
                  <td style={{ padding: '7px 10px', color: 'var(--text-2)', fontFamily: 'monospace', fontSize: '0.72rem' }}>
                    {r.size}
                  </td>
                  <td style={{ padding: '7px 10px', color: 'var(--text-3)', fontSize: '0.7rem', maxWidth: 220 }}>
                    <span style={{ fontFamily: 'monospace', color: EM.text, fontWeight: 600 }}>
                      {r.leadingEdgeN}
                    </span>
                    {' '}
                    <span style={{ opacity: 0.7 }}>
                      {(r.leadingEdge || '').split(',').slice(0, 4).join(', ')}
                      {r.leadingEdgeN > 4 ? `… +${r.leadingEdgeN - 4}` : ''}
                    </span>
                  </td>
                </tr>
              )
            })}
            {pageData.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>
                No pathways match the filter
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ padding: '3px 10px', borderRadius: 6, fontSize: '0.75rem', cursor: page === 0 ? 'default' : 'pointer',
                     background: 'var(--bg-card2)', border: `1px solid ${EM.border}`, color: 'var(--text-2)', opacity: page === 0 ? 0.4 : 1 }}>
            ←
          </button>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
            {page + 1} / {pages}
          </span>
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page === pages - 1}
            style={{ padding: '3px 10px', borderRadius: 6, fontSize: '0.75rem', cursor: page === pages - 1 ? 'default' : 'pointer',
                     background: 'var(--bg-card2)', border: `1px solid ${EM.border}`, color: 'var(--text-2)', opacity: page === pages - 1 ? 0.4 : 1 }}>
            →
          </button>
        </div>
      )}
    </div>
  )
}

// ── Mountain plot modal ───────────────────────────────────────────────────────
function MountainModal({ pathway, result, curveData, curveLoading, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!curveData || !ref.current) return
    const { x, y, hits, nHits } = curveData
    const nes = result?.NES ?? 0
    const color = nes >= 0 ? EM.up : EM.down
    const colorFade = nes >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)'

    const peakIdx = nes >= 0 ? y.indexOf(Math.max(...y)) : y.indexOf(Math.min(...y))
    const peakX   = x[peakIdx] ?? 0.5

    // Running ES trace
    const curveTrace = {
      x, y, type: 'scatter', mode: 'lines', line: { color, width: 2.5 },
      fill: 'tozeroy', fillcolor: colorFade,
      name: 'Running ES',
      hovertemplate: 'Rank: %{x:.3f}<br>ES: %{y:.4f}<extra></extra>',
    }

    // Rug plot — pathway gene positions
    const rugTrace = {
      x: hits,
      y: Array(hits.length).fill(-0.07),
      type: 'scatter', mode: 'markers',
      marker: { symbol: 'line-ns-open', size: 11, color: 'rgba(16,185,129,0.5)', line: { width: 1.2, color } },
      name: 'Pathway genes',
      hovertemplate: 'Gene rank: %{x:.4f}<extra></extra>',
    }

    const fmtName = (pathway || '').replace(/_/g, ' ')
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-1').trim() || '#e2e8f0'
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#1e293b'

    const layout = {
      height: 380,
      margin: { t: 60, r: 20, b: 50, l: 58 },
      title: {
        text: `<b>${fmtName.slice(0, 70)}${fmtName.length > 70 ? '…' : ''}</b>`,
        font: { size: 12, color: textColor }, x: 0.5,
      },
      xaxis: {
        title: 'Gene rank (normalised 0 → 1)', range: [-0.01, 1.01],
        color: 'var(--text-3)', gridcolor: gridColor, zeroline: false, tickfont: { size: 10 },
      },
      yaxis: {
        title: 'Running enrichment score',
        range: [Math.min(...y, -0.12), Math.max(...y) * 1.12],
        color: 'var(--text-3)', gridcolor: gridColor, zeroline: true,
        zerolinecolor: 'var(--text-3)', zerolinewidth: 1,
        tickfont: { size: 10 },
      },
      plot_bgcolor: 'transparent', paper_bgcolor: 'transparent',
      legend: { font: { size: 10, color: 'var(--text-3)' }, x: 0.01, y: 0.99 },
      annotations: [{
        x: 0.99, y: 0.96, xref: 'paper', yref: 'paper', xanchor: 'right', yanchor: 'top',
        text: `NES: <b>${(nes > 0 ? '+' : '') + nes.toFixed(3)}</b>  padj: <b>${result?.padj < 0.001 ? result.padj.toExponential(1) : result?.padj?.toFixed(3)}</b>  n=${nHits}/${result?.size}`,
        showarrow: false, font: { size: 10.5, color: textColor },
        bgcolor: 'rgba(0,0,0,0.3)', borderpad: 5, borderradius: 5,
      }],
      shapes: [
        // Zero line
        { type: 'line', x0: 0, x1: 1, y0: 0, y1: 0, xref: 'paper', line: { color: 'var(--border)', width: 1 } },
        // Peak line
        { type: 'line', x0: peakX, x1: peakX, y0: 0, y1: 1, yref: 'paper', line: { color, width: 1, dash: 'dot' } },
        // Rug separator
        { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: -0.05, y1: -0.05, line: { color: 'var(--border)', width: 0.8 } },
      ],
    }

    Plotly.react(ref.current, [curveTrace, rugTrace], layout, {
      responsive: true, displaylogo: false,
      modeBarButtonsToRemove: ['select2d', 'lasso2d'],
      toImageButtonOptions: { filename: 'enrichment_plot', scale: 2, format: 'png' },
    })
  }, [curveData, pathway, result])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-panel)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 740,
        border: `1px solid ${EM.border}`, boxShadow: `0 0 40px rgba(5,150,105,0.15)`,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ ...LBL, fontSize: '0.7rem' }}>Enrichment Plot</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
        </div>

        {curveLoading ? (
          <div style={{ height: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <span style={{ width: 36, height: 36, borderRadius: '50%', border: `3px solid ${EM.muted}`, borderTopColor: EM.accent, display: 'inline-block', animation: 'gsea-spin 0.7s linear infinite' }} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>Computing enrichment curve…</span>
          </div>
        ) : curveData ? (
          <>
            <div ref={ref} style={{ width: '100%' }} />
            <div style={{ marginTop: 10, fontSize: '0.72rem', color: 'var(--text-3)', lineHeight: 1.5 }}>
              <b style={{ color: EM.text }}>Leading edge:</b>{' '}
              {(result?.leadingEdge || '').split(',').slice(0, 12).join(', ')}
              {result?.leadingEdgeN > 12 ? ` … +${result.leadingEdgeN - 12} more` : ''}
            </div>
          </>
        ) : null}
      </div>
      <style>{`@keyframes gsea-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Main GSEAExplorer component ───────────────────────────────────────────────
export default function GSEAExplorer({ session, contrastLabel, annMap }) {
  // ── Config state ──
  const [rankMethod,    setRankMethod]    = useState('log2FC')
  const [collection,    setCollection]    = useState(COLLECTIONS[0])
  const [species,       setSpecies]       = useState('Homo sapiens')
  const [minSize,       setMinSize]       = useState(15)
  const [maxSize,       setMaxSize]       = useState(500)
  const [filterMethod,  setFilterMethod]  = useState('quantile')   // 'quantile' | 'count'
  const [filterValue,   setFilterValue]   = useState(0.25)         // 0-1 if quantile, count if count

  // ── Preview (density plot) ──
  const [histData,      setHistData]      = useState(null)
  const [histLoading,   setHistLoading]   = useState(false)

  // ── Run state ──
  const [running,       setRunning]       = useState(false)
  const [runError,      setRunError]      = useState(null)
  const [elapsed,       setElapsed]       = useState(0)
  const [gseaData,      setGseaData]      = useState(null)   // { results, rankedList, meta }

  // ── Enrichment curve ──
  const [selPathway,    setSelPathway]     = useState(null)   // { pathway, NES, padj, size, leadingEdge, leadingEdgeN }
  const [curveData,     setCurveData]     = useState(null)
  const [curveLoading,  setCurveLoading]  = useState(false)
  const curveCacheRef   = useRef({})

  // ── Fetch histogram preview ───────────────────────────────────────────────
  useEffect(() => {
    if (!session?.sessionId) return
    setHistData(null); setHistLoading(true)
    const ctrl = new AbortController()
    fetch('/api/gsea/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.sessionId, contrastLabel }),
      signal: ctrl.signal,
    })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setHistData(d); setHistLoading(false) })
      .catch(e => { if (e.name !== 'AbortError') setHistLoading(false) })
    return () => ctrl.abort()
  }, [session, contrastLabel])

  // ── Derive cutoff values ──────────────────────────────────────────────────
  const { cutoffOrig, cutoffLog, genesAbove } = useMemo(() => {
    if (!histData) return { cutoffOrig: 0, cutoffLog: 0, genesAbove: 0 }
    let orig
    if (filterMethod === 'quantile') {
      const idx = Math.min(Math.round(filterValue * 100), 100)
      orig = histData.quantileValues?.[idx] ?? 0
    } else {
      orig = filterValue
    }
    const logC = Math.log1p(orig)
    let above = 0
    histData.hist.x.forEach((mid, i) => { if (mid >= logC) above += histData.hist.y[i] })
    return { cutoffOrig: orig, cutoffLog: logC, genesAbove: above }
  }, [histData, filterMethod, filterValue])

  // ── Run GSEA ──────────────────────────────────────────────────────────────
  const runCtrlRef = useRef(null)

  const handleRun = useCallback(async () => {
    if (!session?.sessionId) return
    runCtrlRef.current?.abort()
    const ctrl = new AbortController()
    runCtrlRef.current = ctrl

    setRunning(true); setRunError(null); setGseaData(null)
    setSelPathway(null); setCurveData(null)
    curveCacheRef.current = {}

    let tick = 0
    const timer = setInterval(() => setElapsed(++tick), 1000)

    try {
      const r = await fetch('/api/gsea/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId:     session.sessionId,
          contrastLabel,
          rankMethod,
          collection:    collection.id,
          subcategory:   collection.sub,
          species,
          minSize,
          maxSize,
          filterMethod,
          filterValue,
          annMap:        annMap || null,
        }),
        signal: ctrl.signal,
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      setGseaData(data)
    } catch (e) {
      if (e.name !== 'AbortError') setRunError(e.message)
    } finally {
      clearInterval(timer)
      setElapsed(0)
      setRunning(false)
    }
  }, [session, contrastLabel, rankMethod, collection, species, minSize, maxSize, filterMethod, filterValue, annMap])

  // ── Fetch enrichment curve on pathway click ───────────────────────────────
  const handlePathwayClick = useCallback(async (result) => {
    setSelPathway(result)
    setCurveData(null)

    if (curveCacheRef.current[result.pathway]) {
      setCurveData(curveCacheRef.current[result.pathway])
      return
    }
    setCurveLoading(true)
    try {
      const r = await fetch('/api/gsea/curve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId:     session.sessionId,
          contrastLabel,
          pathway:       result.pathway,
          collection:    collection.id,
          subcategory:   collection.sub,
          species,
        }),
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      curveCacheRef.current[result.pathway] = data
      setCurveData(data)
    } catch (e) {
      setCurveData(null)
    } finally {
      setCurveLoading(false)
    }
  }, [session, contrastLabel, collection, species])

  // ── Slider range for filter ───────────────────────────────────────────────
  const countMax = histData?.quartiles?.q90 ?? 1000

  if (!session?.sessionId) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>
        No session — please load data first.
      </div>
    )
  }

  return (
    <div data-accent="emerald" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* ── Header banner ────────────────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, rgba(5,150,105,0.12) 0%, rgba(16,185,129,0.05) 100%)`,
        border: `1px solid ${EM.border}`, borderRadius: 12, padding: '14px 20px',
        marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: EM.text, letterSpacing: '-0.01em' }}>
            ⟳ GSEA Explorer
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 2 }}>
            fgsea · MSigDB · Ranked gene set enrichment
          </div>
        </div>
        {contrastLabel && (
          <div style={{
            marginLeft: 'auto', padding: '4px 12px', borderRadius: 20,
            background: EM.muted, border: `1px solid ${EM.border}`,
            fontSize: '0.72rem', color: EM.text, fontWeight: 600,
          }}>
            {contrastLabel}
          </div>
        )}
        {gseaData?.meta && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              [gseaData.meta.n_pathways, 'pathways'],
              [gseaData.meta.n_genes_ranked, 'genes ranked'],
              [`${gseaData.meta.elapsedSecs}s`, 'runtime'],
            ].map(([v, l]) => (
              <div key={l} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: EM.text }}>{v?.toLocaleString()}</div>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Main layout: sidebar + content ───────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

        {/* ── LEFT SIDEBAR (parameters) ───────────────────────────────────── */}
        <div style={{
          width: 300, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 14,
          background: 'var(--bg-card)', borderRadius: 12, padding: 16,
          border: `1px solid ${EM.border}`,
          position: 'sticky', top: 80, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto',
        }}>

          {/* Rank method */}
          <div>
            <SectionLabel>Rank method</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {RANK_METHODS.map(m => (
                <label key={m.value} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
                  padding: '7px 10px', borderRadius: 8,
                  background: rankMethod === m.value ? EM.muted : 'var(--bg-card2)',
                  border: `1px solid ${rankMethod === m.value ? EM.border : 'var(--border)'}`,
                  transition: 'all 0.12s',
                }}>
                  <input type="radio" checked={rankMethod === m.value}
                    onChange={() => setRankMethod(m.value)}
                    style={{ marginTop: 2, accentColor: EM.accent }} />
                  <div>
                    <div style={{ fontSize: '0.78rem', color: rankMethod === m.value ? EM.text : 'var(--text-1)', fontWeight: 600 }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-3)' }}>{m.hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Pre-filter */}
          <div>
            <SectionLabel>Pre-filter genes</SectionLabel>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {[['quantile', 'Quantile'], ['count', 'Count cutoff']].map(([v, l]) => (
                <button key={v} onClick={() => { setFilterMethod(v); setFilterValue(v === 'quantile' ? 0.25 : 10) }}
                  style={{
                    flex: 1, padding: '4px 0', fontSize: '0.7rem', fontWeight: 600,
                    borderRadius: 6, cursor: 'pointer', border: 'none',
                    background: filterMethod === v ? EM.accent : 'var(--bg-card2)',
                    color: filterMethod === v ? '#fff' : 'var(--text-2)',
                    transition: 'all 0.12s',
                  }}>{l}</button>
              ))}
            </div>

            {histLoading ? (
              <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: '0.72rem' }}>
                Loading distribution…
              </div>
            ) : (
              <DensityPlot histData={histData} cutoffLog={cutoffLog} />
            )}

            {filterMethod === 'quantile' ? (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-3)', marginBottom: 4 }}>
                  <span>Remove bottom percentile</span>
                  <span style={{ color: EM.text, fontWeight: 700 }}>{(filterValue * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min={0} max={0.75} step={0.01} value={filterValue}
                  onChange={e => setFilterValue(+e.target.value)}
                  style={{ width: '100%', accentColor: EM.accent }} />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Min row median ≥</span>
                <input type="range" min={0} max={Math.max(countMax, 100)} step={1} value={filterValue}
                  onChange={e => setFilterValue(+e.target.value)}
                  style={{ flex: 1, accentColor: EM.accent }} />
                <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: EM.text, minWidth: 36 }}>{filterValue}</span>
              </div>
            )}

            <div style={{
              display: 'flex', justifyContent: 'space-between', padding: '5px 10px',
              background: EM.muted, borderRadius: 6, marginTop: 8, fontSize: '0.7rem',
              border: `1px solid ${EM.border}`,
            }}>
              <span style={{ color: 'var(--text-3)' }}>Genes passing filter</span>
              <span style={{ color: EM.text, fontWeight: 700 }}>~{genesAbove.toLocaleString()}</span>
            </div>
          </div>

          {/* Collection */}
          <div>
            <SectionLabel>Gene set collection</SectionLabel>
            <CollectionGrid selected={collection} onChange={setCollection} />
          </div>

          {/* Gene set sizes */}
          <div>
            <SectionLabel>Gene set size</SectionLabel>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {[['Min', minSize, setMinSize, 5, 50], ['Max', maxSize, setMaxSize, 100, 2000]].map(([lbl, val, set, mn, mx]) => (
                <div key={lbl} style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.66rem', color: 'var(--text-3)', marginBottom: 3 }}>{lbl}</div>
                  <input type="number" value={val} min={mn} max={mx}
                    onChange={e => set(Math.max(mn, Math.min(mx, +e.target.value || mn)))}
                    style={{
                      width: '100%', padding: '4px 8px', fontSize: '0.78rem', textAlign: 'center',
                      background: 'var(--bg-card2)', border: `1px solid ${EM.border}`,
                      borderRadius: 7, color: 'var(--text-1)',
                    }} />
                </div>
              ))}
            </div>
          </div>

          {/* Species */}
          <div>
            <SectionLabel>Species</SectionLabel>
            <select value={species} onChange={e => setSpecies(e.target.value)}
              style={{
                width: '100%', padding: '6px 10px', fontSize: '0.78rem',
                background: 'var(--bg-card2)', border: `1px solid ${EM.border}`,
                borderRadius: 7, color: 'var(--text-1)',
              }}>
              {SPECIES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          {/* Run button */}
          <button onClick={handleRun} disabled={running}
            style={{
              padding: '11px 0', borderRadius: 10, border: 'none', cursor: running ? 'wait' : 'pointer',
              background: running ? 'rgba(5,150,105,0.35)' : `linear-gradient(135deg, ${EM.accent}, ${EM.accent2})`,
              color: '#fff', fontWeight: 700, fontSize: '0.88rem', letterSpacing: '0.02em',
              boxShadow: running ? 'none' : `0 4px 14px rgba(5,150,105,0.4)`,
              transition: 'all 0.15s', marginTop: 4,
            }}>
            {running
              ? `Running fgsea… ${elapsed}s`
              : gseaData ? '↺ Re-run GSEA' : '▶ Run GSEA'}
          </button>

          {runError && (
            <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: '0.75rem', background: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}>
              ⚠ {runError}
            </div>
          )}

          {!annMap && (
            <div style={{ padding: '7px 10px', borderRadius: 8, fontSize: '0.68rem', background: 'rgba(251,191,36,0.08)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)', lineHeight: 1.4 }}>
              ⚠ No annotation loaded. If using ENSEMBL IDs, run <b>Annotate</b> first for better gene set matching.
            </div>
          )}
        </div>

        {/* ── RIGHT CONTENT (results) ──────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!gseaData && !running && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              minHeight: 400, gap: 16, color: 'var(--text-3)',
            }}>
              <div style={{ fontSize: '3rem', opacity: 0.3 }}>⟳</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-2)' }}>
                Configure parameters and click Run GSEA
              </div>
              <div style={{ fontSize: '0.78rem', maxWidth: 380, textAlign: 'center', lineHeight: 1.6 }}>
                Select a gene set collection, set your rank method and pre-filter, then hit Run.
                Click any result row to open its enrichment mountain plot.
              </div>
            </div>
          )}

          {running && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16 }}>
              <div style={{ position: 'relative', width: 56, height: 56 }}>
                <div style={{
                  width: '100%', height: '100%', borderRadius: '50%',
                  border: `3px solid ${EM.muted}`, borderTopColor: EM.accent,
                  animation: 'gsea-spin 0.8s linear infinite',
                }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, color: EM.text }}>
                  {elapsed}s
                </div>
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-2)', fontWeight: 600 }}>Running fgsea…</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', textAlign: 'center', maxWidth: 300, lineHeight: 1.5 }}>
                {collection.label} · {species}<br />
                Large collections (GO:BP) may take 60+ seconds
              </div>
            </div>
          )}

          {gseaData?.results && (
            <ResultsTable
              results={gseaData.results}
              onPathwayClick={handlePathwayClick}
              selectedPathway={selPathway?.pathway}
            />
          )}
        </div>
      </div>

      {/* ── Mountain plot modal ──────────────────────────────────────────── */}
      {selPathway && (
        <MountainModal
          pathway={selPathway.pathway}
          result={selPathway}
          curveData={curveData}
          curveLoading={curveLoading}
          onClose={() => { setSelPathway(null); setCurveData(null) }}
        />
      )}

      <style>{`@keyframes gsea-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
