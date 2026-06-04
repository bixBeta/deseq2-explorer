import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Plotly from 'plotly.js-dist-min'
import { useDownloadDialog } from './DownloadDialog'

// ── Ocean palette — green/red preserved for ±NES ─────────────────────────────
const V = {
  accent:  '#0b446f',
  accent2: '#1a6a9f',
  text:    '#3a8fc7',
  muted:   'rgba(11,68,111,0.12)',
  border:  'rgba(11,68,111,0.35)',
  card:    'rgba(11,68,111,0.06)',
  up:      '#10b981',
  down:    '#f43f5e',
}

// ── Sample color palette ──────────────────────────────────────────────────────
const SAMPLE_COLORS = [
  '#8b5cf6','#06b6d4','#f59e0b','#10b981','#fb923c',
  '#a78bfa','#34d399','#60a5fa','#f472b6','#fcd34d',
  '#4ade80','#e879f9','#38bdf8','#fb7185','#818cf8',
]

// ── Constants ─────────────────────────────────────────────────────────────────
const COLLECTIONS = [
  { id:'H',      sub:null,               key:'H',      label:'Hallmarks',    icon:'★', desc:'50 curated hallmark gene sets' },
  { id:'C2',     sub:'CP:KEGG_LEGACY',  key:'KEGG',   label:'KEGG',         icon:'⬡', desc:'KEGG canonical pathways' },
  { id:'C2',     sub:'CP:REACTOME',     key:'REACT',  label:'Reactome',     icon:'◎', desc:'Reactome biological pathways' },
  { id:'C2',     sub:'CP:WIKIPATHWAYS', key:'WIKI',   label:'WikiPathways', icon:'◈', desc:'Community-curated pathways' },
  { id:'C5',     sub:'GO:BP',           key:'GOBP',   label:'GO: BP',       icon:'●', desc:'GO Biological Process (large)' },
  { id:'C5',     sub:'GO:MF',           key:'GOMF',   label:'GO: MF',       icon:'◆', desc:'GO Molecular Function' },
  { id:'C5',     sub:'GO:CC',           key:'GOCC',   label:'GO: CC',       icon:'▲', desc:'GO Cellular Component' },
  { id:'C6',     sub:null,              key:'C6',     label:'Oncogenic',    icon:'⬟', desc:'Oncogenic signatures (C6)' },
  { id:'C7',     sub:'IMMUNESIGDB',     key:'IMMUNE', label:'ImmuneSigDB',  icon:'⬡', desc:'Immune cell signatures (C7)' },
  { id:'C8',     sub:null,              key:'C8',     label:'Cell Types',   icon:'◉', desc:'Cell type gene sets (C8)' },
  { id:'CUSTOM', sub:null,              key:'CUSTOM', label:'Custom GMT',   icon:'📂', desc:'Import your own .gmt file' },
]
const SPECIES      = ['Homo sapiens','Mus musculus','Rattus norvegicus','Danio rerio','Drosophila melanogaster','Caenorhabditis elegans']
const RANK_METHODS = [
  { value:'log2FC',         label:'log₂ Fold Change',         short:'LFC',  hint:'Simple, interpretable' },
  { value:'stat',           label:'Wald Statistic',           short:'Stat', hint:'Accounts for LFC uncertainty' },
  { value:'signed_logpadj', label:'sign(FC) × −log₁₀(padj)', short:'S·LP', hint:'Significance-weighted ranking' },
]

const LBL = {
  fontSize:'0.67rem', fontWeight:700, letterSpacing:'0.06em',
  textTransform:'uppercase', color:V.text,
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function downloadCSV(rows, filename) {
  if (!rows?.length) return
  const keys = Object.keys(rows[0])
  const csv  = [keys.join(','), ...rows.map(r => keys.map(k => JSON.stringify(r[k]??'')).join(','))].join('\n')
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv],{type:'text/csv'})), download: filename,
  })
  a.click(); URL.revokeObjectURL(a.href)
}
function fmtPval(v) { return v==null ? '—' : v<0.001 ? v.toExponential(1) : v.toFixed(3) }

// Binary-search gene count: how many medians >= cutoff in a sorted sample
function genesAbove(medsSample, cutoff, nTotal) {
  if (!medsSample?.length) return 0
  let lo=0, hi=medsSample.length
  while (lo<hi) { const mid=(lo+hi)>>1; if (medsSample[mid]<cutoff) lo=mid+1; else hi=mid }
  return Math.round(((medsSample.length-lo)/medsSample.length)*nTotal)
}

// ── GMT file parser: returns { sets: { name:[genes] }, pathwayCount, geneCount } ─
// GMT format: name \t description \t gene1 \t gene2 ...
// Smart label: merges description into name (spaces→underscores) when description
// adds real information (i.e. not a URL, not blank/NA, not identical to the name).
function parseGmt(text) {
  const isUrl   = s => /^https?:\/\//i.test(s)
  const isBlank = s => !s || /^(na|none|n\/a|-|null|unknown)$/i.test(s.trim())

  const sets = {}
  let totalGenes = 0

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split('\t')
    if (parts.length < 3) continue

    const rawName = parts[0].trim()
    const rawDesc = parts[1].trim()
    const genes   = parts.slice(2).map(g => g.trim()).filter(Boolean)
    if (!rawName || !genes.length) continue

    // Build a display label: append description when it adds real info
    let label = rawName
    if (!isBlank(rawDesc) && !isUrl(rawDesc) && rawDesc !== rawName) {
      // Replace whitespace with underscores so the label is a clean single token
      const descClean = rawDesc.trim().replace(/\s+/g, '_')
      label = `${rawName}_${descClean}`
    }

    // Guard against duplicate labels (edge case in poorly-formatted GMT files)
    let finalLabel = label
    let suffix = 1
    while (sets[finalLabel]) { finalLabel = `${label}_${++suffix}` }

    sets[finalLabel] = genes
    totalGenes += genes.length
  }

  return { sets, pathwayCount: Object.keys(sets).length, geneCount: totalGenes }
}

// ── Section divider ───────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{ ...LBL, display:'flex', alignItems:'center', gap:6, marginBottom:7 }}>
      <div style={{ flex:1, height:1, background:V.border }} />{children}<div style={{ flex:1, height:1, background:V.border }} />
    </div>
  )
}

// ── KDE utility: find approximate percentile from a KDE ─────────────────────
function kdePercentile(kde, p = 0.5) {
  const { x, y } = kde
  if (!x?.length) return 0
  let total = 0
  const steps = x.length - 1
  for (let i = 0; i < steps; i++) total += (y[i] + y[i+1]) * (x[i+1]-x[i]) / 2
  let cumul = 0, target = total * p
  for (let i = 0; i < steps; i++) {
    const trap = (y[i] + y[i+1]) * (x[i+1]-x[i]) / 2
    cumul += trap
    if (cumul >= target) {
      const frac = trap > 0 ? (target-(cumul-trap))/trap : 0
      return x[i] + frac * (x[i+1]-x[i])
    }
  }
  return x[x.length-1]
}

// ── Dual-panel KDE chart (pre & post filter) ─────────────────────────────────
function DualDensityChart({ histData, cutoffLog, height = 300 }) {
  const preRef      = useRef(null)
  const postRef     = useRef(null)
  // true = count-value tick labels (default); false = raw log₁p numeric labels
  const [countLabels, setCountLabels] = useState(true)

  useEffect(() => {
    if (!histData?.kdes || !preRef.current || !postRef.current) return
    if (histData.kdes.length > 60) return   // skip — warning shown in JSX instead
    const { kdes } = histData
    const showLegend = kdes.length <= 16
    const textColor  = getComputedStyle(document.documentElement).getPropertyValue('--text-3').trim() || '#94a3b8'
    const isLight    = document.body.classList.contains('light')
    const gridColor  = isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.12)'
    const modebarBg  = isLight ? 'rgba(255,255,255,0.85)' : 'rgba(15,23,42,0.85)'
    const plotCfg    = { responsive:true, displaylogo:false, modeBarButtonsToRemove:['select2d','lasso2d'] }

    // x is always log₁p — only tick labeling differs
    const allXLog = kdes.flatMap(k => k.x)
    const xMaxLog = Math.max(...allXLog) * 1.02
    const cutoffC = Math.expm1(cutoffLog)

    const niceCountTicks = [0,1,2,3,5,10,20,50,100,200,500,1000,2000,5000,10000,20000]
      .filter(v => Math.log1p(v) <= xMaxLog)

    const baseXAxis = {
      color:textColor, gridcolor:gridColor, showgrid:true,
      zeroline:true, zerolinecolor: cutoffLog === 0 ? '#f43f5e' : gridColor, zerolinewidth:1,
      tickfont:{ size:8 },
      range:[0, xMaxLog],
      ...(countLabels
        ? { title:{ text:'normalised count  (log₁p scale)', font:{size:9} },
            tickvals: niceCountTicks.map(v => Math.log1p(v)),
            ticktext: niceCountTicks.map(v => String(v)) }
        : { title:{ text:'log₁p(normalised count)', font:{size:9} } }),
    }

    const baseLayout = {
      height,
      margin:{ t:28, r: showLegend ? 120 : 14, b:52, l:60 },
      plot_bgcolor:'transparent', paper_bgcolor:'transparent',
      xaxis: baseXAxis,
      yaxis:{ title:{ text:'Density', font:{size:9} }, color:textColor, gridcolor:gridColor, showgrid:true, zeroline:false, tickfont:{size:8} },
      legend:{ font:{size:8,color:textColor}, bgcolor:'transparent', x:1.01, y:1, xanchor:'left' },
      hovermode:'x',
      modebar:{ bgcolor:modebarBg, color:textColor, activecolor:isLight?'#000':'#fff' },
    }

    const hoverTpl = (sample) =>
      `<b>${sample}</b><br>log₁p: %{x:.3f}<br>count ≈ %{customdata:.1f}<extra></extra>`

    // Pre-filter traces
    const preTraces = kdes.map((kde, i) => ({
      x:kde.x, y:kde.y,
      customdata: kde.x.map(v => Math.expm1(v)),
      type:'scatter', mode:'lines', name:kde.sample,
      line:{ color:SAMPLE_COLORS[i%SAMPLE_COLORS.length], width:1.5, shape:'spline' },
      opacity:0.7, showlegend:showLegend,
      hovertemplate: hoverTpl(kde.sample),
    }))

    const cutoffLabel = cutoffLog === 0
      ? ' no cutoff (baseMean = 0)'
      : ` cutoff (count ≈ ${cutoffC.toFixed(1)})`

    const preLayout = {
      ...baseLayout,
      title:{ text:'Pre-filter (all genes)', font:{size:11,color:textColor}, x:0.5, xanchor:'center', y:0.97 },
      shapes:[{ type:'line', x0:cutoffLog, x1:cutoffLog, y0:0, y1:1, yref:'paper',
                line:{ color:'#f43f5e', width: cutoffLog === 0 ? 1 : 2, dash:'dash' } }],
      annotations:[{ x:cutoffLog, y:0.96, yref:'paper', xanchor:'left',
                     text:cutoffLabel, font:{size:8,color:'#f87171'}, showarrow:false }],
    }

    // Post-filter traces: keep 15 anchor points below the cutoff so the spline
    // enters the visible window smoothly, then clip the rest
    const ANCHOR = 15
    const postTraces = kdes.map((kde, i) => {
      const cutIdx   = cutoffLog === 0 ? 0 : kde.x.findIndex(v => v >= cutoffLog)
      const startIdx = Math.max(0, cutIdx - ANCHOR)
      const xs = kde.x.slice(startIdx)
      const ys = kde.y.slice(startIdx)
      return {
        x: xs, y: ys,
        customdata: xs.map(v => Math.expm1(v)),
        type:'scatter', mode:'lines', name:kde.sample,
        line:{ color:SAMPLE_COLORS[i%SAMPLE_COLORS.length], width:1.5, shape:'spline' },
        opacity:0.7, showlegend:showLegend,
        hovertemplate: hoverTpl(kde.sample),
      }
    })
    const postXStart = cutoffLog === 0 ? 0 : cutoffLog * 0.98
    // Compute y-range from only the points in the visible x window so the
    // axis doesn't scale to the off-screen pre-cutoff peak
    const postYMax = kdes.reduce((mx, kde) => {
      for (let i = 0; i < kde.x.length; i++) {
        if (kde.x[i] >= postXStart && kde.y[i] > mx) mx = kde.y[i]
      }
      return mx
    }, 0)
    const postLayout = {
      ...baseLayout,
      xaxis:{ ...baseXAxis, range:[postXStart, xMaxLog] },
      yaxis:{ ...baseLayout.yaxis, range:[0, postYMax * 1.08] },
      title:{ text:'Post-filter (genes above cutoff)', font:{size:11,color:textColor}, x:0.5, xanchor:'center', y:0.97 },
    }

    Plotly.react(preRef.current,  preTraces,  preLayout,  plotCfg)
    Plotly.react(postRef.current, postTraces, postLayout, plotCfg)
  }, [histData, cutoffLog, height, countLabels])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6, height:'100%' }}>
      {/* Label mode toggle */}
      <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
        <span style={{ fontSize:'0.7rem', color:'var(--text-3)' }}>X-axis labels:</span>
        <div style={{ display:'flex', gap:0, borderRadius:7, overflow:'hidden', border:`1px solid ${V.border}` }}>
          {[['counts','Count values (default)'],['log1p','log₁p values']].map(([key, lbl]) => {
            const active = (key === 'counts') === countLabels
            return (
              <button key={key} onClick={() => setCountLabels(key === 'counts')} style={{
                padding:'3px 10px', border:'none', cursor:'pointer', fontSize:'0.72rem', fontWeight: active ? 700 : 400,
                background: active ? V.accent : 'var(--bg-card2)',
                color: active ? '#fff' : 'var(--text-2)',
                transition:'background 0.12s',
              }}>{lbl}</button>
            )
          })}
        </div>
        <span style={{ fontSize:'0.68rem', color:'var(--text-3)' }}>
          {countLabels ? 'Axis is log₁p — tick labels show original count equivalents' : 'Raw log₁p values on axis'}
        </span>
      </div>

      {histData?.kdes?.length > 60 ? (
        /* ── Large-cohort warning — density curves disabled ── */
        <div style={{
          flex:'1 1 0', display:'flex', flexDirection:'column',
          alignItems:'center', justifyContent:'center', gap:14,
          padding:'24px 40px', textAlign:'center',
        }}>
          <span style={{ fontSize:'2.2rem', opacity:0.35 }}>📈</span>
          <div style={{ fontSize:'0.92rem', fontWeight:700, color:'var(--text-2)' }}>
            Density preview disabled for large cohorts
          </div>
          <div style={{ fontSize:'0.77rem', color:'var(--text-3)', lineHeight:1.75, maxWidth:440 }}>
            Rendering <strong>{histData.kdes.length} individual density curves</strong> would
            freeze the browser. Use the <strong>Sample Medians</strong> tab above to inspect
            per-sample expression levels and flag outliers. The gene-filter slider and
            all downstream analyses work normally.
          </div>
          <div style={{
            fontSize:'0.71rem', padding:'5px 14px', borderRadius:6,
            background: V.muted, border:`1px solid ${V.border}`, color:V.text,
          }}>
            Limit: 60 samples · {histData.kdes.length} detected
          </div>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, flex:'1 1 0' }}>
          <div style={{ border:`1px solid ${V.border}`, borderRadius:10, overflow:'hidden' }}>
            <div ref={preRef} style={{ width:'100%' }} />
          </div>
          <div style={{ border:`1px solid ${V.border}`, borderRadius:10, overflow:'hidden' }}>
            <div ref={postRef} style={{ width:'100%' }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Outlier badge with hover tooltip ─────────────────────────────────────────
function OutlierBadge({ label, kind, zScore, sizeFactor }) {
  const multiplier  = sizeFactor != null ? (1 / sizeFactor) : null
  const sfNote = multiplier == null ? null
    : multiplier > 1
      ? `Counts scaled up ×${multiplier.toFixed(2)} (library smaller than reference)`
      : `Counts scaled down ×${(1 / multiplier).toFixed(2)} (library larger than reference)`
  const [pos, setPos] = useState(null)
  const isLow = kind === 'low'
  const color  = isLow ? '#f59e0b' : '#818cf8'
  const bg     = isLow ? 'rgba(251,191,36,0.12)'   : 'rgba(99,102,241,0.1)'
  const border = isLow ? 'rgba(251,191,36,0.35)'   : 'rgba(99,102,241,0.3)'
  const icon = isLow
    ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{flexShrink:0}}>
        <path d="M5 1L9 9H1L5 1Z" stroke={color} strokeWidth="1.2" fill={bg} strokeLinejoin="round"/>
        <line x1="5" y1="4" x2="5" y2="6.5" stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
        <circle cx="5" cy="8" r="0.6" fill={color}/>
      </svg>
    : <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{flexShrink:0}}>
        <path d="M5 9L1 1H9L5 9Z" stroke={color} strokeWidth="1.2" fill={bg} strokeLinejoin="round"/>
        <line x1="5" y1="6" x2="5" y2="3.5" stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
        <circle cx="5" cy="2" r="0.6" fill={color}/>
      </svg>
  return (
    <div style={{ position:'relative', display:'inline-flex' }}
         onMouseEnter={e => setPos({ x: e.clientX, y: e.clientY })}
         onMouseMove={e  => setPos({ x: e.clientX, y: e.clientY })}
         onMouseLeave={()=> setPos(null)}>
      <span style={{
        display:'inline-flex', alignItems:'center', gap:4,
        padding:'2px 8px', borderRadius:10, fontSize:'0.65rem', fontWeight:700,
        background:bg, color, border:`1px solid ${border}`, cursor:'default',
      }}>
        {icon}{label}
      </span>
      {pos && createPortal(
        <div style={{
          position:'fixed', left: pos.x + 14, top: pos.y + 14, zIndex:999999,
          background:'var(--bg-panel)', border:`1px solid ${border}`,
          borderRadius:10, padding:'10px 13px', minWidth:260, maxWidth:320,
          boxShadow:'0 8px 28px rgba(0,0,0,0.35)', pointerEvents:'none',
        }}>
          <div style={{ fontSize:'0.72rem', fontWeight:700, color, marginBottom:7 }}>{label}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            <Row label="z-score" value={zScore.toFixed(2)} color={color} />
            <Row label="Direction" value={isLow ? '> 2 SD below mean median' : '> 2 SD above mean median'} />
            <div style={{ height:1, background:'var(--border)', margin:'3px 0' }} />
            <Row label="Size factor"
                 value={sizeFactor != null ? `${sizeFactor.toFixed(4)}  (×${multiplier.toFixed(2)})` : 'not available'}
                 color={sizeFactor != null && (multiplier > 2 || multiplier < 0.5) ? '#f59e0b' : undefined} />
            {sfNote != null
              ? <div style={{ fontSize:'0.68rem', color:'var(--text-3)', lineHeight:1.5 }}>{sfNote}</div>
              : <div style={{ fontSize:'0.68rem', color:'var(--text-4)', fontStyle:'italic' }}>Re-run DESeq2 to populate size factor</div>
            }
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
function Row({ label, value, color }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, fontSize:'0.7rem' }}>
      <span style={{ color:'var(--text-3)', whiteSpace:'nowrap' }}>{label}</span>
      <span style={{ color: color ?? 'var(--text-1)', fontFamily:'monospace', fontWeight:600, textAlign:'right' }}>{value}</span>
    </div>
  )
}

