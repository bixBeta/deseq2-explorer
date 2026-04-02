import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import Plotly from 'plotly.js-dist-min'

// ── Ocean palette — green/red preserved for ±NES ─────────────────────────────
const V = {
  accent:  '#0e7490',
  accent2: '#0891b2',
  text:    '#0891b2',
  muted:   'rgba(14,116,144,0.12)',
  border:  'rgba(14,116,144,0.35)',
  card:    'rgba(14,116,144,0.06)',
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

// ── Section divider ───────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{ ...LBL, display:'flex', alignItems:'center', gap:6, marginBottom:7 }}>
      <div style={{ flex:1, height:1, background:V.border }} />{children}<div style={{ flex:1, height:1, background:V.border }} />
    </div>
  )
}

// ── Per-sample overlapping KDE chart ─────────────────────────────────────────
function SampleDensityChart({ histData, cutoffLog }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!histData?.kdes || !ref.current) return
    const { kdes } = histData
    const showLegend = kdes.length <= 24

    const traces = kdes.map((kde, i) => ({
      x: kde.x, y: kde.y,
      type:'scatter', mode:'lines',
      name: kde.sample,
      line:{ color:SAMPLE_COLORS[i%SAMPLE_COLORS.length], width:1.6, shape:'spline' },
      opacity:0.72, showlegend:showLegend,
      hovertemplate:`<b>${kde.sample}</b><br>log₁p(norm count): %{x:.2f}<extra></extra>`,
    }))

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-3').trim()||'#94a3b8'
    const isLight   = document.body.classList.contains('light')
    const gridColor = isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.12)'

    const layout = {
      height: 380,
      margin:{ t:10, r:showLegend?130:14, b:44, l:52 },
      xaxis:{ title:{ text:'log₁p(normalised count)', font:{size:10} }, color:textColor, gridcolor:gridColor, showgrid:true, zeroline:false, tickfont:{size:9}, autorange:true },
      yaxis:{ title:{ text:'Density', font:{size:10} }, color:textColor, gridcolor:gridColor, showgrid:true, zeroline:false, tickfont:{size:9}, autorange:true },
      plot_bgcolor:'transparent', paper_bgcolor:'transparent',
      legend:{ font:{size:9,color:textColor}, bgcolor:'transparent', x:1.01, y:1, xanchor:'left' },
      hovermode:'x',
      shapes:[{
        type:'line', x0:cutoffLog, x1:cutoffLog, y0:0, y1:1, yref:'paper',
        line:{ color:'#f43f5e', width:2, dash:'dash' },
      }],
      annotations:[{
        x:cutoffLog, y:0.97, yref:'paper', xanchor:'left',
        text:' filter cutoff', font:{size:9,color:'#f87171'}, showarrow:false,
      }],
    }
    const modebarBg    = isLight ? 'rgba(255,255,255,0.85)' : 'rgba(15,23,42,0.85)'
    const modebarColor = isLight ? '#444444' : '#94a3b8'
    layout.modebar = { bgcolor:modebarBg, color:modebarColor, activecolor:isLight?'#000':'#fff' }
    Plotly.react(ref.current, traces, layout, {
      responsive:true, displaylogo:false,
      modeBarButtonsToRemove:['select2d','lasso2d'],
      toImageButtonOptions:{ filename:'count_distributions', scale:2, format:'png' },
    })
  }, [histData, cutoffLog])
  return <div ref={ref} style={{ width:'100%' }} />
}

