import { useEffect, useRef, useState, useMemo } from 'react'
import Plotly from 'plotly.js-dist-min'
import { useDownloadDialog } from './DownloadDialog'
import { useRegisterPlot } from '../context/PlotRegistryContext'

function triggerDownload(csv, name) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  URL.revokeObjectURL(url)
}

const SYMBOLS_2D = ['circle','square','diamond','triangle-up','cross','x','triangle-down','pentagon','hexagon','star','bowtie','hourglass']
const SYMBOLS_3D = ['circle','square','diamond','cross','x']

const PALETTES = {
  'Spectrum':  ['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#3b82f6','#10b981','#f97316'],
  'Clinical':  ['#1565C0','#B71C1C','#2E7D32','#F57F17','#6A1B9A','#00838F','#D84315','#558B2F'],
  'Pastel':    ['#7986CB','#EF9A9A','#80CBC4','#FFD54F','#CE93D8','#90CAF9','#A5D6A7','#FFAB91'],
  'Bold':      ['#E53935','#1E88E5','#43A047','#FB8C00','#8E24AA','#00ACC1','#F4511E','#6D4C41'],
  'Tableau':   ['#4E79A7','#F28E2B','#E15759','#76B7B2','#59A14F','#EDC948','#B07AA1','#FF9DA7'],
}

function getThemeColors() {
  const isLight = document.body.classList.contains('light')
  return {
    font:     isLight ? '#475569' : '#94a3b8',
    axis:     isLight ? '#64748b' : '#64748b',
    grid:     isLight ? 'rgba(0,0,0,0.14)'    : 'rgba(255,255,255,0.12)',
    zeroline: isLight ? 'rgba(0,0,0,0.25)'    : 'rgba(255,255,255,0.15)',
    textfont: isLight ? '#64748b'             : '#94a3b8',
    bar:      isLight ? 'var(--accent)'             : 'var(--accent-text)',
    barBg:    isLight ? 'rgba(var(--accent-rgb),0.1)': 'rgba(var(--accent-rgb),0.2)',
  }
}

const TAB_BTN = (active) => ({
  padding: '4px 14px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.78rem',
  fontWeight: active ? 600 : 400,
  background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
  color: active ? 'var(--text-1)' : 'var(--text-3)',
  transition: 'all 0.15s',
})

