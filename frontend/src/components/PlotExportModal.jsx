import { useState, useEffect, useCallback } from 'react'
import Plotly from 'plotly.js-dist-min'
import { usePlotRegistry } from '../context/PlotRegistryContext'
import { useDownloadDialog } from './DownloadDialog'
import deseq2LogoRaw from '../assets/deseq2-applogo.svg?raw'

// ── Known plots (no heatmap) ──────────────────────────────────────────────────
const KNOWN_PLOTS = [
  { id: 'counts-plot', label: 'Counts Distribution',          group: 'Distributions',          src: 'registry' },
  { id: 'ma-plots',    label: 'MA Plots (all contrasts)',     group: 'Differential Expression', src: 'api'      },
  { id: 'pca-scatter', label: 'PCA Scatter (interactive)',    group: 'PCA',                     src: 'pca'      },
  { id: 'pca-scree',   label: 'PCA Scree',                   group: 'PCA',                     src: 'scree'    },
]

// ── Off-screen Plotly render → PNG data URI ───────────────────────────────────
async function renderToPng(traces, layout, width = 900, height = 520) {
  const div = document.createElement('div')
  div.style.cssText = `position:fixed;left:-9999px;top:-9999px;width:${width}px;height:${height}px;`
  document.body.appendChild(div)
  try {
    await Plotly.react(div, traces, layout, { responsive: false, displaylogo: false, staticPlot: true })
    return await Plotly.toImage(div, { format: 'png', width, height })
  } finally {
    document.body.removeChild(div)
  }
}

// ── Light-theme layout base ───────────────────────────────────────────────────
const LIGHT = {
  paper_bgcolor: '#ffffff',
  plot_bgcolor:  '#f8fafc',
  font: { color: '#1e293b', family: 'Inter, system-ui, sans-serif' },
  grid: '#e2e8f0',
  zero: '#94a3b8',
}

// ── Fetch + render one MA plot → PNG data URI ─────────────────────────────────
async function fetchAndRenderMA(sessionId, contrastLabel) {
  const r = await fetch('/api/maplot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, label: contrastLabel }),
  })
  const data = await r.json()
  if (data.error || !data.points) return null

  const pts = data.points
  const groups = { up: [], down: [], ns: [] }
  for (const p of pts) {
    let g = 'ns'
    if (p.padj != null && p.padj < 0.05 && p.log2FC != null) {
      if      (p.log2FC >=  1) g = 'up'
      else if (p.log2FC <= -1) g = 'down'
    }
    groups[g].push(p)
  }

  const mkTrace = (arr, color, name, opacity) => ({
    x: arr.map(p => Math.log10((p.baseMean ?? 0) + 1)),
    y: arr.map(p => p.log2FC ?? 0),
    text: arr.map(p => p.gene || p.geneId || ''),
    mode: 'markers',
    type: 'scatter',
    name,
    marker: { color, size: 4, opacity },
    hovertemplate: '<b>%{text}</b><br>log₂FC: %{y:.2f}<extra></extra>',
  })

  const traces = [
    mkTrace(groups.ns,   '#94a3b8', `NS (${groups.ns.length})`,     0.25),
    mkTrace(groups.up,   '#B31B21', `Up (${groups.up.length})`,     0.75),
    mkTrace(groups.down, '#1465AC', `Down (${groups.down.length})`, 0.75),
  ]
  const layout = {
    paper_bgcolor: LIGHT.paper_bgcolor, plot_bgcolor: LIGHT.plot_bgcolor,
    font: LIGHT.font,
    title: { text: data.label || contrastLabel, font: { size: 13, color: '#1e293b' } },
    xaxis: { title: 'log₁₀(baseMean + 1)', gridcolor: LIGHT.grid, zeroline: false, color: '#475569' },
    yaxis: { title: 'log₂ Fold Change',    gridcolor: LIGHT.grid, zeroline: true,  zerolinecolor: LIGHT.zero, color: '#475569' },
    showlegend: true,
    legend: { x: 1.01, xanchor: 'left', y: 1 },
    margin: { t: 50, r: 140, b: 60, l: 70 },
  }
  return renderToPng(traces, layout, 900, 540)
}