// ── Distribution + filter modal ───────────────────────────────────────────────
function DistributionModal({ histData, cutoffLog, cutoffOrig, filterMethod, filterValue, setFilterValue, setFilterMethod, nAbove, countMax, onClose }) {
  return (
    <div style={{ position:'fixed', inset:0, zIndex:1100, background:'rgba(0,0,0,0.7)', backdropFilter:'blur(5px)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
      onClick={onClose}>
      <div style={{ background:'var(--bg-panel)', borderRadius:18, padding:28, width:'100%', maxWidth:880, border:`1px solid ${V.border}`, boxShadow:`0 0 60px rgba(14,116,144,0.2)` }}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:18 }}>
          <div>
            <div style={{ fontSize:'1rem', fontWeight:700, color:V.text, marginBottom:3 }}>Count Distribution — All Samples</div>
            <div style={{ fontSize:'0.73rem', color:'var(--text-3)' }}>
              Each curve = one sample (log₁p normalised counts) · Red dashed line = row-median filter cutoff
              {histData && ` · ${histData.n_samples} samples · ${histData.n_genes?.toLocaleString()} genes`}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-3)', fontSize:'1.4rem', lineHeight:1, marginTop:-4 }}>×</button>
        </div>

        {/* Density chart */}
        {histData
          ? <SampleDensityChart histData={histData} cutoffLog={cutoffLog} />
          : <div style={{ height:380, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-3)' }}>Loading…</div>
        }

        {/* Controls */}
        <div style={{ marginTop:20, display:'flex', flexDirection:'column', gap:12 }}>
          {/* Mode toggle */}
          <div style={{ display:'flex', gap:0, borderRadius:9, overflow:'hidden', border:`1px solid ${V.border}`, alignSelf:'flex-start' }}>
            {[['quantile','Quantile (% of genes)'],['count','Absolute count cutoff']].map(([v,l])=>(
              <button key={v} onClick={()=>{ setFilterMethod(v); setFilterValue(v==='quantile'?0.25:10) }}
                style={{ padding:'6px 16px', border:'none', cursor:'pointer', fontSize:'0.78rem', fontWeight:600, background:filterMethod===v?V.accent:'var(--bg-card2)', color:filterMethod===v?'#fff':'var(--text-2)', transition:'background 0.12s' }}>{l}</button>
            ))}
          </div>

          {/* Slider */}
          {filterMethod==='quantile' ? (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.82rem', color:'var(--text-2)' }}>
                <span>Remove genes below the <b style={{ color:V.text }}>{(filterValue*100).toFixed(0)}th percentile</b></span>
                <span style={{ fontFamily:'monospace', color:V.text }}>row-median cutoff ≥ {cutoffOrig.toFixed(1)}</span>
              </div>
              <input type="range" min={0} max={0.75} step={0.01} value={filterValue} onChange={e=>setFilterValue(+e.target.value)} style={{ width:'100%', accentColor:V.accent }} />
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.72rem', color:'var(--text-3)' }}>
                <span>0% (no filter)</span><span>75%</span>
              </div>
            </div>
          ) : (
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <span style={{ fontSize:'0.82rem', color:'var(--text-2)', whiteSpace:'nowrap' }}>Min row median ≥</span>
              <input type="range" min={0} max={Math.max(countMax,100)} step={1} value={filterValue} onChange={e=>setFilterValue(+e.target.value)} style={{ flex:1, accentColor:V.accent }} />
              <span style={{ fontSize:'0.85rem', fontFamily:'monospace', color:V.text, minWidth:52, textAlign:'right' }}>{filterValue} cts</span>
            </div>
          )}

          {/* Stats row */}
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {[
              [`~${nAbove.toLocaleString()}`, 'genes pass filter'],
              [histData?.n_genes ? `${(histData.n_genes-nAbove).toLocaleString()}` : '—', 'genes removed'],
              [histData?.n_genes ? `${((nAbove/(histData.n_genes||1))*100).toFixed(1)}%` : '—', 'retained'],
            ].map(([v,l])=>(
              <div key={l} style={{ padding:'6px 14px', borderRadius:8, background:V.muted, border:`1px solid ${V.border}`, textAlign:'center' }}>
                <div style={{ fontSize:'1rem', fontWeight:700, color:V.text }}>{v}</div>
                <div style={{ fontSize:'0.65rem', color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
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
function NESBar({ nes, maxAbs }) {
  const pct = Math.min((Math.abs(nes)/maxAbs)*46,46)
  return (
    <div style={{ position:'relative', width:96, height:20, display:'flex', alignItems:'center' }}>
      <div style={{ position:'absolute', left:'50%', top:'15%', width:1, height:'70%', background:'var(--border)' }} />
      <div style={{ position:'absolute', width:`${pct}%`, height:'55%', top:'22%', left:nes>0?'50%':`${50-pct}%`, background:nes>0?'rgba(16,185,129,0.5)':'rgba(244,63,94,0.5)', borderRadius:2 }} />
      <span style={{ position:'absolute', [nes>0?'left':'right']:0, fontSize:'0.67rem', fontFamily:'monospace', color:nes>0?V.up:V.down, fontWeight:600 }}>
        {nes>0?'+':''}{nes.toFixed(2)}
      </span>
    </div>
  )
}

// ── Run chips ─────────────────────────────────────────────────────────────────
function RunChips({ runs, activeRunId, onSelect, onRemove }) {
  if (!runs.length) return null
  return (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap', paddingBottom:10, borderBottom:`1px solid ${V.border}`, marginBottom:10 }}>
      <span style={{ fontSize:'0.65rem', color:'var(--text-4)', alignSelf:'center', whiteSpace:'nowrap', textTransform:'uppercase', letterSpacing:'0.05em' }}>Runs:</span>
      {runs.map(r => {
        const active = r.id===activeRunId
        return (
          <div key={r.id} onClick={()=>onSelect(r.id)}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:20, cursor:'pointer', userSelect:'none', background:active?V.muted:'var(--bg-card2)', border:`1px solid ${active?V.border:'var(--border)'}`, transition:'all 0.12s' }}>
            <span style={{ fontSize:'0.7rem', fontWeight:700, color:active?'var(--text-1)':'var(--text-2)' }}>{r.collectionLabel}</span>
            <span style={{ fontSize:'0.64rem', color:'var(--text-3)' }}>·{r.rankShort}</span>
            <span style={{ fontSize:'0.62rem', color:active?'rgba(196,181,253,0.6)':'var(--text-4)', fontFamily:'monospace' }}>{r.meta?.n_pathways}↗</span>
            <button onClick={e=>{ e.stopPropagation(); onRemove(r.id) }}
              style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-4)', fontSize:'0.82rem', lineHeight:1, padding:'0 1px', marginLeft:1 }}>×</button>
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

  const exportRows=()=>downloadCSV(
    filtered.map(r=>({ pathway:r.pathway,NES:r.NES,pvalue:r.pvalue,padj:r.padj,size:r.size,leadingEdgeN:r.leadingEdgeN,leadingEdge:r.leadingEdge })),
    `gsea_${run?.collectionLabel?.replace(/\s/g,'_')}.csv`
  )

  const CB = `1px solid var(--border)`   // cell border shorthand
  const TH = (key, label) => (
    <th key={key} onClick={()=>toggleSort(key)} style={{ padding:'7px 10px', cursor:'pointer', fontSize:'0.65rem', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase', color:sortKey===key?V.text:'var(--text-3)', userSelect:'none', whiteSpace:'nowrap', background:'var(--bg-card2)', border:CB, borderBottom:`2px solid ${sortKey===key?V.accent:'var(--border)'}` }}>
      {label}{sortKey===key?(sortAsc?' ↑':' ↓'):''}
    </th>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
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
      </div>

      {/* Table */}
      <div style={{ overflowX:'auto', borderRadius:10, border:CB }}>
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
                  onMouseEnter={e=>{ if(!isSel) e.currentTarget.style.background='rgba(14,116,144,0.07)' }}
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
}

// ── Ranked list panel ─────────────────────────────────────────────────────────
function RankedListPanel({ run }) {
  const [page,setPage]=useState(0)
  const PER=50
  const list=run?.rankedList??[]
  const pages=Math.ceil(list.length/PER)
  const pageData=list.slice(page*PER,(page+1)*PER)
  const maxAbs=useMemo(()=>Math.max(...list.map(r=>Math.abs(r.score||0)),1),[list])
  const gOff=page*PER

  if(!list.length) return <div style={{ padding:40, textAlign:'center', color:'var(--text-3)' }}>Run GSEA to see the ranked list</div>

  const CB=`1px solid var(--border)`
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <span style={{ fontSize:'0.78rem', color:'var(--text-2)', fontWeight:600 }}>{list.length.toLocaleString()} genes ranked</span>
        <span style={{ fontSize:'0.72rem', color:V.up }}>↑ {list.filter(r=>r.score>0).length.toLocaleString()} positive</span>
        <span style={{ fontSize:'0.72rem', color:V.down }}>↓ {list.filter(r=>r.score<0).length.toLocaleString()} negative</span>
        <button onClick={()=>downloadCSV(list.map((r,i)=>({ rank:i+1,gene:r.gene,score:r.score })),`ranked_list_${run?.collectionLabel?.replace(/\s/g,'_')}.csv`)}
          style={{ marginLeft:'auto', padding:'4px 10px', borderRadius:7, border:`1px solid ${V.border}`, background:V.muted, color:V.text, fontSize:'0.72rem', fontWeight:600, cursor:'pointer' }}>↓ CSV</button>
      </div>
      <div style={{ overflowX:'auto', borderRadius:10, border:CB }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
          <thead><tr>
            {[['#'],['Gene'],['Score'],['']].map(([l],i)=>(
              <th key={i} style={{ padding:'7px 10px', fontSize:'0.65rem', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase', color:'var(--text-3)', background:'var(--bg-card2)', border:CB }}>{l}</th>
            ))}
          </tr></thead>
          <tbody>
            {pageData.map((r,i)=>{
              const rank=gOff+i+1; const pos=r.score>0
              return (
                <tr key={rank} style={{ background:i%2===0?'transparent':'rgba(255,255,255,0.015)' }}>
                  <td style={{ padding:'5px 10px', color:'var(--text-4)', fontFamily:'monospace', fontSize:'0.7rem', border:CB }}>{rank}</td>
                  <td style={{ padding:'5px 10px', fontFamily:'monospace', fontWeight:600, color:'var(--text-1)', border:CB }}>{r.gene}</td>
                  <td style={{ padding:'5px 10px', fontFamily:'monospace', fontSize:'0.72rem', color:pos?V.up:V.down, border:CB }}>{r.score>0?'+':''}{r.score.toFixed(4)}</td>
                  <td style={{ padding:'5px 10px', border:CB }}>
                    <div style={{ width:Math.round((Math.abs(r.score)/maxAbs)*80), height:8, background:pos?'rgba(16,185,129,0.45)':'rgba(244,63,94,0.45)', borderRadius:3 }} />
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
            <button key={l} onClick={fn} disabled={dis} style={{ padding:'3px 10px', borderRadius:6, fontSize:'0.75rem', cursor:dis?'default':'pointer', background:'var(--bg-card2)', border:`1px solid ${V.border}`, color:'var(--text-2)', opacity:dis?0.4:1 }}>{l}</button>
          ))}
          <span style={{ fontSize:'0.72rem', color:'var(--text-3)' }}>{page+1}/{pages}</span>
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

function PlotsPanel({ run, session, contrastLabel }) {
  const [plotType,   setPlotType]   = useState('dotplot')
  const [nShow,      setNShow]      = useState(20)
  const [fontSize,   setFontSize]   = useState(11)
  const [width,      setWidth]      = useState(9)
  const [height,     setHeight]     = useState(7)
  const [colorPos,   setColorPos]   = useState('#e63946')
  const [colorNeg,   setColorNeg]   = useState('#457b9d')
  const [selPathways,  setSelPathways]  = useState([])
  const [loading,    setLoading]    = useState(false)
  const [imgSrc,     setImgSrc]     = useState(null)
  const [error,      setError]      = useState(null)
  const [fullscreen, setFullscreen] = useState(false)

  const pathwaysForPlot = plotType === 'heatplot' || plotType === 'cnetplot' || plotType === 'gsea_plot'
  const availablePathways = useMemo(() => (run?.results ?? []).map(r => r.pathway).filter(Boolean), [run])
  const pathwayList = selPathways

  // Clear selection when run changes
  useEffect(() => { setSelPathways([]) }, [run])

  // Escape key closes fullscreen
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') setFullscreen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const handleGenerate = async () => {
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
          plotType,
          params: {
            n_show:    nShow,
            font_size: fontSize,
            color_pos: colorPos,
            color_neg: colorNeg,
            width,
            height,
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

  const downloadPng = () => {
    if (!imgSrc) return
    const a = Object.assign(document.createElement('a'), { href: imgSrc, download: `gsea_${plotType}.png` })
    a.click()
  }

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
          style={{ padding:'9px 0', borderRadius:8, border:'none', cursor:loading||!run?'wait':'pointer', background:loading?`rgba(14,116,144,0.35)`:`linear-gradient(135deg,${V.accent},${V.accent2})`, color:'#fff', fontWeight:700, fontSize:'0.82rem', transition:'all 0.15s' }}>
          {loading ? '⟳ Generating…' : '▶ Generate Plot'}
        </button>

        {imgSrc && (
          <button onClick={downloadPng}
            style={{ padding:'6px 0', borderRadius:7, border:`1px solid ${V.border}`, background:V.muted, color:'var(--text-1)', fontSize:'0.75rem', fontWeight:600, cursor:'pointer' }}>
            ↓ Download PNG
          </button>
        )}
      </div>

      {/* Image area */}
      <div style={{ flex:1, minWidth:0, borderRadius:10, border:CB, background:'var(--bg-card)', minHeight:420,
        display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', position:'relative' }}>
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
          <>
            <img src={imgSrc} alt={plotType} style={{ maxWidth:'100%', maxHeight:'80vh', objectFit:'contain' }} />
            <button onClick={() => setFullscreen(true)}
              title="View fullscreen"
              style={{ position:'absolute', top:10, right:10, padding:'4px 8px', borderRadius:6,
                border:`1px solid ${V.border}`, background:V.muted, color:'var(--text-1)',
                fontSize:'0.72rem', cursor:'pointer', backdropFilter:'blur(4px)' }}>
              ⛶ Expand
            </button>
          </>
        )}
        {!imgSrc && !loading && !error && (
          <div style={{ textAlign:'center', color:'var(--text-3)', padding:40 }}>
            <div style={{ fontSize:'2.5rem', opacity:0.15, marginBottom:10 }}>◈</div>
            <div style={{ fontSize:'0.82rem' }}>Select a plot type and click Generate</div>
          </div>
        )}
      </div>

      {/* Fullscreen modal */}
      {fullscreen && imgSrc && (
        <div onClick={() => setFullscreen(false)}
          style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.85)',
            display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(6px)' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ position:'relative', maxWidth:'95vw', maxHeight:'95vh', borderRadius:12,
              border:CB, background:'var(--bg-card)', overflow:'hidden', boxShadow:'0 24px 80px rgba(0,0,0,0.6)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'8px 14px', borderBottom:CB, background:'rgba(0,0,0,0.2)' }}>
              <span style={{ fontSize:'0.78rem', color:'var(--text-2)', fontWeight:600 }}>
                {PLOT_TYPES.find(p => p.key === plotType)?.label}
              </span>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={downloadPng}
                  style={{ fontSize:'0.7rem', padding:'3px 10px', borderRadius:5, border:`1px solid ${V.border}`,
                    background:V.muted, color:'var(--text-1)', cursor:'pointer' }}>
                  ↓ Download
                </button>
                <button onClick={() => setFullscreen(false)}
                  style={{ fontSize:'0.8rem', padding:'3px 8px', borderRadius:5, border:`1px solid ${V.border}`,
                    background:'rgba(255,255,255,0.07)', color:'var(--text-1)', cursor:'pointer' }}>
                  ✕
                </button>
              </div>
            </div>
            <div style={{ padding:16, overflow:'auto', maxHeight:'calc(95vh - 52px)' }}>
              <img src={imgSrc} alt={plotType} style={{ maxWidth:'100%', display:'block' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Enrichment mountain plot modal ────────────────────────────────────────────
function MountainModal({ pathway, result, curveData, curveLoading, onClose }) {
  const ref=useRef(null)
  useEffect(()=>{
    if(!curveData||!ref.current) return
    const { x, y, hits, hitGenes, nHits }=curveData
    const nes=result?.NES??0
    const color=nes>=0?V.up:V.down
    const colorFade=nes>=0?'rgba(16,185,129,0.12)':'rgba(244,63,94,0.12)'
    const peakIdx=nes>=0?y.indexOf(Math.max(...y)):y.indexOf(Math.min(...y))
    const peakX=x[peakIdx]??0.5
    const textColor=getComputedStyle(document.documentElement).getPropertyValue('--text-1').trim()||'#e2e8f0'
    const gridColor=getComputedStyle(document.documentElement).getPropertyValue('--border').trim()||'#334155'
    const fmtName=(pathway||'').replace(/_/g,' ')

    Plotly.react(ref.current, [
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
         toImageButtonOptions:{ filename:'enrichment_'+pathway, scale:2, format:'png' } })
  },[curveData,pathway,result])

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.65)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }} onClick={onClose}>
      <div style={{ background:'var(--bg-panel)', borderRadius:16, padding:20, width:'100%', maxWidth:780, border:`1px solid ${V.border}`, boxShadow:`0 0 40px rgba(14,116,144,0.18)` }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <span style={{ ...LBL, fontSize:'0.7rem' }}>Enrichment Mountain Plot</span>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <span style={{ fontSize:'0.67rem', color:'var(--text-3)' }}>Camera icon in toolbar → export PNG · Hover rug marks for gene names</span>
            <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-3)', fontSize:'1.3rem', lineHeight:1 }}>×</button>
          </div>
        </div>
        {curveLoading ? (
          <div style={{ height:400, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14 }}>
            <div style={{ width:40, height:40, borderRadius:'50%', border:`3px solid ${V.muted}`, borderTopColor:V.accent, animation:'gsea-spin 0.7s linear infinite' }} />
            <span style={{ fontSize:'0.8rem', color:'var(--text-3)' }}>Computing enrichment curve…</span>
          </div>
        ) : curveData ? (
          <>
            <div ref={ref} style={{ width:'100%' }} />
            <div style={{ marginTop:8, fontSize:'0.72rem', color:'var(--text-3)', lineHeight:1.6 }}>
              <b style={{ color:'var(--text-1)' }}>Leading edge ({result?.leadingEdgeN}):</b>{' '}
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
  const [rankMethod,   setRankMethod]   = useState('log2FC')
  const [collection,   setCollection]   = useState(COLLECTIONS[0])
  const [species,      setSpecies]      = useState('Homo sapiens')
  const [minSize,      setMinSize]      = useState(15)
  const [maxSize,      setMaxSize]      = useState(500)
  const [scoreType,    setScoreType]    = useState('std')
  const [nPerm,        setNPerm]        = useState(1000)
  const [pAdjMethod,   setPAdjMethod]   = useState('BH')
  const [padjCutoff,   setPadjCutoff]   = useState(0.25)
  const [filterMethod, setFilterMethod] = useState('quantile')
  const [filterValue,  setFilterValue]  = useState(0.25)

  const [histData,     setHistData]     = useState(null)
  const [histLoading,  setHistLoading]  = useState(false)
  const [showDistModal,setShowDistModal]= useState(false)

  const [running,  setRunning]  = useState(false)
  const [runError, setRunError] = useState(null)
  const [elapsed,  setElapsed]  = useState(0)

  const [runs,        setRuns]        = useState([])
  const [activeRunId, setActiveRunId] = useState(null)

  // Only show runs belonging to the current contrast
  const contrastRuns = useMemo(()=>runs.filter(r=>r.contrastLabel===contrastLabel),[runs,contrastLabel])
  const activeRun    = contrastRuns.find(r=>r.id===activeRunId) ?? contrastRuns[contrastRuns.length-1] ?? null

  const [contentTab,   setContentTab]  = useState('results')
  const [selPathway,   setSelPathway]   = useState(null)
  const [curveData,    setCurveData]    = useState(null)
  const [curveLoading, setCurveLoading] = useState(false)
  const curveCacheRef  = useRef({})
  const runCtrlRef     = useRef(null)

  // Reset per-contrast state when contrast changes
  useEffect(()=>{
    setActiveRunId(null); setSelPathway(null); setCurveData(null)
    curveCacheRef.current = {}
  },[contrastLabel])

  // Fetch preview when contrast changes
  useEffect(()=>{
    if(!session?.sessionId) return
    setHistData(null); setHistLoading(true)
    const ctrl=new AbortController()
    fetch('/api/gsea/preview',{ method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ sessionId:session.sessionId, contrastLabel }), signal:ctrl.signal })
      .then(r=>r.json())
      .then(d=>{ if(d.error) throw new Error(d.error); setHistData(d); setHistLoading(false) })
      .catch(e=>{ if(e.name!=='AbortError') setHistLoading(false) })
    return ()=>ctrl.abort()
  },[session, contrastLabel])

  // Derived cutoff
  const { cutoffOrig, cutoffLog, nAbove } = useMemo(()=>{
    if(!histData) return { cutoffOrig:0, cutoffLog:0, nAbove:0 }
    const orig = filterMethod==='quantile'
      ? (histData.quantileValues?.[Math.min(Math.round(filterValue*100),100)] ?? 0)
      : filterValue
    return {
      cutoffOrig: orig,
      cutoffLog:  Math.log1p(orig),
      nAbove:     genesAbove(histData.mediansSample, orig, histData.n_genes||0),
    }
  },[histData, filterMethod, filterValue])

  const countMax = histData?.quartiles?.q90 ?? 1000

  // Run GSEA
  const handleRun = useCallback(async()=>{
    if(!session?.sessionId) return
    runCtrlRef.current?.abort()
    const ctrl=new AbortController(); runCtrlRef.current=ctrl
    setRunning(true); setRunError(null)
    let tick=0; const timer=setInterval(()=>setElapsed(++tick),1000)
    try {
      const r=await fetch('/api/gsea/run',{ method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ sessionId:session.sessionId, contrastLabel, rankMethod,
          collection:collection.id, subcategory:collection.sub, species,
          minSize, maxSize, scoreType, nPerm, pAdjMethod, padjCutoff,
          filterMethod, filterValue, annMap:annMap||null }), signal:ctrl.signal })
      const data=await r.json()
      if(data.error) throw new Error(data.error)
      const rm=RANK_METHODS.find(m=>m.value===rankMethod)
      const newRun={ id:Date.now(), collectionLabel:collection.label, collectionKey:collection.key,
        collectionId:collection.id, collectionSub:collection.sub,
        rankMethod, rankShort:rm?.short??rankMethod, filterMethod, filterValue, species,
        scoreType, nPerm, pAdjMethod, padjCutoff,
        results:data.results, rankedList:data.rankedList, meta:data.meta,
        timestamp:new Date().toLocaleTimeString(), contrastLabel }
      setRuns(prev=>[...prev,newRun])
      setActiveRunId(newRun.id)
      setContentTab('results'); curveCacheRef.current={}
      setSelPathway(null); setCurveData(null)
    } catch(e){ if(e.name!=='AbortError') setRunError(e.message) }
    finally{ clearInterval(timer); setElapsed(0); setRunning(false) }
  },[session,contrastLabel,rankMethod,collection,species,minSize,maxSize,scoreType,nPerm,pAdjMethod,padjCutoff,filterMethod,filterValue,annMap])

  // Curve on pathway click
  const handlePathwayClick=useCallback(async(result)=>{
    setSelPathway(result); setCurveData(null)
    if(curveCacheRef.current[result.pathway]){ setCurveData(curveCacheRef.current[result.pathway]); return }
    setCurveLoading(true)
    try{
      const ar=activeRun
      const r=await fetch('/api/gsea/curve',{ method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ sessionId:session.sessionId, contrastLabel, pathway:result.pathway,
          collection:ar?.collectionId??collection.id, subcategory:ar?.collectionSub??collection.sub,
          species:ar?.species??species }) })
      const data=await r.json()
      if(data.error) throw new Error(data.error)
      curveCacheRef.current[result.pathway]=data; setCurveData(data)
    } catch{ setCurveData(null) } finally{ setCurveLoading(false) }
  },[session,contrastLabel,activeRun,collection,species])

  const removeRun=(id)=>{ setRuns(p=>p.filter(r=>r.id!==id)); if(activeRunId===id) setActiveRunId(null); setSelPathway(null); setCurveData(null) }

  if(!session?.sessionId) return <div style={{ padding:60, textAlign:'center', color:'var(--text-3)' }}>No session available.</div>

  return (
    <div data-accent="ocean" style={{ display:'flex', flexDirection:'column', gap:0 }}>

      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,rgba(14,116,144,0.12),rgba(8,145,178,0.04))`, border:`1px solid ${V.border}`, borderRadius:12, padding:'14px 20px', marginBottom:16, display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
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
      </div>

      <div style={{ display:'flex', gap:16, alignItems:'flex-start' }}>

        {/* ── SIDEBAR ─────────────────────────────────────────────────── */}
        <div style={{ width:292, flexShrink:0, display:'flex', flexDirection:'column', gap:14, background:V.card, borderRadius:12, padding:16, border:`1px solid ${V.border}`, position:'sticky', top:80, maxHeight:'calc(100vh - 120px)', overflowY:'auto' }}>

          {/* Rank method */}
          <div>
            <SectionLabel>Rank method</SectionLabel>
            <select value={rankMethod} onChange={e=>setRankMethod(e.target.value)}
              style={{ width:'100%', padding:'6px 10px', fontSize:'0.78rem', background:'rgba(255,255,255,0.05)', border:`1px solid ${V.border}`, borderRadius:7, color:'var(--text-1)' }}>
              {RANK_METHODS.map(m=><option key={m.value} value={m.value}>{m.label} — {m.hint}</option>)}
            </select>
          </div>

          {/* Pre-filter — compact, opens modal */}
          <div>
            <SectionLabel>Pre-filter genes</SectionLabel>
            <div style={{ display:'flex', gap:4, marginBottom:8 }}>
              {[['quantile','Quantile'],['count','Count']].map(([v,l])=>(
                <button key={v} onClick={()=>{ setFilterMethod(v); setFilterValue(v==='quantile'?0.25:10) }}
                  style={{ flex:1, padding:'4px 0', fontSize:'0.7rem', fontWeight:600, borderRadius:6, cursor:'pointer', border:'none', background:filterMethod===v?V.accent:'rgba(255,255,255,0.06)', color:filterMethod===v?'#fff':'var(--text-2)', transition:'all 0.12s' }}>{l}</button>
              ))}
            </div>

            {/* Compact slider */}
            {filterMethod==='quantile' ? (
              <div style={{ marginBottom:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.7rem', color:'var(--text-3)', marginBottom:4 }}>
                  <span>Remove bottom</span><span style={{ color:V.text, fontWeight:700 }}>{(filterValue*100).toFixed(0)}% · ≥{cutoffOrig.toFixed(1)}</span>
                </div>
                <input type="range" min={0} max={0.75} step={0.01} value={filterValue} onChange={e=>setFilterValue(+e.target.value)} style={{ width:'100%', accentColor:V.accent }} />
              </div>
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                <span style={{ fontSize:'0.7rem', color:'var(--text-3)', whiteSpace:'nowrap' }}>Min ≥</span>
                <input type="range" min={0} max={Math.max(countMax,100)} step={1} value={filterValue} onChange={e=>setFilterValue(+e.target.value)} style={{ flex:1, accentColor:V.accent }} />
                <span style={{ fontSize:'0.72rem', fontFamily:'monospace', color:V.text, minWidth:32 }}>{filterValue}</span>
              </div>
            )}

            {/* Stat + distribution button */}
            <div style={{ display:'flex', gap:6 }}>
              <div style={{ flex:1, display:'flex', justifyContent:'space-between', padding:'5px 8px', background:V.muted, borderRadius:6, fontSize:'0.7rem', border:`1px solid ${V.border}` }}>
                <span style={{ color:'var(--text-3)' }}>Passing</span>
                <span style={{ color:V.text, fontWeight:700 }}>~{nAbove.toLocaleString()}</span>
              </div>
              <button onClick={()=>setShowDistModal(true)} title="View per-sample count distributions"
                disabled={!histData}
                style={{ padding:'5px 10px', borderRadius:6, border:`1px solid ${V.border}`, background:V.muted, color:V.text, fontSize:'0.72rem', fontWeight:600, cursor:histData?'pointer':'default', opacity:histData?1:0.45, whiteSpace:'nowrap' }}>
                {histLoading ? '…' : '⎚ Distributions'}
              </button>
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
                    style={{ width:'100%', padding:'4px 8px', fontSize:'0.78rem', textAlign:'center', background:'rgba(255,255,255,0.05)', border:`1px solid ${V.border}`, borderRadius:7, color:'var(--text-1)' }} />
                </div>
              ))}
            </div>
          </div>

          {/* Species */}
          <div>
            <SectionLabel>Species</SectionLabel>
            <select value={species} onChange={e=>setSpecies(e.target.value)}
              style={{ width:'100%', padding:'6px 10px', fontSize:'0.78rem', background:'rgba(255,255,255,0.05)', border:`1px solid ${V.border}`, borderRadius:7, color:'var(--text-1)' }}>
              {SPECIES.map(s=><option key={s}>{s}</option>)}
            </select>
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
          <button onClick={handleRun} disabled={running}
            style={{ padding:'11px 0', borderRadius:10, border:'none', cursor:running?'wait':'pointer', background:running?`rgba(14,116,144,0.35)`:`linear-gradient(135deg,${V.accent},${V.accent2})`, color:'#fff', fontWeight:700, fontSize:'0.88rem', boxShadow:running?'none':`0 4px 16px rgba(14,116,144,0.45)`, transition:'all 0.15s', marginTop:4 }}>
            {running?`Running… ${elapsed}s`:contrastRuns.length?'↺ New Run':'▶ Run GSEA'}
          </button>
          {runError && <div style={{ padding:'8px 12px', borderRadius:8, fontSize:'0.75rem', background:'rgba(248,113,113,0.08)', color:'#f87171', border:'1px solid rgba(248,113,113,0.2)', lineHeight:1.5 }}>⚠ {runError}</div>}
          {!annMap && <div style={{ padding:'7px 10px', borderRadius:8, fontSize:'0.68rem', background:'rgba(251,191,36,0.07)', color:'#fbbf24', border:'1px solid rgba(251,191,36,0.18)', lineHeight:1.5 }}>⚠ No annotation loaded — run <b>Annotate</b> first for best gene ID matching.</div>}
        </div>

        {/* ── RIGHT CONTENT ──────────────────────────────────────────────── */}
        <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:12 }}>
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
              <RunChips runs={contrastRuns} activeRunId={activeRunId} onSelect={id=>{ setActiveRunId(id); setSelPathway(null); setCurveData(null) }} onRemove={removeRun} />
              <div style={{ display:'flex', gap:2, borderBottom:`1px solid ${V.border}` }}>
                {[
                  ['results', `◉ Pathways${activeRun?.results?.length?` (${activeRun.results.length})`:''}`],
                  ['ranked',  `≡ Ranked List${activeRun?.rankedList?.length?` (${activeRun.rankedList.length.toLocaleString()})`:''}`],
                  ['plots',   '◈ Plots'],
                ].map(([k,l])=>(
                  <button key={k} onClick={()=>setContentTab(k)}
                    style={{ padding:'6px 14px', border:'none', borderRadius:'6px 6px 0 0', cursor:'pointer', fontSize:'0.8rem', fontWeight:contentTab===k?700:400, background:contentTab===k?V.muted:'transparent', color:contentTab===k?'var(--text-1)':'var(--text-3)', borderBottom:`2px solid ${contentTab===k?V.accent:'transparent'}`, transition:'all 0.12s' }}>{l}</button>
                ))}
              </div>
              <div style={{ paddingTop:4 }}>
                {contentTab==='results' && <ResultsTable run={activeRun} onPathwayClick={handlePathwayClick} selectedPathway={selPathway?.pathway} />}
                {contentTab==='ranked'  && <RankedListPanel run={activeRun} />}
                {contentTab==='plots'   && <PlotsPanel run={activeRun} session={session} contrastLabel={contrastLabel} />}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Distribution modal */}
      {showDistModal && (
        <DistributionModal
          histData={histData} cutoffLog={cutoffLog} cutoffOrig={cutoffOrig}
          filterMethod={filterMethod} filterValue={filterValue}
          setFilterValue={setFilterValue} setFilterMethod={setFilterMethod}
          nAbove={nAbove} countMax={countMax}
          onClose={()=>setShowDistModal(false)}
        />
      )}

      {/* Mountain plot modal */}
      {selPathway && (
        <MountainModal pathway={selPathway.pathway} result={selPathway} curveData={curveData} curveLoading={curveLoading} onClose={()=>{ setSelPathway(null); setCurveData(null) }} />
      )}

      <style>{`@keyframes gsea-spin { to { transform:rotate(360deg); } }`}</style>
    </div>
  )
}