export default function PCAPlot({ pca, design, sampleLabels = {}, annMap = {} }) {
  const outerRef      = useRef(null)
  const plotRef       = useRef(null)
  const screeRef      = useRef(null)
  const screeOuterRef = useRef(null)

  const pcaScatterCaptureRef = useRef(null)
  pcaScatterCaptureRef.current = () => {
    if (!plotRef.current?._fullLayout) return null
    return Plotly.toImage(plotRef.current, { format: 'png', width: 900, height: 660 })
  }
  useRegisterPlot('pca-scatter', 'PCA Scatter', 'PCA', pcaScatterCaptureRef)

  const pcaScreeCaptureRef = useRef(null)
  pcaScreeCaptureRef.current = () => {
    if (!screeRef.current?._fullLayout) return null
    return Plotly.toImage(screeRef.current, { format: 'png', width: 900, height: 500 })
  }
  useRegisterPlot('pca-scree', 'PCA Scree', 'PCA', pcaScreeCaptureRef)

  const [plotTab,     setPlotTab]     = useState('scatter')   // 'scatter' | 'scree' | 'loadings'
  const [is3D,        setIs3D]        = useState(false)
  const [xPC,         setXPC]         = useState('PC1')
  const [yPC,         setYPC]         = useState('PC2')
  const [zPC,         setZPC]         = useState('PC3')
  const [showLabels,  setShowLabels]  = useState(false)
  const [ptSize,      setPtSize]      = useState(15)
  const [opacity,     setOpacity]     = useState(0.85)
  const [paletteName, setPaletteName] = useState('Clinical')
  const [colorBy,     setColorBy]     = useState(design?.column ?? null)
  const [shapeBy,     setShapeBy]     = useState(null)
  const [rankByPC,    setRankByPC]    = useState('PC1')
  const [topN,        setTopN]        = useState(20)

  // Derive available PC keys + variance + metadata columns from data
  const { pcKeys, variance, metaCols } = useMemo(() => {
    if (!pca?.scores?.length) return { pcKeys: ['PC1', 'PC2'], variance: [], metaCols: [] }
    const first = pca.scores[0]
    const keys  = Object.keys(first)
      .filter(k => /^PC\d+$/.test(k))
      .sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)))
    const meta  = Object.keys(first).filter(k => k !== 'sample' && !/^PC\d+$/.test(k))
    return { pcKeys: keys, variance: pca.variance ?? [], metaCols: meta }
  }, [pca])

  // Reset axis selectors + colorBy when new data arrives
  useEffect(() => {
    setXPC('PC1')
    setYPC('PC2')
    setZPC('PC3')
    setIs3D(false)
    setColorBy(design?.column ?? null)
    setShapeBy(null)
  }, [pca])

  // Compute group summary for the bottom bar
  const groupSummary = useMemo(() => {
    if (!pca?.scores?.length) return []
    const column  = colorBy || design?.column
    const palette = PALETTES[paletteName] || PALETTES['Clinical']
    const counts  = {}
    pca.scores.forEach(s => {
      const grp = (column ? s[column] : null) ?? 'Unknown'
      counts[grp] = (counts[grp] || 0) + 1
    })
    return Object.entries(counts).map(([name, count], i) => ({
      name, count, color: palette[i % palette.length],
    }))
  }, [pca, colorBy, design, paletteName])

  // ── Export helpers ────────────────────────────────────────────────────────────
  function exportScores() {
    if (!pca?.scores?.length) return
    const pcHeaders = pcKeys.map((k, i) =>
      variance[i] != null ? `${k} (${Number(variance[i]).toFixed(1)}%)` : k
    )
    const header = ['sample', ...metaCols, ...pcHeaders].join(',')
    const rows = pca.scores.map(s => {
      const meta = metaCols.map(c => { const v = String(s[c] ?? ''); return v.includes(',') ? `"${v}"` : v })
      const pcs  = pcKeys.map(k => (s[k] ?? 0).toFixed(6))
      return [s.sample ?? '', ...meta, ...pcs].join(',')
    })
    triggerDownload([header, ...rows].join('\n'), 'pca_scores.csv')
  }

  function exportScree() {
    if (!variance?.length) return
    let cum = 0
    const rows = pcKeys.slice(0, variance.length).map((k, i) => {
      const v = Number(variance[i] ?? 0); cum += v
      return `${k},${v.toFixed(4)},${cum.toFixed(4)}`
    })
    triggerDownload(['PC,Variance_Pct,Cumulative_Pct', ...rows].join('\n'), 'pca_scree.csv')
  }

  // Resize observer (scatter plot)
  useEffect(() => {
    if (!outerRef.current || !plotRef.current) return
    const ro = new ResizeObserver(() => {
      if (plotRef.current?._fullLayout) Plotly.Plots.resize(plotRef.current)
    })
    ro.observe(outerRef.current)
    return () => ro.disconnect()
  }, [])

  // Resize observer (scree plot)
  useEffect(() => {
    if (!screeOuterRef.current || !screeRef.current) return
    const ro = new ResizeObserver(() => {
      if (screeRef.current?._fullLayout) Plotly.Plots.resize(screeRef.current)
    })
    ro.observe(screeOuterRef.current)
    return () => ro.disconnect()
  }, [])

  // Draw scatter plot (2D or 3D)
  useEffect(() => {
    if (plotTab !== 'scatter' || !plotRef.current || !pca?.scores?.length) return
    const c      = getThemeColors()
    const column = colorBy || design?.column
    const { scores } = pca

    const groups = {}
    scores.forEach(s => {
      const grp = (column ? s[column] : null) ?? 'Unknown'
      if (!groups[grp]) groups[grp] = []
      groups[grp].push(s)
    })

    const xIdx = pcKeys.indexOf(xPC)
    const yIdx = pcKeys.indexOf(yPC)
    const zIdx = pcKeys.indexOf(zPC)
    const xVar = variance[xIdx] != null ? ` (${Number(variance[xIdx]).toFixed(1)}%)` : ''
    const yVar = variance[yIdx] != null ? ` (${Number(variance[yIdx]).toFixed(1)}%)` : ''
    const zVar = variance[zIdx] != null ? ` (${Number(variance[zIdx]).toFixed(1)}%)` : ''

    const palette = PALETTES[paletteName] || PALETTES['Clinical']

    // Build shape map: unique shapeBy values → Plotly symbols
    const shapeVals = shapeBy ? [...new Set(scores.map(s => s[shapeBy] ?? 'Unknown'))] : []
    const shapeMap  = shapeBy
      ? Object.fromEntries(shapeVals.map((v, i) => [v, (is3D ? SYMBOLS_3D : SYMBOLS_2D)[i % (is3D ? SYMBOLS_3D : SYMBOLS_2D).length]]))
      : null

    const commonHover = {
      bgcolor: 'rgba(13,20,36,0.9)',
      bordercolor: 'rgba(var(--accent-rgb),0.4)',
      font: { color: '#e2e8f0', size: 12 },
    }

    if (is3D) {
      const traces = Object.entries(groups).map(([grp, pts], i) => ({
        x:    pts.map(s => s[xPC] ?? 0),
        y:    pts.map(s => s[yPC] ?? 0),
        z:    pts.map(s => s[zPC] ?? 0),
        text: pts.map(s => sampleLabels[s.sample] ?? s.sample),
        mode: showLabels ? 'markers+text' : 'markers',
        type: 'scatter3d',
        name: grp,
        textposition: 'top center',
        textfont: { size: 9, color: c.textfont },
        marker: { color: palette[i % palette.length], size: ptSize * 0.6, opacity,
                  symbol: shapeMap ? pts.map(s => shapeMap[s[shapeBy] ?? 'Unknown']) : 'circle' },
        hovertemplate: '%{text}<extra></extra>',
      }))

      const axStyle = { gridcolor: c.grid, zerolinecolor: c.zeroline, color: c.axis,
                        tickfont: { size: 10 }, backgroundcolor: 'transparent', showbackground: false }
      const layout = {
        paper_bgcolor: 'transparent',
        font: { color: c.font, family: "'Inter', system-ui" },
        scene: {
          xaxis: { title: { text: `${xPC}${xVar}` }, ...axStyle },
          yaxis: { title: { text: `${yPC}${yVar}` }, ...axStyle },
          zaxis: { title: { text: `${zPC}${zVar}` }, ...axStyle },
          bgcolor: 'transparent',
        },
        showlegend: true,
        legend: { font: { size: 11 }, bgcolor: 'transparent',
                  x: 1.02, xanchor: 'left', y: 1, yanchor: 'top', orientation: 'v' },
        margin: { t: 36, r: 180, b: 20, l: 20 },
        modebar: { bgcolor: 'transparent', color: c.font, activecolor: 'var(--accent)' },
        hoverlabel: commonHover,
      }

      Plotly.react(plotRef.current, traces, layout, {
        responsive: false, displaylogo: false,
      }).then(() => {
        plotRef.current?.querySelectorAll('.modebar-container, .modebar, .modebar-group')
          .forEach(el => el.style.setProperty('background', 'transparent', 'important'))
      })
    } else {
      const traces = Object.entries(groups).map(([grp, pts], i) => ({
        x:    pts.map(s => s[xPC] ?? 0),
        y:    pts.map(s => s[yPC] ?? 0),
        text: pts.map(s => sampleLabels[s.sample] ?? s.sample),
        mode: showLabels ? 'markers+text' : 'markers',
        type: 'scatter',
        name: grp,
        textposition: 'top center',
        textfont: { size: 9, color: c.textfont },
        marker: { color: palette[i % palette.length], size: ptSize, opacity,
                  symbol: shapeMap ? pts.map(s => shapeMap[s[shapeBy] ?? 'Unknown']) : 'circle' },
        hovertemplate: '%{text}<extra></extra>',
      }))

      const layout = {
        paper_bgcolor: 'transparent',
        plot_bgcolor:  'transparent',
        font: { color: c.font, family: "'Inter', system-ui" },
        xaxis: {
          title: { text: `${xPC}${xVar}`, standoff: 10 },
          gridcolor: c.grid, zerolinecolor: c.zeroline, color: c.axis,
          tickfont: { size: 11 }, showgrid: true,
        },
        yaxis: {
          title: { text: `${yPC}${yVar}`, standoff: 10 },
          gridcolor: c.grid, zerolinecolor: c.zeroline, color: c.axis,
          tickfont: { size: 11 }, showgrid: true,
        },
        showlegend: true,
        legend: { font: { size: 11 }, bgcolor: 'transparent',
                  x: 1.02, xanchor: 'left', y: 1, yanchor: 'top', orientation: 'v' },
        margin: { t: 36, r: 180, b: 48, l: 68 },
        modebar: { bgcolor: 'transparent', color: c.font, activecolor: 'var(--accent)' },
        hoverlabel: commonHover,
      }

      Plotly.react(plotRef.current, traces, layout, {
        responsive: false,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      }).then(() => {
        plotRef.current?.querySelectorAll('.modebar-container, .modebar, .modebar-group')
          .forEach(el => el.style.setProperty('background', 'transparent', 'important'))
      })
    }
  }, [pca, design, xPC, yPC, zPC, is3D, showLabels, ptSize, opacity, plotTab, pcKeys, variance, paletteName, colorBy, shapeBy, sampleLabels])

  // Draw scree plot
  useEffect(() => {
    if (plotTab !== 'scree' || !screeRef.current || !variance?.length) return
    const c = getThemeColors()

    const labels   = pcKeys.slice(0, variance.length)
    const cumul    = variance.reduce((acc, v) => {
      acc.push((acc.length ? acc[acc.length - 1] : 0) + Number(v))
      return acc
    }, [])

    const barTrace = {
      x: labels, y: variance.map(Number),
      type: 'bar', name: 'Variance explained (%)',
      marker: { color: (PALETTES[paletteName] || PALETTES['Clinical'])[0], opacity: 0.8 },
      hovertemplate: '%{x}: %{y:.2f}%<extra></extra>',
    }
    const lineTrace = {
      x: labels, y: cumul.map(v => Math.min(v, 100)),
      type: 'scatter', mode: 'lines+markers',
      name: 'Cumulative (%)',
      line: { color: '#f59e0b', width: 2 },
      marker: { color: '#f59e0b', size: 5 },
      hovertemplate: '%{x}: %{y:.1f}%<extra></extra>',
      yaxis: 'y2',
    }

    const layout = {
      paper_bgcolor: 'transparent',
      plot_bgcolor:  'transparent',
      font: { color: c.font, family: "'Inter', system-ui" },
      bargap: 0.25,
      xaxis: {
        title: { text: 'Principal Component', standoff: 10 },
        gridcolor: c.grid, color: c.axis, tickfont: { size: 11 },
      },
      yaxis: {
        title: { text: 'Variance explained (%)', standoff: 10 },
        gridcolor: c.grid, zerolinecolor: c.zeroline, color: c.axis,
        tickfont: { size: 11 }, range: [0, Math.max(...variance) * 1.15],
      },
      yaxis2: {
        title: { text: 'Cumulative (%)', standoff: 10 },
        overlaying: 'y', side: 'right', range: [0, 105],
        gridcolor: 'transparent', color: '#f59e0b',
        tickfont: { size: 11 }, showgrid: false,
      },
      legend: { font: { size: 11 }, bgcolor: 'transparent', x: 0.5, xanchor: 'center', y: -0.18, orientation: 'h' },
      margin: { t: 36, r: 60, b: 70, l: 68 },
      modebar: { bgcolor: 'transparent', color: c.font, activecolor: 'var(--accent)' },
      hoverlabel: {
        bgcolor: 'rgba(13,20,36,0.9)',
        bordercolor: 'rgba(var(--accent-rgb),0.4)',
        font: { color: '#e2e8f0', size: 12 },
      },
    }

    Plotly.react(screeRef.current, [barTrace, lineTrace], layout, {
      responsive: false, displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    }).then(() => {
      screeRef.current?.querySelectorAll('.modebar-container, .modebar, .modebar-group')
        .forEach(el => el.style.setProperty('background', 'transparent', 'important'))
    })
  }, [pca, plotTab, pcKeys, variance, paletteName])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>

      {/* ── Sub-tab bar ── */}
      <div style={{ display: 'flex', gap: 4, padding: '3px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
        {[['scatter', '◉ Scatter'], ['scree', '↗ Scree'], ['loadings', '≋ Loadings']].map(([key, lbl]) => (
          <button key={key} onClick={() => setPlotTab(key)} style={TAB_BTN(plotTab === key)}>
            {lbl}
          </button>
        ))}
      </div>

      {/* ── Controls (scatter only) ── */}
      {plotTab === 'scatter' && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* X axis */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)',
                           letterSpacing: '0.04em', textTransform: 'uppercase' }}>X</span>
            <select value={xPC} onChange={e => setXPC(e.target.value)}
                    style={{ fontSize: '0.78rem', padding: '2px 6px', minWidth: 70 }}>
              {pcKeys.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          {/* Y axis */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)',
                           letterSpacing: '0.04em', textTransform: 'uppercase' }}>Y</span>
            <select value={yPC} onChange={e => setYPC(e.target.value)}
                    style={{ fontSize: '0.78rem', padding: '2px 6px', minWidth: 70 }}>
              {pcKeys.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          {/* Z axis (3D only) */}
          {is3D && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent)',
                             letterSpacing: '0.04em', textTransform: 'uppercase' }}>Z</span>
              <select value={zPC} onChange={e => setZPC(e.target.value)}
                      style={{ fontSize: '0.78rem', padding: '2px 6px', minWidth: 70 }}>
                {pcKeys.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          )}
          {/* 2D / 3D toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2,
                        background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
                        borderRadius: 6, padding: 2 }}>
            {['2D', '3D'].map(mode => {
              const active = (mode === '3D') === is3D
              const disabled = mode === '3D' && pcKeys.length < 3
              return (
                <button key={mode}
                        disabled={disabled}
                        onClick={() => setIs3D(mode === '3D')}
                        style={{ padding: '2px 10px', borderRadius: 4, border: 'none',
                                 cursor: disabled ? 'not-allowed' : 'pointer',
                                 fontSize: '0.72rem', fontWeight: active ? 600 : 400,
                                 background: active ? 'rgba(var(--accent-rgb),0.15)' : 'transparent',
                                 color: active ? 'var(--accent)' : disabled ? 'var(--text-3)' : 'var(--text-2)',
                                 opacity: disabled ? 0.4 : 1,
                                 transition: 'all 0.12s' }}>
                  {mode}
                </button>
              )
            })}
          </div>
          {/* Point size */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)',
                           letterSpacing: '0.04em', textTransform: 'uppercase' }}>Size</span>
            <input type="range" min={12} max={30} step={1} value={ptSize}
                   onChange={e => setPtSize(+e.target.value)} style={{ width: 80 }} />
            <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--accent-text)', minWidth: 18 }}>
              {ptSize}
            </span>
          </div>
          {/* Opacity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)',
                           letterSpacing: '0.04em', textTransform: 'uppercase' }}>Opacity</span>
            <input type="range" min={0.1} max={1} step={0.05} value={opacity}
                   onChange={e => setOpacity(+e.target.value)} style={{ width: 80 }} />
            <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--accent-text)', minWidth: 30 }}>
              {opacity.toFixed(2)}
            </span>
          </div>
          {/* Labels toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)',
                           letterSpacing: '0.04em', textTransform: 'uppercase' }}>Labels</span>
            <label className="toggle" style={{ transform: 'scale(0.85)', transformOrigin: 'left center' }}>
              <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
          {/* Color by */}
          {metaCols.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)',
                             letterSpacing: '0.04em', textTransform: 'uppercase' }}>Color by</span>
              <select
                value={colorBy || ''}
                onChange={e => setColorBy(e.target.value || null)}
                style={{ fontSize: '0.78rem', padding: '2px 6px', minWidth: 90 }}>
                {metaCols.map(col => (
                  <option key={col} value={col}>
                    {col}{col === design?.column ? ' (group)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Shape by */}
          {metaCols.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)',
                             letterSpacing: '0.04em', textTransform: 'uppercase' }}>Shape by</span>
              <select
                value={shapeBy || ''}
                onChange={e => setShapeBy(e.target.value || null)}
                style={{ fontSize: '0.78rem', padding: '2px 6px', minWidth: 90 }}>
                <option value=''>None</option>
                {metaCols.map(col => (
                  <option key={col} value={col}>
                    {col}{col === design?.column ? ' (group)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Palette picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)',
                           letterSpacing: '0.04em', textTransform: 'uppercase' }}>Palette</span>
            {Object.entries(PALETTES).map(([name, colors]) => (
              <button
                key={name}
                title={name}
                onClick={() => setPaletteName(name)}
                style={{
                  display: 'flex', gap: 2, alignItems: 'center', padding: '3px 6px',
                  borderRadius: 6, cursor: 'pointer',
                  border: paletteName === name ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: paletteName === name ? 'rgba(var(--accent-rgb),0.12)' : 'rgba(255,255,255,0.04)',
                }}>
                {colors.slice(0, 4).map((c, i) => (
                  <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'block' }} />
                ))}
              </button>
            ))}
          </div>

          {/* Export buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <ExportBtn onClick={exportScores} label="Scores + Metadata" />
            {variance?.length > 0 && <ExportBtn onClick={exportScree} label="Scree" />}
          </div>
        </div>
      )}

      {/* ── Scatter plot ── */}
      {plotTab === 'scatter' && (
        <>
          <div ref={outerRef}
               className="resizable-plot"
               style={{ width: '100%', height: 660 }}>
            <div ref={plotRef} style={{ width: '100%', height: '100%' }} />
          </div>

          {/* ── Summary bar ── */}
          {groupSummary.length > 0 && (
            <div style={{
              width: '100%', display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
              padding: '6px 10px',
              borderTop: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.02)',
              borderRadius: '0 0 8px 8px',
              fontSize: '0.72rem', color: 'var(--text-3)',
            }}>
              {/* Left: group legend */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-3)', marginRight: 2 }}>
                  {colorBy || design?.column}:
                </span>
                {groupSummary.map(g => (
                  <span key={g.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-2)' }}>{g.name}</span>
                    <span style={{ color: 'var(--text-3)' }}>({g.count})</span>
                  </span>
                ))}
              </div>
              {/* Right: totals + axes */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span>n <strong style={{ color: 'var(--text-2)' }}>{pca?.scores?.length}</strong> samples</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span style={{ color: 'var(--accent-text)', fontWeight: 600 }}>
                  {xPC} · {yPC}{is3D ? ` · ${zPC}` : ''}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Scree plot ── */}
      {plotTab === 'scree' && (
        <div ref={screeOuterRef}
             className="resizable-plot"
             style={{ width: '100%', height: 960 }}>
          <div ref={screeRef} style={{ width: '100%', height: '100%' }} />
        </div>
      )}

      {/* ── Loadings table ── */}
      {plotTab === 'loadings' && (
        <LoadingsTable
          loadings={pca?.loadings}
          pcKeys={pcKeys}
          variance={variance}
          annMap={annMap}
          rankByPC={rankByPC}
          setRankByPC={setRankByPC}
          topN={topN}
          setTopN={setTopN}
        />
      )}
    </div>
  )
}

// ── Shared export button ──────────────────────────────────────────────────────
function ExportBtn({ onClick, label }) {
  return (
    <button onClick={onClick} title={`Download ${label} as CSV`}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 7,
        fontSize: '0.7rem', fontWeight: 600,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        color: 'var(--text-2)', cursor: 'pointer',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
      }}>
      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      {label}
    </button>
  )
}

// ── Loadings table component ──────────────────────────────────────────────────
function LoadingsTable({ loadings, pcKeys, variance, annMap, rankByPC, setRankByPC, topN, setTopN }) {
  const { promptDownload, dialog } = useDownloadDialog()
  const hasAnn = annMap && Object.keys(annMap).length > 0

  const sorted = useMemo(() => {
    if (!loadings?.length) return []
    const pc = rankByPC
    return [...loadings]
      .filter(r => r[pc] != null)
      .sort((a, b) => Math.abs(b[pc]) - Math.abs(a[pc]))
      .slice(0, topN)
  }, [loadings, rankByPC, topN])

  // Show a subset of PC columns (selected PC + first 4 others, to avoid huge tables)
  const displayPCs = useMemo(() => {
    const others = pcKeys.filter(k => k !== rankByPC).slice(0, 4)
    return [rankByPC, ...others]
  }, [pcKeys, rankByPC])

  function fmtLoading(v) {
    if (v == null) return '—'
    const n = Number(v)
    return (n >= 0 ? '+' : '') + n.toFixed(4)
  }

  function doDownloadCSV(filename) {
    if (!sorted.length) return
    const allPCs = pcKeys
    const header = ['Rank', 'Gene', ...(hasAnn ? ['Symbol'] : []), ...allPCs.map(k => {
      const vi = pcKeys.indexOf(k)
      return variance[vi] != null ? `${k} (${Number(variance[vi]).toFixed(1)}%)` : k
    })]
    const rows = sorted.map((r, i) => [
      i + 1,
      r.gene,
      ...(hasAnn ? [annMap[r.gene] || ''] : []),
      ...allPCs.map(k => r[k] != null ? Number(r[k]).toFixed(6) : ''),
    ])
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: filename,
    })
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  if (!loadings?.length) return (
    <div style={{ color: 'var(--text-3)', fontSize: '0.85rem', padding: 20 }}>
      No loadings data — re-run the analysis to generate loadings.
    </div>
  )

  const thS = {
    padding: '8px 12px', fontSize: '0.72rem', fontWeight: 600,
    color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em',
    background: 'var(--bg-card2)', borderBottom: '1px solid var(--border)',
    borderRight: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 2,
    whiteSpace: 'nowrap',
  }
  const tdS = {
    padding: '5px 12px', fontSize: '0.78rem',
    borderBottom: '1px solid var(--border)',
    borderRight: '1px solid var(--border)',
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)',
                         textTransform: 'uppercase', letterSpacing: '0.04em' }}>Rank by</span>
          <select value={rankByPC} onChange={e => setRankByPC(e.target.value)}
                  style={{ fontSize: '0.78rem', padding: '2px 6px', minWidth: 70 }}>
            {pcKeys.map(k => {
              const vi = pcKeys.indexOf(k)
              const vp = variance[vi] != null ? ` (${Number(variance[vi]).toFixed(1)}%)` : ''
              return <option key={k} value={k}>{k}{vp}</option>
            })}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)',
                         textTransform: 'uppercase', letterSpacing: '0.04em' }}>Top</span>
          <select value={topN} onChange={e => setTopN(Number(e.target.value))}
                  style={{ fontSize: '0.78rem', padding: '2px 6px' }}>
            {[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button onClick={() => promptDownload(`pca_loadings_${rankByPC}.csv`, doDownloadCSV)}
                style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: '0.75rem',
                         borderRadius: 6, border: '1px solid var(--border)',
                         background: 'var(--bg-card2)', color: 'var(--text-2)',
                         cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download CSV
        </button>
      </div>
      {dialog}

      {/* Table */}
      <div className="glass" style={{ overflow: 'auto', maxHeight: 600, borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: '0.78rem' }}>
          <thead>
            <tr>
              <th style={{ ...thS, width: 40, textAlign: 'center' }}>#</th>
              <th style={thS}>Gene</th>
              {hasAnn && <th style={thS}>Symbol</th>}
              {displayPCs.map((k, ci) => {
                const vi = pcKeys.indexOf(k)
                const vp = variance[vi] != null ? ` (${Number(variance[vi]).toFixed(1)}%)` : ''
                const isRank = k === rankByPC
                return (
                  <th key={k} style={{
                    ...thS,
                    color: isRank ? 'var(--accent-text)' : 'var(--text-3)',
                    ...(ci === displayPCs.length - 1 ? { borderRight: 'none' } : {}),
                  }}>
                    {k}{vp}{isRank ? ' ▼' : ''}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const sym = hasAnn ? (typeof annMap[row.gene] === 'string' && annMap[row.gene] ? annMap[row.gene] : null) : null
              return (
                <tr key={row.gene}>
                  <td style={{ ...tdS, textAlign: 'center', color: 'var(--text-3)', width: 40 }}>{i + 1}</td>
                  <td style={{ ...tdS, fontFamily: 'monospace', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                    {row.gene}
                  </td>
                  {hasAnn && (
                    <td style={{ ...tdS, color: sym ? 'var(--accent-text)' : 'var(--text-3)',
                                 fontStyle: sym ? 'normal' : 'italic', whiteSpace: 'nowrap' }}>
                      {sym || '—'}
                    </td>
                  )}
                  {displayPCs.map((k, ci) => {
                    const val = row[k]
                    const n   = val != null ? Number(val) : null
                    const isRank = k === rankByPC
                    const color = n == null ? 'var(--text-3)'
                                : n > 0    ? '#34d399'
                                :             '#f87171'
                    return (
                      <td key={k} style={{
                        ...tdS,
                        fontFamily: 'monospace',
                        color: isRank ? color : 'var(--text-2)',
                        fontWeight: isRank ? 600 : 400,
                        ...(ci === displayPCs.length - 1 ? { borderRight: 'none' } : {}),
                      }}>
                        {fmtLoading(val)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
        Showing top {sorted.length} genes by |loading| on {rankByPC} · loadings shown for {rankByPC} + first {displayPCs.length - 1} other PCs · download CSV for all PCs
        {hasAnn ? ' · annotations loaded' : ' · load annotations in the Annotation tab to add gene symbols'}
      </p>
    </div>
  )
}
