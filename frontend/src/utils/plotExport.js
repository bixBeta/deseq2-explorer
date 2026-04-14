import Plotly from 'plotly.js-dist-min'

// ── Known plots ───────────────────────────────────────────────────────────────
export const KNOWN_PLOTS = [
  { id: 'counts-plot', label: 'Counts Distribution',         group: 'Distributions',          src: 'registry' },
  { id: 'ma-plots',    label: 'MA Plots (all contrasts)',    group: 'Differential Expression', src: 'api'      },
  { id: 'pca-scatter', label: 'PCA Scatter (interactive)',   group: 'PCA',                     src: 'pca'      },
  { id: 'pca-scree',   label: 'PCA Scree',                  group: 'PCA',                     src: 'scree'    },
]

// ── Derive available set from live data + registry ────────────────────────────
export function getAvailablePlots(registryGetAll, results) {
  const registered = new Set(registryGetAll().map(p => p.id))
  const avail = new Set()
  if (registered.has('counts-plot'))     avail.add('counts-plot')
  if (results?.contrasts?.length)        avail.add('ma-plots')
  if (results?.pca?.scores?.length)      avail.add('pca-scatter')
  if (results?.pca?.variance?.length)    avail.add('pca-scree')
  return avail
}

// ── Off-screen Plotly → PNG ───────────────────────────────────────────────────
export async function renderToPng(traces, layout, width = 900, height = 520) {
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

const LIGHT = {
  paper_bgcolor: '#ffffff', plot_bgcolor: '#f8fafc',
  font: { color: '#1e293b', family: 'Inter, system-ui, sans-serif' },
  grid: '#e2e8f0', zero: '#94a3b8',
}

// ── MA plot fetch + render ────────────────────────────────────────────────────
export async function fetchAndRenderMA(sessionId, contrastLabel) {
  const r = await fetch('/api/maplot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, label: contrastLabel }),
  })
  const data = await r.json()
  if (data.error || !data.points) return null

  const groups = { up: [], down: [], ns: [] }
  for (const p of data.points) {
    let g = 'ns'
    if (p.padj != null && p.padj < 0.05 && p.log2FC != null) {
      if      (p.log2FC >=  1) g = 'up'
      else if (p.log2FC <= -1) g = 'down'
    }
    groups[g].push(p)
  }
  const mk = (arr, color, name, op) => ({
    x: arr.map(p => Math.log10((p.baseMean ?? 0) + 1)),
    y: arr.map(p => p.log2FC ?? 0),
    text: arr.map(p => p.gene || p.geneId || ''),
    mode: 'markers', type: 'scatter', name,
    marker: { color, size: 4, opacity: op },
    hovertemplate: '<b>%{text}</b><br>log₂FC: %{y:.2f}<extra></extra>',
  })
  const nsLabel = data.ns_total != null && data.ns_total > groups.ns.length
    ? `NS (${groups.ns.length.toLocaleString()} of ${data.ns_total.toLocaleString()} shown)`
    : `NS (${groups.ns.length.toLocaleString()})`
  const traces = [
    mk(groups.ns,   '#94a3b8', nsLabel,                            0.25),
    mk(groups.up,   '#B31B21', `Up (${groups.up.length})`,         0.75),
    mk(groups.down, '#1465AC', `Down (${groups.down.length})`,     0.75),
  ]
  const layout = {
    ...LIGHT,
    title: { text: data.label || contrastLabel, font: { size: 13, color: '#1e293b' } },
    xaxis: { title: 'log₁₀(baseMean + 1)', gridcolor: LIGHT.grid, zeroline: false,  color: '#475569' },
    yaxis: { title: 'log₂ Fold Change',    gridcolor: LIGHT.grid, zeroline: true, zerolinecolor: LIGHT.zero, color: '#475569' },
    showlegend: true,
    legend: { x: 1.01, xanchor: 'left', y: 1 },
    margin: { t: 50, r: 140, b: 60, l: 70 },
  }
  return renderToPng(traces, layout, 900, 540)
}