// ── Render scree plot → PNG data URI ──────────────────────────────────────────
async function renderScree(variance) {
  if (!variance?.length) return null
  const pcs    = variance.map((_, i) => `PC${i + 1}`)
  const numVar = variance.map(Number)
  let cum = 0
  const cumul = numVar.map(v => { cum += v; return Math.min(cum, 100) })

  const accentColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim() || '#6366f1'

  const traces = [
    {
      x: pcs, y: numVar, type: 'bar', name: 'Variance (%)',
      marker: { color: accentColor, opacity: 0.85 },
      hovertemplate: '%{x}: %{y:.2f}%<extra></extra>',
    },
    {
      x: pcs, y: cumul, type: 'scatter', mode: 'lines+markers',
      name: 'Cumulative (%)', yaxis: 'y2',
      line: { color: '#f59e0b', width: 2 },
      marker: { color: '#f59e0b', size: 5 },
      hovertemplate: '%{x}: %{y:.1f}%<extra></extra>',
    },
  ]
  const layout = {
    paper_bgcolor: LIGHT.paper_bgcolor, plot_bgcolor: LIGHT.plot_bgcolor,
    font: LIGHT.font,
    bargap: 0.25,
    xaxis: { title: 'Principal Component', gridcolor: LIGHT.grid, color: '#475569', tickfont: { size: 10 } },
    yaxis: { title: 'Variance (%)',    gridcolor: LIGHT.grid, color: '#475569',
             range: [0, Math.max(...numVar) * 1.15] },
    yaxis2: { title: 'Cumulative (%)', overlaying: 'y', side: 'right',
              range: [0, 105], color: '#f59e0b', showgrid: false },
    showlegend: true,
    legend: { x: 0.5, xanchor: 'center', y: -0.2, orientation: 'h' },
    margin: { t: 36, r: 70, b: 80, l: 70 },
  }
  return renderToPng(traces, layout, 900, 460)
}

// ── Build interactive PCA scatter HTML snippet ────────────────────────────────
function buildPCAInteractiveHtml(pca, design) {
  const column = design?.column
  const scores = pca?.scores ?? []
  if (!scores.length) return null

  const groups = {}
  for (const s of scores) {
    const grp = column ? (s[column] ?? 'Unknown') : 'Samples'
    if (!groups[grp]) groups[grp] = []
    groups[grp].push(s)
  }

  const palette = ['#6366f1','#ec4899','#14b8a6','#f59e0b','#3b82f6','#10b981','#f97316','#8b5cf6']
  const variance = pca?.variance ?? []
  const xLabel = variance[0] != null ? `PC1 (${Number(variance[0]).toFixed(1)}%)` : 'PC1'
  const yLabel = variance[1] != null ? `PC2 (${Number(variance[1]).toFixed(1)}%)` : 'PC2'

  const traces = Object.entries(groups).map(([grp, pts], i) => ({
    x: pts.map(p => p.PC1 ?? 0),
    y: pts.map(p => p.PC2 ?? 0),
    text: pts.map(p => p.sample ?? ''),
    mode: 'markers+text',
    type: 'scatter',
    name: grp,
    textposition: 'top center',
    textfont: { size: 9, color: '#475569' },
    marker: { color: palette[i % palette.length], size: 11, opacity: 0.85 },
    hovertemplate: '<b>%{text}</b><extra></extra>',
  }))

  const layout = {
    paper_bgcolor: '#ffffff', plot_bgcolor: '#f8fafc',
    font: { color: '#1e293b', family: 'Inter, system-ui, sans-serif', size: 12 },
    xaxis: { title: xLabel, gridcolor: '#e2e8f0', zeroline: false, color: '#475569' },
    yaxis: { title: yLabel, gridcolor: '#e2e8f0', zeroline: false, color: '#475569' },
    showlegend: true,
    legend: { x: 1.02, xanchor: 'left', y: 1 },
    margin: { t: 40, r: 160, b: 60, l: 70 },
  }
  const config = { responsive: true, displaylogo: false }

  return `<div id="pca-scatter-div" style="width:100%;height:520px;"></div>
<script>
(function(){
  var traces = ${JSON.stringify(traces)};
  var layout = ${JSON.stringify(layout)};
  var config = ${JSON.stringify(config)};
  if(typeof Plotly !== 'undefined') { Plotly.newPlot('pca-scatter-div', traces, layout, config); }
  else { document.addEventListener('plotly-ready', function(){ Plotly.newPlot('pca-scatter-div', traces, layout, config); }); }
})();
</script>`
}

