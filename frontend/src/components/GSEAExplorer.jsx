import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import Plotly from 'plotly.js-dist-min'

// ── Emerald palette ───────────────────────────────────────────────────────────
const EM = {
  accent:  '#059669', accent2: '#10b981',
  text:    '#34d399', muted:   'rgba(5,150,105,0.13)',
  border:  'rgba(5,150,105,0.28)',
  up:      '#10b981', down:    '#f43f5e',
}

// ── Constants ─────────────────────────────────────────────────────────────────
const COLLECTIONS = [
  { id:'H',  sub:null,               key:'H',      label:'Hallmarks',    icon:'★', desc:'50 curated hallmark gene sets' },
  { id:'C2', sub:'CP:KEGG_LEGACY',  key:'KEGG',   label:'KEGG',         icon:'⬡', desc:'KEGG canonical pathways' },
  { id:'C2', sub:'CP:REACTOME',     key:'REACT',  label:'Reactome',     icon:'◎', desc:'Reactome biological pathways' },
  { id:'C2', sub:'CP:WIKIPATHWAYS', key:'WIKI',   label:'WikiPathways', icon:'◈', desc:'Community-curated pathways' },
  { id:'C5', sub:'GO:BP',           key:'GOBP',   label:'GO: BP',       icon:'●', desc:'GO Biological Process (large)' },
  { id:'C5', sub:'GO:MF',           key:'GOMF',   label:'GO: MF',       icon:'◆', desc:'GO Molecular Function' },
  { id:'C5', sub:'GO:CC',           key:'GOCC',   label:'GO: CC',       icon:'▲', desc:'GO Cellular Component' },
  { id:'C6', sub:null,              key:'C6',     label:'Oncogenic',    icon:'⬟', desc:'Oncogenic signatures (C6)' },
  { id:'C7', sub:'IMMUNESIGDB',     key:'IMMUNE', label:'ImmuneSigDB',  icon:'⬡', desc:'Immune cell signatures (C7)' },
  { id:'C8', sub:null,              key:'C8',     label:'Cell Types',   icon:'◉', desc:'Cell type gene sets (C8)' },
]
const SPECIES      = ['Homo sapiens','Mus musculus','Rattus norvegicus','Danio rerio','Drosophila melanogaster','Caenorhabditis elegans']
const RANK_METHODS = [
  { value:'log2FC',         label:'log₂ Fold Change',          short:'LFC' },
  { value:'stat',           label:'Wald Statistic',            short:'Stat' },
  { value:'signed_logpadj', label:'sign(FC) × −log₁₀(padj)', short:'S·LP' },
]
const LBL = { fontSize:'0.67rem', fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:EM.text }

// ── Utilities ─────────────────────────────────────────────────────────────────
function downloadCSV(rows, filename) {
  if (!rows?.length) return
  const headers = Object.keys(rows[0])
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))].join('\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type:'text/csv' })), download: filename })
  a.click(); URL.revokeObjectURL(a.href)
}
function fmtPval(v) { return v == null ? '—' : v < 0.001 ? v.toExponential(1) : v.toFixed(3) }

// ── KDE density plot (reused in sidebar & modal) ──────────────────────────────
function DensityPlot({ histData, cutoffLog, height = 140 }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!histData?.kde || !ref.current) return
    const { x, y } = histData.kde
    const traces = [{
      x, y, type:'scatter', mode:'lines',
      fill:'tozeroy', fillcolor:'rgba(16,185,129,0.12)',
      line:{ color:EM.accent2, width:2, shape:'spline' },
      name:'Density',
      hovertemplate:'log₁p(median): %{x:.2f}<extra></extra>',
    }]
    const layout = {
      height, margin:{ t:6, r:6, b:28, l:38 },
      xaxis:{ title:{ text:'log₁p(row median count)', font:{size:9} }, color:'var(--text-3)', gridcolor:'var(--border)', zeroline:false, tickfont:{size:8}, autorange:true },
      yaxis:{ title:{ text:'Density', font:{size:9} }, color:'var(--text-3)', gridcolor:'var(--border)', zeroline:false, tickfont:{size:8}, autorange:true },
      plot_bgcolor:'transparent', paper_bgcolor:'transparent',
      showlegend:false,
      shapes:[{ type:'line', x0:cutoffLog, x1:cutoffLog, y0:0, y1:1, yref:'paper', line:{ color:'#f43f5e', width:2, dash:'dash' } }],
    }
    Plotly.react(ref.current, traces, layout, { displayModeBar:false, responsive:true })
  }, [histData, cutoffLog, height])
  return <div ref={ref} style={{ width:'100%' }} />
}