// ── Scree plot ────────────────────────────────────────────────────────────────
export async function renderScree(variance) {
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
    ...LIGHT,
    bargap: 0.25,
    xaxis: { title: 'Principal Component', gridcolor: LIGHT.grid, color: '#475569', tickfont: { size: 10 } },
    yaxis: { title: 'Variance (%)', gridcolor: LIGHT.grid, color: '#475569', range: [0, Math.max(...numVar) * 1.15] },
    yaxis2: { title: 'Cumulative (%)', overlaying: 'y', side: 'right', range: [0, 105], color: '#f59e0b', showgrid: false },
    showlegend: true,
    legend: { x: 0.5, xanchor: 'center', y: -0.2, orientation: 'h' },
    margin: { t: 36, r: 70, b: 80, l: 70 },
  }
  return renderToPng(traces, layout, 900, 460)
}

// ── Interactive PCA HTML snippet ──────────────────────────────────────────────
export function buildPCAInteractiveHtml(pca, design) {
  const scores   = pca?.scores ?? []
  const variance = pca?.variance ?? []
  if (!scores.length) return null

  const column = design?.column
  const groups = {}
  for (const s of scores) {
    const grp = column ? (s[column] ?? 'Unknown') : 'Samples'
    if (!groups[grp]) groups[grp] = []
    groups[grp].push(s)
  }
  const palette = ['#6366f1','#ec4899','#14b8a6','#f59e0b','#3b82f6','#10b981','#f97316','#8b5cf6']
  const xLabel  = variance[0] != null ? `PC1 (${Number(variance[0]).toFixed(1)}%)` : 'PC1'
  const yLabel  = variance[1] != null ? `PC2 (${Number(variance[1]).toFixed(1)}%)` : 'PC2'
  const traces  = Object.entries(groups).map(([grp, pts], i) => ({
    x: pts.map(p => p.PC1 ?? 0), y: pts.map(p => p.PC2 ?? 0),
    text: pts.map(p => p.sample ?? ''),
    mode: 'markers',   // labels off by default; toggled via button
    type: 'scatter', name: grp,
    textposition: 'top center', textfont: { size: 9, color: '#475569' },
    marker: { color: palette[i % palette.length], size: 11, opacity: 0.85 },
    hovertemplate: '<b>%{text}</b><extra></extra>',
  }))
  const layout = {
    paper_bgcolor: '#ffffff', plot_bgcolor: '#f8fafc',
    font: { color: '#1e293b', family: 'Inter, system-ui, sans-serif', size: 12 },
    xaxis: { title: xLabel, gridcolor: '#e2e8f0', zeroline: false, color: '#475569' },
    yaxis: { title: yLabel, gridcolor: '#e2e8f0', zeroline: false, color: '#475569' },
    showlegend: true, legend: { x: 1.02, xanchor: 'left', y: 1 },
    margin: { t: 40, r: 160, b: 60, l: 70 },
  }
  return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
  <button id="pca-lbl-btn" onclick="(function(){
    var on=(this.dataset.on==='1');
    var div=document.getElementById('pca-scatter-div');
    Plotly.restyle(div,{mode:on?'markers':'markers+text'});
    this.dataset.on=on?'0':'1';
    this.textContent=on?'Show labels':'Hide labels';
    this.style.background=on?'#f8fafc':'#0b446f';
    this.style.color=on?'#475569':'#fff';
    this.style.borderColor=on?'#e2e8f0':'#0b446f';
  }).call(this)" data-on="0"
    style="font-size:0.78rem;padding:5px 14px;border-radius:20px;border:1px solid #e2e8f0;background:#f8fafc;color:#475569;cursor:pointer;font-family:inherit;transition:all 0.15s;">
    Show labels
  </button>
  <span style="font-size:0.74rem;color:#94a3b8;">Hover points for sample names</span>
</div>
<div id="pca-scatter-div" style="width:100%;height:500px;"></div>
<script>
(function(){
  var t=${JSON.stringify(traces)},l=${JSON.stringify(layout)};
  if(typeof Plotly!=='undefined') Plotly.newPlot('pca-scatter-div',t,l,{responsive:true,displaylogo:false,modeBarButtonsToRemove:['select2d','lasso2d']});
})();
<\/script>`
}

// ── Build HTML sections string (injected into the report) ─────────────────────
export function buildPlotSectionsHtml(sections) {
  return sections.map(sec => {
    const anchorId = `plot-${sec.anchorId ?? sec.id ?? sec.label.toLowerCase().replace(/\s+/g,'-')}`
    if (sec.type === 'static') {
      return `<section id="${anchorId}">
  <h2>${sec.label}</h2>
  <figure style="margin:0;text-align:center">
    <img src="${sec.dataUri}" alt="${sec.label}" style="max-width:100%;height:auto;border-radius:6px;border:1px solid #e2e8f0;" />
  </figure>