// ── HTML report builder ───────────────────────────────────────────────────────
const svgToDataUri = (raw) =>
  `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(raw)))}`

function buildHtml(sections, session, date) {
  const logoUri = svgToDataUri(deseq2LogoRaw)

  const sectionsHtml = sections.map(sec => {
    if (sec.type === 'static') {
      return `<section>
        <h2>${sec.label}</h2>
        <figure><img src="${sec.dataUri}" alt="${sec.label}" /></figure>
      </section>`
    }
    if (sec.type === 'tabs') {
      const tabBtns = sec.items.map((it, i) =>
        `<button class="tab-btn${i === 0 ? ' active' : ''}" onclick="switchTab(this,'${sec.id}-${i}')">${it.label}</button>`
      ).join('\n        ')
      const tabPanes = sec.items.map((it, i) =>
        `<div id="${sec.id}-${i}" class="tab-pane${i === 0 ? ' active' : ''}">
          <figure><img src="${it.dataUri}" alt="${it.label}" /></figure>
        </div>`
      ).join('\n        ')
      return `<section>
        <h2>${sec.label}</h2>
        <div class="tab-bar">${tabBtns}</div>
        ${tabPanes}
      </section>`
    }
    if (sec.type === 'interactive') {
      return `<section>
        <h2>${sec.label}</h2>
        ${sec.html}
      </section>`
    }
    return ''
  }).join('\n')

  const sessionInfo = session
    ? `<p class="meta">Session: <strong>${session.sessionId}</strong> &middot; Generated ${date}</p>`
    : `<p class="meta">Generated ${date}</p>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>DESeq2 Plot Report</title>
<script src="https://cdn.plot.ly/plotly-2.27.0.min.js" charset="utf-8"><\/script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: #f0f4f8; color: #1e293b;
    padding: 40px 20px; max-width: 1060px; margin: 0 auto;
  }
  header {
    display: flex; align-items: center; gap: 18px;
    padding-bottom: 24px; border-bottom: 2px solid #e2e8f0; margin-bottom: 36px;
  }
  header img { width: 52px; height: 52px; border-radius: 12px; }
  header h1 { font-size: 1.5rem; font-weight: 700; color: #0f172a; }
  .meta { font-size: 0.8rem; color: #64748b; margin-top: 4px; }
  section {
    background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
    padding: 26px 30px; margin-bottom: 28px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  section h2 {
    font-size: 0.95rem; font-weight: 700; color: #1e293b;
    margin-bottom: 18px; padding-bottom: 10px; border-bottom: 1px solid #f1f5f9;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  figure { margin: 0; text-align: center; }
  figure img { max-width: 100%; height: auto; border-radius: 6px; border: 1px solid #e2e8f0; }
  .tab-bar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
  .tab-btn {
    padding: 5px 14px; border-radius: 20px; border: 1px solid #e2e8f0;
    background: #f8fafc; color: #64748b; font-size: 0.78rem; font-weight: 500;
    cursor: pointer; transition: all 0.12s;
  }
  .tab-btn.active { background: #0b446f; color: #fff; border-color: #0b446f; font-weight: 600; }
  .tab-pane { display: none; }
  .tab-pane.active { display: block; }
  @media print {
    body { background: white; padding: 0; }
    section { break-inside: avoid; box-shadow: none; }
  }
</style>
</head>
<body>
<header>
  <img src="${logoUri}" alt="DESeq2 logo" />
  <div>
    <h1>DESeq2 Plot Report</h1>
    ${sessionInfo}
  </div>
</header>
${sectionsHtml}
<script>
function switchTab(btn, id) {
  var bar  = btn.closest('.tab-bar');
  var sect = btn.closest('section');
  bar.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
  sect.querySelectorAll('.tab-pane').forEach(function(p){ p.classList.remove('active'); p.style.display='none'; });
  btn.classList.add('active');
  var pane = document.getElementById(id);
  if(pane){ pane.classList.add('active'); pane.style.display='block'; }
}
<\/script>
</body>
</html>`
}