// ── Expanded density modal ────────────────────────────────────────────────────
function DensityModal({ histData, cutoffLog, cutoffOrig, filterMethod, filterValue, setFilterValue, genesAbove, countMax, onClose }) {
  return (
    <div style={{ position:'fixed', inset:0, zIndex:1100, background:'rgba(0,0,0,0.65)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }} onClick={onClose}>
      <div style={{ background:'var(--bg-panel)', borderRadius:16, padding:24, width:'100%', maxWidth:720, border:`1px solid ${EM.border}`, boxShadow:`0 0 40px rgba(5,150,105,0.18)` }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <span style={{ ...LBL, fontSize:'0.72rem' }}>Row Median Distribution</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-3)', fontSize:'1.3rem', lineHeight:1 }}>×</button>
        </div>
        <DensityPlot histData={histData} cutoffLog={cutoffLog} height={300} />
        <div style={{ marginTop:16, display:'flex', flexDirection:'column', gap:8 }}>
          {filterMethod === 'quantile' ? (
            <>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.75rem', color:'var(--text-2)' }}>
                <span>Remove bottom percentile</span>
                <span style={{ color:EM.text, fontWeight:700 }}>{(filterValue*100).toFixed(0)}%  ·  cutoff ≥ {cutoffOrig.toFixed(1)} counts</span>
              </div>
              <input type="range" min={0} max={0.75} step={0.01} value={filterValue} onChange={e => setFilterValue(+e.target.value)} style={{ width:'100%', accentColor:EM.accent }} />
            </>
          ) : (
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:'0.75rem', color:'var(--text-2)', whiteSpace:'nowrap' }}>Min row median ≥</span>
              <input type="range" min={0} max={Math.max(countMax,100)} step={1} value={filterValue} onChange={e => setFilterValue(+e.target.value)} style={{ flex:1, accentColor:EM.accent }} />
              <span style={{ fontSize:'0.78rem', fontFamily:'monospace', color:EM.text, minWidth:44 }}>{filterValue}</span>
            </div>
          )}
          <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 12px', background:EM.muted, borderRadius:7, fontSize:'0.75rem', border:`1px solid ${EM.border}` }}>
            <span style={{ color:'var(--text-2)' }}>Genes passing filter</span>
            <span style={{ color:EM.text, fontWeight:700 }}>~{genesAbove.toLocaleString()} / {histData?.n_genes?.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Section divider ───────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{ ...LBL, display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
      <div style={{ flex:1, height:1, background:EM.border }} />
      {children}
      <div style={{ flex:1, height:1, background:EM.border }} />
    </div>
  )
}

// ── Collection grid ───────────────────────────────────────────────────────────
function CollectionGrid({ selected, onChange }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
      {COLLECTIONS.map(c => {
        const active = selected.key === c.key
        return (
          <button key={c.key} onClick={() => onChange(c)} title={c.desc}
            style={{ padding:'6px 8px', borderRadius:7, cursor:'pointer', textAlign:'left', background:active ? EM.muted : 'var(--bg-card2)', border:`1px solid ${active ? EM.border : 'var(--border)'}`, color:active ? EM.text : 'var(--text-2)', boxShadow:active ? `0 0 0 1.5px ${EM.accent}55` : 'none', transition:'all 0.12s' }}>
            <div style={{ fontSize:'0.8rem', marginBottom:1 }}>{c.icon} {c.label}</div>
            <div style={{ fontSize:'0.62rem', color:active ? 'rgba(52,211,153,0.7)' : 'var(--text-3)', lineHeight:1.3 }}>{c.desc.split('(')[0].trim()}</div>
          </button>
        )
      })}
    </div>
  )
}

// ── Inline NES bar ────────────────────────────────────────────────────────────
function NESBar({ nes, maxAbs }) {
  const pct = Math.min((Math.abs(nes) / maxAbs) * 46, 46)
  return (
    <div style={{ position:'relative', width:96, height:20, display:'flex', alignItems:'center' }}>
      <div style={{ position:'absolute', left:'50%', top:'15%', width:1, height:'70%', background:'var(--border)' }} />
      <div style={{ position:'absolute', width:`${pct}%`, height:'55%', top:'22%', left:nes>0?'50%':`${50-pct}%`, background:nes>0?'rgba(16,185,129,0.5)':'rgba(244,63,94,0.5)', borderRadius:2 }} />
      <span style={{ position:'absolute', [nes>0?'left':'right']:0, fontSize:'0.67rem', fontFamily:'monospace', color:nes>0?EM.up:EM.down, fontWeight:600 }}>
        {nes>0?'+':''}{nes.toFixed(2)}
      </span>
    </div>
  )
}

// ── Run history chips ─────────────────────────────────────────────────────────
function RunChips({ runs, activeRunId, onSelect, onRemove }) {
  if (!runs.length) return null
  return (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap', paddingBottom:10, borderBottom:`1px solid ${EM.border}`, marginBottom:12 }}>
      <span style={{ fontSize:'0.66rem', color:'var(--text-3)', alignSelf:'center', whiteSpace:'nowrap' }}>RUNS:</span>
      {runs.map(r => {
        const active = r.id === activeRunId
        return (
          <div key={r.id} onClick={() => onSelect(r.id)}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:20, cursor:'pointer', userSelect:'none',
              background:active ? EM.muted : 'var(--bg-card2)', border:`1px solid ${active ? EM.border : 'var(--border)'}`, transition:'all 0.12s' }}>
            <span style={{ fontSize:'0.7rem', fontWeight:700, color:active ? EM.text : 'var(--text-2)' }}>{r.collectionLabel}</span>
            <span style={{ fontSize:'0.65rem', color:'var(--text-3)' }}>·{r.rankShort}</span>
            <span style={{ fontSize:'0.62rem', color:active ? 'rgba(52,211,153,0.6)' : 'var(--text-4)', fontFamily:'monospace' }}>{r.meta?.n_pathways}↗</span>
            <button onClick={e => { e.stopPropagation(); onRemove(r.id) }}
              style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-4)', fontSize:'0.8rem', lineHeight:1, padding:'0 1px', marginLeft:2 }}>×</button>
          </div>
        )
      })}
    </div>
  )
}