</section>`
    }
    if (sec.type === 'tabs') {
      const btns  = sec.items.map((it, i) =>
        `<button class="plt-tab-btn${i===0?' active':''}" onclick="switchPlotTab(this,'${sec.id}-${i}')">${it.label}</button>`
      ).join('')
      const panes = sec.items.map((it, i) =>
        `<div id="${sec.id}-${i}" class="plt-tab-pane"${i!==0?' style="display:none"':''}>
    <figure style="margin:0;text-align:center">
      <img src="${it.dataUri}" alt="${it.label}" style="max-width:100%;height:auto;border-radius:6px;border:1px solid #e2e8f0;" />
    </figure>
  </div>`
      ).join('\n  ')
      return `<section id="${anchorId}">
  <h2>${sec.label}</h2>
  <div class="plt-tab-bar">${btns}</div>
  ${panes}
</section>`
    }
    if (sec.type === 'interactive') {
      return `<section id="${anchorId}">
  <h2>${sec.label}</h2>
  ${sec.html}
</section>`
    }
    return ''
  }).join('\n')
}

// ── CSS + JS to inject into buildHtmlExport when plots are present ────────────
export const PLOT_HTML_EXTRAS = {
  css: `
  figure { margin: 0; }
  .plt-tab-bar { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
  .plt-tab-btn { padding:5px 16px; border-radius:20px; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; font-size:0.78rem; font-weight:500; cursor:pointer; transition:all 0.12s; font-family:inherit; }
  .plt-tab-btn.active { background:#0b446f; color:#fff; border-color:#0b446f; font-weight:600; }`,
  js: `
function switchPlotTab(btn,id){
  var bar=btn.closest('.plt-tab-bar'), sect=btn.closest('section');
  bar.querySelectorAll('.plt-tab-btn').forEach(function(b){b.classList.remove('active');});
  sect.querySelectorAll('.plt-tab-pane').forEach(function(p){p.style.display='none';});
  btn.classList.add('active');
  var pane=document.getElementById(id); if(pane) pane.style.display='block';
}`,
}

// ── Capture all selected plots, return sections array ────────────────────────
export async function captureSelectedPlots(
  selected, available, results, design, session, registryGetAll, onProgress
) {
  const withTimeout = (p, ms = 15000) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

  const targets = KNOWN_PLOTS.filter(p => selected.has(p.id) && available.has(p.id))
  const sections = []
  let done = 0

  for (const t of targets) {
    onProgress?.(done, targets.length, t.label)
    try {
      if (t.src === 'registry') {
        const entry = registryGetAll().find(e => e.id === t.id)
        const capFn = entry?.captureRef?.current
        if (capFn) {
          const result = capFn()
          if (result) {
            const dataUri = await withTimeout(result)
            if (dataUri) sections.push({ type: 'static', anchorId: 'counts', label: t.label, dataUri })
          }
        }
      }
      if (t.src === 'api') {
        const contrasts = results?.contrasts ?? []
        const items = []
        for (const c of contrasts) {
          onProgress?.(done, targets.length, `MA — ${c.label}`)
          try {
            const dataUri = await withTimeout(fetchAndRenderMA(session?.sessionId, c.label))
            if (dataUri) items.push({ label: c.label, dataUri })
          } catch (e) { console.warn(`MA failed: ${c.label}`, e) }
        }
        if (items.length === 1) {
          sections.push({ type: 'static', anchorId: 'ma', label: `MA Plot — ${items[0].label}`, dataUri: items[0].dataUri })
        } else if (items.length > 1) {
          sections.push({ type: 'tabs', id: 'ma', anchorId: 'ma', label: 'MA Plots', items })
        }
      }
      if (t.src === 'pca') {
        const html = buildPCAInteractiveHtml(results?.pca, design)
        if (html) sections.push({ type: 'interactive', anchorId: 'pca', label: 'PCA Scatter', html })
      }
      if (t.src === 'scree') {
        const dataUri = await withTimeout(renderScree(results?.pca?.variance))
        if (dataUri) sections.push({ type: 'static', anchorId: 'scree', label: 'PCA Scree', dataUri })
      }
    } catch (e) {
      console.warn(`Export failed for ${t.label}:`, e)
    }
    done++
  }

  onProgress?.(done, targets.length, '')
  return sections
}
