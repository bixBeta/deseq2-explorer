import { useState, useEffect, useRef } from 'react'
import { useDownloadDialog } from './DownloadDialog'
import methodsMd from '../methods.md?raw'
import deseq2LogoRaw from '../assets/deseq2-applogo.svg?raw'
import trexLogoRaw   from '../assets/trex-applogo.svg?raw'

const svgToDataUri = (raw) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(raw)))}`

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
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function inlineHtml(text) {
  // Escape HTML first, then apply markdown inline syntax
  return escHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#0b446f">$1</a>')
}

function mdToHtml(md) {
  const lines = md.split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block — extracted BEFORE any inline processing
    if (line.startsWith('```')) {
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++ }
      i++ // skip closing ```
      out.push(`<div class="code-block"><button class="copy-btn" onclick="copyCode(this)">Copy</button><pre><code>${escHtml(codeLines.join('\n'))}</code></pre></div>`)
      continue
    }

    // Pipe table
    if (line.startsWith('|') && lines[i + 1]?.startsWith('|---')) {
      const headers = line.split('|').map(s => s.trim()).filter(Boolean)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(lines[i].split('|').map(s => s.trim()).filter(Boolean)); i++
      }
      out.push(
        `<div style="overflow-x:auto;margin:1rem 0 1.5rem">` +
        `<table style="width:auto;min-width:100%"><thead><tr>${headers.map(h => `<th style="white-space:nowrap">${inlineHtml(h)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map(row => `<tr>${row.map(c => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      )
      continue
    }

    // HR
    if (line.trim() === '---') { out.push('<hr>'); i++; continue }

    // Headings (longest prefix first) — id attributes match TOC anchor hrefs
    const slug = t => t.toLowerCase().replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'-')
    if (line.startsWith('#### ')) { const t=line.slice(5); out.push(`<h4 id="${slug(t)}">${inlineHtml(t)}</h4>`); i++; continue }
    if (line.startsWith('### '))  { const t=line.slice(4); out.push(`<h3 id="${slug(t)}">${inlineHtml(t)}</h3>`); i++; continue }
    if (line.startsWith('## '))   {
      const t = line.slice(3)
      // Suppress inline Table of Contents — rendered as sidebar instead
      if (t.trim() === 'Table of Contents') {
        i++
        while (i < lines.length && (lines[i].match(/^- \[/) || lines[i].trim() === '')) i++
        continue
      }
      out.push(`<h2 id="${slug(t)}">${inlineHtml(t)}</h2>`); i++; continue
    }
    if (line.startsWith('# '))    { const t=line.slice(2); out.push(`<h1 id="${slug(t)}">${inlineHtml(t)}</h1>`); i++; continue }

    // TOC / anchor list items: - [Text](#anchor)
    if (line.match(/^- \[/)) {
      const items = []
      while (i < lines.length && lines[i].match(/^- \[/)) {
        const m = lines[i].match(/^- \[([^\]]+)\]\(([^)]+)\)/)
        items.push(m ? `<li><a href="${m[2]}" style="color:#0b446f">${escHtml(m[1])}</a></li>`
                     : `<li>${inlineHtml(lines[i].slice(2))}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    // Bullet list
    if (line.match(/^[-*] /)) {
      const items = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(`<li>${inlineHtml(lines[i].slice(2))}</li>`); i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    // Empty line
    if (line.trim() === '') { i++; continue }

    // Paragraph — collect consecutive non-special lines
    const paraLines = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('|') &&
      lines[i].trim() !== '---' &&
      !lines[i].match(/^[-*] /)
    ) { paraLines.push(lines[i]); i++ }
    if (paraLines.length) out.push(`<p>${inlineHtml(paraLines.join(' '))}</p>`)
  }

  return out.join('\n')
}

function buildHtmlExport(md, sessionRows, contrasts, gseaRuns, alpha) {
  const eff_alpha = alpha ?? 0.05

  const sessionHtml = sessionRows?.some(([,v]) => v != null) ? `
<section>
  <h2>Session Parameters</h2>
  <table>
    <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
    <tbody>${sessionRows.filter(([,v]) => v != null).map(([k,v]) =>
      `<tr><td>${escHtml(k)}</td><td><code>${escHtml(String(v))}</code></td></tr>`).join('')}
    </tbody>
  </table>
</section>` : ''

  const contrastsHtml = contrasts?.length ? `
<section>
  <h2>DESeq2 Contrasts</h2>
  <table>
    <thead><tr><th>Contrast</th><th>Treatment</th><th>Reference</th><th>Genes tested</th><th>Sig. (padj&lt;α)</th><th>Up</th><th>Down</th></tr></thead>
    <tbody>${contrasts.map(ct => {
      const genes = ct.results ?? []
      const sig   = genes.filter(g => g.padj != null && g.padj < eff_alpha)
      const up    = sig.filter(g => g.log2FC > 0).length
      const dn    = sig.length - up
      return `<tr><td><code>${escHtml(ct.label ?? '')}</code></td>` +
             `<td>${escHtml(ct.treatment ?? '—')}</td><td>${escHtml(ct.reference ?? '—')}</td>` +
             `<td>${genes.length.toLocaleString()}</td>` +
             `<td>${sig.length.toLocaleString()}</td><td style="color:#059669">↑ ${up.toLocaleString()}</td>` +
             `<td style="color:#dc2626">↓ ${dn.toLocaleString()}</td></tr>`
    }).join('')}
    </tbody>
  </table>
</section>` : ''

  const RANK_LABELS_EXP = { log2FC:'LFC', stat:'Wald stat', shrunkLFC:'Shrunk LFC', signedNegLog10p:'−log10p' }

  const gseaHtml = gseaRuns?.length ? `
<section>
  <h2>GSEA Runs (${gseaRuns.length})</h2>
  <div style="overflow-x:auto">
  <table style="width:auto;min-width:100%;white-space:nowrap">
    <thead><tr><th>Contrast</th><th>Collection</th><th>Rank by</th><th>padj method</th><th>padj cutoff</th><th>Min baseMean</th><th>Gene set size</th><th>Species</th><th>Pathways</th></tr></thead>
    <tbody>${gseaRuns.map(r => {
      const p = r.params ?? r
      return `<tr><td><code>${escHtml(r.contrastLabel ?? '')}</code></td>` +
        `<td>${escHtml(r.collectionLabel ?? '')}${r.collectionSub ? ` / ${escHtml(r.collectionSub)}` : ''}</td>` +
        `<td>${escHtml(RANK_LABELS_EXP[p.rankMethod] ?? p.rankMethod ?? '')}</td>` +
        `<td>${escHtml(p.pAdjMethod ?? '')}</td>` +
        `<td>${escHtml(String(p.padjCutoff ?? ''))}</td>` +
        `<td>${escHtml(String(p.filterValue ?? ''))}</td>` +
        `<td>${escHtml(String(p.minSize ?? ''))}–${escHtml(String(p.maxSize ?? ''))}</td>` +
        `<td>${escHtml(p.species ?? '')}</td>` +
        `<td>${r.meta?.n_pathways ?? '—'}</td></tr>`
    }).join('')}
    </tbody>
  </table>
  </div>
</section>` : ''

  const hasParams = sessionHtml || contrastsHtml || gseaHtml

  // Extract TOC entries from markdown for the sidebar
  const tocItems = md.split('\n')
    .filter(l => l.match(/^- \[/))
    .map(l => { const m = l.match(/^- \[([^\]]+)\]\(([^)]+)\)/); return m ? { text: m[1], href: m[2] } : null })
    .filter(Boolean)

  const tocSidebarHtml = tocItems.length ? `
<nav class="toc-sidebar" id="toc-sidebar">
  <div class="toc-title">On this page</div>
  <ul>
    ${tocItems.map(item => `<li><a href="${item.href}" class="toc-link">${escHtml(item.text)}</a></li>`).join('\n    ')}
  </ul>
</nav>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DESeq2 ExploreR — Methods Report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; color: #1e293b; line-height: 1.65; background: #fff; }
  .page-wrap { display: flex; max-width: 1180px; margin: 0 auto; padding: 40px 24px; gap: 0; align-items: flex-start; }
  .main-content { flex: 1; min-width: 0; max-width: 860px; padding-left: 48px; }
  h1 { color: #0b446f; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
  h2 { color: #0b446f; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-top: 2rem; }
  h3 { color: #334155; margin-top: 1.5rem; }
  h4 { color: #475569; margin-top: 1rem; }
  a { color: #0b446f; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 0.85em; font-family: 'JetBrains Mono', 'Fira Code', monospace; color: #0b446f; }
  pre { background: #1e293b; color: #e2e8f0; padding: 16px 20px; border-radius: 8px; overflow-x: auto; margin: 0.6rem 0 1.2rem; }
  pre code { background: none; color: inherit; font-size: 0.82rem; padding: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  th { background: #f1f5f9; padding: 8px 12px; text-align: left; border-bottom: 2px solid #cbd5e1; color: #0b446f; }
  td { padding: 6px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 2rem 0; }
  ul { padding-left: 1.5rem; }
  li { margin-bottom: 0.3rem; }
  p { margin: 0 0 0.8rem; }
  .generated { font-size: 0.75rem; color: #94a3b8; margin-top: 3rem; border-top: 1px solid #e2e8f0; padding-top: 1rem; }
  .doc-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; margin-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
  .doc-header-text h1 { border-bottom: none; padding-bottom: 0; margin: 0 0 2px; font-size: 1.5rem; }
  .doc-header-text p { margin: 0; font-size: 0.82rem; color: #64748b; }
  .doc-logo { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .code-block { position: relative; margin: 0.6rem 0 1.2rem; }
  .code-block pre { margin: 0; border-radius: 8px; }
  .copy-btn { position: absolute; top: 8px; right: 10px; padding: 3px 10px; font-size: 0.72rem; font-family: inherit; font-weight: 600; color: #94a3b8; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; cursor: pointer; transition: all 0.15s; z-index: 1; }
  .copy-btn:hover { background: rgba(255,255,255,0.14); color: #e2e8f0; }
  .copy-btn.copied { color: #34d399; border-color: rgba(52,211,153,0.4); background: rgba(52,211,153,0.1); }
  /* TOC sidebar */
  .toc-sidebar { width: 220px; flex-shrink: 0; position: sticky; top: 32px; max-height: calc(100vh - 64px); overflow-y: auto; padding-right: 16px; border-right: 1px solid #e2e8f0; order: -1; }
  .toc-title { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #94a3b8; margin-bottom: 10px; padding-left: 8px; }
  .toc-sidebar ul { list-style: none; padding: 0; margin: 0; }
  .toc-sidebar li { margin-bottom: 1px; }
  .toc-link { font-size: 0.78rem; color: #64748b; text-decoration: none; display: block; padding: 4px 8px; border-radius: 4px; border-left: 2px solid transparent; margin-left: -2px; line-height: 1.4; transition: color 0.12s, background 0.12s; }
  .toc-link:hover { color: #0b446f; background: #f1f5f9; }
  .toc-link.active { color: #0b446f; border-left-color: #0b446f; background: #eff6ff; font-weight: 600; }
  @media (max-width: 820px) { .toc-sidebar { display: none; } .main-content { padding-left: 0; } }
</style>
</head>
<body>
<div class="page-wrap">
  <div class="main-content">
    <div class="doc-header">
      <div class="doc-header-text">
        <h1>DESeq2 ExploreR</h1>
        <p>Methods &amp; Session Report — ${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}</p>
      </div>
      <div class="doc-logo" style="display:flex;align-items:center;gap:6px;">
        <img src="${svgToDataUri(deseq2LogoRaw)}" width="50" height="50" style="border-radius:12px;" alt="DESeq2 ExploreR"/>
        <img src="${svgToDataUri(trexLogoRaw)}"   width="50" height="50" style="border-radius:12px;" alt="TREx"/>
      </div>
    </div>
    ${hasParams ? `${sessionHtml}${contrastsHtml}${gseaHtml}<hr>` : ''}
    ${mdToHtml(md)}
    <p class="generated">Generated by DESeq2 ExploreR</p>
  </div>
  ${tocSidebarHtml}
</div>
<script>
function copyCode(btn) {
  var code = btn.nextElementSibling.querySelector('code').innerText;
  navigator.clipboard.writeText(code).then(function() {
    btn.textContent = 'Copied!'; btn.classList.add('copied');
    setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  }).catch(function() {
    btn.textContent = 'Failed';
    setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
  });
}
// Scroll spy — highlight active TOC link
(function() {
  var links = document.querySelectorAll('.toc-link');
  if (!links.length) return;
  var headings = Array.from(links).map(function(a) {
    return document.getElementById(a.getAttribute('href').slice(1));
  }).filter(Boolean);
  function onScroll() {
    var scrollY = window.scrollY + 80;
    var active = headings[0];
    for (var i = 0; i < headings.length; i++) {
      if (headings[i].getBoundingClientRect().top + window.scrollY <= scrollY) active = headings[i];
    }
    links.forEach(function(a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + active.id);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
</script>
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
  const { promptDownload, dialog } = useDownloadDialog()
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
    ['Pre-filter min count',    params.minCount ?? 1],
    ['Pre-filter min samples',  params.minSamples ?? 2],
    ['Ind. filtering',    String(params.independentFiltering ?? true)],
    ['Cooks cutoff',      String(params.cooksCutoff ?? true)],
    ['Contrasts run',     contrasts.length || undefined],
  ]

  function handleExport() {
    const html = buildHtmlExport(methodsMd, sessionRows, contrasts, gseaRuns, alpha)
    const blob = new Blob([html], { type: 'text/html' })
    const url  = URL.createObjectURL(blob)
    promptDownload('deseq2-explorer-methods.html', name => {
      const a = Object.assign(document.createElement('a'), { href: url, download: name })
      a.click(); URL.revokeObjectURL(url)
    })
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
            {dialog}
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
                            {['Contrast','Treatment','Reference','Genes tested','Sig. (padj<α)','Up','Down'].map(h=>(
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
                                <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{ct.treatment ?? '—'}</td>
                                <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{ct.reference ?? '—'}</td>
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
                            {['Contrast','Collection','Rank by','padj method','padj cutoff','Min baseMean','Gene set size','Species','Pathways','Time'].map(h=>(
                              <th key={h} style={{ padding:'6px 10px', textAlign:'left', color:'var(--accent)',
                                fontWeight:600, borderBottom:'2px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {gseaRuns.map((r, i) => {
                            const p = r.params ?? r
                            const RANK_LABELS = { log2FC:'LFC', stat:'Wald stat', shrunkLFC:'Shrunk LFC', signedNegLog10p:'−log₁₀p' }
                            return (
                              <tr key={r.id} style={{ background: i%2===0?'transparent':'rgba(255,255,255,0.02)',
                                borderBottom:'1px solid var(--border)' }}>
                                <td style={{ padding:'5px 10px', fontSize:'0.73rem', color:'var(--text-1)', fontFamily:'monospace' }}>{r.contrastLabel}</td>
                                <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{r.collectionLabel}{r.collectionSub ? ` / ${r.collectionSub}` : ''}</td>
                                <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{RANK_LABELS[p.rankMethod] ?? p.rankMethod}</td>
                                <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{p.pAdjMethod}</td>
                                <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{p.padjCutoff}</td>
                                <td style={{ padding:'5px 10px', color:'var(--text-2)', whiteSpace:'nowrap' }}>{p.filterValue ?? '—'}</td>
                                <td style={{ padding:'5px 10px', color:'var(--text-2)', whiteSpace:'nowrap' }}>{p.minSize}–{p.maxSize}</td>
                                <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{p.species}</td>
                                <td style={{ padding:'5px 10px', color:'var(--text-2)' }}>{r.meta?.n_pathways ?? '—'}</td>
                                <td style={{ padding:'5px 10px', color:'var(--text-3)', fontSize:'0.71rem' }}>{r.timestamp}</td>
                              </tr>
                            )
                          })}
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
