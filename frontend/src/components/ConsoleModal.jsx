import { useState, useEffect, useRef } from 'react'
import methodsMd from '../../public/methods.md?raw'

// ── Simple markdown → JSX renderer ───────────────────────────────────────────
function renderMd(md) {
  const lines = md.split('\n')
  const out = []
  let i = 0
  const key = () => i

  while (i < lines.length) {
    const line = lines[i]

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]); i++
      }
      out.push(
        <pre key={key()} style={{ background:'#1e2430', borderRadius:8, padding:'12px 16px',
          overflowX:'auto', margin:'0.6rem 0 1rem', border:'1px solid rgba(255,255,255,0.08)' }}>
          <code style={{ fontSize:'0.75rem', fontFamily:'monospace', color:'#e2e8f0', lineHeight:1.7 }}>
            {codeLines.join('\n')}
          </code>
        </pre>
      )
      i++; continue
    }

    // Table
    if (line.startsWith('|') && i + 1 < lines.length && lines[i+1].startsWith('|---')) {
      const headers = line.split('|').map(s=>s.trim()).filter(Boolean)
      i += 2 // skip header + separator
      const rows = []
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(lines[i].split('|').map(s=>s.trim()).filter(Boolean)); i++
      }
      out.push(
        <table key={key()} style={{ width:'100%', borderCollapse:'collapse', margin:'0.5rem 0 1rem', fontSize:'0.78rem' }}>
          <thead>
            <tr>{headers.map((h,j)=>(
              <th key={j} style={{ padding:'6px 10px', textAlign:'left', background:'rgba(var(--accent-rgb),0.1)',
                color:'var(--accent)', borderBottom:'2px solid var(--border)', fontWeight:600 }}>
                {inlineRender(h)}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((row,ri)=>(
              <tr key={ri} style={{ background: ri%2===0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                {row.map((cell,ci)=>(
                  <td key={ci} style={{ padding:'5px 10px', color:'var(--text-2)',
                    borderBottom:'1px solid var(--border)', verticalAlign:'top' }}>
                    {inlineRender(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
      continue
    }

    // HR
    if (line.startsWith('---') && line.trim() === '---') {
      out.push(<hr key={key()} style={{ border:'none', borderTop:'1px solid var(--border)', margin:'1.5rem 0' }} />)
      i++; continue
    }

    // H1
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      out.push(<h1 key={key()} style={{ fontSize:'1.4rem', fontWeight:800, color:'var(--accent)', marginBottom:'0.5rem', marginTop:'0.5rem' }}>{inlineRender(line.slice(2))}</h1>)
      i++; continue
    }

    // H2
    if (line.startsWith('## ') && !line.startsWith('### ')) {
      out.push(<h2 key={key()} style={{ fontSize:'1.05rem', fontWeight:700, color:'var(--accent)',
        margin:'1.5rem 0 0.5rem', paddingBottom:'4px', borderBottom:'1px solid var(--border)' }}>
        {inlineRender(line.slice(3))}
      </h2>)
      i++; continue
    }

    // H3
    if (line.startsWith('### ')) {
      out.push(<h3 key={key()} style={{ fontSize:'0.88rem', fontWeight:700, color:'var(--text-1)', margin:'1rem 0 0.3rem' }}>
        {inlineRender(line.slice(4))}
      </h3>)
      i++; continue
    }

    // H4
    if (line.startsWith('#### ')) {
      out.push(<h4 key={key()} style={{ fontSize:'0.82rem', fontWeight:600, color:'var(--text-1)', margin:'0.8rem 0 0.2rem' }}>
        {inlineRender(line.slice(5))}
      </h4>)
      i++; continue
    }

    // Bullet list
    if (line.match(/^[-*] /)) {
      const items = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(lines[i].slice(2)); i++
      }
      out.push(
        <ul key={key()} style={{ margin:'0.2rem 0 0.8rem', paddingLeft:'1.4rem' }}>
          {items.map((item,j)=>(
            <li key={j} style={{ fontSize:'0.82rem', color:'var(--text-2)', lineHeight:1.65, marginBottom:'0.2rem' }}>
              {inlineRender(item)}
            </li>
          ))}
        </ul>
      )
      continue
    }

    // Empty line
    if (line.trim() === '') { i++; continue }

    // TOC links (skip)
    if (line.startsWith('- [')) { i++; continue }

    // Paragraph
    const paraLines = []
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('#')
      && !lines[i].startsWith('```') && !lines[i].startsWith('|') && !lines[i].startsWith('---')
      && !lines[i].match(/^[-*] /)) {
      paraLines.push(lines[i]); i++
    }
    if (paraLines.length) {
      out.push(
        <p key={key()} style={{ fontSize:'0.82rem', color:'var(--text-2)', lineHeight:1.7, margin:'0 0 0.7rem' }}>
          {inlineRender(paraLines.join(' '))}
        </p>
      )
    }
  }
  return out
}

function inlineRender(text) {
  // Split on bold, italic, inline code, links
  const parts = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\([^)]+\))/g
  let last = 0, m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('`')) {
      parts.push(<code key={m.index} style={{ fontSize:'0.72rem', padding:'1px 5px', borderRadius:3,
        background:'rgba(var(--accent-rgb),0.12)', color:'var(--accent)', fontFamily:'monospace' }}>
        {token.slice(1,-1)}
      </code>)
    } else if (token.startsWith('**')) {
      parts.push(<strong key={m.index} style={{ color:'var(--text-1)', fontWeight:600 }}>{token.slice(2,-2)}</strong>)
    } else if (token.startsWith('*')) {
      parts.push(<em key={m.index}>{token.slice(1,-1)}</em>)
    } else if (token.startsWith('[')) {
      parts.push(<span key={m.index} style={{ color:'var(--accent)', textDecoration:'underline' }}>{m[2]}</span>)
    }
    last = m.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts
}

// ── HTML export ───────────────────────────────────────────────────────────────
function mdToHtml(md) {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/```[a-z]*\n([\s\S]*?)```/gm, (_, code) =>
      `<pre><code>${code.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code></pre>`)
    .split('\n\n')
    .map(block => block.trim().startsWith('<') ? block : `<p>${block}</p>`)
    .join('\n')
}

function buildHtmlExport(md, sessionParams) {
  const paramsHtml = sessionParams ? `
  <section>
    <h2>Session Parameters</h2>
    <table>
      <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
      <tbody>
        ${sessionParams.map(([k,v]) => `<tr><td>${k}</td><td><code>${v ?? '—'}</code></td></tr>`).join('')}
      </tbody>
    </table>
  </section>
  <hr>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DESeq2 ExploreR — Methods Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 860px; margin: 40px auto; padding: 0 24px; color: #1e293b; line-height: 1.65; }
  h1 { color: #0e7490; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
  h2 { color: #0e7490; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-top: 2rem; }
  h3 { color: #334155; margin-top: 1.5rem; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 0.85em; font-family: 'JetBrains Mono', monospace; color: #0e7490; }
  pre { background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; color: inherit; font-size: 0.82rem; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.88rem; }
  th { background: #f1f5f9; padding: 8px 12px; text-align: left; border-bottom: 2px solid #cbd5e1; color: #0e7490; }
  td { padding: 6px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 2rem 0; }
  ul { padding-left: 1.5rem; }
  li { margin-bottom: 0.25rem; }
  .generated { font-size: 0.75rem; color: #94a3b8; margin-top: 3rem; border-top: 1px solid #e2e8f0; padding-top: 1rem; }
</style>
</head>
<body>
${paramsHtml}
${mdToHtml(md)}
<p class="generated">Generated by DESeq2 ExploreR — ${new Date().toLocaleString()}</p>
</body>
</html>`
}

// ── Section heading helper ────────────────────────────────────────────────────
function SH({ children }) {
  return (
    <h2 style={{ fontSize:'0.88rem', fontWeight:700, color:'var(--accent)',
      margin:'1.5rem 0 0.6rem', paddingBottom:5, borderBottom:'1px solid var(--border)' }}>
      {children}
    </h2>
  )
}

function ParamTable({ rows }) {
  return (
    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.79rem', marginBottom:'0.5rem' }}>
      <tbody>
        {rows.map(([k,v]) => v !== undefined && (
          <tr key={k} style={{ borderBottom:'1px solid var(--border)' }}>
            <td style={{ padding:'6px 12px', color:'var(--text-3)', width:'45%', fontWeight:500 }}>{k}</td>
            <td style={{ padding:'6px 12px', color:'var(--text-1)', fontFamily:'monospace', fontSize:'0.74rem' }}>
              {String(v ?? '—')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Main ConsoleModal ─────────────────────────────────────────────────────────
export default function ConsoleModal({ onClose, session, design, results, parseInfo, gseaRuns }) {
  const [tab, setTab] = useState('methods')
  const scrollRef = useRef(null)

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // Derived values with correct data shapes
  const contrasts   = results?.contrasts ?? []
  const params      = design?.params ?? {}
  const nSamples    = parseInfo?.metadataRows?.length
  const nGenes      = contrasts[0]?.results?.length
  const alpha       = params.alpha ?? 0.05

  const sessionRows = [
    ['Session ID',        session?.sessionId],
    ['Email',             session?.email],
    ['Genes tested',      nGenes != null ? nGenes.toLocaleString() : undefined],
    ['Samples',           nSamples != null ? nSamples : undefined],
    ['Design column',     design?.column],
    ['Fit type',          params.fitType ?? 'parametric'],
    ['Alpha (FDR)',        alpha],
    ['LFC threshold',     params.lfcThreshold ?? 0],
    ['Ind. filtering',    String(params.independentFiltering ?? true)],
    ['Cooks cutoff',      String(params.cooksCutoff ?? true)],
    ['Contrasts run',     contrasts.length || undefined],
  ]

  function handleExport() {
    const html = buildHtmlExport(methodsMd, sessionRows)
    const blob = new Blob([html], { type: 'text/html' })
    const a    = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: 'deseq2-explorer-methods.html'
    })
    a.click(); URL.revokeObjectURL(a.href)
  }

  const TABS = [
    { id: 'methods', label: '📄 Methods & Code' },
    { id: 'params',  label: '⚙ Session Params'  },
  ]

  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, zIndex:900, background:'rgba(0,0,0,0.6)',
        backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width:'min(860px, 95vw)', height:'min(88vh, 820px)', borderRadius:14,
          background:'var(--bg-panel)', border:'1px solid var(--border)',
          boxShadow:'0 24px 80px rgba(0,0,0,0.5)', display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'12px 18px', borderBottom:'1px solid var(--border)',
          background:'rgba(var(--accent-rgb),0.04)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:'1rem', fontFamily:'monospace', color:'var(--accent)', fontWeight:700 }}>{'> _'}</span>
            <span style={{ fontSize:'0.9rem', fontWeight:700, color:'var(--text-1)' }}>Console</span>
            <span style={{ fontSize:'0.7rem', color:'var(--text-3)', background:'rgba(var(--accent-rgb),0.1)',
              border:'1px solid var(--border)', borderRadius:10, padding:'1px 8px' }}>
              DESeq2 ExploreR
            </span>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={handleExport}
              style={{ fontSize:'0.72rem', padding:'4px 12px', borderRadius:6,
                border:'1px solid var(--border)', background:'rgba(var(--accent-rgb),0.1)',
                color:'var(--accent)', cursor:'pointer', fontWeight:600 }}>
              ↓ Export HTML
            </button>
            <button onClick={onClose}
              style={{ width:28, height:28, borderRadius:6, border:'1px solid var(--border)',
                background:'rgba(255,255,255,0.05)', color:'var(--text-2)', cursor:'pointer', fontSize:'0.9rem' }}>
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', flexShrink:0,
          padding:'0 18px', background:'rgba(0,0,0,0.05)' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding:'8px 14px', fontSize:'0.76rem', fontWeight: tab===t.id ? 700 : 400,
                color: tab===t.id ? 'var(--accent)' : 'var(--text-3)',
                background:'none', border:'none', cursor:'pointer',
                borderBottom: tab===t.id ? '2px solid var(--accent)' : '2px solid transparent',
                transition:'all 0.12s' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div ref={scrollRef} style={{ flex:1, overflowY:'auto', padding:'20px 28px' }}>
          {tab === 'methods' && <div>{renderMd(methodsMd)}</div>}

          {tab === 'params' && (
            <div>
              {!session ? (
                <p style={{ color:'var(--text-3)', fontSize:'0.82rem', padding:'2rem 0' }}>
                  No active session — load data to see parameters.
                </p>
              ) : (
                <>
                  <SH>Session</SH>
                  <ParamTable rows={sessionRows} />

                  {contrasts.length > 0 && (
                    <>
                      <SH>DESeq2 Contrasts</SH>
                      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.79rem' }}>
                        <thead>
                          <tr style={{ background:'rgba(var(--accent-rgb),0.07)' }}>
                            {['Contrast','Genes tested','Sig. (padj<α)','Up','Down'].map(h=>(
                              <th key={h} style={{ padding:'6px 10px', textAlign:'left', color:'var(--accent)',
                                fontWeight:600, borderBottom:'2px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {contrasts.map((ct, i) => {
                            const genes = ct.results ?? []
                            const sig   = genes.filter(g => g.padj != null && g.padj < alpha)
                            const up    = sig.filter(g => g.log2FC > 0).length
                            const dn    = sig.length - up
                            return (
                              <tr key={ct.label ?? i} style={{ background: i%2===0?'transparent':'rgba(255,255,255,0.02)',
                                borderBottom:'1px solid var(--border)' }}>
                                <td style={{ padding:'5px 10px', fontFamily:'monospace', fontSize:'0.73rem', color:'var(--text-1)' }}>{ct.label}</td>
                                <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{genes.length.toLocaleString()}</td>
                                <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{sig.length.toLocaleString()}</td>
                                <td style={{ padding:'5px 10px', color:'#10b981' }}>↑ {up.toLocaleString()}</td>
                                <td style={{ padding:'5px 10px', color:'#f43f5e' }}>↓ {dn.toLocaleString()}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </>
                  )}

                  {gseaRuns?.length > 0 && (
                    <>
                      <SH>GSEA Runs ({gseaRuns.length})</SH>
                      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.79rem' }}>
                        <thead>
                          <tr style={{ background:'rgba(var(--accent-rgb),0.07)' }}>
                            {['Contrast','Collection','Rank method','padj method','padj cutoff','Pathways','Time'].map(h=>(
                              <th key={h} style={{ padding:'6px 10px', textAlign:'left', color:'var(--accent)',
                                fontWeight:600, borderBottom:'2px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {gseaRuns.map((r, i) => (
                            <tr key={r.id} style={{ background: i%2===0?'transparent':'rgba(255,255,255,0.02)',
                              borderBottom:'1px solid var(--border)' }}>
                              <td style={{ padding:'5px 10px', fontSize:'0.73rem', color:'var(--text-1)', fontFamily:'monospace' }}>{r.contrastLabel}</td>
                              <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{r.collectionLabel}{r.collectionSub ? ` / ${r.collectionSub}` : ''}</td>
                              <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{r.rankMethod}</td>
                              <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{r.pAdjMethod}</td>
                              <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{r.padjCutoff}</td>
                              <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{r.meta?.n_pathways ?? '—'}</td>
                              <td style={{ padding:'5px 10px', color:'var(--text-3)', fontSize:'0.71rem' }}>{r.timestamp}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