// ── Per-sample medians table ──────────────────────────────────────────────────
function MediansTable({ histData }) {
  const { rows, meanMed, sd } = useMemo(() => {
    if (!histData?.kdes?.length) return { rows: [], meanMed: 0, sd: 0 }
    const computed = histData.kdes.map((kde, i) => {
      const medLog = kdePercentile(kde, 0.5)
      const p25Log = kdePercentile(kde, 0.25)
      const p75Log = kdePercentile(kde, 0.75)
      return {
        sample:     kde.sample,
        color:      SAMPLE_COLORS[i % SAMPLE_COLORS.length],
        sizeFactor: kde.size_factor ?? null,
        medLog,
        medOrig: Math.expm1(medLog),
        p25:     Math.expm1(p25Log),
        p75:     Math.expm1(p75Log),
      }
    })
    const mean = computed.reduce((s, r) => s + r.medLog, 0) / computed.length
    const variance = computed.reduce((s, r) => s + (r.medLog - mean) ** 2, 0) / computed.length
    const stdDev = Math.sqrt(variance)
    return {
      rows:    computed.sort((a, b) => b.medLog - a.medLog),
      meanMed: mean,
      sd:      stdDev,
    }
  }, [histData])

  if (!rows.length) return <div style={{ padding:40, textAlign:'center', color:'var(--text-3)' }}>No data</div>

  const maxMed = Math.max(...rows.map(r => r.medLog))
  const GRID = '1px solid var(--border)'

  return (
    <div style={{ overflowY:'auto', maxHeight:'100%' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.76rem' }}>
        <thead style={{ position:'sticky', top:0, background:'var(--bg-panel)', zIndex:2 }}>
          <tr>
            {['Sample','Median (log₁p)','Median (count)','IQR (counts)','vs mean','Distribution','Status'].map(h => (
              <th key={h} style={{ padding:'6px 10px', textAlign:'left', borderBottom:'2px solid var(--border)',
                                   fontSize:'0.68rem', fontWeight:700, color:V.text, whiteSpace:'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const barPct   = maxMed > 0 ? (r.medLog / maxMed) * 100 : 0
            const diffPct  = meanMed > 0 ? ((r.medLog - meanMed) / meanMed * 100) : 0
            const diffColor = diffPct >= 0 ? '#10b981' : '#f43f5e'
            const zScore   = sd > 0 ? (r.medLog - meanMed) / sd : 0
            const isLow    = zScore < -2
            const isHigh   = zScore > 2
            const rowBg    = isLow
              ? 'rgba(251,191,36,0.04)'
              : ri % 2 === 0 ? 'transparent' : 'rgba(var(--accent-rgb),0.02)'
            return (
              <tr key={r.sample} style={{ background:rowBg }}>
                <td style={{ padding:'5px 10px', borderBottom:GRID, whiteSpace:'nowrap' }}>
                  <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background:r.color, marginRight:6, flexShrink:0 }} />
                  {r.sample}
                </td>
                <td style={{ padding:'5px 10px', borderBottom:GRID, fontFamily:'monospace', textAlign:'right' }}>
                  {r.medLog.toFixed(3)}
                </td>
                <td style={{ padding:'5px 10px', borderBottom:GRID, fontFamily:'monospace', textAlign:'right' }}>
                  {r.medOrig < 1 ? r.medOrig.toFixed(3) : r.medOrig.toFixed(1)}
                </td>
                <td style={{ padding:'5px 10px', borderBottom:GRID, fontFamily:'monospace', textAlign:'right', fontSize:'0.7rem', color:'var(--text-3)' }}>
                  {r.p25.toFixed(1)}–{r.p75.toFixed(1)}
                </td>
                <td style={{ padding:'5px 10px', borderBottom:GRID, textAlign:'right', fontFamily:'monospace', color:diffColor, fontSize:'0.72rem' }}>
                  {diffPct >= 0 ? '+' : ''}{diffPct.toFixed(1)}%
                </td>
                <td style={{ padding:'5px 10px', borderBottom:GRID, minWidth:120 }}>
                  <div style={{ height:8, borderRadius:4, background:'rgba(var(--accent-rgb),0.1)', overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${barPct}%`, background:r.color, borderRadius:4, transition:'width 0.3s' }} />
                  </div>
                </td>
                <td style={{ padding:'5px 10px', borderBottom:GRID, whiteSpace:'nowrap' }}>
                  {isLow ? (
                    <OutlierBadge label="Low outlier" kind="low" zScore={zScore} sizeFactor={r.sizeFactor} />
                  ) : isHigh ? (
                    <OutlierBadge label="High outlier" kind="high" zScore={zScore} sizeFactor={r.sizeFactor} />
                  ) : (
                    <span style={{ color:'var(--text-4)', fontSize:'0.72rem' }}>—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Guide helpers ─────────────────────────────────────────────────────────────
function GuideSection({ title, icon, children }) {
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
        {icon}
        <span style={{ fontSize:'0.8rem', fontWeight:700, color:V.text, letterSpacing:'0.01em' }}>{title}</span>
        <div style={{ flex:1, height:1, background:V.border }} />
      </div>
      {children}
    </div>
  )
}

function GuideTable({ rows }) {
  return (
    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.76rem' }}>
      <tbody>
        {rows.map(([term, desc], i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `rgba(11,68,111,0.04)` }}>
            <td style={{ padding:'6px 12px', whiteSpace:'nowrap', verticalAlign:'top', width:1,
                         fontWeight:600, color:V.text, fontFamily:'monospace', fontSize:'0.72rem',
                         borderBottom:'1px solid var(--border)', borderRight:`1px solid ${V.border}` }}>
              {term}
            </td>
            <td style={{ padding:'6px 12px', color:'var(--text-2)', lineHeight:1.55,
                         borderBottom:'1px solid var(--border)', fontSize:'0.74rem' }}>
              {desc}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Distribution + filter modal (draggable, resizable) ───────────────────────
function DistributionModal({ histData, cutoffLog, cutoffOrig, filterValue, setFilterValue, nAbove, onClose }) {
  const [activeTab, setActiveTab] = useState('distribution')
  const [pos,  setPos]  = useState(null)   // {x,y} once dragged; null = CSS-centered
  const [size, setSize] = useState({ w: Math.min(window.innerWidth  * 0.88, 1280),
                                     h: Math.min(window.innerHeight * 0.84, 900) })
  const modalRef      = useRef(null)
  const dragRef       = useRef(null)
  const resizeRef     = useRef(null)
  const wasDragging   = useRef(false)   // prevents backdrop onClick firing after drag/resize mouseup

  // ── Drag ────────────────────────────────────────────────────────────────────
  const onHeaderMouseDown = (e) => {
    if (e.target.closest('button')) return
    const rect = modalRef.current.getBoundingClientRect()
    dragRef.current = { sx:e.clientX, sy:e.clientY, ox:rect.left, oy:rect.top }
    wasDragging.current = false
    const onMove = ev => {
      wasDragging.current = true
      setPos({ x: dragRef.current.ox + ev.clientX - dragRef.current.sx,
               y: dragRef.current.oy + ev.clientY - dragRef.current.sy })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // Clear the flag after the click event has been evaluated
      setTimeout(() => { wasDragging.current = false }, 0)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    e.preventDefault()
  }

  // ── Resize (bottom-right handle) ────────────────────────────────────────────
  const onResizeMouseDown = (e) => {
    const rect = modalRef.current.getBoundingClientRect()
    resizeRef.current = { sx:e.clientX, sy:e.clientY, ow:rect.width, oh:rect.height }
    wasDragging.current = true   // set immediately so any stray click is swallowed
    const onMove = ev => {
      setSize({ w: Math.max(720, resizeRef.current.ow + ev.clientX - resizeRef.current.sx),
                h: Math.max(480, resizeRef.current.oh + ev.clientY - resizeRef.current.sy) })
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setTimeout(() => { wasDragging.current = false }, 0)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    e.preventDefault(); e.stopPropagation()
  }

  // On first drag, snap pos to current rendered position
  const initDrag = (e) => {
    if (!pos && modalRef.current) {
      const rect = modalRef.current.getBoundingClientRect()
      setPos({ x: rect.left, y: rect.top })
    }
    onHeaderMouseDown(e)
  }

  const modalStyle = {
    position: 'fixed',
    zIndex: 101001,
    background: 'var(--bg-panel)',
    border: `1px solid ${V.border}`,
    borderRadius: 16,
    boxShadow: '0 8px 60px rgba(0,0,0,0.45)',
    width:  size.w,
    height: size.h,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    ...(pos
      ? { left:pos.x, top:pos.y }
      : { top:'50%', left:'50%', transform:'translate(-50%,-50%)' }),
  }

  const chartH = Math.max(220, Math.round((size.h - 320) / 1))

  return createPortal(
    <div style={{ position:'fixed', inset:0, zIndex:101000, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(4px)' }}
         onClick={() => { if (!wasDragging.current) onClose() }}>
      <div ref={modalRef} style={modalStyle} onClick={e=>e.stopPropagation()}>

        {/* ── Draggable header ── */}
        <div onMouseDown={initDrag} style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'14px 20px 10px', cursor:'grab', userSelect:'none', flexShrink:0,
          borderBottom:`1px solid ${V.border}`,
        }}>
          <div>
            <div style={{ fontSize:'0.95rem', fontWeight:700, color:V.text }}>Count Distribution — All Samples</div>
            <div style={{ fontSize:'0.7rem', color:'var(--text-3)', marginTop:2 }}>
              Each curve = one sample · log₁p(normalised counts)
              {histData && ` · ${histData.n_samples} samples · ${histData.n_genes?.toLocaleString()} genes`}
              {' · '}drag header to move · drag ◢ to resize
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-3)', fontSize:'1.4rem', lineHeight:1, padding:'0 4px' }}>×</button>
        </div>

        {/* ── Tab bar ── */}
        <div style={{ display:'flex', gap:2, padding:'8px 20px 0', flexShrink:0, borderBottom:`1px solid ${V.border}` }}>
          {[
            ['distribution',
              <><svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{display:'inline',verticalAlign:'middle',marginRight:5}}>
                <path d="M1 11 Q3 4 5 7 Q7 10 9 3 Q11 0 12 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                <line x1="4" y1="0" x2="4" y2="13" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" opacity="0.5"/>
              </svg>Distribution</>
            ],
            ['medians',
              <><svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{display:'inline',verticalAlign:'middle',marginRight:5}}>
                <rect x="1" y="1" width="11" height="2.5" rx="0.5" fill="currentColor" opacity="0.8"/>
                <rect x="1" y="5" width="7"  height="2.5" rx="0.5" fill="currentColor" opacity="0.55"/>
                <rect x="1" y="9" width="9"  height="2.5" rx="0.5" fill="currentColor" opacity="0.55"/>
              </svg>Sample Medians</>
            ],
            ['guide',
              <><svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{display:'inline',verticalAlign:'middle',marginRight:5}}>
                <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
                <text x="6.5" y="10" textAnchor="middle" fontSize="7" fill="currentColor" fontWeight="700">?</text>
              </svg>How to read</>
            ],
          ].map(([id,label]) => (
            <button key={id} onClick={()=>setActiveTab(id)} style={{
              padding:'5px 14px', borderRadius:'6px 6px 0 0', border:`1px solid ${activeTab===id?V.border:'transparent'}`,
              borderBottom: activeTab===id ? '1px solid var(--bg-panel)' : `1px solid ${V.border}`,
              cursor:'pointer', fontSize:'0.78rem', fontWeight: activeTab===id ? 700 : 400,
              background: activeTab===id ? 'var(--bg-panel)' : 'transparent',
              color: activeTab===id ? V.text : 'var(--text-3)',
              marginBottom: -1, display:'flex', alignItems:'center',
            }}>{label}</button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div style={{ flex:'1 1 0', overflow:'hidden', display:'flex', flexDirection:'column', padding:'14px 20px 16px', gap:12 }}>

          {activeTab === 'distribution' && (<>
            {/* Filter controls */}
            <div style={{ display:'flex', flexDirection:'column', gap:10, flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                {/* Stats chips */}
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {[
                    [`~${nAbove.toLocaleString()}`, 'pass filter', '#10b981'],
                    [histData?.n_genes ? `${(histData.n_genes-nAbove).toLocaleString()}` : '—', 'removed', '#f43f5e'],
                    [histData?.n_genes ? `${((nAbove/(histData.n_genes||1))*100).toFixed(1)}%` : '—', 'retained', V.text],
                    [`≥ ${cutoffOrig.toFixed(1)}`, 'baseMean cutoff', 'var(--text-2)'],
                  ].map(([v,l,col])=>(
                    <div key={l} style={{ padding:'4px 10px', borderRadius:8, background:V.muted, border:`1px solid ${V.border}`, textAlign:'center' }}>
                      <span style={{ fontSize:'0.88rem', fontWeight:700, color:col }}>{v}</span>
                      <span style={{ fontSize:'0.62rem', color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.04em', marginLeft:5 }}>{l}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* baseMean slider */}
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:'0.8rem', color:'var(--text-2)', whiteSpace:'nowrap' }}>Min baseMean ≥</span>
                <input type="range" min={0} max={500} step={0.5} value={Math.min(filterValue, 500)}
                  onChange={e=>setFilterValue(+e.target.value)} style={{ flex:1, accentColor:V.accent }} />
                <input type="number" min={0} value={filterValue}
                  onChange={e=>setFilterValue(Math.max(0,+e.target.value))}
                  style={{ width:74, padding:'3px 6px', fontSize:'0.85rem', fontFamily:'monospace',
                           background:'var(--bg-card2)', border:`1px solid ${V.border}`, borderRadius:6,
                           color:V.text, textAlign:'right' }} />
              </div>
            </div>

            {/* Dual density charts */}
            <div style={{ flex:'1 1 0', overflow:'hidden' }}>
              {histData
                ? <DualDensityChart histData={histData} cutoffLog={cutoffLog} height={chartH} />
                : <div style={{ height:chartH, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-3)' }}>Loading…</div>
              }
            </div>
          </>)}

          {activeTab === 'medians' && (
            <div style={{ flex:'1 1 0', overflow:'hidden', display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ fontSize:'0.75rem', color:'var(--text-3)', flexShrink:0 }}>
                Approximate sample-level median expression (50th percentile of log₁p KDE) · sorted highest → lowest ·
                IQR = interquartile range · Status flags statistical outliers (⚠ Low / ↑ High) at ±2 SD from the mean median
              </div>
              {histData
                ? <MediansTable histData={histData} />
                : <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-3)' }}>Loading…</div>
              }
            </div>
          )}

          {activeTab === 'guide' && (
            <div style={{ flex:'1 1 0', overflowY:'auto', display:'flex', flexDirection:'column', gap:22 }}>

              {/* ── Section: Distribution tab ── */}
              <GuideSection title="Distribution tab" icon={
                <svg width="14" height="14" viewBox="0 0 13 13" fill="none"><path d="M1 11 Q3 4 5 7 Q7 10 9 3 Q11 0 12 2" stroke={V.text} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/><line x1="4" y1="0" x2="4" y2="13" stroke={V.text} strokeWidth="1" strokeDasharray="2 2" opacity="0.5"/></svg>
              }>
                <GuideTable rows={[
                  ['Each KDE curve',         'One curve per sample. Shows how normalised gene counts are distributed within that sample across all genes.'],
                  ['X-axis',                 'log₁p(normalised count) — a log-scale transformation of each gene\'s count value within the sample. Tick labels are shown in count space for readability.'],
                  ['Y-axis',                 'Probability density — taller peaks mean more genes cluster at that expression level.'],
                  ['Red dashed line',        'The current baseMean cutoff. Genes to the left of this line are removed before running GSEA.'],
                  ['Pre-filter panel',       'Full distributions before any filtering is applied. Shows the natural expression landscape of your data.'],
                  ['Post-filter panel',      'Same distributions clipped at the cutoff. Shows only the genes that will be passed to GSEA.'],
                  ['baseMean cutoff',        'Filters genes where the average normalised count across ALL samples is below this value. It is a per-gene cross-sample statistic — not a per-sample value.'],
                ]} />
              </GuideSection>

              {/* ── Section: baseMean vs per-sample counts ── */}
              <GuideSection title="baseMean vs per-sample counts" icon={
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="5" rx="1" stroke={V.text} strokeWidth="1.2"/><rect x="8" y="1" width="5" height="5" rx="1" stroke={V.text} strokeWidth="1.2"/><rect x="1" y="8" width="5" height="5" rx="1" stroke={V.text} strokeWidth="1.2"/><rect x="8" y="8" width="5" height="5" rx="1" fill={V.text} opacity="0.25" stroke={V.text} strokeWidth="1.2"/></svg>
              }>
                <GuideTable rows={[
                  ['counts[gene, sample]',   'Normalised count for one gene in one specific sample. This is what the KDE curves are built from.'],
                  ['baseMean (per gene)',     'rowMeans(counts) — the average of a gene\'s normalised count across all samples. Used for the filter cutoff.'],
                  ['Median (count) in table','The 50th percentile of counts[·, sample] — the midpoint of that sample\'s own count distribution. Not related to baseMean.'],
                  ['Key difference',         'A gene can have baseMean = 50 (passes the filter) yet have a count of 0 in one specific sample. Conversely, a gene can be highly expressed in one sample but have a low baseMean if the rest barely express it.'],
                ]} />
              </GuideSection>

              {/* ── Section: Sample Medians tab ── */}
              <GuideSection title="Sample Medians tab" icon={
                <svg width="14" height="14" viewBox="0 0 13 13" fill="none"><rect x="1" y="1" width="11" height="2.5" rx="0.5" fill={V.text} opacity="0.8"/><rect x="1" y="5" width="7" height="2.5" rx="0.5" fill={V.text} opacity="0.55"/><rect x="1" y="9" width="9" height="2.5" rx="0.5" fill={V.text} opacity="0.55"/></svg>
              }>
                <GuideTable rows={[
                  ['Median (log₁p)',  '50th percentile of the sample\'s KDE — in log₁p space. Comparable across samples.'],
                  ['Median (count)',  'The same value back-transformed to count space (eˣ − 1). Represents the typical expression level in that sample.'],
                  ['IQR (counts)',    'Interquartile range: P25 to P75 in count space. Wide IQR = broad dynamic range; narrow = expression is tightly clustered.'],
                  ['vs mean',        'How far each sample\'s median is from the mean of all sample medians — expressed as a percentage. Positive = above average, negative = below.'],
                  ['Distribution bar','Bar length is proportional to the sample\'s median. Quick visual comparison of relative expression levels across all samples.'],
                  ['⚠ Low outlier',  'Sample median is more than 2 SD below the group mean. Hover the badge for the DESeq2 size factor — a small size factor (< 0.5) alongside a low median suggests genuinely low sequencing depth; a large size factor (> 2) alongside a low median suggests a composition effect rather than a depth problem.'],
                  ['↑ High outlier', 'Sample median is more than 2 SD above the group mean. Less commonly a problem. Hover the badge for the size factor — a small size factor here may indicate over-scaling of a small library.'],
                ]} />
              </GuideSection>

            </div>
          )}
        </div>

        {/* ── Resize handles: bottom edge, right edge, corner ── */}
        <div onMouseDown={e => {
          e.preventDefault(); e.stopPropagation(); wasDragging.current = true
          const startY = e.clientY, startH = modalRef.current?.getBoundingClientRect().height ?? size.h
          const onMove = ev => setSize(s => ({ ...s, h: Math.max(480, startH + ev.clientY - startY) }))
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); setTimeout(() => { wasDragging.current = false }, 0) }
          window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
        }} style={{ position:'absolute', bottom:0, left:0, right:18, height:8, cursor:'ns-resize', zIndex:10 }} />
        <div onMouseDown={e => {
          e.preventDefault(); e.stopPropagation(); wasDragging.current = true
          const startX = e.clientX, startW = modalRef.current?.getBoundingClientRect().width ?? size.w
          const onMove = ev => setSize(s => ({ ...s, w: Math.max(720, startW + ev.clientX - startX) }))
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); setTimeout(() => { wasDragging.current = false }, 0) }
          window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
        }} style={{ position:'absolute', top:0, right:0, bottom:18, width:8, cursor:'ew-resize', zIndex:10 }} />
        <div onMouseDown={onResizeMouseDown} style={{
          position:'absolute', bottom:0, right:0, width:18, height:18, cursor:'nwse-resize',
          display:'flex', alignItems:'flex-end', justifyContent:'flex-end',
          padding:'3px', color:'var(--text-3)', fontSize:'0.7rem', lineHeight:1, userSelect:'none', zIndex:11,
        }}>◢</div>
      </div>
    </div>,
    document.body
  )
}

// ── Collection grid ───────────────────────────────────────────────────────────
function CollectionGrid({ selected, onChange }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
      {COLLECTIONS.map(c => {
        const active = selected.key===c.key
        return (
          <button key={c.key} onClick={()=>onChange(c)} title={c.desc}
            style={{ padding:'6px 8px', borderRadius:8, cursor:'pointer', textAlign:'left', background:active?V.muted:'var(--bg-card2)', border:`1px solid ${active?V.border:'var(--border)'}`, color:active?'var(--text-1)':'var(--text-2)', boxShadow:active?`0 0 0 1.5px ${V.accent}55`:'none', transition:'all 0.12s' }}>
            <div style={{ fontSize:'0.8rem', marginBottom:2 }}>{c.icon} {c.label}</div>
            <div style={{ fontSize:'0.62rem', color:'var(--text-3)', lineHeight:1.3 }}>{c.desc.split('(')[0].trim()}</div>
          </button>
        )
      })}
    </div>
  )
}

// ── Inline NES bar ────────────────────────────────────────────────────────────
function NESBar({ nes, maxAbs, decimals = 2 }) {
  const pct = Math.min((Math.abs(nes)/maxAbs)*46,46)
  return (
    <div style={{ position:'relative', width:96, height:20, display:'flex', alignItems:'center' }}>
      <div style={{ position:'absolute', left:'50%', top:'15%', width:1, height:'70%', background:'var(--border)' }} />
      <div style={{ position:'absolute', width:`${pct}%`, height:'55%', top:'22%', left:nes>0?'50%':`${50-pct}%`, background:nes>0?'rgba(16,185,129,0.5)':'rgba(244,63,94,0.5)', borderRadius:2 }} />
      <span style={{ position:'absolute', [nes>0?'left':'right']:0, fontSize:'0.67rem', fontFamily:'monospace', color:nes>0?V.up:V.down, fontWeight:600 }}>
        {nes>0?'+':''}{nes.toFixed(decimals)}
      </span>
    </div>
  )
}

// ── Run chips ─────────────────────────────────────────────────────────────────
function RunChip({ r, active, onSelect, onRemove }) {
  const [hover, setHover] = useState(false)
  const p = r.params ?? {}
  const RANK_LABELS = { log2FC:'LFC', stat:'Wald stat', shrunkLFC:'Shrunk LFC', signedNegLog10p:'−log₁₀p' }
  return (
    <div style={{ position:'relative' }}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}>
      <div onClick={()=>onSelect(r.id)}
        style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:20,
          cursor:'pointer', userSelect:'none', background:active?V.muted:'var(--bg-card2)',
          border:`1px solid ${active?V.border:'var(--border)'}`, transition:'all 0.12s' }}>
        <span style={{ fontSize:'0.7rem', fontWeight:700, color:active?'var(--text-1)':'var(--text-2)' }}>{r.collectionLabel}</span>
        <span style={{ fontSize:'0.64rem', color:'var(--text-2)' }}>·{r.rankShort}</span>
        <span style={{ fontSize:'0.62rem', color:active?V.text:'var(--text-2)', fontFamily:'monospace' }}>{r.meta?.n_pathways}↗</span>
        <span style={{ fontSize:'0.6rem', color:'var(--text-2)' }}>{r.timestamp}</span>
        <button onClick={e=>{ e.stopPropagation(); onRemove(r.id) }}
          style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-4)', fontSize:'0.82rem', lineHeight:1, padding:'0 1px', marginLeft:1 }}>×</button>
      </div>
      {hover && (
        <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, zIndex:400, minWidth:240,
          background:'var(--bg-panel)', border:`1px solid ${V.border}`, borderRadius:8,
          padding:'10px 12px', boxShadow:'0 8px 24px rgba(0,0,0,0.35)', pointerEvents:'none' }}>
          <div style={{ fontSize:'0.65rem', fontWeight:700, color:V.text, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' }}>Run Parameters</div>
          {[
            ['Collection', r.collectionLabel + (r.collectionSub ? ` / ${r.collectionSub}` : '')],
            ['Rank by',    RANK_LABELS[p.rankMethod] ?? p.rankMethod],
            ['padj method',p.pAdjMethod],
            ['padj cutoff',p.padjCutoff],
            ['Filter',     `baseMean ≥ ${p.filterValue}`],
            ['Gene set size', `${p.minSize}–${p.maxSize}`],
            ['Species',    p.species],
            ['Time',       r.timestamp],
          ].map(([k,v])=>(
            <div key={k} style={{ display:'flex', justifyContent:'space-between', gap:12, marginBottom:3 }}>
              <span style={{ fontSize:'0.65rem', color:'var(--text-3)', whiteSpace:'nowrap' }}>{k}</span>
              <span style={{ fontSize:'0.65rem', color:'var(--text-1)', fontFamily:'monospace', textAlign:'right' }}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RunChips({ runs, activeRunId, onSelect, onRemove }) {
  if (!runs.length) return null
  return (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', paddingBottom:10, borderBottom:`1px solid ${V.border}`, marginBottom:10 }}>
      <span style={{ fontSize:'0.65rem', color:'var(--text-4)', alignSelf:'center', whiteSpace:'nowrap', textTransform:'uppercase', letterSpacing:'0.05em' }}>Runs:</span>
      {runs.map(r => (
        <RunChip key={r.id} r={r} active={r.id===activeRunId} onSelect={onSelect} onRemove={onRemove} />
      ))}
    </div>
  )
}

// ── Results table ─────────────────────────────────────────────────────────────
function ResultsTable({ run, onPathwayClick, selectedPathway, fullscreen, setFullscreen }) {
  const { promptDownload, dialog } = useDownloadDialog()
  const [sortKey,   setSortKey]   = useState('padj')
  const [sortAsc,   setSortAsc]   = useState(true)
  const [dirFilter, setDirFilter] = useState('all')
  const [query,     setQuery]     = useState('')
  const [page,      setPage]      = useState(0)
  const PER = 20
  const padjCutoff = run?.padjCutoff ?? 1
  const results = (run?.results ?? []).filter(r => (r.padj ?? 1) <= padjCutoff)
  const maxAbs  = useMemo(()=>Math.max(...results.map(r=>Math.abs(r.NES||0)),1),[results])
  const filtered = useMemo(()=>{
    let r=results
    if(dirFilter==='up')   r=r.filter(x=>(x.NES||0)>0)
    if(dirFilter==='down') r=r.filter(x=>(x.NES||0)<0)
    if(query){ const q=query.toLowerCase(); r=r.filter(x=>x.pathway?.toLowerCase().includes(q)) }
    return [...r].sort((a,b)=>{ const av=a[sortKey]??Infinity,bv=b[sortKey]??Infinity; return sortAsc?av-bv:bv-av })
  },[results,dirFilter,query,sortKey,sortAsc])
  const pages=Math.ceil(filtered.length/PER)
  const pageData=filtered.slice(page*PER,(page+1)*PER)
  function toggleSort(k){ if(sortKey===k) setSortAsc(a=>!a); else{ setSortKey(k); setSortAsc(true) }; setPage(0) }

  const exportRows=()=>promptDownload(
    `gsea_${run?.collectionLabel?.replace(/\s/g,'_')}.csv`,
    name => downloadCSV(filtered.map(r=>({ pathway:r.pathway,NES:r.NES,pvalue:r.pvalue,padj:r.padj,size:r.size,leadingEdgeN:r.leadingEdgeN,leadingEdge:r.leadingEdge })), name)
  )

  const CB = `1px solid var(--border)`   // cell border shorthand
  const TH = (key, label) => (
    <th key={key} onClick={()=>toggleSort(key)} style={{ padding:'7px 10px', cursor:'pointer', fontSize:'0.65rem', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase', color:sortKey===key?V.text:'var(--text-3)', userSelect:'none', whiteSpace:'nowrap', background:'var(--bg-card2)', border:CB, borderBottom:`2px solid ${sortKey===key?V.accent:'var(--border)'}` }}>
      {label}{sortKey===key?(sortAsc?' ↑':' ↓'):''}
    </th>
  )

  const _inner = (
    <div style={fullscreen ? {
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'var(--bg-panel)', padding: '16px 20px',
      display: 'flex', flexDirection: 'column', gap: 10,
      overflow: 'hidden',
    } : { display:'flex', flexDirection:'column', gap:10 }}>
      {/* Toolbar */}
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <div style={{ display:'flex', borderRadius:8, overflow:'hidden', border:`1px solid ${V.border}` }}>
          {[['all','All'],['up','↑ Enriched'],['down','↓ Depleted']].map(([v,l])=>(
            <button key={v} onClick={()=>{ setDirFilter(v); setPage(0) }}
              style={{ padding:'4px 10px', border:'none', cursor:'pointer', fontSize:'0.72rem', fontWeight:600, background:dirFilter===v?V.accent:'var(--bg-card2)', color:dirFilter===v?'#fff':'var(--text-3)', transition:'background 0.12s' }}>{l}</button>
          ))}
        </div>
        <input value={query} onChange={e=>{ setQuery(e.target.value); setPage(0) }} placeholder="Search pathways…"
          style={{ flex:1, minWidth:160, padding:'4px 10px', fontSize:'0.78rem', background:'var(--bg-card2)', border:`1px solid ${V.border}`, borderRadius:8, color:'var(--text-1)' }} />
        <span style={{ fontSize:'0.7rem', color:'var(--text-3)' }}>{filtered.length} pathways</span>
        <button onClick={exportRows} style={{ padding:'4px 10px', borderRadius:7, border:`1px solid ${V.border}`, background:V.muted, color:V.text, fontSize:'0.72rem', fontWeight:600, cursor:'pointer' }}>↓ CSV</button>
        {dialog}
        {setFullscreen && (
          <button
            onClick={() => setFullscreen(v => !v)}
            title={fullscreen ? 'Exit fullscreen (Esc)' : 'Expand to fullscreen'}
            style={{ fontSize: '0.82rem', padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                     background: 'transparent', border: '1px solid var(--border)',
                     color: 'var(--text-3)' }}>
            {fullscreen ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ overflowX:'auto', overflowY: fullscreen ? 'auto' : 'visible', borderRadius:10, border:CB, flex: fullscreen ? '1 1 0' : undefined, minHeight: 0 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
          <thead><tr>{TH('pathway','Pathway')}{TH('NES','NES')}{TH('padj','padj')}{TH('size','Size')}
            <th style={{ padding:'7px 10px', fontSize:'0.65rem', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase', color:'var(--text-3)', background:'var(--bg-card2)', border:CB }}>Leading Edge</th>
          </tr></thead>
          <tbody>
            {pageData.map((r,i)=>{
              const isSel=selectedPathway===r.pathway
              const name=(r.pathway||'').replace(/_/g,' ').replace(/^[A-Z0-9]+\s+/,'')
              return (
                <tr key={r.pathway??i} onClick={()=>onPathwayClick(r)}
                  style={{ cursor:'pointer', background:isSel?V.muted:i%2===0?'transparent':'rgba(255,255,255,0.015)', borderLeft:`3px solid ${isSel?V.accent:'transparent'}` }}
                  onMouseEnter={e=>{ if(!isSel) e.currentTarget.style.background='rgba(11,68,111,0.07)' }}
                  onMouseLeave={e=>{ if(!isSel) e.currentTarget.style.background=i%2===0?'transparent':'rgba(255,255,255,0.015)' }}>
                  <td style={{ padding:'7px 10px', color:'var(--text-1)', maxWidth:340, border:CB }}>
                    <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={r.pathway}>{name}</div>
                  </td>
                  <td style={{ padding:'7px 10px', border:CB }}><NESBar nes={r.NES??0} maxAbs={maxAbs} /></td>
                  <td style={{ padding:'7px 10px', fontFamily:'monospace', fontSize:'0.72rem', color:r.padj<0.05?V.accent:r.padj<0.25?'var(--text-2)':'var(--text-3)', border:CB }}>{fmtPval(r.padj)}</td>
                  <td style={{ padding:'7px 10px', color:'var(--text-2)', fontFamily:'monospace', fontSize:'0.72rem', border:CB }}>{r.size}</td>
                  <td style={{ padding:'7px 10px', fontSize:'0.7rem', maxWidth:220, border:CB }}>
                    <span style={{ fontFamily:'monospace', color:V.accent, fontWeight:600 }}>{r.leadingEdgeN} </span>
                    <span style={{ color:'var(--text-3)' }}>{(r.leadingEdge||'').split(',').slice(0,4).join(', ')}{r.leadingEdgeN>4?` +${r.leadingEdgeN-4}`:''}</span>
                  </td>
                </tr>
              )
            })}
            {!pageData.length && <tr><td colSpan={5} style={{ padding:24, textAlign:'center', color:'var(--text-3)', border:CB }}>No pathways match</td></tr>}
          </tbody>
        </table>
      </div>
      {pages>1 && (
        <div style={{ display:'flex', gap:4, justifyContent:'center', alignItems:'center' }}>
          {[['←',()=>setPage(p=>Math.max(0,p-1)),page===0],['→',()=>setPage(p=>Math.min(pages-1,p+1)),page===pages-1]].map(([l,fn,dis])=>(
            <button key={l} onClick={fn} disabled={dis} style={{ padding:'3px 10px', borderRadius:6, fontSize:'0.75rem', cursor:dis?'default':'pointer', background:'var(--bg-card2)', border:`1px solid ${V.border}`, color:'var(--text-2)', opacity:dis?0.4:1 }}>{l}</button>
          ))}
          <span style={{ fontSize:'0.72rem', color:'var(--text-3)' }}>{page+1}/{pages}</span>
        </div>
      )}
    </div>
  )
  return fullscreen ? createPortal(_inner, document.body) : _inner
}

// ── Ranked list panel ─────────────────────────────────────────────────────────
const PER_PAGE_OPTIONS = [20, 50, 100, 200, 'All']

function RankedListPanel({ run }) {
  const { promptDownload, dialog } = useDownloadDialog()
  const [page,    setPage]    = useState(0)
  const [perPage, setPerPage] = useState(20)
  const [sortAsc, setSortAsc] = useState(false)  // default: high→low (desc)

  const rawList = run?.rankedList ?? []

  const list = useMemo(() => {
    const sorted = [...rawList].sort((a,b) => sortAsc ? a.score - b.score : b.score - a.score)
    return sorted
  }, [rawList, sortAsc])

  const PER    = perPage === 'All' ? list.length : perPage
  const pages  = perPage === 'All' ? 1 : Math.ceil(list.length / PER)
  const gOff   = page * PER
  const pageData = list.slice(gOff, gOff + PER)
  const maxAbs = useMemo(() => Math.max(...list.map(r => Math.abs(r.score || 0)), 1), [list])

  // Reset to page 0 when perPage or sort changes
  const prevPer  = useRef(perPage)
  const prevSort = useRef(sortAsc)
  if (prevPer.current !== perPage || prevSort.current !== sortAsc) {
    prevPer.current = perPage; prevSort.current = sortAsc; setPage(0)
  }

  if (!list.length) return <div style={{ padding:40, textAlign:'center', color:'var(--text-3)' }}>Run GSEA to see the ranked list</div>

  const CB = `1px solid var(--border)`
  const selStyle = { padding:'3px 8px', borderRadius:6, fontSize:'0.72rem', border:`1px solid ${V.border}`, background:'var(--bg-card2)', color:'var(--text-2)', cursor:'pointer' }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <span style={{ fontSize:'0.78rem', color:'var(--text-2)', fontWeight:600 }}>{list.length.toLocaleString()} genes ranked</span>
        <span style={{ fontSize:'0.72rem', color:V.up }}>↑ {list.filter(r=>r.score>0).length.toLocaleString()} positive</span>
        <span style={{ fontSize:'0.72rem', color:V.down }}>↓ {list.filter(r=>r.score<0).length.toLocaleString()} negative</span>

        {/* Sort toggle */}
        <button onClick={() => setSortAsc(s => !s)}
          style={{ ...selStyle, display:'flex', alignItems:'center', gap:4, color: 'var(--text-2)' }}
          title="Toggle score sort order">
          Score {sortAsc ? '↑ Low→High' : '↓ High→Low'}
        </button>

        {/* Per-page selector */}
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ fontSize:'0.7rem', color:'var(--text-3)' }}>Show</span>
          {PER_PAGE_OPTIONS.map(opt => (
            <button key={opt} onClick={() => setPerPage(opt)}
              style={{ ...selStyle, fontWeight: perPage===opt ? 700 : 400,
                color: perPage===opt ? 'var(--accent)' : 'var(--text-2)',
                borderColor: perPage===opt ? 'rgba(var(--accent-rgb),0.4)' : V.border,
                background: perPage===opt ? 'rgba(var(--accent-rgb),0.08)' : 'var(--bg-card2)' }}>
              {opt}
            </button>
          ))}
        </div>

        <button onClick={() => promptDownload(
            `ranked_list_${run?.collectionLabel?.replace(/\s/g,'_')}.csv`,
            name => downloadCSV(list.map((r,i) => ({ rank:i+1, gene:r.gene, score:r.score })), name)
          )}
          style={{ marginLeft:'auto', padding:'4px 10px', borderRadius:7, border:`1px solid ${V.border}`, background:V.muted, color:V.text, fontSize:'0.72rem', fontWeight:600, cursor:'pointer' }}>↓ CSV</button>
        {dialog}
      </div>

      {/* Table */}
      <div style={{ overflowX:'auto', borderRadius:10, border:CB }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
          <thead><tr>
            {['#', 'Gene', 'Score'].map((l,i) => (
              <th key={i} style={{ padding:'7px 10px', fontSize:'0.65rem', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase', color:'var(--text-3)', background:'var(--bg-card2)', border:CB }}>{l}</th>
            ))}
          </tr></thead>
          <tbody>
            {pageData.map((r, i) => {
              const rank = gOff + i + 1; const pos = r.score > 0
              return (
                <tr key={rank} style={{ background: i%2===0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                  <td style={{ padding:'5px 10px', color:'var(--text-4)', fontFamily:'monospace', fontSize:'0.7rem', border:CB }}>{rank}</td>
                  <td style={{ padding:'5px 10px', fontFamily:'monospace', fontWeight:600, color:'var(--text-1)', border:CB }}>{r.gene}</td>
                  <td style={{ padding:'5px 10px', border:CB }}><NESBar nes={r.score} maxAbs={maxAbs} decimals={4} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display:'flex', gap:6, justifyContent:'center', alignItems:'center' }}>
          <button onClick={() => setPage(0)} disabled={page===0}
            style={{ ...selStyle, opacity:page===0?0.4:1 }}>«</button>
          <button onClick={() => setPage(p => Math.max(0, p-1))} disabled={page===0}
            style={{ ...selStyle, opacity:page===0?0.4:1 }}>‹</button>
          <span style={{ fontSize:'0.72rem', color:'var(--text-3)', minWidth:60, textAlign:'center' }}>
            {page+1} / {pages}
          </span>
          <button onClick={() => setPage(p => Math.min(pages-1, p+1))} disabled={page===pages-1}
            style={{ ...selStyle, opacity:page===pages-1?0.4:1 }}>›</button>
          <button onClick={() => setPage(pages-1)} disabled={page===pages-1}
            style={{ ...selStyle, opacity:page===pages-1?0.4:1 }}>»</button>
        </div>
      )}
    </div>
  )
}

// ── clusterProfiler / plotthis plots panel ────────────────────────────────────
const PLOT_TYPES = [
  { key:'dotplot',   label:'Dot Plot',         icon:'●', desc:'Top pathways by NES & padj, sized by gene count' },
  { key:'ridgeplot', label:'Ridge Plot',        icon:'≋', desc:'Leading-edge expression distributions per pathway' },
  { key:'heatplot',  label:'Heat Plot',         icon:'▦', desc:'Leading-edge genes × pathway heatmap' },
  { key:'upsetplot', label:'UpSet Plot',        icon:'⊞', desc:'Leading-edge gene overlaps across pathways' },
  { key:'emapplot',  label:'Enrichment Map',    icon:'◎', desc:'Network of pathway similarity by shared genes' },
  { key:'cnetplot',  label:'Concept Network',   icon:'◈', desc:'Gene-pathway concept network (cnetplot)' },
  { key:'gsea_plot', label:'GSEA Plot',         icon:'⟳', desc:'Enrichment score curve(s) per pathway' },
]

function PathwayPicker({ options, selected, onChange, accent }) {
  const [open,   setOpen]   = useState(false)
  const [filter, setFilter] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = options.filter(p => p.toLowerCase().includes(filter.toLowerCase()))
  const toggle = p => onChange(selected.includes(p) ? selected.filter(x => x !== p) : [...selected, p])
  const CB2 = `1px solid ${accent}40`

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'5px 8px', fontSize:'0.72rem', background:'rgba(255,255,255,0.05)',
          border:CB2, borderRadius:6, color:'var(--text-1)', cursor:'pointer', textAlign:'left' }}>
        <span style={{ opacity: selected.length ? 1 : 0.45 }}>
          {selected.length === 0 ? 'default (top 3 by padj)' : `${selected.length} pathway${selected.length>1?'s':''} selected`}
        </span>
        <span style={{ fontSize:'0.6rem', opacity:0.5 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ position:'absolute', zIndex:200, top:'calc(100% + 4px)', left:0, right:0,
          background:'var(--bg-card, #0f1623)', border:CB2, borderRadius:8,
          boxShadow:'0 8px 24px rgba(0,0,0,0.4)', overflow:'hidden' }}>
          <div style={{ padding:'6px 8px', borderBottom:CB2 }}>
            <input autoFocus value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="Filter pathways…"
              style={{ width:'100%', padding:'3px 6px', fontSize:'0.7rem', background:'rgba(255,255,255,0.07)',
                border:CB2, borderRadius:4, color:'var(--text-1)', outline:'none', boxSizing:'border-box' }} />
          </div>
          <div style={{ maxHeight:220, overflowY:'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding:'8px 10px', fontSize:'0.68rem', opacity:0.45 }}>No pathways match</div>
            )}
            {filtered.map(p => {
              const checked = selected.includes(p)
              return (
                <div key={p} onClick={() => toggle(p)}
                  style={{ display:'flex', alignItems:'center', gap:7, padding:'5px 10px', cursor:'pointer',
                    background: checked ? `${accent}18` : 'transparent',
                    borderLeft: `2px solid ${checked ? accent : 'transparent'}` }}>
                  <div style={{ width:13, height:13, borderRadius:3, border:`1.5px solid ${checked ? accent : 'rgba(255,255,255,0.25)'}`,
                    background: checked ? accent : 'transparent', flexShrink:0,
                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {checked && <span style={{ fontSize:'0.55rem', color:'#fff', lineHeight:1 }}>✓</span>}
                  </div>
                  <span style={{ fontSize:'0.67rem', fontFamily:'monospace', color:'var(--text-1)',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p}</span>
                </div>
              )
            })}
          </div>
          {selected.length > 0 && (
            <div style={{ padding:'5px 10px', borderTop:CB2 }}>
              <button onClick={() => { onChange([]); setOpen(false) }}
                style={{ fontSize:'0.63rem', color: accent, background:'none', border:'none', cursor:'pointer', padding:0 }}>
                ✕ clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PlotsPanel({ run, session, contrastLabel, imgSrcCache }) {
  const { promptDownload, dialog } = useDownloadDialog()
  const [plotType,   setPlotType]   = useState('dotplot')
  const [nShow,      setNShow]      = useState(20)
  const [fontSize,   setFontSize]   = useState(11)
  const [width,      setWidth]      = useState(9)
  const [height,     setHeight]     = useState(7)
  const [colorPos,   setColorPos]   = useState('#e63946')
  const [colorNeg,   setColorNeg]   = useState('#457b9d')
  const [selPathways,  setSelPathways]  = useState([])
  const [loading,    setLoading]    = useState(false)
  // Initialise from cache so image survives fsPanel portal remounts
  const [imgSrc,     setImgSrcState] = useState(() => imgSrcCache?.current ?? null)
  const setImgSrc = useCallback((src) => {
    setImgSrcState(src)
    if (imgSrcCache) imgSrcCache.current = src
  }, [imgSrcCache])
  const [error,      setError]      = useState(null)
  const [imgContainerHeight, setImgContainerHeight] = useState(500)
  const [imgContainerWidth,  setImgContainerWidth]  = useState(null)
  const imgContainerRef = useRef(null)
  const imgWrapperRef   = useRef(null)
  const generateRef     = useRef(null)   // always points to latest doGenerate

  const pathwaysForPlot = plotType === 'heatplot' || plotType === 'cnetplot' || plotType === 'gsea_plot'
  const availablePathways = useMemo(() => (run?.results ?? []).map(r => r.pathway).filter(Boolean), [run])
  const pathwayList = selPathways

  // Clear selection when run changes
  useEffect(() => { setSelPathways([]) }, [run])


  const doGenerate = async (w, h) => {
    if (!run || !session?.sessionId) return
    setLoading(true); setError(null); setImgSrc(null)
    try {
      const r = await fetch('/api/gsea/plots', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          sessionId:     session.sessionId,
          contrastLabel,
          collection:    run.collectionId,
          subcategory:   run.collectionSub,
          species:       run.species,
          runId:         run.id,
          plotType,
          params: {
            n_show:    nShow,
            font_size: fontSize,
            color_pos: colorPos,
            color_neg: colorNeg,
            width:     w,
            height:    h,
            pathways:  pathwayList.length ? pathwayList : null,
          },
        }),
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      setImgSrc(data.image)
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }
  // Keep ref always pointing to latest closure so resize handlers can call it
  generateRef.current = doGenerate

  const handleGenerate = () => doGenerate(width, height)

  const downloadPng = () => {
    if (!imgSrc) return
    promptDownload(`gsea_${plotType}.png`, name => {
      const a = Object.assign(document.createElement('a'), { href: imgSrc, download: name })
      a.click()
    })
  }

  const handleImgResizeHeight = useCallback(e => {
    e.preventDefault()
    const el = imgContainerRef.current
    if (!el) return
    const startY = e.clientY, startH = el.getBoundingClientRect().height
    document.body.classList.add('plot-resizing')
    const onMove = ev => { el.style.height = `${Math.max(200, startH + (ev.clientY - startY))}px` }
    const onUp = ev => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('plot-resizing')
      const newPxH = Math.max(200, startH + (ev.clientY - startY))
      const newH   = Math.max(3, Math.min(20, Math.round(newPxH / 72)))
      setImgContainerHeight(newPxH)
      setHeight(newH)
      generateRef.current?.(width, newH)
    }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }, [width])

  const handleImgResizeWidth = useCallback(e => {
    e.preventDefault()
    const el = imgWrapperRef.current
    if (!el) return
    const startX = e.clientX, startW = el.getBoundingClientRect().width
    document.body.classList.add('plot-resizing-h')
    const onMove = ev => { el.style.width = `${Math.max(300, startW + (ev.clientX - startX))}px` }
    const onUp = ev => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('plot-resizing-h')
      const newPxW = Math.max(300, startW + (ev.clientX - startX))
      const newW   = Math.max(4, Math.min(30, Math.round(newPxW / 72)))
      setImgContainerWidth(newPxW)
      setWidth(newW)
      generateRef.current?.(newW, height)
    }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }, [height])

  const CB = `1px solid var(--border)`

  return (
    <div style={{ display:'flex', gap:16, alignItems:'flex-start' }}>

      {/* Controls */}
      <div style={{ width:220, flexShrink:0, display:'flex', flexDirection:'column', gap:10 }}>

        {/* Plot type */}
        <div>
          <div style={{ ...LBL, marginBottom:5 }}>Plot type</div>
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {PLOT_TYPES.map(pt=>(
              <button key={pt.key} onClick={()=>{ setPlotType(pt.key); setImgSrc(null); setError(null) }} title={pt.desc}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'5px 8px', borderRadius:6, cursor:'pointer', textAlign:'left', border:`1px solid ${plotType===pt.key?V.border:'transparent'}`, background:plotType===pt.key?V.muted:'transparent', transition:'all 0.1s', width:'100%' }}>
                <span style={{ fontSize:'0.9rem', opacity:0.8 }}>{pt.icon}</span>
                <div>
                  <div style={{ fontSize:'0.74rem', fontWeight:plotType===pt.key?700:400, color:'var(--text-1)' }}>{pt.label}</div>
                  <div style={{ fontSize:'0.6rem', color:'var(--text-3)', lineHeight:1.3 }}>{pt.desc.split('—')[0].trim()}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ height:1, background:'var(--border)' }} />

        {/* Common params */}
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ ...LBL, marginBottom:2 }}>Parameters</div>

          {!pathwaysForPlot && (
            <div>
              <div style={{ fontSize:'0.66rem', color:'var(--text-3)', marginBottom:2 }}>Show top N pathways</div>
              <input type="number" value={nShow} min={5} max={50} onChange={e=>setNShow(+e.target.value)}
                style={{ width:'100%', padding:'4px 8px', fontSize:'0.78rem', background:'rgba(255,255,255,0.05)', border:CB, borderRadius:6, color:'var(--text-1)' }} />
            </div>
          )}

          {pathwaysForPlot && (
            <div>
              <div style={{ fontSize:'0.66rem', color:'var(--text-3)', marginBottom:4 }}>Pathways</div>
              <PathwayPicker options={availablePathways} selected={selPathways}
                onChange={setSelPathways} accent={V.accent} />
            </div>
          )}

          <div style={{ display:'flex', gap:6 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:'0.66rem', color:'var(--text-3)', marginBottom:2 }}>Font size</div>
              <input type="number" value={fontSize} min={7} max={18} onChange={e=>setFontSize(+e.target.value)}
                style={{ width:'100%', padding:'4px 6px', fontSize:'0.75rem', background:'rgba(255,255,255,0.05)', border:CB, borderRadius:6, color:'var(--text-1)' }} />
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:'0.66rem', color:'var(--text-3)', marginBottom:2 }}>W × H (in)</div>
              <div style={{ display:'flex', gap:3 }}>
                <input type="number" value={width}  min={4} max={20} onChange={e=>setWidth(+e.target.value)}  style={{ width:'50%', padding:'4px 4px', fontSize:'0.72rem', background:'rgba(255,255,255,0.05)', border:CB, borderRadius:6, color:'var(--text-1)' }} />
                <input type="number" value={height} min={3} max={20} onChange={e=>setHeight(+e.target.value)} style={{ width:'50%', padding:'4px 4px', fontSize:'0.72rem', background:'rgba(255,255,255,0.05)', border:CB, borderRadius:6, color:'var(--text-1)' }} />
              </div>
            </div>
          </div>

          <div style={{ display:'flex', gap:6 }}>
            {[['Pos color', colorPos, setColorPos],['Neg color', colorNeg, setColorNeg]].map(([l,v,set])=>(
              <div key={l} style={{ flex:1 }}>
                <div style={{ fontSize:'0.66rem', color:'var(--text-3)', marginBottom:2 }}>{l}</div>
                <input type="color" value={v} onChange={e=>set(e.target.value)}
                  style={{ width:'100%', height:28, padding:2, borderRadius:5, border:CB, cursor:'pointer', background:'transparent' }} />
              </div>
            ))}
          </div>
        </div>

        <button onClick={handleGenerate} disabled={loading||!run}
          style={{ padding:'9px 0', borderRadius:8, border:'none', cursor:loading||!run?'wait':'pointer', background:loading?`rgba(11,68,111,0.35)`:`linear-gradient(135deg,${V.accent},${V.accent2})`, color:'#fff', fontWeight:700, fontSize:'0.82rem', transition:'all 0.15s' }}>
          {loading ? '⟳ Generating…' : '▶ Generate Plot'}
        </button>

        {imgSrc && (
          <button onClick={downloadPng}
            style={{ padding:'6px 0', borderRadius:7, border:`1px solid ${V.border}`, background:V.muted, color:'var(--text-1)', fontSize:'0.75rem', fontWeight:600, cursor:'pointer' }}>
            ↓ Download PNG
          </button>
        )}
        {dialog}
      </div>

      {/* Image area — with two-axis resize handles */}
      <div ref={imgWrapperRef} style={{
        flex: imgContainerWidth ? '0 0 auto' : 1,
        minWidth: imgContainerWidth ? imgContainerWidth : 300,
        width: imgContainerWidth ?? undefined,
        flexShrink: 0,
        display: 'flex', flexDirection: 'row', alignItems: 'stretch', alignSelf: 'flex-start',
      }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Main image container */}
          <div ref={imgContainerRef} style={{
            borderRadius: 10, border: CB,
            background: imgSrc && !loading ? '#ffffff' : 'var(--bg-card)',
            height: imgContainerHeight, minHeight: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', position: 'relative',
          }}>
            {loading && (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
                <div style={{ width:36, height:36, borderRadius:'50%', border:`3px solid ${V.muted}`, borderTopColor:V.accent, animation:'gsea-spin 0.8s linear infinite' }} />
                <span style={{ fontSize:'0.8rem', color:'var(--text-3)' }}>Rendering with R…</span>
              </div>
            )}
            {error && (
              <div style={{ padding:24, maxWidth:420, textAlign:'center' }}>
                <div style={{ fontSize:'1.4rem', marginBottom:8 }}>⚠</div>
                <div style={{ fontSize:'0.78rem', color:'#f87171', lineHeight:1.6 }}>{error}</div>
              </div>
            )}
            {imgSrc && !loading && (
              <img src={imgSrc} alt={plotType} style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }} />
            )}
            {!imgSrc && !loading && !error && (
              <div style={{ textAlign:'center', color:'var(--text-3)', padding:40 }}>
                <div style={{ fontSize:'2.5rem', opacity:0.15, marginBottom:10 }}>◈</div>
                <div style={{ fontSize:'0.82rem' }}>Select a plot type and click Generate</div>
              </div>
            )}
          </div>

          {/* Bottom drag handle (height) */}
          <div onMouseDown={handleImgResizeHeight} title="Drag to resize height"
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(11,68,111,0.12)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(11,68,111,0.04)' }}
            style={{ width: '100%', height: 10, cursor: 'ns-resize', flexShrink: 0,
              background: 'rgba(11,68,111,0.04)', transition: 'background 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(11,68,111,0.35)', flexShrink: 0 }} />
            ))}
          </div>
        </div>

        {/* Right drag handle (width) */}
        <div onMouseDown={handleImgResizeWidth} title="Drag to resize width"
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(11,68,111,0.12)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(11,68,111,0.04)' }}
          style={{ width: 10, cursor: 'ew-resize', flexShrink: 0,
            background: 'rgba(11,68,111,0.04)', transition: 'background 0.15s',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
          {[0,1,2].map(i => (
            <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(11,68,111,0.35)', flexShrink: 0 }} />
          ))}
        </div>
      </div>

    </div>
  )
}

// ── Enrichment mountain plot modal (draggable + resizable) ───────────────────
function MountainModal({ pathway, result, curveData, curveLoading, curveError, onClose, onRetry }) {
  const plotRef = useRef(null)
  const cardRef = useRef(null)
  const [size, setSize] = useState({ width: 800, height: 560 })
  const [pos,  setPos]  = useState(null) // null until centred on first render

  // Centre on mount
  useEffect(() => {
    setPos({
      x: Math.max(0, Math.round((window.innerWidth  - 800) / 2)),
      y: Math.max(0, Math.round((window.innerHeight - 560) / 2)),
    })
  }, [])

  // Drag — header acts as handle
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
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
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
        width:  Math.min(Math.max(480, startW + e.clientX - startX), Math.floor(window.innerWidth * 0.97)),
        height: Math.max(320, startH + e.clientY - startY),
      })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp)
      window.addEventListener('click', e => e.stopPropagation(), { capture: true, once: true })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
  }

  useEffect(()=>{
    // pos is null on first render (modal returns null); wait until the div is in the DOM
    if(!curveData||!plotRef.current||!pos) return
    const { x, y, hits, hitGenes, nHits }=curveData
    const nes=result?.NES??0
    const color=nes>=0?V.up:V.down
    const colorFade=nes>=0?'rgba(16,185,129,0.12)':'rgba(244,63,94,0.12)'
    const peakIdx=nes>=0?y.indexOf(Math.max(...y)):y.indexOf(Math.min(...y))
    const peakX=x[peakIdx]??0.5
    const textColor=getComputedStyle(document.documentElement).getPropertyValue('--text-1').trim()||'#e2e8f0'
    const gridColor=getComputedStyle(document.documentElement).getPropertyValue('--border').trim()||'#334155'
    const fmtName=(pathway||'').replace(/_/g,' ')

    Plotly.react(plotRef.current, [
      { x, y, type:'scatter', mode:'lines', fill:'tozeroy', fillcolor:colorFade, line:{ color, width:2.5 }, name:'Running ES', hovertemplate:'Rank: %{x:.4f}<br>ES: %{y:.4f}<extra></extra>' },
      { x:hits, y:Array(hits.length).fill(-0.08), customdata:hitGenes??[],
        type:'scatter', mode:'markers',
        marker:{ symbol:'line-ns-open', size:12, color, line:{ width:1.5, color } },
        name:'Pathway genes',
        hovertemplate:hitGenes?.length?'<b>%{customdata}</b><br>Rank: %{x:.4f}<extra></extra>':'Rank: %{x:.4f}<extra></extra>' },
    ], {
      height:400, margin:{ t:55, r:20, b:55, l:60 },
      title:{ text:`<b>${fmtName.slice(0,72)}${fmtName.length>72?'…':''}</b>`, font:{size:12,color:textColor}, x:0.5 },
      xaxis:{ title:'Gene rank (normalised)', range:[-0.01,1.01], color:'var(--text-3)', gridcolor:gridColor, zeroline:false, tickfont:{size:10} },
      yaxis:{ title:'Running enrichment score', autorange:true, color:'var(--text-3)', gridcolor:gridColor, zeroline:true, zerolinecolor:'var(--text-3)', zerolinewidth:1, tickfont:{size:10} },
      plot_bgcolor:'transparent', paper_bgcolor:'transparent',
      legend:{ font:{size:10,color:'var(--text-3)'}, x:0.01, y:0.99 },
      modebar:{ bgcolor:'rgba(255,255,255,0.85)', color:'#444444', activecolor:'#000000' },
      annotations:[{ x:0.99, y:0.97, xref:'paper', yref:'paper', xanchor:'right', yanchor:'top',
        text:`NES: <b>${(nes>0?'+':'')+nes.toFixed(3)}</b>  padj: <b>${fmtPval(result?.padj)}</b>  hits: ${nHits}/${result?.size}`,
        showarrow:false, font:{size:11,color:'#000000'}, bgcolor:'rgba(255,255,255,0.82)', borderpad:5, bordercolor:'rgba(0,0,0,0.12)', borderwidth:1 }],
      shapes:[
        { type:'line', x0:0, x1:1, y0:0, y1:0, xref:'paper', line:{ color:'var(--border)', width:1 } },
        { type:'line', x0:peakX, x1:peakX, y0:0, y1:1, yref:'paper', line:{ color, width:1.2, dash:'dot' } },
        { type:'line', x0:0, x1:1, xref:'paper', y0:-0.055, y1:-0.055, line:{ color:'var(--border)', width:0.8 } },
      ],
    }, { responsive:true, displaylogo:false, modeBarButtonsToRemove:['select2d','lasso2d'],
         toImageButtonOptions:{ filename:'enrichment_'+pathway, scale:2, format:'png' } }
    ).then(()=>{ if(plotRef.current) Plotly.Plots.resize(plotRef.current) })
  },[curveData, pathway, result, pos])

  // Resize Plotly when modal size changes
  useEffect(()=>{
    if(plotRef.current && curveData) Plotly.Plots.resize(plotRef.current)
  },[size, curveData])

  if (!pos) return null

  return (
    <div style={{ position:'fixed', inset:0, zIndex:101000, pointerEvents:'none' }}>
      {/* Backdrop */}
      <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.55)', backdropFilter:'blur(4px)', pointerEvents:'auto' }}
        onClick={onClose} />

      {/* Modal card */}
      <div ref={cardRef}
        style={{ position:'absolute', left:pos.x, top:pos.y, width:size.width, height:size.height,
                 background:'var(--bg-panel)', borderRadius:16, border:`1px solid ${V.border}`,
                 boxShadow:`0 0 40px rgba(11,68,111,0.22)`, display:'flex', flexDirection:'column',
                 pointerEvents:'auto', overflow:'hidden', boxSizing:'border-box' }}
        onClick={e=>e.stopPropagation()}>

        {/* Header — drag handle */}
        <div onMouseDown={onDragStart}
          style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                   padding:'10px 16px', cursor:'grab', flexShrink:0, userSelect:'none',
                   borderBottom:`1px solid ${V.border}`, background:'rgba(255,255,255,0.02)' }}>
          <span style={{ ...LBL, fontSize:'0.7rem' }}>Enrichment Mountain Plot</span>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <span style={{ fontSize:'0.67rem', color:'var(--text-3)' }}>Camera → export PNG · Hover rug marks for gene names</span>
            <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-3)', fontSize:'1.3rem', lineHeight:1 }}>×</button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex:'1 1 0', minHeight:0, display:'flex', flexDirection:'column', padding:'8px 16px 12px', gap:6 }}>
          {curveLoading ? (
            <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14 }}>
              <div style={{ width:40, height:40, borderRadius:'50%', border:`3px solid ${V.muted}`, borderTopColor:V.accent, animation:'gsea-spin 0.7s linear infinite' }} />
              <span style={{ fontSize:'0.8rem', color:'var(--text-3)' }}>Computing enrichment curve…</span>
            </div>
          ) : curveError ? (
            <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14 }}>
              <div style={{ fontSize:'0.85rem', color:'#f87171', textAlign:'center', maxWidth:480, lineHeight:1.6 }}>⚠ {curveError}</div>
              {onRetry && <button onClick={onRetry} style={{ padding:'6px 18px', borderRadius:7, border:`1px solid ${V.border}`, background:V.muted, color:V.text, fontSize:'0.78rem', fontWeight:600, cursor:'pointer' }}>↺ Retry</button>}
            </div>
          ) : curveData ? (
            <>
              <div ref={plotRef} style={{ flex:'1 1 0', minHeight:0 }} />
              <div style={{ flexShrink:0, fontSize:'0.72rem', color:'var(--text-3)', lineHeight:1.6 }}>
                <b style={{ color:'var(--text-1)' }}>Leading edge ({result?.leadingEdgeN}):</b>{' '}
                {(result?.leadingEdge||'').split(',').slice(0,15).join(', ')}
                {result?.leadingEdgeN>15?` … +${result.leadingEdgeN-15} more`:''}
              </div>
            </>
          ) : null}
        </div>

        {/* Resize handles: bottom edge, right edge, corner */}
        <div onMouseDown={e => {
          e.preventDefault(); e.stopPropagation()
          const startY = e.clientY, startH = cardRef.current?.offsetHeight ?? size.height
          const onMove = ev => setSize(s => ({ ...s, height: Math.max(320, startH + ev.clientY - startY) }))
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); window.addEventListener('click', ev => ev.stopPropagation(), { capture: true, once: true }) }
          window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
        }} style={{ position:'absolute', bottom:0, left:0, right:18, height:8, cursor:'ns-resize', zIndex:10 }} />
        <div onMouseDown={e => {
          e.preventDefault(); e.stopPropagation()
          const startX = e.clientX, startW = cardRef.current?.offsetWidth ?? size.width
          const onMove = ev => setSize(s => ({ ...s, width: Math.min(Math.max(480, startW + ev.clientX - startX), Math.floor(window.innerWidth * 0.97)) }))
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); window.addEventListener('click', ev => ev.stopPropagation(), { capture: true, once: true }) }
          window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
        }} style={{ position:'absolute', top:0, right:0, bottom:18, width:8, cursor:'ew-resize', zIndex:10 }} />
        <div onMouseDown={onResizeStart}
          style={{ position:'absolute', bottom:4, right:4, width:16, height:16,
                   cursor:'nwse-resize', opacity:0.35, zIndex:11,
                   backgroundImage:'radial-gradient(circle, var(--text-3) 1.2px, transparent 1.2px)',
                   backgroundSize:'4px 4px' }} />
      </div>
      <style>{`
  @keyframes gsea-spin { to { transform:rotate(360deg); } }
  .plot-resizing, .plot-resizing * { cursor: ns-resize !important; user-select: none !important; }
  .plot-resizing-h, .plot-resizing-h * { cursor: ew-resize !important; user-select: none !important; }
`}</style>
    </div>
  )
}

// ── Leading-edge heatmap helpers ──────────────────────────────────────────────
const LE_PALETTE_PRESETS = [
  { label: 'Blue–White–Red',   colors: ['#1565C0','#ffffff','#B71C1C'] },
  { label: 'Purple–White–Org', colors: ['#6A1B9A','#ffffff','#E65100'] },
  { label: 'Green–White–Red',  colors: ['#1B5E20','#ffffff','#B71C1C'] },
  { label: 'Navy–White–Gold',  colors: ['#0D1B4B','#ffffff','#F9A825'] },
  { label: 'Teal–Black–Pink',  colors: ['#00695C','#000000','#AD1457'] },
]

function LEPaletteRow({ palette, setPalette }) {
  const [drafts, setDrafts] = useState(palette)
  const timer = useRef(null)
  useEffect(() => { setDrafts(palette) }, [palette])
  const commit = (next) => { clearTimeout(timer.current); timer.current = setTimeout(() => setPalette(next), 500) }
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
      <div style={{ display:'flex', gap:4 }}>
        {LE_PALETTE_PRESETS.map(p => {
          const active = JSON.stringify(p.colors) === JSON.stringify(palette)
          return (
            <button key={p.label} title={p.label}
                    onClick={() => { clearTimeout(timer.current); setPalette(p.colors) }}
                    style={{ display:'flex', padding:0, border:`2px solid ${active?V.accent:'transparent'}`,
                             borderRadius:5, cursor:'pointer', overflow:'hidden', height:18 }}>
              {p.colors.map((c,i) => <span key={i} style={{ width:14, height:18, background:c, display:'block' }} />)}
            </button>
          )
        })}
      </div>
      <div style={{ display:'flex', gap:6 }}>
        {drafts.map((col,i) => (
          <label key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, cursor:'pointer' }}>
            <span style={{ fontSize:'0.6rem', color:'var(--text-3)', textTransform:'uppercase' }}>{['Low','Mid','High'][i]}</span>
            <div style={{ position:'relative', width:24, height:24 }}>
              <span style={{ display:'block', width:24, height:24, borderRadius:4, background:col, border:'2px solid var(--border)' }} />
              <input type="color" value={col}
                     onInput={e => { const n=[...drafts]; n[i]=e.target.value; setDrafts(n); commit(n) }}
                     style={{ position:'absolute', inset:0, opacity:0, width:'100%', height:'100%', cursor:'pointer' }} />
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}

async function leApiFetch(path, body) {
  const res = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

function applySymbolsLE(fig, annMap) {
  if (!annMap || !fig?.layout) return fig
  const rep = arr => Array.isArray(arr) ? arr.map(v => annMap[v] || v) : arr
  Object.keys(fig.layout).filter(k => /^[xy]axis/.test(k)).forEach(ax => {
    if (fig.layout[ax]?.ticktext) fig.layout[ax].ticktext = rep(fig.layout[ax].ticktext)
  })
  fig.data?.forEach(t => { if (t.y) t.y = rep(t.y) })
  return fig
}

function applySampleLabelsLE(fig, sampleLabels) {
  if (!sampleLabels || !Object.keys(sampleLabels).length || !fig) return fig
  const ren = v => typeof v === 'string' ? (sampleLabels[v] ?? v) : v
  if (fig.layout) Object.keys(fig.layout).filter(k => /^xaxis/.test(k)).forEach(ax => {
    if (fig.layout[ax]?.ticktext) fig.layout[ax].ticktext = fig.layout[ax].ticktext.map(ren)
  })
  fig.data?.forEach(t => { if (t.x) t.x = t.x.map(ren) })
  return fig
}

// ── LeadingEdgeHeatmapPanel ───────────────────────────────────────────────────
function LeadingEdgeHeatmapPanel({ run, session, annMap, sampleLabels = {}, pca, contrastList = [] }) {
  const plotRef        = useRef(null)
  const outerRef       = useRef(null)   // height-resize target
  const plotWrapperRef = useRef(null)   // width-resize target

  // ── Sidebar state ────────────────────────────────────────────────────────────
  const [selPathways,  setSelPathways]  = useState([])
  const [searchQuery,  setSearchQuery]  = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  // ── Controls state ───────────────────────────────────────────────────────────
  const [controlsOpen, setControlsOpen] = useState(false)
  const [exprMode,     setExprMode]     = useState('norm')
  const [sampleScope,  setSampleScope]  = useState('all')
  const [scopeContrast,setScopeContrast]= useState('')
  const [clusterRows,  setClusterRows]  = useState(true)
  const [clusterCols,  setClusterCols]  = useState(true)
  const [distMethod,   setDistMethod]   = useState('pearson')
  const [colorBy,      setColorBy]      = useState('')
  const [palette,      setPalette]      = useState(['#1565C0','#ffffff','#B71C1C'])
  const [annColors,    setAnnColors]    = useState({})
  const [annGroups,    setAnnGroups]    = useState([])

  // ── Plot state ───────────────────────────────────────────────────────────────
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [hasPlot,      setHasPlot]      = useState(false)
  const [plotHeight,   setPlotHeight]   = useState(800)
  const [plotWidth,    setPlotWidth]    = useState(null)

  // Reset on run change
  useEffect(() => { setSelPathways([]); setHasPlot(false); setError(null) }, [run])

  // Init scopeContrast from contrastList
  useEffect(() => {
    if (contrastList?.length && !scopeContrast) setScopeContrast(contrastList[0]?.label ?? '')
  }, [contrastList])

  // ── Derived ──────────────────────────────────────────────────────────────────
  const availablePathways = useMemo(() => run?.results ?? [], [run])

  const filteredPathways = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return availablePathways.filter(r => !q || (r.pathway||'').toLowerCase().includes(q)).slice(0, 60)
  }, [availablePathways, searchQuery])

  const geneList = useMemo(() => {
    const seen = new Set(); const genes = []
    selPathways.forEach(({ genes: g }) => g.forEach(x => { if (!seen.has(x)) { seen.add(x); genes.push(x) } }))
    return genes
  }, [selPathways])

  const metaCols = useMemo(() => {
    if (!pca?.scores?.length) return []
    return Object.keys(pca.scores[0]).filter(k => k !== 'sample' && !/^PC\d+$/.test(k))
  }, [pca])

  useEffect(() => {
    if (!metaCols.length) return
    setColorBy(v => (v && metaCols.includes(v)) ? v : metaCols[0])
  }, [metaCols])

  useEffect(() => { setAnnGroups([]); setAnnColors({}) }, [colorBy])

  // Sample subset for contrast-limited mode.
  // We auto-detect the design column by finding whichever metadata column in
  // pca.scores actually contains both the treatment and reference values — this
  // avoids depending on colorBy (the annotation colour column) matching the DESeq2
  // design column, which is often different.
  const sampleSubset = useMemo(() => {
    if (sampleScope !== 'contrast' || !scopeContrast) return null
    const c = contrastList?.find(c => c.label === scopeContrast)
    if (!c?.treatment || !c?.reference) return null
    const scores = pca?.scores || []
    if (!scores.length) return null
    // Find the first metadata column whose values include both treatment and reference
    const metaKeys = Object.keys(scores[0]).filter(k => k !== 'sample' && !/^PC\d+$/.test(k))
    const designCol = metaKeys.find(col =>
      scores.some(s => s[col] === c.treatment) &&
      scores.some(s => s[col] === c.reference)
    )
    if (!designCol) return null
    return scores
      .filter(s => s[designCol] === c.treatment || s[designCol] === c.reference)
      .map(s => s.sample)
  }, [sampleScope, scopeContrast, contrastList, pca])

  // ── Resize observer ───────────────────────────────────────────────────────────
  // Read plotRef.current inside the callback so we always get the live reference,
  // not a stale null captured at mount time (before any plot has been generated).
  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const plot = plotRef.current
      if (plot?._fullLayout) Plotly.Plots.resize(plot)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Drag resize handlers ──────────────────────────────────────────────────────
  const handleHeightResize = useCallback(e => {
    e.preventDefault()
    const el = outerRef.current; if (!el) return
    const startY = e.clientY, startH = el.getBoundingClientRect().height
    document.body.classList.add('plot-resizing')
    const onMove = ev => { el.style.height = `${Math.max(300, startH + (ev.clientY - startY))}px` }
    const onUp = ev => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('plot-resizing')
      setPlotHeight(Math.max(300, startH + (ev.clientY - startY)))
      setTimeout(() => { if (plotRef.current?._fullLayout) Plotly.Plots.resize(plotRef.current) }, 50)
    }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }, [])

  const handleWidthResize = useCallback(e => {
    e.preventDefault()
    const el = plotWrapperRef.current; if (!el) return
    const startX = e.clientX, startW = el.getBoundingClientRect().width
    document.body.classList.add('plot-resizing-h')
    const onMove = ev => { el.style.width = `${Math.max(300, startW + (ev.clientX - startX))}px` }
    const onUp = ev => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('plot-resizing-h')
      setPlotWidth(Math.max(300, startW + (ev.clientX - startX)))
      setTimeout(() => { if (plotRef.current?._fullLayout) Plotly.Plots.resize(plotRef.current) }, 50)
    }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }, [])

  // ── Sidebar actions ───────────────────────────────────────────────────────────
  function addPathway(r) {
    const genes = (r.leadingEdge || '').split(',').map(g => g.trim()).filter(Boolean)
    if (!genes.length) return
    setSelPathways(prev => prev.find(p => p.pathway === r.pathway)
      ? prev : [...prev, { pathway: r.pathway, genes, count: r.leadingEdgeN ?? genes.length }])
    setSearchQuery(''); setShowDropdown(false)
  }
  function removePathway(name) { setSelPathways(prev => prev.filter(p => p.pathway !== name)) }

  // ── Generate ─────────────────────────────────────────────────────────────────
  async function generate() {
    if (!geneList.length) { setError('Add at least one pathway first.'); return }
    if (!session?.sessionId) return
    setLoading(true); setError(null); setHasPlot(false)
    try {
      const activeLabels = (contrastList || []).map(c => c.label ?? `${c.treatment}|${c.reference}`)
      const body = {
        sessionId:    session.sessionId,
        customGenes:  geneList,
        annMap:       annMap || null,
        pathwayLabel: selPathways.map(p => (p.pathway||'').replace(/_/g,' ')).join(' + '),
        mode: exprMode, clusterRows, clusterCols, distMethod,
        colorBy: colorBy || '', topN: geneList.length, palette,
        annColors: Object.keys(annColors).length ? annColors : null,
        activeLabels,
      }
      if (sampleSubset?.length) body.sampleSubset = sampleSubset

      const data = await leApiFetch('/api/heatmap', body)
      const fig = JSON.parse(data.plotlyJson)
      const textColor = getComputedStyle(document.body).getPropertyValue('--text-2').trim() || '#475569'
      const hlabel = { bgcolor:'#1e293b', bordercolor:'#334155', font:{ color:'#e2e8f0', size:12 } }
      fig.data = fig.data.map(t => ({ ...t, hoverlabel: hlabel }))

      // Strip any explicit width/height the backend baked in — we want Plotly to
      // fill the flex cell exactly so the SVG never bleeds over the drag handle.
      // eslint-disable-next-line no-unused-vars
      const { width: _bw, height: _bh, ...baseLayout } = fig.layout ?? {}
      fig.layout = { ...baseLayout, autosize: true,
                     paper_bgcolor:'transparent', plot_bgcolor:'transparent',
                     font:{ ...(baseLayout?.font||{}), color:textColor }, hoverlabel:hlabel }
      applySymbolsLE(fig, annMap)
      applySampleLabelsLE(fig, sampleLabels)

      // Show the wrapper first so plotRef has real dimensions when Plotly measures it
      setHasPlot(true)
      // Let the browser paint the wrapper before reacting
      await new Promise(r => requestAnimationFrame(r))
      await Plotly.react(plotRef.current, fig.data, fig.layout, {
        responsive:true, displaylogo:false, modeBarButtonsToRemove:['lasso2d','select2d'],
      })
      setTimeout(() => { if (plotRef.current?._fullLayout) Plotly.Plots.resize(plotRef.current) }, 50)

      if (data.annGroups?.length) {
        const defs = ['#800020','#228B22','#C9A227','#555555','#4E6E8E','#A0522D']
        setAnnGroups(data.annGroups)
        setAnnColors(prev => {
          const next = { ...prev }
          data.annGroups.forEach((g,i) => { if (!next[g]) next[g] = defs[i % defs.length] })
          return next
        })
      }

    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }

  // ── Mini sub-components ───────────────────────────────────────────────────────
  const LESwitch = ({ val, set, label }) => (
    <label style={{ display:'flex', alignItems:'center', gap:7, cursor:'pointer', userSelect:'none' }}>
      <div onClick={() => set(v => !v)} style={{
        width:34, height:18, borderRadius:9, position:'relative', cursor:'pointer', flexShrink:0,
        background: val ? V.accent : 'rgba(255,255,255,0.12)',
        border:`1px solid ${val ? V.accent : 'var(--border)'}`, transition:'background 0.2s',
      }}>
        <div style={{ position:'absolute', top:1, left: val?15:1, width:14, height:14,
                      borderRadius:'50%', background: val?'#fff':'rgba(255,255,255,0.5)',
                      transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.3)' }} />
      </div>
      <span style={{ fontSize:'0.78rem', color: val?'var(--text-1)':'var(--text-3)', fontWeight: val?500:400 }}>{label}</span>
    </label>
  )

  const LEControlGroup = ({ label, children }) => (
    <div style={{ display:'flex', flexDirection:'column', gap:8, padding:'10px 14px',
                  background:'rgba(255,255,255,0.02)', border:'1px solid var(--border)', borderRadius:8 }}>
      <span style={{ fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.07em',
                     textTransform:'uppercase', color:'var(--text-3)', marginBottom:2 }}>{label}</span>
      {children}
    </div>
  )

  const LEPillToggle = ({ options, value, onChange }) => (
    <div style={{ display:'inline-flex', background:'rgba(255,255,255,0.04)',
                  borderRadius:6, border:'1px solid var(--border)', padding:'2px 3px' }}>
      {options.map(([val, lbl]) => (
        <button key={val} onClick={() => onChange(val)}
                style={{ fontSize:'0.72rem', padding:'2px 10px', borderRadius:4, border:'none',
                         cursor:'pointer', whiteSpace:'nowrap', transition:'background 0.15s, color 0.15s',
                         background: value===val ? V.accent : 'transparent',
                         color:      value===val ? '#fff'    : 'var(--text-3)',
                         fontWeight: value===val ? 600 : 400 }}>{lbl}</button>
      ))}
    </div>
  )

  const pName = s => (s||'').replace(/_/g,' ').replace(/^[A-Z0-9]+ /,'')

  if (!run) return (
    <div style={{ padding:40, textAlign:'center', color:'var(--text-3)', fontSize:'0.85rem' }}>
      Run a GSEA analysis first to use the leading-edge heatmap.
    </div>
  )

  return (
    <div style={{ display:'flex', gap:0, minHeight:600 }}>

      {/* ── LEFT SIDEBAR ── */}
      <div style={{ width:260, flexShrink:0, borderRight:`1px solid ${V.border}`,
                    paddingRight:14, paddingTop:4, display:'flex', flexDirection:'column', gap:14,
                    overflowY:'auto' }}>

        <span style={{ fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.07em',
                       textTransform:'uppercase', color:V.text }}>Leading-Edge Gene Sets</span>

        {/* Pathway search */}
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <span style={{ fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.07em',
                         textTransform:'uppercase', color:'var(--text-3)' }}>Add pathway</span>
          <div style={{ position:'relative' }}>
            <input value={searchQuery}
                   onChange={e => { setSearchQuery(e.target.value); setShowDropdown(true) }}
                   onFocus={() => setShowDropdown(true)}
                   onBlur={() => setTimeout(() => setShowDropdown(false), 160)}
                   placeholder="Search pathways…"
                   style={{ width:'100%', fontSize:'0.76rem', padding:'5px 8px' }} />
            {showDropdown && filteredPathways.length > 0 && (
              <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:300,
                            background:'var(--bg-panel)', border:`1px solid ${V.border}`,
                            borderRadius:7, maxHeight:230, overflowY:'auto',
                            boxShadow:'0 8px 28px rgba(0,0,0,0.35)' }}>
                {filteredPathways.map(r => {
                  const already = !!selPathways.find(p => p.pathway === r.pathway)
                  return (
                    <div key={r.pathway}
                         onMouseDown={e => { e.preventDefault(); if (!already) addPathway(r) }}
                         style={{ padding:'6px 10px', fontSize:'0.74rem',
                                  cursor: already?'default':'pointer',
                                  color: already?'var(--text-3)':'var(--text-1)',
                                  borderBottom:`1px solid ${V.border}` }}
                         onMouseEnter={e => { if (!already) e.currentTarget.style.background = V.muted }}
                         onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {already ? '✓ ' : ''}{pName(r.pathway)}
                      </div>
                      <div style={{ fontSize:'0.66rem', color:V.text, marginTop:2 }}>
                        {r.leadingEdgeN} genes · padj {fmtPval(r.padj)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ borderTop:`1px solid ${V.border}` }} />

        {/* Selected pathway chips */}
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.07em',
                           textTransform:'uppercase', color:'var(--text-3)' }}>
              Selected ({selPathways.length})
            </span>
            {selPathways.length > 0 && (
              <button onClick={() => { setSelPathways([]); setHasPlot(false) }}
                      style={{ background:'none', border:'none', cursor:'pointer',
                               fontSize:'0.68rem', color:'var(--text-3)', textDecoration:'underline' }}>
                Clear all
              </button>
            )}
          </div>
          {selPathways.length === 0 ? (
            <em style={{ fontSize:'0.73rem', color:'var(--text-3)' }}>No pathways added yet</em>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:5, maxHeight:260, overflowY:'auto' }}>
              {selPathways.map(p => (
                <div key={p.pathway} style={{ display:'flex', alignItems:'flex-start', gap:5,
                                              background:V.muted, border:`1px solid ${V.border}`,
                                              borderRadius:6, padding:'5px 7px', fontSize:'0.72rem' }}>
                  <span style={{ flex:1, color:'var(--text-1)', lineHeight:1.3, wordBreak:'break-word' }}>
                    {pName(p.pathway)}
                    <span style={{ marginLeft:5, color:V.text, fontWeight:600 }}>({p.count})</span>
                  </span>
                  <button onClick={() => removePathway(p.pathway)}
                          style={{ background:'none', border:'none', cursor:'pointer',
                                   color:'var(--text-3)', fontSize:'1rem', lineHeight:1,
                                   padding:'0 1px', flexShrink:0 }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer gene count */}
        <div style={{ marginTop:'auto', paddingTop:10, borderTop:`1px solid ${V.border}`,
                      display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:'0.72rem', color:'var(--text-3)' }}>Total unique genes</span>
          <span style={{ fontSize:'0.75rem', fontWeight:600, color:V.text,
                         background:V.muted, border:`1px solid ${V.border}`,
                         borderRadius:999, padding:'2px 10px' }}>
            {geneList.length.toLocaleString()}
          </span>
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div style={{ flex:1, paddingLeft:18, display:'flex', flexDirection:'column', gap:12,
                    minWidth:0, overflowX: plotWidth ? 'auto' : 'visible' }}>

        {/* Collapsible controls toggle */}
        <button onClick={() => setControlsOpen(v => !v)}
                style={{ display:'flex', alignItems:'center', gap:8, width:'100%',
                          background:'rgba(255,255,255,0.03)', border:`1px solid ${V.border}`,
                          borderRadius: controlsOpen ? '8px 8px 0 0' : 8, padding:'7px 14px',
                          cursor:'pointer', color:'var(--text-2)', fontSize:'0.78rem', fontWeight:500,
                          transition:'border-radius 0.15s' }}>
          <span style={{ display:'inline-block', transition:'transform 0.2s', fontSize:'0.7rem',
                         color:'var(--text-3)', transform: controlsOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          Plot Controls
          <span style={{ marginLeft:'auto', fontSize:'0.82rem', color:'var(--text-3)',
                         display:'inline-block', transition:'transform 0.2s',
                         transform: controlsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
        </button>

        {/* Controls grid */}
        <div style={{ display: controlsOpen ? 'grid' : 'none',
                      gridTemplateColumns:'1fr 1fr', gap:8, alignItems:'start',
                      border:`1px solid ${V.border}`, borderTop:'none',
                      borderRadius:'0 0 8px 8px', padding:'12px 8px 8px' }}>

          {/* Sample scope */}
          <LEControlGroup label="Sample Scope">
            <LEPillToggle
              options={[['all','All Samples'],['contrast','Contrast-limited']]}
              value={sampleScope} onChange={setSampleScope} />
            {sampleScope === 'contrast' && (
              <select value={scopeContrast} onChange={e => setScopeContrast(e.target.value)}
                      style={{ fontSize:'0.78rem', padding:'3px 8px', marginTop:2 }}>
                {(contrastList || []).map(c => (
                  <option key={c.label} value={c.label}>{c.label ?? c.treatment}</option>
                ))}
              </select>
            )}
            {sampleScope === 'contrast' && !colorBy && (
              <span style={{ fontSize:'0.68rem', color:'#f87171' }}>
                ⚠ Select a metadata column first
              </span>
            )}
          </LEControlGroup>

          {/* Expression */}
          <LEControlGroup label="Expression">
            <LEPillToggle
              options={[['norm','Norm. counts'],['vst','VST']]}
              value={exprMode} onChange={setExprMode} />
          </LEControlGroup>

          {/* Clustering */}
          <LEControlGroup label="Clustering">
            <LESwitch val={clusterRows} set={setClusterRows} label="Rows" />
            <LESwitch val={clusterCols} set={setClusterCols} label="Columns" />
            {(clusterRows || clusterCols) && (
              <select value={distMethod} onChange={e => setDistMethod(e.target.value)}
                      style={{ fontSize:'0.78rem', padding:'3px 8px', minWidth:110 }}>
                {['euclidean','pearson','spearman','kendall','manhattan','maximum'].map(m =>
                  <option key={m} value={m}>{m}</option>)}
              </select>
            )}
          </LEControlGroup>

          {/* Annotation */}
          {metaCols.length > 0 && (
            <LEControlGroup label="Annotation">
              <select value={colorBy} onChange={e => setColorBy(e.target.value)}
                      style={{ fontSize:'0.78rem', padding:'3px 8px', minWidth:120 }}>
                {metaCols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {annGroups.length > 0 && (
                <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginTop:2 }}>
                  {annGroups.map(grp => (
                    <label key={grp} style={{ display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
                      <input type="color" value={annColors[grp]||'#999999'}
                             onChange={e => setAnnColors(prev => ({ ...prev, [grp]: e.target.value }))}
                             style={{ width:18, height:18, padding:0,
                                      border:'1px solid var(--border)', borderRadius:3, cursor:'pointer' }} />
                      <span style={{ fontSize:'0.7rem', color:'var(--text-2)',
                                     maxWidth:80, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {grp}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </LEControlGroup>
          )}

          {/* Palette — full width */}
          <div style={{ gridColumn:'1 / -1' }}>
            <LEControlGroup label="Palette">
              <LEPaletteRow palette={palette} setPalette={setPalette} />
            </LEControlGroup>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:8, alignItems:'center' }}>
          <button onClick={generate} disabled={loading || !geneList.length}
                  style={{ padding:'7px 20px', fontSize:'0.82rem', borderRadius:8, fontWeight:600,
                           background: loading || !geneList.length ? 'rgba(255,255,255,0.06)' : V.accent,
                           color: loading || !geneList.length ? 'var(--text-3)' : '#fff',
                           border:'none', cursor: loading || !geneList.length ? 'not-allowed' : 'pointer',
                           transition:'background 0.15s, color 0.15s' }}>
            {loading ? '⏳ Generating…' : '▶ Generate Heatmap'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding:'10px 14px', borderRadius:8, fontSize:'0.82rem',
                        background:'rgba(248,113,113,0.08)', color:'#f87171',
                        border:'1px solid rgba(248,113,113,0.25)' }}>⚠ {error}</div>
        )}

        {/* Placeholder */}
        {!hasPlot && !loading && !error && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
                        minHeight:220, color:'var(--text-3)', fontSize:'0.82rem',
                        fontStyle:'italic', textAlign:'center', padding:20 }}>
            {geneList.length
              ? `${geneList.length} genes ready — click Generate Heatmap`
              : 'Select pathways from the left panel, then click Generate Heatmap'}
          </div>
        )}

        {/* Spinner */}
        {loading && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                        justifyContent:'center', minHeight:300, gap:14 }}>
            <span style={{ width:40, height:40, borderRadius:'50%',
                           border:`3px solid ${V.muted}`, borderTopColor:V.accent,
                           display:'inline-block', animation:'gsea-spin 0.7s linear infinite' }} />
            <span style={{ fontSize:'0.82rem', color:'var(--text-3)', fontStyle:'italic' }}>Building heatmap…</span>
          </div>
        )}

        {/* Plot + resize handles */}
        <div ref={plotWrapperRef} style={{ display: hasPlot ? 'flex' : 'none',
                                           flexDirection:'column', width: plotWidth ?? '100%',
                                           alignSelf:'flex-start', flexShrink:0 }}>
          {/* Plot row + right handle */}
          <div style={{ display:'flex', alignItems:'stretch' }}>
            <div ref={outerRef} style={{ flex:1, height:plotHeight, minHeight:300 }}>
              <div ref={plotRef} style={{ width:'100%', height:'100%', minHeight:300 }} />
            </div>
            {/* Right drag handle */}
            <div onMouseDown={handleWidthResize} title="Drag to resize width"
                 style={{ width:10, cursor:'ew-resize', flexShrink:0,
                          display:'flex', alignItems:'center', justifyContent:'center',
                          background:'rgba(255,255,255,0.03)',
                          border:`1px solid ${V.border}`, borderLeft:'none',
                          borderRadius:'0 6px 0 0', userSelect:'none', transition:'background 0.15s' }}
                 onMouseEnter={e => e.currentTarget.style.background = V.muted}
                 onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}>
              <span style={{ fontSize:'0.5rem', color:'var(--text-3)',
                             writingMode:'vertical-lr', letterSpacing:3, lineHeight:1, pointerEvents:'none' }}>▾▾</span>
            </div>
          </div>
          {/* Bottom drag handle */}
          <div onMouseDown={handleHeightResize} title="Drag to resize height"
               style={{ width:'100%', height:10, cursor:'ns-resize', flexShrink:0,
                        display:'flex', alignItems:'center', justifyContent:'center',
                        background:'rgba(255,255,255,0.03)',
                        border:`1px solid ${V.border}`, borderTop:'none',
                        borderRadius:'0 0 6px 6px', userSelect:'none', transition:'background 0.15s' }}
               onMouseEnter={e => e.currentTarget.style.background = V.muted}
               onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}>
            <span style={{ fontSize:'0.5rem', color:'var(--text-3)',
                           letterSpacing:3, lineHeight:1, pointerEvents:'none' }}>▾▾</span>
          </div>
        </div>
      </div>

    </div>
  )
}

// ── Main GSEAExplorer ─────────────────────────────────────────────────────────
export default function GSEAExplorer({ session, contrastLabel, allContrasts = [], annMap, annDetails, onRunsChange, initialRuns, pca, sampleLabels = {}, contrastList = [] }) {
  const { promptDownload, dialog: exportDialog } = useDownloadDialog()
  const [exportLoading,  setExportLoading]  = useState(false)
  const [exportProgress, setExportProgress] = useState(0)   // 0-100
  const exportTimerRef = useRef(null)
  const [rankMethod,   setRankMethod]   = useState('log2FC')
  const [collection,   setCollection]   = useState(COLLECTIONS[0])
  const [species,      setSpecies]      = useState('Homo sapiens')

  // ── Human ortholog substitution for non-human species ────────────────────────
  // Build gene ID → human ortholog symbol from annDetails (populated by BioMart
  // or Built-in DB when "Fetch 1:1 human orthologs" was ticked during annotation).
  const orthoMap = useMemo(() => {
    if (!annDetails) return {}
    const m = {}
    for (const [gid, det] of Object.entries(annDetails)) {
      const h = det?.humanOrtholog
      if (h && typeof h === 'string' && h.trim()) m[gid] = h.trim()
    }
    return m
  }, [annDetails])
  const hasOrthologs  = Object.keys(orthoMap).length > 0
  const [useOrthologs, setUseOrthologs] = useState(false)
  // When ortholog mode is on, swap the gene → symbol map for gene → human-ortholog
  // and force the MSigDB species to Homo sapiens (all collections are human-based).
  const effectiveAnnMap  = useOrthologs && hasOrthologs ? orthoMap  : (annMap  ?? null)
  const effectiveSpecies = useOrthologs && hasOrthologs ? 'Homo sapiens' : species

  // Custom GMT state — { filename, sets: { name: [genes] }, pathwayCount, geneCount }
  const [customGmt, setCustomGmt] = useState(null)
  const [gmtDragOver, setGmtDragOver] = useState(false)

  const [minSize,      setMinSize]      = useState(15)
  const [maxSize,      setMaxSize]      = useState(500)
  const [scoreType,    setScoreType]    = useState('std')
  const [nPerm,        setNPerm]        = useState(1000)
  const [pAdjMethod,   setPAdjMethod]   = useState('BH')
  const [padjCutoff,   setPadjCutoff]   = useState(0.25)
  const [filterValue,  setFilterValue]  = useState(10)

  const [histData,     setHistData]     = useState(null)
  const [histLoading,  setHistLoading]  = useState(false)
  const [histError,    setHistError]    = useState(null)
  const [showDistModal,setShowDistModal]= useState(false)

  const [running,     setRunning]     = useState(false)
  const [runError,    setRunError]    = useState(null)
  const [elapsed,     setElapsed]     = useState(0)
  const [runningAll,  setRunningAll]  = useState(null)
  const [toast,       setToast]       = useState(null)
  const [notifyAll,   setNotifyAll]   = useState(() => localStorage.getItem('gsea_notify_all') === 'true')
  const toastTimerRef = useRef(null)

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 3500)
  }, [])

  const [runs,        setRuns]        = useState(() => initialRuns ?? [])
  const [activeRunId, setActiveRunId] = useState(null)

  // Only show runs belonging to the current contrast
  const contrastRuns = useMemo(()=>runs.filter(r=>r.contrastLabel===contrastLabel),[runs,contrastLabel])
  const activeRun    = contrastRuns.find(r=>r.id===activeRunId) ?? contrastRuns[contrastRuns.length-1] ?? null

  // Bubble all runs up to App for the Console
  useEffect(() => { onRunsChange?.(runs) }, [runs, onRunsChange])

  const [fullscreen,   setFullscreen]   = useState(false)
  const [fsPanel,      setFsPanel]      = useState(false)

  // Persist PlotsPanel image across fsPanel changes
  const plotImgCache = useRef(null)

  useEffect(() => {
    if (!fullscreen) return
    const handler = e => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fullscreen])

  // Clear cached plot image when the active run changes
  useEffect(() => { plotImgCache.current = null }, [activeRunId])

  // Toggle body attribute so that .glass backdrop-filter is neutralised while the
  // panel is fullscreen — this lets position:fixed escape the glass card's stacking
  // context without needing a portal (which would unmount and wipe child state).
  useEffect(() => {
    if (fsPanel) document.body.setAttribute('data-gsea-fs', '')
    else         document.body.removeAttribute('data-gsea-fs')
    return () =>   document.body.removeAttribute('data-gsea-fs')
  }, [fsPanel])

  useEffect(() => {
    if (!fsPanel) return
    const handler = e => { if (e.key === 'Escape') setFsPanel(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fsPanel])

  const [contentTab,   setContentTab]  = useState('results')
  const [selPathway,   setSelPathway]   = useState(null)
  const [curveData,    setCurveData]    = useState(null)
  const [curveLoading, setCurveLoading] = useState(false)
  const [curveError,   setCurveError]   = useState(null)
  const curveCacheRef  = useRef({})
  const runCtrlRef     = useRef(null)

  // Reset per-contrast state when contrast changes
  useEffect(()=>{
    setActiveRunId(null); setSelPathway(null); setCurveData(null); setCurveError(null)
    curveCacheRef.current = {}
  },[contrastLabel])

  // Fetch preview when contrast changes
  const fetchPreview = useCallback(()=>{
    if(!session?.sessionId) return
    setHistData(null); setHistLoading(true); setHistError(null)
    fetch('/api/gsea/preview',{ method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ sessionId:session.sessionId, contrastLabel }) })
      .then(r=>r.json())
      .then(d=>{ if(d.error) throw new Error(d.error); setHistData(d); setHistLoading(false) })
      .catch(e=>{ setHistError(e.message || 'Failed to load distributions'); setHistLoading(false) })
  },[session, contrastLabel])

  useEffect(()=>{ fetchPreview() },[fetchPreview])

  // Derived cutoff — baseMean absolute mode only
  const { cutoffOrig, cutoffLog, nAbove } = useMemo(()=>{
    if(!histData) return { cutoffOrig:0, cutoffLog:0, nAbove:0 }
    return {
      cutoffOrig: filterValue,
      cutoffLog:  Math.log1p(filterValue),
      nAbove:     genesAbove(histData.baseMeans, filterValue, histData.n_genes||0),
    }
  },[histData, filterValue])

  // Export clusterProfiler RDS — modal to pick which runs to include
  const [rdsModalOpen, setRdsModalOpen] = useState(false)
  const [rdsSelected,  setRdsSelected]  = useState({})   // runId → bool
  const [rdsLoading,   setRdsLoading]   = useState(false)
  const [rdsError,     setRdsError]     = useState(null)

  // Open modal: pre-check all runs for this contrast
  const openRdsModal = useCallback(() => {
    const sel = {}
    contrastRuns.forEach(r => { sel[r.id] = true })
    setRdsSelected(sel)
    setRdsError(null)
    setRdsModalOpen(true)
  }, [contrastRuns])

  const handleExportRds = useCallback(async () => {
    if (!session?.sessionId) return
    const selected = contrastRuns.filter(r => rdsSelected[r.id])
    if (!selected.length) { setRdsError('Select at least one run.'); return }
    setRdsLoading(true); setRdsError(null)
    try {
      const runs = selected.map(r => ({
        contrast_label:   r.contrastLabel,
        collection:       r.collectionId,
        subcategory:      r.collectionSub ?? null,
        species:          r.species,
        run_id:           r.id,
        collection_label: r.collectionLabel,
        rank_method:      r.rankMethod,
        // run params — for meta provenance in exported RDS
        min_size:         r.params?.minSize    ?? null,
        max_size:         r.params?.maxSize    ?? null,
        score_type:       r.scoreType          ?? null,
        n_perm:           r.nPerm              ?? null,
        padj_method:      r.pAdjMethod         ?? r.params?.pAdjMethod  ?? null,
        padj_cutoff:      r.padjCutoff         ?? r.params?.padjCutoff  ?? null,
        filter_value:     r.filterValue        ?? r.params?.filterValue ?? null,
        used_orthologs:   r.usedOrthologs      ?? false,
      }))
      const resp = await fetch('/api/gsea/export_rds', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, runs })
      })
      if (!resp.ok) {
        const ct = resp.headers.get('content-type') ?? ''
        const msg = ct.includes('json') ? (await resp.json()).error : await resp.text()
        throw new Error(msg ?? `HTTP ${resp.status}`)
      }
      const blob = await resp.blob()
      const url  = URL.createObjectURL(blob)
      const label = (contrastRuns[0]?.contrastLabel ?? 'contrast').replace(/\s+/g, '_')
      const cols  = selected.map(r => r.collectionLabel).join('+')
      const a = Object.assign(document.createElement('a'), { href: url, download: `gsea_${label}_${cols}.rds` })
      a.click(); URL.revokeObjectURL(url)
      setRdsModalOpen(false)
    } catch(e) { setRdsError(e.message) }
    finally { setRdsLoading(false) }
  }, [session, contrastRuns, rdsSelected])

  // Export full clusterProfiler results for all runs in this contrast
  const handleExportAll = useCallback(async()=>{
    if(!session?.sessionId || !contrastRuns.length) return
    // Start progress simulation: crawl toward 80%, slowing as it approaches
    setExportProgress(0)
    setExportLoading(true)
    clearInterval(exportTimerRef.current)
    exportTimerRef.current = setInterval(()=>{
      setExportProgress(p => {
        if(p >= 80) { clearInterval(exportTimerRef.current); return p }
        // step shrinks as we get closer to 80
        const step = Math.max(0.3, (80 - p) * 0.035)
        return Math.min(80, p + step)
      })
    }, 120)
    try {
      const runs = contrastRuns.map(r=>({
        contrast_label:   r.contrastLabel,
        collection:       r.collectionId,
        subcategory:      r.collectionSub ?? null,
        species:          r.species,
        run_id:           r.id,
        collection_label: r.collectionLabel,
        rank_method:      r.rankMethod,
      }))
      const resp = await fetch('/api/gsea/export_results',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ sessionId:session.sessionId, runs }),
      })
      const rows = await resp.json()
      if(rows.error) throw new Error(rows.error)
      // Snap to 100% then prompt download
      clearInterval(exportTimerRef.current)
      setExportProgress(100)
      const label = contrastLabel?.replace(/\s+/g,'_') ?? 'contrast'
      const dbs   = [...new Set(contrastRuns.map(r=>r.collectionLabel))].join('+')
      promptDownload(`gsea_results_${label}_${dbs}.csv`, name => downloadCSV(rows, name))
    } catch(e){ console.error('[GSEA export]', e) }
    finally{
      clearInterval(exportTimerRef.current)
      // Brief pause at 100% so the user sees completion, then reset
      setTimeout(()=>{ setExportLoading(false); setExportProgress(0) }, 600)
    }
  },[session, contrastRuns, contrastLabel, promptDownload])

  // Run GSEA
  const handleRun = useCallback(async()=>{
    if(!session?.sessionId) return
    const isCustom = collection.key === 'CUSTOM'
    if(isCustom && !customGmt?.sets) { setRunError('Please load a .gmt file before running.'); return }
    runCtrlRef.current?.abort()
    const ctrl=new AbortController(); runCtrlRef.current=ctrl
    setRunning(true); setRunError(null)
    let tick=0; const timer=setInterval(()=>setElapsed(++tick),1000)
    try {
      const runId = Date.now()
      const collectionLabel = isCustom ? (customGmt.filename ?? 'Custom GMT') : collection.label
      const r=await fetch('/api/gsea/run',{ method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ sessionId:session.sessionId, contrastLabel, rankMethod,
          collection:collection.id, subcategory:collection.sub, species:effectiveSpecies,
          minSize, maxSize, scoreType, nPerm, pAdjMethod, padjCutoff,
          filterMethod:'count', filterValue, annMap:effectiveAnnMap, runId,
          ...(isCustom && { customGmt: customGmt.sets }) }), signal:ctrl.signal })
      const data=await r.json()
      if(data.error) throw new Error(data.error)
      const rm=RANK_METHODS.find(m=>m.value===rankMethod)
      const newRun={ id:runId, sessionId:session?.sessionId,
        collectionLabel, collectionKey:collection.key,
        collectionId:collection.id, collectionSub:collection.sub,
        rankMethod, rankShort:rm?.short??rankMethod, filterValue, species:effectiveSpecies,
        scoreType, nPerm, pAdjMethod, padjCutoff,
        results:data.results, rankedList:data.rankedList, meta:data.meta,
        timestamp:new Date().toLocaleTimeString(), contrastLabel,
        usedOrthologs: useOrthologs && hasOrthologs,
        params: { rankMethod, pAdjMethod, padjCutoff, minSize, maxSize, filterValue, species:effectiveSpecies } }
      setRuns(prev=>[...prev,newRun])
      setActiveRunId(newRun.id)
      setContentTab('results'); curveCacheRef.current={}
      setSelPathway(null); setCurveData(null); setCurveError(null)
    } catch(e){ if(e.name!=='AbortError') setRunError(e.message) }
    finally{ clearInterval(timer); setElapsed(0); setRunning(false) }
  },[session,contrastLabel,rankMethod,collection,species,minSize,maxSize,scoreType,nPerm,pAdjMethod,padjCutoff,filterValue,annMap,useOrthologs,orthoMap,customGmt])

  // Run same collection across ALL contrasts — N parallel /run calls so the
  // frontend can track individual completions and show a real progress bar.
  const handleRunAll = useCallback(async()=>{
    if(!session?.sessionId || allContrasts.length < 2) return
    const isCustom = collection.key === 'CUSTOM'
    if(isCustom && !customGmt?.sets) { setRunError('Please load a .gmt file before running.'); return }
    const total = allContrasts.length
    setRunningAll({ done:0, total }); setRunError(null)
    const baseId = Date.now()
    const rm = RANK_METHODS.find(m=>m.value===rankMethod)
    const collectionLabel = isCustom ? (customGmt?.filename ?? 'Custom GMT') : collection.label
    try {
      // Fire one /api/gsea/run per contrast in parallel; update counter on each completion
      const promises = allContrasts.map((cl, i) =>
        fetch('/api/gsea/run', { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ sessionId:session.sessionId, contrastLabel:cl,
            rankMethod, collection:collection.id, subcategory:collection.sub, species:effectiveSpecies,
            minSize, maxSize, scoreType, nPerm, pAdjMethod, padjCutoff,
            filterMethod:'count', filterValue, annMap:effectiveAnnMap, runId:baseId+i,
            ...(isCustom && { customGmt: customGmt.sets }) }) })
          .then(r=>r.json())
          .then(data => {
            if(data.error) throw new Error(`${cl}: ${data.error}`)
            setRunningAll(prev => prev ? { ...prev, done: prev.done + 1 } : null)
            return { id:baseId+i, sessionId:session.sessionId,
              collectionLabel, collectionKey:collection.key,
              collectionId:collection.id, collectionSub:collection.sub,
              rankMethod, rankShort:rm?.short??rankMethod, filterValue, species:effectiveSpecies,
              scoreType, nPerm, pAdjMethod, padjCutoff,
              results:data.results, rankedList:data.rankedList, meta:data.meta,
              timestamp:new Date().toLocaleTimeString(), contrastLabel:cl,
              usedOrthologs: useOrthologs && hasOrthologs,
              params:{ rankMethod, pAdjMethod, padjCutoff, minSize, maxSize, filterValue, species:effectiveSpecies } }
          })
      )
      const newRuns = await Promise.all(promises)
      setRuns(prev => [...prev, ...newRuns])
      const mine = newRuns.find(r => r.contrastLabel === contrastLabel)
      if(mine){ setActiveRunId(mine.id); setContentTab('results'); curveCacheRef.current={} }

      // Email notification — compute summary from results and POST to /notify
      if(notifyAll && session?.email && session.email !== 'example') {
        const padjNum = Number(padjCutoff)
        const contrastSummary = newRuns.map(r => {
          const sig = (r.results||[]).filter(p => p.padj!=null && p.padj < padjNum)
          return { contrast: r.contrastLabel, total: sig.length,
                   up: sig.filter(p=>p.NES>0).length, down: sig.filter(p=>p.NES<=0).length }
        })
        fetch('/api/gsea/notify', { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ sessionId:session.sessionId, notifyEmail:session.email,
            collection:collection.id, collectionLabel:collection.label,
            rankMethod, species:effectiveSpecies, minSize, maxSize, scoreType, nPerm, pAdjMethod, padjCutoff,
            contrastSummary }) }).catch(()=>{})
      }

      showToast(`${collection.label} · ran on ${total} contrasts`)
    } catch(e){ setRunError(e.message) }
    finally{ setRunningAll(null) }
  },[session,allContrasts,contrastLabel,rankMethod,collection,species,minSize,maxSize,scoreType,nPerm,pAdjMethod,padjCutoff,filterValue,annMap,useOrthologs,orthoMap,notifyAll,showToast,customGmt])

  // Curve on pathway click
  const fetchCurve = useCallback(async(result, ar)=>{
    setCurveData(null); setCurveError(null)
    if(curveCacheRef.current[result.pathway]){ setCurveData(curveCacheRef.current[result.pathway]); return }
    setCurveLoading(true)
    try{
      const r=await fetch('/api/gsea/curve',{ method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ sessionId:session.sessionId, contrastLabel, pathway:result.pathway,
          collection:ar?.collectionId??collection.id, subcategory:ar?.collectionSub??collection.sub,
          species:ar?.species??species, runId:ar?.id }) })
      const data=await r.json()
      if(data.error) throw new Error(data.error)
      curveCacheRef.current[result.pathway]=data; setCurveData(data)
    } catch(e){
      console.error('[GSEA curve]', e.message)
      setCurveError(e.message || 'Failed to load enrichment curve')
    } finally{ setCurveLoading(false) }
  },[session,contrastLabel,collection,species])

  const handlePathwayClick=useCallback((result)=>{
    setSelPathway(result)
    fetchCurve(result, activeRun)
  },[fetchCurve, activeRun])

  const removeRun=(id)=>{ setRuns(p=>p.filter(r=>r.id!==id)); if(activeRunId===id) setActiveRunId(null); setSelPathway(null); setCurveData(null) }

  if(!session?.sessionId) return <div style={{ padding:60, textAlign:'center', color:'var(--text-3)' }}>No session available.</div>

  const _panel = (
    <div data-accent="ocean" style={fsPanel ? { position:'fixed', inset:0, zIndex:99999, background:'var(--bg-panel)', padding:'16px 20px', display:'flex', flexDirection:'column', gap:12, overflow:'hidden' } : { display:'flex', flexDirection:'column', gap:0 }}>

      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,rgba(11,68,111,0.12),rgba(26,106,159,0.04))`, border:`1px solid ${V.border}`, borderRadius:12, padding:'14px 20px', marginBottom:16, display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:'1.05rem', fontWeight:700, color:'var(--text-1)', letterSpacing:'-0.01em' }}>⟳ GSEA Explorer</div>
          <div style={{ fontSize:'0.72rem', color:'var(--text-3)', marginTop:2 }}>GSEA · MSigDB · Ranked gene set enrichment</div>
        </div>
        {contrastLabel && <div style={{ padding:'4px 12px', borderRadius:20, background:V.muted, border:`1px solid ${V.border}`, fontSize:'0.72rem', color:'var(--text-1)', fontWeight:600 }}>{contrastLabel}</div>}
        {activeRun?.meta && (
          <div style={{ marginLeft:'auto', display:'flex', gap:16, flexWrap:'wrap' }}>
            {[[activeRun.meta.n_pathways,'pathways'],[activeRun.meta.n_genes_ranked,'genes ranked'],[`${activeRun.meta.elapsedSecs}s`,'runtime']].map(([v,l])=>(
              <div key={l} style={{ textAlign:'center' }}>
                <div style={{ fontSize:'0.95rem', fontWeight:700, color:'var(--text-1)' }}>{typeof v==='number'?v.toLocaleString():v}</div>
                <div style={{ fontSize:'0.62rem', color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{l}</div>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => setFsPanel(v => !v)}
                title={fsPanel ? 'Exit fullscreen (Esc)' : 'Expand panel'}
                style={{ fontSize: '0.75rem', padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                         background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)',
                         marginLeft: activeRun?.meta ? 0 : 'auto' }}>
          {fsPanel ? 'Collapse' : 'Expand'}
        </button>
      </div>

      <div style={{ display:'flex', gap:16, alignItems: fsPanel ? 'stretch' : 'flex-start', flex: fsPanel ? '1 1 0' : undefined, minHeight: fsPanel ? 0 : undefined }}>

        {/* ── SIDEBAR ─────────────────────────────────────────────────── */}
        <div style={{ width:292, flexShrink:0, display:'flex', flexDirection:'column', gap:14, background:V.card, borderRadius:12, padding:16, border:`1px solid ${V.border}`, position:'sticky', top: fsPanel ? 0 : 80, maxHeight: fsPanel ? '100%' : 'calc(100vh - 120px)', overflowY:'auto' }}>

          {/* Rank method */}
          <div>
            <SectionLabel>Rank method</SectionLabel>
            <select value={rankMethod} onChange={e=>setRankMethod(e.target.value)}
              style={{ width:'100%', padding:'6px 10px', fontSize:'0.78rem', background:'rgba(255,255,255,0.05)', border:`1px solid ${V.border}`, borderRadius:7, color:'var(--text-1)' }}>
              {RANK_METHODS.map(m=><option key={m.value} value={m.value}>{m.label} — {m.hint}</option>)}
            </select>
          </div>

          {/* Pre-filter — baseMean absolute cutoff */}
          <div>
            <SectionLabel>Pre-filter genes</SectionLabel>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
              <span style={{ fontSize:'0.7rem', color:'var(--text-3)', whiteSpace:'nowrap' }}>baseMean ≥</span>
              <input type="range" min={0} max={500} step={0.5} value={Math.min(filterValue, 500)}
                onChange={e=>setFilterValue(+e.target.value)} style={{ flex:1, accentColor:V.accent }} />
              <input type="number" min={0} value={filterValue}
                onChange={e=>setFilterValue(Math.max(0,+e.target.value))}
                style={{ width:52, padding:'2px 4px', fontSize:'0.72rem', fontFamily:'monospace',
                         background:'var(--bg-card2)', border:`1px solid ${V.border}`, borderRadius:5,
                         color:V.text, textAlign:'right' }} />
            </div>

            {/* Stat + distribution button */}
            <div style={{ display:'flex', gap:6 }}>
              <div style={{ flex:1, display:'flex', justifyContent:'space-between', padding:'5px 8px', background:V.muted, borderRadius:6, fontSize:'0.7rem', border:`1px solid ${V.border}` }}>
                <span style={{ color:'var(--text-3)' }}>Passing</span>
                <span style={{ color:V.text, fontWeight:700 }}>~{nAbove.toLocaleString()}</span>
              </div>
              <button onClick={()=>{ if(histError) fetchPreview(); else if(histData) setShowDistModal(true) }}
                title={histError ? `Error: ${histError}\n\nClick to retry` : 'View per-sample count distributions'}
                disabled={histLoading}
                style={{ padding:'5px 10px', borderRadius:6, border:`1px solid ${histError?'rgba(244,63,94,0.4)':V.border}`,
                  background: histError?'rgba(244,63,94,0.08)':V.muted,
                  color: histError?'#f43f5e':V.text,
                  fontSize:'0.72rem', fontWeight:600, cursor: histLoading ? 'wait' : 'pointer',
                  opacity: histLoading ? 0.45 : 1, whiteSpace:'nowrap' }}>
                {histLoading ? '…' : histError ? '↺ Retry dist.' : '⎚ Distributions'}
              </button>
            </div>
          </div>

          {/* Collection */}
          <div>
            <SectionLabel>Gene set collection</SectionLabel>
            <CollectionGrid selected={collection} onChange={setCollection} />

            {/* Custom GMT drop zone — shown when Custom GMT tile is selected */}
            {collection.key === 'CUSTOM' && (
              <div style={{ marginTop:10 }}>
                {/* Drop zone / file picker */}
                <label
                  onDragOver={e => { e.preventDefault(); setGmtDragOver(true) }}
                  onDragLeave={() => setGmtDragOver(false)}
                  onDrop={e => {
                    e.preventDefault(); setGmtDragOver(false)
                    const file = e.dataTransfer.files[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = ev => {
                      const parsed = parseGmt(ev.target.result)
                      setCustomGmt({ filename: file.name, ...parsed })
                    }
                    reader.readAsText(file)
                  }}
                  style={{
                    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                    gap:6, padding:'14px 10px', borderRadius:9, cursor:'pointer', textAlign:'center',
                    border:`1.5px dashed ${gmtDragOver ? V.accent2 : V.border}`,
                    background: gmtDragOver ? V.muted : 'rgba(255,255,255,0.02)',
                    transition:'all 0.15s',
                  }}>
                  <input type="file" accept=".gmt,.txt,.tsv" style={{ display:'none' }}
                    onChange={e => {
                      const file = e.target.files[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = ev => {
                        const parsed = parseGmt(ev.target.result)
                        setCustomGmt({ filename: file.name, ...parsed })
                      }
                      reader.readAsText(file)
                      e.target.value = ''
                    }} />
                  <span style={{ fontSize:'1.4rem', opacity:0.5 }}>📂</span>
                  <span style={{ fontSize:'0.72rem', color:'var(--text-3)', lineHeight:1.4 }}>
                    Drop a <strong style={{ color:V.text }}>.gmt</strong> file here<br/>or click to browse
                  </span>
                </label>

                {/* Loaded GMT summary */}
                {customGmt && (
                  <div style={{
                    marginTop:8, padding:'8px 11px', borderRadius:8,
                    background: V.muted, border:`1px solid ${V.border}`,
                    display:'flex', flexDirection:'column', gap:4,
                  }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontSize:'0.7rem', fontWeight:700, color:V.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:130 }}>
                        {customGmt.filename}
                      </span>
                      <button onClick={() => setCustomGmt(null)}
                        style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-4)', fontSize:'0.85rem', lineHeight:1, padding:'1px 2px', flexShrink:0 }}>×</button>
                    </div>
                    <div style={{ display:'flex', gap:10, fontSize:'0.68rem', color:'var(--text-3)' }}>
                      <span><strong style={{ color:'var(--text-2)' }}>{customGmt.pathwayCount.toLocaleString()}</strong> gene sets</span>
                      <span><strong style={{ color:'var(--text-2)' }}>{customGmt.geneCount.toLocaleString()}</strong> total genes</span>
                    </div>
                  </div>
                )}

                {/* Warning if no GMT loaded */}
                {!customGmt && (
                  <div style={{ marginTop:6, padding:'5px 9px', borderRadius:7, fontSize:'0.68rem', lineHeight:1.45,
                    background:'rgba(251,191,36,0.06)', border:'1px solid rgba(251,191,36,0.22)', color:'#ca8a04' }}>
                    ⚠ Load a .gmt file to run. Species selector is ignored — gene symbols must match your data.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sizes */}
          <div>
            <SectionLabel>Gene set size</SectionLabel>
            <div style={{ display:'flex', gap:10 }}>
              {[['Min',minSize,setMinSize,5,50],['Max',maxSize,setMaxSize,100,2000]].map(([l,v,set,mn,mx])=>(
                <div key={l} style={{ flex:1 }}>
                  <div style={{ fontSize:'0.66rem', color:'var(--text-3)', marginBottom:3 }}>{l}</div>
                  <input type="number" value={v} min={mn} max={mx} onChange={e=>set(Math.max(mn,Math.min(mx,+e.target.value||mn)))}
                    style={{ width:'100%', padding:'4px 8px', fontSize:'0.78rem', textAlign:'center', background:'rgba(255,255,255,0.05)', border:`1px solid ${V.border}`, borderRadius:7, color:'var(--text-1)' }} />
                </div>
              ))}
            </div>
          </div>

          {/* Species */}
          <div>
            <SectionLabel>Species</SectionLabel>
            <select value={useOrthologs && hasOrthologs ? 'Homo sapiens' : species}
              onChange={e=>setSpecies(e.target.value)}
              disabled={useOrthologs && hasOrthologs}
              style={{ width:'100%', padding:'6px 10px', fontSize:'0.78rem', background:'rgba(255,255,255,0.05)', border:`1px solid ${V.border}`, borderRadius:7, color:'var(--text-1)',
                       opacity: useOrthologs && hasOrthologs ? 0.45 : 1, cursor: useOrthologs && hasOrthologs ? 'not-allowed' : 'default' }}>
              {SPECIES.map(s=><option key={s}>{s}</option>)}
            </select>

            {/* Ortholog toggle — only rendered when annDetails has 1:1 human orthologs */}
            {hasOrthologs && (
              <button
                onClick={() => setUseOrthologs(v => !v)}
                style={{
                  display:'flex', alignItems:'center', gap:8, width:'100%',
                  marginTop:8, padding:'8px 10px', borderRadius:8, cursor:'pointer',
                  border:`1px solid ${useOrthologs ? 'rgba(124,58,237,0.4)' : V.border}`,
                  background: useOrthologs ? 'rgba(124,58,237,0.1)' : 'rgba(255,255,255,0.03)',
                  transition:'all 0.15s', textAlign:'left',
                }}>
                {/* pill toggle */}
                <div style={{ width:28, height:15, borderRadius:8, flexShrink:0, position:'relative',
                              background: useOrthologs ? '#7c3aed' : 'rgba(255,255,255,0.15)', transition:'background 0.2s' }}>
                  <div style={{ position:'absolute', top:2, left: useOrthologs ? 14 : 2, width:11, height:11,
                                borderRadius:'50%', background:'#fff', transition:'left 0.2s' }} />
                </div>
                <div>
                  <div style={{ fontSize:'0.73rem', fontWeight:600, color: useOrthologs ? '#a78bfa' : 'var(--text-2)' }}>
                    Use human orthologs
                  </div>
                  <div style={{ fontSize:'0.66rem', color:'var(--text-3)', marginTop:1, lineHeight:1.4 }}>
                    {useOrthologs
                      ? `${Object.keys(orthoMap).length.toLocaleString()} genes → human symbols · forces Homo sapiens`
                      : `${Object.keys(orthoMap).length.toLocaleString()} 1:1 orthologs available`}
                  </div>
                </div>
              </button>
            )}
          </div>

          {/* Run options */}
          <div>
            <SectionLabel>Run options</SectionLabel>

            {/* padj method */}
            <div style={{ marginBottom:9 }}>
              <div style={{ fontSize:'0.66rem', color:'var(--text-3)', marginBottom:3 }}>p-value adjustment</div>
              <select value={pAdjMethod} onChange={e=>setPAdjMethod(e.target.value)}
                style={{ width:'100%', padding:'5px 8px', fontSize:'0.75rem', background:'rgba(255,255,255,0.05)', border:`1px solid ${V.border}`, borderRadius:7, color:'var(--text-1)' }}>
                {[['BH','Benjamini-Hochberg (BH)'],['bonferroni','Bonferroni'],['holm','Holm'],['BY','Benjamini-Yekutieli (BY)'],['none','None (raw p-values)']].map(([v,l])=>(
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            {/* padj cutoff */}
            <div>
              <div style={{ fontSize:'0.66rem', color:'var(--text-3)', marginBottom:3 }}>padj cutoff</div>
              <div style={{ display:'flex', gap:3 }}>
                {[0.05, 0.1, 0.25, 0.5, 1].map(v=>(
                  <button key={v} onClick={()=>setPadjCutoff(v)}
                    style={{ flex:1, padding:'4px 0', fontSize:'0.68rem', fontWeight:600, borderRadius:6, cursor:'pointer', border:'none', background:padjCutoff===v?V.accent:'rgba(255,255,255,0.06)', color:padjCutoff===v?'#fff':'var(--text-2)', transition:'all 0.12s' }}>{v}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Run */}
          <button onClick={handleRun} disabled={!!(running||runningAll)}
            style={{ padding:'11px 0', borderRadius:10, border:'none', cursor:(running||runningAll)?'wait':'pointer', background:(running||runningAll)?`rgba(11,68,111,0.35)`:`linear-gradient(135deg,${V.accent},${V.accent2})`, color:'#fff', fontWeight:700, fontSize:'0.88rem', boxShadow:(running||runningAll)?'none':`0 4px 16px rgba(11,68,111,0.45)`, transition:'all 0.15s', marginTop:4 }}>
            {running?`Running… ${elapsed}s`:contrastRuns.length?'↺ New Run':'▶ Run GSEA'}
          </button>

          {/* Run All Contrasts — only shown when 2+ contrasts exist */}
          {allContrasts.length > 1 && (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {/* Button with inline progress fill when running */}
              <button onClick={handleRunAll} disabled={!!(running||runningAll)}
                style={{ position:'relative', overflow:'hidden', padding:'9px 0', borderRadius:10,
                         border:`1px solid ${V.border}`, cursor:(running||runningAll)?'default':'pointer',
                         background:'rgba(255,255,255,0.05)', color: runningAll?V.text:running?'var(--text-3)':V.text,
                         fontWeight:600, fontSize:'0.82rem', transition:'all 0.15s' }}>
                {/* progress fill — slides in as contrasts complete */}
                {runningAll && (
                  <div style={{
                    position:'absolute', inset:0,
                    width:`${(runningAll.done / runningAll.total) * 100}%`,
                    background: V.muted, transition:'width 0.35s ease', borderRadius:'inherit',
                  }} />
                )}
                <span style={{ position:'relative', zIndex:1 }}>
                  {runningAll
                    ? `⟳ ${runningAll.done} / ${runningAll.total} · ${collection.label}`
                    : `⟳ Run All Contrasts (${allContrasts.length})`}
                </span>
              </button>

              {/* Email notification toggle — uses login email, hidden for example sessions */}
              {session?.email && session.email !== 'example' && (
                <button
                  onClick={() => setNotifyAll(v => { const next = !v; localStorage.setItem('gsea_notify_all', String(next)); return next })}
                  style={{
                    display:'flex', alignItems:'center', justifyContent:'space-between',
                    padding:'6px 10px', borderRadius:8, cursor:'pointer', width:'100%',
                    border:`1px solid ${notifyAll ? V.border : 'rgba(255,255,255,0.08)'}`,
                    background: notifyAll ? V.muted : 'rgba(255,255,255,0.03)',
                    transition:'all 0.15s',
                  }}>
                  <span style={{ fontSize:'0.76rem', color: notifyAll ? V.text : 'var(--text-3)', letterSpacing:'0.01em' }}>
                    ✉&nbsp;Enable email notifications
                  </span>
                  {/* pill toggle */}
                  <div style={{ width:28, height:15, borderRadius:8, flexShrink:0, position:'relative',
                                background: notifyAll ? V.accent : 'rgba(255,255,255,0.15)', transition:'background 0.2s' }}>
                    <div style={{ position:'absolute', top:2, left: notifyAll ? 14 : 2, width:11, height:11,
                                  borderRadius:'50%', background:'#fff', transition:'left 0.2s' }} />
                  </div>
                </button>
              )}
            </div>
          )}

          {runError && <div style={{ padding:'8px 12px', borderRadius:8, fontSize:'0.75rem', background:'rgba(248,113,113,0.08)', color:'#f87171', border:'1px solid rgba(248,113,113,0.2)', lineHeight:1.5 }}>⚠ {runError}</div>}
          {!effectiveAnnMap && <div style={{ padding:'7px 10px', borderRadius:8, fontSize:'0.68rem', background:'rgba(251,191,36,0.07)', color:'#fbbf24', border:'1px solid rgba(251,191,36,0.18)', lineHeight:1.5 }}>⚠ No annotation loaded — run <b>Annotate</b> first for best gene ID matching.</div>}
        </div>

        {/* ── RIGHT CONTENT ──────────────────────────────────────────────── */}
        <div style={{ flex:1, minWidth:0, minHeight:0, display:'flex', flexDirection:'column', gap:12,
                      overflowY: fsPanel ? 'auto' : undefined,
                      // On the heatmap tab (non-fullscreen) use 'visible' so the horizontal
                      // resize drag handle is never clipped by the scroll container.
                      overflowX: contentTab === 'heatmap' && !fsPanel ? 'visible' : 'auto' }}>
          {!contrastRuns.length && !running && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:400, gap:16, color:'var(--text-3)' }}>
              <div style={{ fontSize:'3rem', opacity:0.2 }}>⟳</div>
              <div style={{ fontSize:'0.9rem', fontWeight:600, color:'var(--text-2)' }}>Configure parameters and click Run GSEA</div>
              <div style={{ fontSize:'0.78rem', maxWidth:380, textAlign:'center', lineHeight:1.7 }}>Select a gene set collection, set your rank method and pre-filter threshold, then hit Run. Click any result row to open its enrichment mountain plot.</div>
            </div>
          )}
          {running && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:400, gap:16 }}>
              <div style={{ position:'relative', width:56, height:56 }}>
                <div style={{ width:'100%', height:'100%', borderRadius:'50%', border:`3px solid ${V.muted}`, borderTopColor:V.accent, animation:'gsea-spin 0.8s linear infinite' }} />
                <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.72rem', fontWeight:700, color:V.text }}>{elapsed}s</div>
              </div>
              <div style={{ fontSize:'0.9rem', color:'var(--text-2)', fontWeight:600 }}>Running GSEA…</div>
              <div style={{ fontSize:'0.75rem', color:'var(--text-3)', textAlign:'center', maxWidth:300, lineHeight:1.6 }}>{collection.label} · {species}<br />Large collections (GO:BP) may take 60+ seconds</div>
            </div>
          )}
          {contrastRuns.length>0 && !running && (
            <>
              <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <RunChips runs={contrastRuns} activeRunId={activeRunId} onSelect={id=>{ setActiveRunId(id); setSelPathway(null); setCurveData(null) }} onRemove={removeRun} />
                <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
                  {/* Export RDS — opens modal to pick runs */}
                  {contrastRuns.length > 0 && (
                    <button onClick={openRdsModal}
                      title="Export clusterProfiler RDS — choose which runs to include"
                      style={{ padding:'4px 12px', borderRadius:8,
                        border:`1px solid ${V.border}`, background:V.muted, color:V.text,
                        fontSize:'0.72rem', fontWeight:600, cursor:'pointer',
                        whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:5 }}>
                      <svg width="11" height="11" viewBox="0 0 14 14" fill="none" style={{flexShrink:0}}>
                        <path d="M7 1v8M4 6l3 3 3-3M2 11h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>Export RDS
                    </button>
                  )}
                  {/* Export CSV — all runs for this contrast */}
                  <button onClick={handleExportAll} disabled={exportLoading}
                    title="Export full clusterProfiler results for all runs in this contrast"
                    style={{ padding:'4px 12px', borderRadius:8,
                      border:`1px solid ${V.border}`, background:V.muted, color:V.text,
                      fontSize:'0.72rem', fontWeight:600, cursor:exportLoading?'wait':'pointer',
                      opacity:exportLoading?0.6:1, whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:5 }}>
                    {exportLoading
                      ? '…'
                      : <><svg width="11" height="11" viewBox="0 0 14 14" fill="none" style={{flexShrink:0}}>
                          <path d="M7 1v8M4 6l3 3 3-3M2 11h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>Export Results</>
                    }
                  </button>
                </div>
                {exportDialog}
              </div>
              {exportLoading && (
                <div style={{ width:'100%', height:3, borderRadius:2, background:V.border, overflow:'hidden', marginTop:2 }}>
                  <div style={{
                    height:'100%', borderRadius:2,
                    background:`linear-gradient(90deg,${V.accent},${V.accent2})`,
                    width:`${exportProgress}%`,
                    transition: exportProgress === 100 ? 'width 0.2s ease' : 'width 0.12s linear',
                  }} />
                </div>
              )}
              <div style={{ display:'flex', gap:2, borderBottom:`1px solid ${V.border}` }}>
                {[
                  ['results',  `◉ Pathways${activeRun?.results?.length?` (${activeRun.results.length})`:''}`],
                  ['ranked',   `≡ Ranked List${activeRun?.rankedList?.length?` (${activeRun.rankedList.length.toLocaleString()})`:''}`],
                  ['plots',    '◈ Plots'],
                  ['heatmap',  '▦ Heatmap'],
                ].map(([k,l])=>(
                  <button key={k} onClick={()=>setContentTab(k)}
                    style={{ padding:'6px 14px', border:'none', borderRadius:'6px 6px 0 0', cursor:'pointer', fontSize:'0.8rem', fontWeight:contentTab===k?700:400, background:contentTab===k?V.muted:'transparent', color:contentTab===k?'var(--text-1)':'var(--text-3)', borderBottom:`2px solid ${contentTab===k?V.accent:'transparent'}`, transition:'all 0.12s' }}>{l}</button>
                ))}
              </div>
              <div style={{ paddingTop:4 }}>
                <div style={{ display: contentTab==='results' ? 'block' : 'none' }}>
                  <ResultsTable run={activeRun} onPathwayClick={handlePathwayClick} selectedPathway={selPathway?.pathway} fullscreen={fullscreen} setFullscreen={setFullscreen} />
                </div>
                <div style={{ display: contentTab==='ranked' ? 'block' : 'none' }}>
                  <RankedListPanel run={activeRun} />
                </div>
                <div style={{ display: contentTab==='plots' ? 'block' : 'none' }}>
                  <PlotsPanel run={activeRun} session={session} contrastLabel={contrastLabel} imgSrcCache={plotImgCache} />
                </div>
                <div style={{ display: contentTab==='heatmap' ? 'block' : 'none' }}>
                  <LeadingEdgeHeatmapPanel run={activeRun} session={session} annMap={annMap} sampleLabels={sampleLabels} pca={pca} contrastList={contrastList} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Distribution modal — portaled to body so it's above all fullscreen panels */}
      {showDistModal && createPortal(
        <DistributionModal
          histData={histData} cutoffLog={cutoffLog} cutoffOrig={cutoffOrig}
          filterValue={filterValue} setFilterValue={setFilterValue}
          nAbove={nAbove}
          onClose={()=>setShowDistModal(false)}
        />,
        document.body
      )}

      {/* Mountain plot modal — always portaled to body so it escapes any stacking context */}
      {selPathway && createPortal(
        <MountainModal pathway={selPathway.pathway} result={selPathway} curveData={curveData} curveLoading={curveLoading} curveError={curveError}
          onClose={()=>{ setSelPathway(null); setCurveData(null); setCurveError(null) }}
          onRetry={()=>fetchCurve(selPathway, activeRun)} />,
        document.body
      )}

      {/* RDS export modal */}
      {rdsModalOpen && createPortal(
        <div onClick={e => { if(e.target === e.currentTarget) setRdsModalOpen(false) }}
             style={{ position:'fixed', inset:0, zIndex:99999, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'var(--bg-panel)', border:'1px solid var(--border)', borderRadius:12,
                        padding:'20px', width:400, maxWidth:'92vw', boxShadow:'0 16px 48px rgba(0,0,0,0.35)',
                        display:'flex', flexDirection:'column', gap:14 }}>

            {/* Header */}
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
              <div>
                <div style={{ fontSize:'0.88rem', fontWeight:700, color:V.accent }}>Export RDS</div>
                <div style={{ fontSize:'0.71rem', color:'var(--text-3)', marginTop:2 }}>Select runs to bundle into a named R list</div>
              </div>
              <button onClick={() => setRdsModalOpen(false)}
                style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1rem', color:'var(--text-3)', lineHeight:1, padding:2, flexShrink:0 }}>×</button>
            </div>

            {/* Run list */}
            <div style={{ display:'flex', flexDirection:'column', gap:2, maxHeight:260, overflowY:'auto' }}>
              {contrastRuns.map(r => {
                const checked  = !!rdsSelected[r.id]
                const isActive = r.id === activeRunId
                const rKey     = `${(r.collectionLabel ?? r.collectionId ?? 'run').replace(/[^A-Za-z0-9]/g,'_')}_${r.rankMethod ?? 'LFC'}`
                return (
                  <label key={r.id} onClick={() => setRdsSelected(prev => ({ ...prev, [r.id]: !prev[r.id] }))}
                    style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:7,
                             cursor:'pointer', userSelect:'none',
                             background: checked ? V.muted : 'transparent',
                             border: `1px solid ${checked ? V.border : 'transparent'}` }}>
                    <input type="checkbox" checked={checked} readOnly
                      style={{ width:14, height:14, accentColor:V.accent2, flexShrink:0, pointerEvents:'none' }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ fontSize:'0.78rem', fontWeight:600, color:V.accent }}>{r.collectionLabel}</span>
                        {isActive && <span style={{ fontSize:'0.6rem', padding:'0 5px', borderRadius:3,
                          background:V.muted, color:V.text, border:`1px solid ${V.border}` }}>active</span>}
                      </div>
                      <div style={{ display:'flex', gap:10, marginTop:1 }}>
                        <span style={{ fontSize:'0.67rem', color:'var(--text-3)' }}>{r.rankMethod}</span>
                        <span style={{ fontSize:'0.67rem', color:'var(--text-3)' }}>{r.results?.length ?? '?'} pathways</span>
                        <span style={{ fontSize:'0.67rem', color:'var(--text-3)' }}>{r.timestamp}</span>
                      </div>
                      <div style={{ fontSize:'0.63rem', color:V.text, fontFamily:'monospace', marginTop:1,
                                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', opacity:0.75 }}>
                        result${rKey}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>

            {/* Select all / none + count */}
            <div style={{ display:'flex', alignItems:'center', gap:6, borderTop:`1px solid var(--border)`, paddingTop:10 }}>
              {[['All', true], ['None', false]].map(([lbl, val]) => (
                <button key={lbl} onClick={() => { const s = {}; if(val) contrastRuns.forEach(r => { s[r.id] = true }); setRdsSelected(s) }}
                  style={{ fontSize:'0.7rem', padding:'3px 10px', borderRadius:5, cursor:'pointer',
                    border:`1px solid ${V.border}`, background:'none', color:V.text }}>{lbl}</button>
              ))}
              <span style={{ fontSize:'0.7rem', color:'var(--text-3)', marginLeft:2 }}>
                {Object.values(rdsSelected).filter(Boolean).length} / {contrastRuns.length} selected
              </span>
            </div>

            {rdsError && (
              <div style={{ fontSize:'0.72rem', color:'#dc2626', padding:'6px 10px', borderRadius:6,
                background:'rgba(220,38,38,0.07)', border:'1px solid rgba(220,38,38,0.2)' }}>{rdsError}</div>
            )}

            {/* Actions */}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => setRdsModalOpen(false)}
                style={{ padding:'7px 16px', borderRadius:7, border:'1px solid var(--border)',
                  background:'none', color:'var(--text-2)', fontSize:'0.78rem', cursor:'pointer' }}>Cancel</button>
              <button onClick={handleExportRds}
                disabled={rdsLoading || !Object.values(rdsSelected).some(Boolean)}
                style={{ padding:'7px 20px', borderRadius:7, border:'none', fontSize:'0.78rem', fontWeight:700,
                  cursor: rdsLoading || !Object.values(rdsSelected).some(Boolean) ? 'default' : 'pointer',
                  background:`linear-gradient(135deg,${V.accent},${V.accent2})`, color:'#fff',
                  opacity: rdsLoading || !Object.values(rdsSelected).some(Boolean) ? 0.5 : 1 }}>
                {rdsLoading ? 'Exporting…' : 'Download RDS'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Run-all toast notification */}
      {toast && createPortal(
        <div style={{
          position:'fixed', bottom:32, right:32, zIndex:9999,
          background:`linear-gradient(135deg,${V.accent},${V.accent2})`,
          color:'#fff', padding:'10px 18px', borderRadius:10,
          fontSize:'0.82rem', fontWeight:600,
          boxShadow:'0 4px 20px rgba(0,0,0,0.3)',
          display:'flex', alignItems:'center', gap:8,
          animation:'gsea-fadein 0.2s ease',
        }}>
          <span>✓</span> {toast}
        </div>,
        document.body
      )}

      <style>{`@keyframes gsea-spin { to { transform:rotate(360deg); } } @keyframes gsea-fadein { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  )
  // Always render inline — position:fixed + data-gsea-fs body attribute handles
  // the fullscreen look without a portal (portal would unmount child state).
  return _panel
}