// ── Modal component ───────────────────────────────────────────────────────────
export default function PlotExportModal({ open, onClose, session, results, design }) {
  const registry = usePlotRegistry()
  const { promptDownload, dialog } = useDownloadDialog()

  const [selected,  setSelected]  = useState(() => new Set(KNOWN_PLOTS.map(p => p.id)))
  const [available, setAvailable] = useState(new Set())
  const [exporting, setExporting] = useState(false)
  const [progress,  setProgress]  = useState({ done: 0, total: 0, current: '' })

  // Derive availability from live data
  useEffect(() => {
    if (!open) return
    const registered = new Set(registry.getAll().map(p => p.id))
    const avail = new Set()
    if (registered.has('counts-plot')) avail.add('counts-plot')
    if (results?.contrasts?.length)    avail.add('ma-plots')
    if (results?.pca?.scores?.length)  avail.add('pca-scatter')
    if (results?.pca?.variance?.length) avail.add('pca-scree')
    setAvailable(avail)
  }, [open, registry, results])

  const toggle = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback((on) => {
    if (on) setSelected(new Set(KNOWN_PLOTS.map(p => p.id)))
    else     setSelected(new Set())
  }, [])

  const handleExport = useCallback(async () => {
    const targets = KNOWN_PLOTS.filter(p => selected.has(p.id) && available.has(p.id))
    if (!targets.length) return

    setExporting(true)
    const sections = []

    const withTimeout = (p, ms = 15000) =>
      Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      setProgress({ done: i, total: targets.length, current: t.label })

      try {
        // ── Counts (registry) ──────────────────────────────────────────────
        if (t.src === 'registry') {
          const all     = registry.getAll()
          const entry   = all.find(e => e.id === t.id)
          const capFn   = entry?.captureRef?.current
          if (!capFn) continue
          const result = capFn()
          if (!result) continue
          const dataUri = await withTimeout(result)
          if (dataUri) sections.push({ type: 'static', label: t.label, dataUri })
        }

        // ── MA plots (one per contrast, tabbed) ────────────────────────────
        if (t.src === 'api') {
          const contrasts = results?.contrasts ?? []
          const items = []
          for (const c of contrasts) {
            setProgress({ done: i, total: targets.length, current: `MA — ${c.label}` })
            try {
              const dataUri = await withTimeout(
                fetchAndRenderMA(session?.sessionId, c.label)
              )
              if (dataUri) items.push({ label: c.label, dataUri })
            } catch (e) {
              console.warn(`MA capture failed for ${c.label}:`, e)
            }
          }
          if (items.length === 1) {
            sections.push({ type: 'static', label: `MA Plot — ${items[0].label}`, dataUri: items[0].dataUri })
          } else if (items.length > 1) {
            sections.push({ type: 'tabs', id: 'ma', label: 'MA Plots', items })
          }
        }

        // ── PCA interactive ────────────────────────────────────────────────
        if (t.src === 'pca') {
          const html = buildPCAInteractiveHtml(results?.pca, design)
          if (html) sections.push({ type: 'interactive', label: 'PCA Scatter', html })
        }

        // ── Scree (off-screen) ─────────────────────────────────────────────
        if (t.src === 'scree') {
          const dataUri = await withTimeout(renderScree(results?.pca?.variance))
          if (dataUri) sections.push({ type: 'static', label: 'PCA Scree', dataUri })
        }

      } catch (e) {
        console.warn(`Export failed for ${t.label}:`, e)
      }
    }

    setExporting(false)
    if (!sections.length) return

    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const html = buildHtml(sections, session, date)
    const blob = new Blob([html], { type: 'text/html' })
    const defaultName = `deseq2-plots-${session?.sessionId ?? 'report'}.html`

    promptDownload(defaultName, (finalName) => {
      const url = URL.createObjectURL(blob)
      Object.assign(document.createElement('a'), { href: url, download: finalName }).click()
      URL.revokeObjectURL(url)
      onClose()
    })
  }, [registry, selected, available, results, design, session, promptDownload, onClose])

  if (!open) return null

  const groups = {}
  for (const p of KNOWN_PLOTS) {
    if (!groups[p.group]) groups[p.group] = []
    groups[p.group].push(p)
  }

  const selectedAvailable = KNOWN_PLOTS.filter(p => selected.has(p.id) && available.has(p.id)).length
  const contrastCount = results?.contrasts?.length ?? 0

  return (
    <>
      {dialog}
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 900,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div onClick={e => e.stopPropagation()}
          style={{ width: 'min(480px, 95vw)', height: 'min(560px, 88vh)',
            borderRadius: 14, background: 'var(--bg-panel)', border: '1px solid var(--border)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 18px', borderBottom: '1px solid var(--border)',
            background: 'rgba(var(--accent-rgb),0.04)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"
                   style={{ color: 'var(--accent)', flexShrink: 0 }}>
                <path d="M8 12l-4.5-4.5 1.06-1.06L7 8.88V2h2v6.88l2.44-2.44L12.5 7.5 8 12z" fill="currentColor"/>
                <path d="M2 14h12v-2H2v2z" fill="currentColor"/>
              </svg>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-1)' }}>
                Export Plots
              </span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-3)',
                background: 'rgba(var(--accent-rgb),0.1)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '1px 8px' }}>
                HTML Report
              </span>
            </div>
            <button onClick={onClose}
              style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.05)', color: 'var(--text-2)',
                cursor: 'pointer', fontSize: '0.9rem', display: 'flex',
                alignItems: 'center', justifyContent: 'center' }}>
              ✕
            </button>
          </div>

          {/* Body */}
          <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', padding: '16px 20px' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              {[['Select all', true], ['Deselect all', false]].map(([label, on]) => (
                <button key={label} onClick={() => toggleAll(on)}
                  style={{ fontSize: '0.72rem', padding: '4px 12px', borderRadius: 6,
                    background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid var(--border)',
                    color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>
                  {label}
                </button>
              ))}
            </div>

            {Object.entries(groups).map(([group, plots]) => (
              <div key={group} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.07em', color: 'var(--text-3)', marginBottom: 7,
                  paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
                  {group}
                </div>
                {plots.map(p => {
                  const isAvail   = available.has(p.id)
                  const isChecked = selected.has(p.id)
                  const hint = !isAvail ? 'not generated'
                    : p.id === 'ma-plots' && contrastCount > 1 ? `${contrastCount} contrasts`
                    : p.id === 'ma-plots' && contrastCount === 1 ? '1 contrast'
                    : p.id === 'pca-scatter' ? 'interactive'
                    : null
                  return (
                    <label key={p.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', borderRadius: 8, marginBottom: 4,
                      background: isChecked && isAvail ? 'rgba(var(--accent-rgb),0.1)' : 'var(--bg-card2)',
                      border: `1px solid ${isChecked && isAvail ? 'var(--accent-border)' : 'var(--border)'}`,
                      cursor: isAvail ? 'pointer' : 'default',
                      opacity: isAvail ? 1 : 0.45, transition: 'all 0.12s',
                    }}>
                      <input type="checkbox"
                        checked={isChecked && isAvail} disabled={!isAvail}
                        onChange={() => isAvail && toggle(p.id)}
                        style={{ accentColor: 'var(--accent)', width: 14, height: 14, flexShrink: 0 }}
                      />
                      <span style={{ fontSize: '0.83rem', color: 'var(--text-1)', flex: 1 }}>
                        {p.label}
                      </span>
                      {hint && (
                        <span style={{ fontSize: '0.68rem',
                          color: isAvail ? 'var(--accent-text)' : 'var(--text-3)',
                          fontStyle: isAvail ? 'normal' : 'italic' }}>
                          {hint}
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {exporting ? (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-2)', marginBottom: 6 }}>
                  {progress.current || 'Building report…'}
                </div>
                <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 2,
                    background: 'linear-gradient(90deg,var(--accent),var(--accent2))',
                    width: `${progress.total ? (progress.done / progress.total) * 100 : 10}%`,
                    transition: 'width 0.3s ease' }} />
                </div>
              </div>
            ) : (
              <>
                <button onClick={onClose}
                  style={{ flex: 1, padding: '7px 0', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'transparent',
                    color: 'var(--text-2)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={handleExport} disabled={selectedAvailable === 0}
                  style={{ flex: 2, padding: '7px 0', borderRadius: 8, border: 'none',
                    background: selectedAvailable
                      ? 'linear-gradient(135deg,var(--accent),var(--accent2))'
                      : 'var(--bg-card2)',
                    color: selectedAvailable ? '#fff' : 'var(--text-3)',
                    fontSize: '0.82rem', fontWeight: 700,
                    cursor: selectedAvailable ? 'pointer' : 'default',
                    transition: 'all 0.15s' }}>
                  ↓ Export {selectedAvailable > 0
                    ? `${selectedAvailable} plot${selectedAvailable > 1 ? 's' : ''}`
                    : 'HTML'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