// ── Results table ─────────────────────────────────────────────────────────────
function ResultsTable({ run, onPathwayClick, selectedPathway }) {
  const [sortKey,   setSortKey]   = useState('padj')
  const [sortAsc,   setSortAsc]   = useState(true)
  const [dirFilter, setDirFilter] = useState('all')
  const [query,     setQuery]     = useState('')
  const [page,      setPage]      = useState(0)
  const PER = 30
  const results = run?.results ?? []
  const maxAbs  = useMemo(() => Math.max(...results.map(r => Math.abs(r.NES||0)), 1), [results])

  const filtered = useMemo(() => {
    let r = results
    if (dirFilter==='up')   r = r.filter(x => (x.NES||0) > 0)
    if (dirFilter==='down') r = r.filter(x => (x.NES||0) < 0)
    if (query) { const q = query.toLowerCase(); r = r.filter(x => x.pathway?.toLowerCase().includes(q)) }
    return [...r].sort((a,b) => { const av=a[sortKey]??Infinity, bv=b[sortKey]??Infinity; return sortAsc?av-bv:bv-av })
  }, [results, dirFilter, query, sortKey, sortAsc])

  const pages    = Math.ceil(filtered.length / PER)
  const pageData = filtered.slice(page*PER, (page+1)*PER)
  function toggleSort(k) { if(sortKey===k) setSortAsc(a=>!a); else { setSortKey(k); setSortAsc(true) }; setPage(0) }

  const exportRows = () => downloadCSV(
    filtered.map(r => ({ pathway:r.pathway, NES:r.NES, pvalue:r.pvalue, padj:r.padj, size:r.size, leadingEdgeN:r.leadingEdgeN, leadingEdge:r.leadingEdge })),
    `gsea_results_${run?.collectionLabel?.replace(/\s/g,'_')}.csv`
  )

  const cellBorder = `1px solid var(--border)`
  const th = (key, label) => (
    <th onClick={() => toggleSort(key)} style={{ padding:'7px 10px', cursor:'pointer', fontSize:'0.65rem', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase', color:sortKey===key?EM.text:'var(--text-3)', userSelect:'none', whiteSpace:'nowrap', background:'var(--bg-card2)', borderBottom:`2px solid ${sortKey===key?EM.accent:'var(--border)'}`, border:cellBorder }}>
      {label}{sortKey===key?(sortAsc?' ↑':' ↓'):''}
    </th>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <div style={{ display:'flex', borderRadius:8, overflow:'hidden', border:`1px solid ${EM.border}` }}>
          {[['all','All'],['up','↑ Enriched'],['down','↓ Depleted']].map(([v,l]) => (
            <button key={v} onClick={() => { setDirFilter(v); setPage(0) }}
              style={{ padding:'4px 10px', border:'none', cursor:'pointer', fontSize:'0.72rem', fontWeight:600, background:dirFilter===v?EM.accent:'var(--bg-card2)', color:dirFilter===v?'#fff':'var(--text-3)', transition:'background 0.12s' }}>{l}</button>
          ))}
        </div>
        <input value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} placeholder="Search pathways…"
          style={{ flex:1, minWidth:160, padding:'4px 10px', fontSize:'0.78rem', background:'var(--bg-card2)', border:`1px solid ${EM.border}`, borderRadius:8, color:'var(--text-1)' }} />
        <span style={{ fontSize:'0.7rem', color:'var(--text-3)' }}>{filtered.length} pathways</span>
        <button onClick={exportRows} title="Export CSV"
          style={{ padding:'4px 10px', borderRadius:7, border:`1px solid ${EM.border}`, background:EM.muted, color:EM.text, fontSize:'0.72rem', fontWeight:600, cursor:'pointer' }}>
          ↓ CSV
        </button>
      </div>

      <div style={{ overflowX:'auto', borderRadius:10, border:cellBorder }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
          <thead><tr>
            {th('pathway','Pathway')}
            {th('NES','NES')}
            {th('padj','padj')}
            {th('size','Size')}
            <th style={{ padding:'7px 10px', fontSize:'0.65rem', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase', color:'var(--text-3)', background:'var(--bg-card2)', border:cellBorder }}>Leading Edge</th>
          </tr></thead>
          <tbody>
            {pageData.map((r,i) => {
              const isSel = selectedPathway === r.pathway
              const name  = (r.pathway||'').replace(/_/g,' ').replace(/^[A-Z0-9]+\s+/,'')
              return (
                <tr key={r.pathway??i} onClick={() => onPathwayClick(r)}
                  style={{ cursor:'pointer', background:isSel?EM.muted:i%2===0?'transparent':'rgba(255,255,255,0.015)', borderLeft:`3px solid ${isSel?EM.accent:'transparent'}` }}
                  onMouseEnter={e => { if(!isSel) e.currentTarget.style.background='rgba(5,150,105,0.06)' }}
                  onMouseLeave={e => { if(!isSel) e.currentTarget.style.background=i%2===0?'transparent':'rgba(255,255,255,0.015)' }}>
                  <td style={{ padding:'7px 10px', color:'var(--text-1)', maxWidth:340, border:cellBorder }}>
                    <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={r.pathway}>{name}</div>
                  </td>
                  <td style={{ padding:'7px 10px', border:cellBorder }}><NESBar nes={r.NES??0} maxAbs={maxAbs} /></td>
                  <td style={{ padding:'7px 10px', fontFamily:'monospace', fontSize:'0.72rem', color:r.padj<0.05?EM.text:r.padj<0.25?'var(--text-2)':'var(--text-3)', border:cellBorder }}>{fmtPval(r.padj)}</td>
                  <td style={{ padding:'7px 10px', color:'var(--text-2)', fontFamily:'monospace', fontSize:'0.72rem', border:cellBorder }}>{r.size}</td>
                  <td style={{ padding:'7px 10px', fontSize:'0.7rem', maxWidth:220, border:cellBorder }}>
                    <span style={{ fontFamily:'monospace', color:EM.text, fontWeight:600 }}>{r.leadingEdgeN} </span>
                    <span style={{ color:'var(--text-3)', opacity:0.8 }}>
                      {(r.leadingEdge||'').split(',').slice(0,4).join(', ')}
                      {r.leadingEdgeN>4?` +${r.leadingEdgeN-4}`:''}
                    </span>
                  </td>
                </tr>
              )
            })}
            {!pageData.length && <tr><td colSpan={5} style={{ padding:24, textAlign:'center', color:'var(--text-3)', border:cellBorder }}>No pathways match</td></tr>}
          </tbody>
        </table>
      </div>

      {pages>1 && (
        <div style={{ display:'flex', gap:4, justifyContent:'center', alignItems:'center' }}>
          {[['←', () => setPage(p=>Math.max(0,p-1)), page===0],
            ['→', () => setPage(p=>Math.min(pages-1,p+1)), page===pages-1]].map(([l,fn,dis]) => (
            <button key={l} onClick={fn} disabled={dis}
              style={{ padding:'3px 10px', borderRadius:6, fontSize:'0.75rem', cursor:dis?'default':'pointer', background:'var(--bg-card2)', border:`1px solid ${EM.border}`, color:'var(--text-2)', opacity:dis?0.4:1 }}>{l}</button>
          ))}
          <span style={{ fontSize:'0.72rem', color:'var(--text-3)' }}>{page+1}/{pages}</span>
        </div>
      )}
    </div>
  )
}

// ── Ranked list panel ─────────────────────────────────────────────────────────
function RankedListPanel({ run }) {
  const [page, setPage] = useState(0)
  const PER = 50
  const list = run?.rankedList ?? []
  const pages = Math.ceil(list.length / PER)
  const pageData = list.slice(page*PER, (page+1)*PER)
  const maxAbs = useMemo(() => Math.max(...list.map(r => Math.abs(r.score||0)), 1), [list])
  const globalOffset = page * PER

  const exportList = () => downloadCSV(
    list.map((r,i) => ({ rank:i+1, gene:r.gene, score:r.score })),
    `ranked_list_${run?.collectionLabel?.replace(/\s/g,'_')}.csv`
  )

  if (!list.length) return (
    <div style={{ padding:40, textAlign:'center', color:'var(--text-3)' }}>Run GSEA to see the ranked list</div>
  )

  const cellBorder = `1px solid var(--border)`
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:'0.78rem', color:'var(--text-2)', fontWeight:600 }}>
          {list.length.toLocaleString()} genes ranked
        </span>
        <span style={{ fontSize:'0.72rem', color:'var(--text-3)' }}>·</span>
        <span style={{ fontSize:'0.72rem', color:EM.up }}>{list.filter(r=>r.score>0).length.toLocaleString()} positive</span>
        <span style={{ fontSize:'0.72rem', color:EM.down }}>{list.filter(r=>r.score<0).length.toLocaleString()} negative</span>
        <button onClick={exportList} style={{ marginLeft:'auto', padding:'4px 10px', borderRadius:7, border:`1px solid ${EM.border}`, background:EM.muted, color:EM.text, fontSize:'0.72rem', fontWeight:600, cursor:'pointer' }}>↓ CSV</button>
      </div>

      <div style={{ overflowX:'auto', borderRadius:10, border:cellBorder }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
          <thead><tr>
            {[['#','Rank'],['gene','Gene'],['score','Score'],['bar','']].map(([k,l]) => (
              <th key={k} style={{ padding:'7px 10px', fontSize:'0.65rem', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase', color:'var(--text-3)', background:'var(--bg-card2)', border:cellBorder, whiteSpace:'nowrap' }}>{l}</th>
            ))}
          </tr></thead>
          <tbody>
            {pageData.map((r,i) => {
              const rank = globalOffset + i + 1
              const pos  = r.score > 0
              const barW = Math.round((Math.abs(r.score)/maxAbs)*80)
              return (
                <tr key={rank} style={{ background:i%2===0?'transparent':'rgba(255,255,255,0.015)' }}>
                  <td style={{ padding:'5px 10px', color:'var(--text-4)', fontFamily:'monospace', fontSize:'0.7rem', border:cellBorder }}>{rank}</td>
                  <td style={{ padding:'5px 10px', fontFamily:'monospace', fontWeight:600, color:pos?EM.up:EM.down, border:cellBorder }}>{r.gene}</td>
                  <td style={{ padding:'5px 10px', fontFamily:'monospace', fontSize:'0.72rem', color:pos?EM.up:EM.down, border:cellBorder }}>{r.score>0?'+':''}{r.score.toFixed(4)}</td>
                  <td style={{ padding:'5px 10px', border:cellBorder }}>
                    <div style={{ width:barW, height:8, background:pos?'rgba(16,185,129,0.45)':'rgba(244,63,94,0.45)', borderRadius:3 }} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pages>1 && (
        <div style={{ display:'flex', gap:4, justifyContent:'center', alignItems:'center' }}>
          {[['←',()=>setPage(p=>Math.max(0,p-1)),page===0],['→',()=>setPage(p=>Math.min(pages-1,p+1)),page===pages-1]].map(([l,fn,dis])=>(
            <button key={l} onClick={fn} disabled={dis} style={{ padding:'3px 10px', borderRadius:6, fontSize:'0.75rem', cursor:dis?'default':'pointer', background:'var(--bg-card2)', border:`1px solid ${EM.border}`, color:'var(--text-2)', opacity:dis?0.4:1 }}>{l}</button>
          ))}
          <span style={{ fontSize:'0.72rem', color:'var(--text-3)' }}>{page+1}/{pages}</span>
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
    const { x, y, hits, hitGenes, nHits } = curveData
    const nes   = result?.NES ?? 0
    const color = nes >= 0 ? EM.up : EM.down
    const colorFade = nes >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)'
    const peakIdx = nes >= 0 ? y.indexOf(Math.max(...y)) : y.indexOf(Math.min(...y))
    const peakX   = x[peakIdx] ?? 0.5

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-1').trim() || '#e2e8f0'
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#334155'

    const curveTrace = {
      x, y, type:'scatter', mode:'lines',
      fill:'tozeroy', fillcolor:colorFade,
      line:{ color, width:2.5 }, name:'Running ES',
      hovertemplate:'Rank: %{x:.4f}<br>ES: %{y:.4f}<extra></extra>',
    }
    const rugTrace = {
      x: hits,
      y: Array(hits.length).fill(-0.08),
      customdata: hitGenes ?? [],
      type:'scatter', mode:'markers',
      marker:{ symbol:'line-ns-open', size:12, color:'rgba(16,185,129,0.5)', line:{ width:1.5, color } },
      name:'Pathway genes',
      hovertemplate: hitGenes?.length ? '<b>%{customdata}</b><br>Rank: %{x:.4f}<extra></extra>' : 'Rank: %{x:.4f}<extra></extra>',
    }

    const fmtName  = (pathway||'').replace(/_/g,' ')
    const layout = {
      height:400,
      margin:{ t:60, r:20, b:55, l:60 },
      title:{ text:`<b>${fmtName.slice(0,70)}${fmtName.length>70?'…':''}</b>`, font:{size:12,color:textColor}, x:0.5 },
      xaxis:{ title:'Gene rank (normalised)', range:[-0.01,1.01], color:'var(--text-3)', gridcolor:gridColor, zeroline:false, tickfont:{size:10} },
      yaxis:{ title:'Running enrichment score', autorange:true, color:'var(--text-3)', gridcolor:gridColor, zeroline:true, zerolinecolor:'var(--text-3)', zerolinewidth:1, tickfont:{size:10} },
      plot_bgcolor:'transparent', paper_bgcolor:'transparent',
      legend:{ font:{size:10,color:'var(--text-3)'}, x:0.01, y:0.99 },
      annotations:[{
        x:0.99, y:0.97, xref:'paper', yref:'paper', xanchor:'right', yanchor:'top',
        text:`NES: <b>${(nes>0?'+':'')+nes.toFixed(3)}</b>  padj: <b>${fmtPval(result?.padj)}</b>  hits: ${nHits}/${result?.size}`,
        showarrow:false, font:{size:11,color:textColor}, bgcolor:'rgba(0,0,0,0.3)', borderpad:5,
      }],
      shapes:[
        { type:'line', x0:0, x1:1, y0:0, y1:0, xref:'paper', line:{ color:'var(--border)', width:1 } },
        { type:'line', x0:peakX, x1:peakX, y0:0, y1:1, yref:'paper', line:{ color, width:1.2, dash:'dot' } },
        { type:'line', x0:0, x1:1, xref:'paper', y0:-0.055, y1:-0.055, line:{ color:'var(--border)', width:0.8 } },
      ],
    }
    Plotly.react(ref.current, [curveTrace, rugTrace], layout, {
      responsive:true, displaylogo:false,
      modeBarButtonsToRemove:['select2d','lasso2d'],
      toImageButtonOptions:{ filename:'enrichment_'+pathway, scale:2, format:'png' },
    })
  }, [curveData, pathway, result])

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.65)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }} onClick={onClose}>
      <div style={{ background:'var(--bg-panel)', borderRadius:16, padding:20, width:'100%', maxWidth:760, border:`1px solid ${EM.border}`, boxShadow:`0 0 40px rgba(5,150,105,0.15)` }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <span style={{ ...LBL, fontSize:'0.7rem' }}>Enrichment Mountain Plot</span>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <span style={{ fontSize:'0.68rem', color:'var(--text-3)' }}>Click camera icon in toolbar to export PNG</span>
            <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-3)', fontSize:'1.3rem', lineHeight:1 }}>×</button>
          </div>
        </div>

        {curveLoading ? (
          <div style={{ height:400, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14 }}>
            <div style={{ width:40, height:40, borderRadius:'50%', border:`3px solid ${EM.muted}`, borderTopColor:EM.accent, animation:'gsea-spin 0.7s linear infinite' }} />
            <span style={{ fontSize:'0.8rem', color:'var(--text-3)' }}>Computing enrichment curve…</span>
          </div>
        ) : curveData ? (
          <>
            <div ref={ref} style={{ width:'100%' }} />
            <div style={{ marginTop:8, fontSize:'0.72rem', color:'var(--text-3)', lineHeight:1.6 }}>
              <b style={{ color:EM.text }}>Leading edge ({result?.leadingEdgeN} genes):</b>{' '}
              {(result?.leadingEdge||'').split(',').slice(0,15).join(', ')}
              {result?.leadingEdgeN>15?` … +${result.leadingEdgeN-15} more`:''}
            </div>
          </>
        ) : null}
      </div>
      <style>{`@keyframes gsea-spin { to { transform:rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Main GSEAExplorer ─────────────────────────────────────────────────────────
export default function GSEAExplorer({ session, contrastLabel, annMap }) {
  // Config
  const [rankMethod,   setRankMethod]   = useState('log2FC')
  const [collection,   setCollection]   = useState(COLLECTIONS[0])
  const [species,      setSpecies]      = useState('Homo sapiens')
  const [minSize,      setMinSize]      = useState(15)
  const [maxSize,      setMaxSize]      = useState(500)
  const [filterMethod, setFilterMethod] = useState('quantile')
  const [filterValue,  setFilterValue]  = useState(0.25)

  // Density preview
  const [histData,     setHistData]     = useState(null)
  const [histLoading,  setHistLoading]  = useState(false)
  const [showDensityModal, setShowDensityModal] = useState(false)

  // Run state
  const [running,  setRunning]  = useState(false)
  const [runError, setRunError] = useState(null)
  const [elapsed,  setElapsed]  = useState(0)

  // Multiple runs in memory
  const [runs,        setRuns]        = useState([])
  const [activeRunId, setActiveRunId] = useState(null)
  const activeRun = runs.find(r => r.id === activeRunId) ?? runs[runs.length-1] ?? null

  // Content subtab
  const [contentTab, setContentTab] = useState('results')  // 'results' | 'ranked'

  // Enrichment curve
  const [selPathway,   setSelPathway]   = useState(null)
  const [curveData,    setCurveData]    = useState(null)
  const [curveLoading, setCurveLoading] = useState(false)
  const curveCacheRef = useRef({})
  const runCtrlRef    = useRef(null)

  // Fetch density preview when contrast changes
  useEffect(() => {
    if (!session?.sessionId) return
    setHistData(null); setHistLoading(true)
    const ctrl = new AbortController()
    fetch('/api/gsea/preview', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ sessionId:session.sessionId, contrastLabel }),
      signal: ctrl.signal,
    })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setHistData(d); setHistLoading(false) })
      .catch(e => { if (e.name !== 'AbortError') setHistLoading(false) })
    return () => ctrl.abort()
  }, [session, contrastLabel])

  // Derived cutoff values
  const { cutoffOrig, cutoffLog, genesAbove } = useMemo(() => {
    if (!histData) return { cutoffOrig:0, cutoffLog:0, genesAbove:0 }
    let orig = filterMethod === 'quantile'
      ? (histData.quantileValues?.[Math.min(Math.round(filterValue*100),100)] ?? 0)
      : filterValue
    const logC = Math.log1p(orig)
    let above = 0
    histData.kde?.x?.forEach((xi, i) => { if (i > 0 && xi >= logC) above += (histData.kde.y[i] + histData.kde.y[i-1]) * (xi - histData.kde.x[i-1]) / 2 })
    // approximate from kde integral — scale to n_genes
    const totalArea = histData.kde?.x?.reduce((s,xi,i) => i>0 ? s+(histData.kde.y[i]+histData.kde.y[i-1])*(xi-histData.kde.x[i-1])/2 : s, 0) || 1
    const fracAbove = Math.min(above / totalArea, 1)
    return { cutoffOrig:orig, cutoffLog:logC, genesAbove:Math.round(fracAbove*(histData.n_genes||0)) }
  }, [histData, filterMethod, filterValue])

  const countMax = histData?.quartiles?.q90 ?? 1000

  // Run GSEA
  const handleRun = useCallback(async () => {
    if (!session?.sessionId) return
    runCtrlRef.current?.abort()
    const ctrl = new AbortController()
    runCtrlRef.current = ctrl
    setRunning(true); setRunError(null)
    let tick = 0; const timer = setInterval(() => setElapsed(++tick), 1000)

    try {
      const r = await fetch('/api/gsea/run', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          sessionId:session.sessionId, contrastLabel,
          rankMethod, collection:collection.id, subcategory:collection.sub,
          species, minSize, maxSize,
          filterMethod, filterValue, annMap:annMap||null,
        }), signal:ctrl.signal,
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      const rm = RANK_METHODS.find(m => m.value === rankMethod)
      const newRun = {
        id: Date.now(),
        collectionLabel: collection.label, collectionKey: collection.key,
        rankMethod, rankShort: rm?.short ?? rankMethod,
        filterMethod, filterValue, species,
        results: data.results, rankedList: data.rankedList, meta: data.meta,
        timestamp: new Date().toLocaleTimeString(),
        contrastLabel,
      }
      setRuns(prev => [...prev, newRun])
      setActiveRunId(newRun.id)
      setContentTab('results')
      curveCacheRef.current = {}
      setSelPathway(null); setCurveData(null)
    } catch(e) {
      if (e.name !== 'AbortError') setRunError(e.message)
    } finally {
      clearInterval(timer); setElapsed(0); setRunning(false)
    }
  }, [session, contrastLabel, rankMethod, collection, species, minSize, maxSize, filterMethod, filterValue, annMap])

  // Enrichment curve on pathway click
  const handlePathwayClick = useCallback(async (result) => {
    setSelPathway(result); setCurveData(null)
    if (curveCacheRef.current[result.pathway]) { setCurveData(curveCacheRef.current[result.pathway]); return }
    setCurveLoading(true)
    try {
      const r = await fetch('/api/gsea/curve', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          sessionId:session.sessionId, contrastLabel,
          pathway:result.pathway,
          collection:activeRun?.collectionKey ? COLLECTIONS.find(c=>c.key===activeRun.collectionKey)?.id ?? collection.id : collection.id,
          subcategory:activeRun?.collectionKey ? COLLECTIONS.find(c=>c.key===activeRun.collectionKey)?.sub : collection.sub,
          species: activeRun?.species ?? species,
        }),
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      curveCacheRef.current[result.pathway] = data
      setCurveData(data)
    } catch { setCurveData(null) }
    finally { setCurveLoading(false) }
  }, [session, contrastLabel, activeRun, collection, species])

  const removeRun = (id) => {
    setRuns(prev => prev.filter(r => r.id !== id))
    if (activeRunId === id) setActiveRunId(null)
    setSelPathway(null); setCurveData(null)
  }

  if (!session?.sessionId) return <div style={{ padding:60, textAlign:'center', color:'var(--text-3)' }}>No session available.</div>

  return (
    <div data-accent="emerald" style={{ display:'flex', flexDirection:'column', gap:0 }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ background:`linear-gradient(135deg,rgba(5,150,105,0.12),rgba(16,185,129,0.05))`, border:`1px solid ${EM.border}`, borderRadius:12, padding:'14px 20px', marginBottom:16, display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:'1.05rem', fontWeight:700, color:EM.text, letterSpacing:'-0.01em' }}>⟳ GSEA Explorer</div>
          <div style={{ fontSize:'0.72rem', color:'var(--text-3)', marginTop:2 }}>fgsea · MSigDB · Ranked gene set enrichment</div>
        </div>
        {contrastLabel && (
          <div style={{ padding:'4px 12px', borderRadius:20, background:EM.muted, border:`1px solid ${EM.border}`, fontSize:'0.72rem', color:EM.text, fontWeight:600 }}>{contrastLabel}</div>
        )}
        {activeRun?.meta && (
          <div style={{ marginLeft:'auto', display:'flex', gap:16, flexWrap:'wrap' }}>
            {[[activeRun.meta.n_pathways,'pathways'],[activeRun.meta.n_genes_ranked,'genes ranked'],[`${activeRun.meta.elapsedSecs}s`,'runtime']].map(([v,l]) => (
              <div key={l} style={{ textAlign:'center' }}>
                <div style={{ fontSize:'0.95rem', fontWeight:700, color:EM.text }}>{v?.toLocaleString()}</div>
                <div style={{ fontSize:'0.62rem', color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{l}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Main layout ────────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:16, alignItems:'flex-start' }}>

        {/* ── SIDEBAR ─────────────────────────────────────────────────── */}
        <div style={{ width:295, flexShrink:0, display:'flex', flexDirection:'column', gap:14, background:'var(--bg-card)', borderRadius:12, padding:16, border:`1px solid ${EM.border}`, position:'sticky', top:80, maxHeight:'calc(100vh - 120px)', overflowY:'auto' }}>

          {/* Rank method */}
          <div>
            <SectionLabel>Rank method</SectionLabel>
            {RANK_METHODS.map(m => (
              <label key={m.value} style={{ display:'flex', alignItems:'flex-start', gap:8, cursor:'pointer', padding:'7px 10px', borderRadius:8, marginBottom:5, background:rankMethod===m.value?EM.muted:'var(--bg-card2)', border:`1px solid ${rankMethod===m.value?EM.border:'var(--border)'}`, transition:'all 0.12s' }}>
                <input type="radio" checked={rankMethod===m.value} onChange={()=>setRankMethod(m.value)} style={{ marginTop:2, accentColor:EM.accent }} />
                <div>
                  <div style={{ fontSize:'0.78rem', color:rankMethod===m.value?EM.text:'var(--text-1)', fontWeight:600 }}>{m.label}</div>
                  <div style={{ fontSize:'0.65rem', color:'var(--text-3)' }}>{m.hint||''}</div>
                </div>
              </label>
            ))}
          </div>

          {/* Pre-filter */}
          <div>
            <SectionLabel>Pre-filter genes</SectionLabel>
            <div style={{ display:'flex', gap:4, marginBottom:8 }}>
              {[['quantile','Quantile'],['count','Count cutoff']].map(([v,l]) => (
                <button key={v} onClick={()=>{ setFilterMethod(v); setFilterValue(v==='quantile'?0.25:10) }}
                  style={{ flex:1, padding:'4px 0', fontSize:'0.7rem', fontWeight:600, borderRadius:6, cursor:'pointer', border:'none', background:filterMethod===v?EM.accent:'var(--bg-card2)', color:filterMethod===v?'#fff':'var(--text-2)', transition:'all 0.12s' }}>{l}</button>
              ))}
            </div>

            {/* Density plot in sidebar */}
            <div style={{ position:'relative' }}>
              {histLoading ? (
                <div style={{ height:130, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-3)', fontSize:'0.72rem' }}>Loading distribution…</div>
              ) : histData ? (
                <DensityPlot histData={histData} cutoffLog={cutoffLog} height={130} />
              ) : null}
              {histData && (
                <button onClick={()=>setShowDensityModal(true)} title="Expand distribution"
                  style={{ position:'absolute', top:4, right:4, background:'rgba(0,0,0,0.4)', border:`1px solid ${EM.border}`, borderRadius:5, padding:'2px 6px', fontSize:'0.65rem', color:EM.text, cursor:'pointer', lineHeight:1 }}>⤢</button>
              )}
            </div>

            {filterMethod==='quantile' ? (
              <div style={{ marginTop:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.7rem', color:'var(--text-3)', marginBottom:4 }}>
                  <span>Remove bottom</span>
                  <span style={{ color:EM.text, fontWeight:700 }}>{(filterValue*100).toFixed(0)}%  ≥{cutoffOrig.toFixed(1)}</span>
                </div>
                <input type="range" min={0} max={0.75} step={0.01} value={filterValue} onChange={e=>setFilterValue(+e.target.value)} style={{ width:'100%', accentColor:EM.accent }} />
              </div>
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:8 }}>
                <span style={{ fontSize:'0.7rem', color:'var(--text-3)', whiteSpace:'nowrap' }}>Min ≥</span>
                <input type="range" min={0} max={Math.max(countMax,100)} step={1} value={filterValue} onChange={e=>setFilterValue(+e.target.value)} style={{ flex:1, accentColor:EM.accent }} />
                <span style={{ fontSize:'0.72rem', fontFamily:'monospace', color:EM.text, minWidth:36 }}>{filterValue}</span>
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 10px', background:EM.muted, borderRadius:6, marginTop:8, fontSize:'0.7rem', border:`1px solid ${EM.border}` }}>
              <span style={{ color:'var(--text-3)' }}>Genes passing</span>
              <span style={{ color:EM.text, fontWeight:700 }}>~{genesAbove.toLocaleString()}{histData?.n_genes?` / ${histData.n_genes.toLocaleString()}`:''}</span>
            </div>
          </div>

          {/* Collection */}
          <div>
            <SectionLabel>Gene set collection</SectionLabel>
            <CollectionGrid selected={collection} onChange={setCollection} />
          </div>

          {/* Sizes */}
          <div>
            <SectionLabel>Gene set size</SectionLabel>
            <div style={{ display:'flex', gap:10 }}>
              {[['Min',minSize,setMinSize,5,50],['Max',maxSize,setMaxSize,100,2000]].map(([l,v,set,mn,mx])=>(
                <div key={l} style={{ flex:1 }}>
                  <div style={{ fontSize:'0.66rem', color:'var(--text-3)', marginBottom:3 }}>{l}</div>
                  <input type="number" value={v} min={mn} max={mx} onChange={e=>set(Math.max(mn,Math.min(mx,+e.target.value||mn)))}
                    style={{ width:'100%', padding:'4px 8px', fontSize:'0.78rem', textAlign:'center', background:'var(--bg-card2)', border:`1px solid ${EM.border}`, borderRadius:7, color:'var(--text-1)' }} />
                </div>
              ))}
            </div>
          </div>

          {/* Species */}
          <div>
            <SectionLabel>Species</SectionLabel>
            <select value={species} onChange={e=>setSpecies(e.target.value)}
              style={{ width:'100%', padding:'6px 10px', fontSize:'0.78rem', background:'var(--bg-card2)', border:`1px solid ${EM.border}`, borderRadius:7, color:'var(--text-1)' }}>
              {SPECIES.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>

          {/* Run button */}
          <button onClick={handleRun} disabled={running}
            style={{ padding:'11px 0', borderRadius:10, border:'none', cursor:running?'wait':'pointer', background:running?'rgba(5,150,105,0.35)':`linear-gradient(135deg,${EM.accent},${EM.accent2})`, color:'#fff', fontWeight:700, fontSize:'0.88rem', boxShadow:running?'none':`0 4px 14px rgba(5,150,105,0.4)`, transition:'all 0.15s', marginTop:4 }}>
            {running ? `Running… ${elapsed}s` : runs.length ? '↺ New Run' : '▶ Run GSEA'}
          </button>

          {runError && (
            <div style={{ padding:'8px 12px', borderRadius:8, fontSize:'0.75rem', background:'rgba(248,113,113,0.08)', color:'#f87171', border:'1px solid rgba(248,113,113,0.2)', lineHeight:1.5 }}>⚠ {runError}</div>
          )}
          {!annMap && (
            <div style={{ padding:'7px 10px', borderRadius:8, fontSize:'0.68rem', background:'rgba(251,191,36,0.08)', color:'#fbbf24', border:'1px solid rgba(251,191,36,0.2)', lineHeight:1.5 }}>
              ⚠ No annotation loaded — run <b>Annotate</b> first for best gene ID matching.
            </div>
          )}
        </div>

        {/* ── RIGHT CONTENT ─────────────────────────────────────────────── */}
        <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:12 }}>
          {/* Empty state */}
          {!runs.length && !running && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:400, gap:16, color:'var(--text-3)' }}>
              <div style={{ fontSize:'3rem', opacity:0.25 }}>⟳</div>
              <div style={{ fontSize:'0.9rem', fontWeight:600, color:'var(--text-2)' }}>Configure parameters and click Run GSEA</div>
              <div style={{ fontSize:'0.78rem', maxWidth:380, textAlign:'center', lineHeight:1.7 }}>Select a gene set collection, set your rank method and pre-filter threshold, then hit Run. Click any result row to open its enrichment mountain plot.</div>
            </div>
          )}

          {/* Spinner while running */}
          {running && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:400, gap:16 }}>
              <div style={{ position:'relative', width:56, height:56 }}>
                <div style={{ width:'100%', height:'100%', borderRadius:'50%', border:`3px solid ${EM.muted}`, borderTopColor:EM.accent, animation:'gsea-spin 0.8s linear infinite' }} />
                <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.72rem', fontWeight:700, color:EM.text }}>{elapsed}s</div>
              </div>
              <div style={{ fontSize:'0.9rem', color:'var(--text-2)', fontWeight:600 }}>Running fgsea…</div>
              <div style={{ fontSize:'0.75rem', color:'var(--text-3)', textAlign:'center', maxWidth:300, lineHeight:1.6 }}>{collection.label} · {species}<br />Large collections (GO:BP) may take 60+ seconds</div>
            </div>
          )}

          {/* Results area */}
          {runs.length > 0 && !running && (
            <>
              {/* Run history chips */}
              <RunChips runs={runs} activeRunId={activeRunId} onSelect={id=>{ setActiveRunId(id); setSelPathway(null); setCurveData(null) }} onRemove={removeRun} />

              {/* Content subtabs */}
              <div style={{ display:'flex', gap:2, borderBottom:`1px solid ${EM.border}` }}>
                {[['results',`◉ Pathways${activeRun?.results?.length?` (${activeRun.results.length})`:''}` ], ['ranked',`≡ Ranked List${activeRun?.rankedList?.length?` (${activeRun.rankedList.length.toLocaleString()})`:''}` ]].map(([k,l])=>(
                  <button key={k} onClick={()=>setContentTab(k)}
                    style={{ padding:'6px 14px', border:'none', borderRadius:'6px 6px 0 0', cursor:'pointer', fontSize:'0.8rem', fontWeight:contentTab===k?700:400, background:contentTab===k?EM.muted:'transparent', color:contentTab===k?EM.text:'var(--text-3)', borderBottom:`2px solid ${contentTab===k?EM.accent:'transparent'}`, transition:'all 0.12s' }}>{l}</button>
                ))}
              </div>

              <div style={{ paddingTop:4 }}>
                {contentTab==='results' && <ResultsTable run={activeRun} onPathwayClick={handlePathwayClick} selectedPathway={selPathway?.pathway} />}
                {contentTab==='ranked'  && <RankedListPanel run={activeRun} />}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Density expanded modal ─────────────────────────────────────── */}
      {showDensityModal && histData && (
        <DensityModal
          histData={histData} cutoffLog={cutoffLog} cutoffOrig={cutoffOrig}
          filterMethod={filterMethod} filterValue={filterValue} setFilterValue={setFilterValue}
          genesAbove={genesAbove} countMax={countMax}
          onClose={()=>setShowDensityModal(false)}
        />
      )}

      {/* ── Mountain plot modal ─────────────────────────────────────────── */}
      {selPathway && (
        <MountainModal
          pathway={selPathway.pathway} result={selPathway}
          curveData={curveData} curveLoading={curveLoading}
          onClose={()=>{ setSelPathway(null); setCurveData(null) }}
        />
      )}

      <style>{`@keyframes gsea-spin { to { transform:rotate(360deg); } }`}</style>
    </div>
  )
}
