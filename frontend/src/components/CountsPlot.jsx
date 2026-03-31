import { useEffect, useRef, useState, useMemo } from 'react'
import Plotly from 'plotly.js-dist-min'

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
    grid:     isLight ? 'rgba(0,0,0,0.14)'   : 'rgba(255,255,255,0.12)',
    zeroline: isLight ? 'rgba(0,0,0,0.25)'   : 'rgba(255,255,255,0.15)',
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

export default function CountsPlot({ countDist, design, metadata, sampleLabels = {} }) {
  const outerRef     = useRef(null)
  const plotRef      = useRef(null)
  const [countType,   setCountType]  = useState('vst')
  const [showPoints,  setShowPoints] = useState(false)
  const [paletteName, setPaletteName] = useState('Clinical')
  const [colorBy,     setColorBy]    = useState(design?.column ?? null)

  // Derive available metadata columns + sample lookup from pca scores
  const { metaCols, sampleMeta } = useMemo(() => {
    if (!metadata?.length) return { metaCols: [], sampleMeta: {} }
    const cols   = Object.keys(metadata[0]).filter(k => k !== 'sample' && !/^PC\d+$/.test(k))
    const lookup = {}
    metadata.forEach(r => { lookup[r.sample] = r })
    return { metaCols: cols, sampleMeta: lookup }
  }, [metadata])

  // Resize observer — keeps Plotly in sync when user drags the handle
  useEffect(() => {
    if (!outerRef.current || !plotRef.current) return
    const ro = new ResizeObserver(() => {
      if (plotRef.current?._fullLayout) Plotly.Plots.resize(plotRef.current)
    })
    ro.observe(outerRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!plotRef.current || !countDist?.vst?.length) return
    const c      = getThemeColors()
    const data   = countDist[countType]
    if (!data?.length) return

    // Resolve group value per sample using colorBy column (fall back to condition)
    const getGroup = (d) => {
      if (colorBy && sampleMeta[d.sample]) return String(sampleMeta[d.sample][colorBy] ?? d.condition)
      return d.condition
    }

    // Build group → color mapping
    const palette = PALETTES[paletteName] || PALETTES['Clinical']
    const groups  = [...new Set(data.map(getGroup))]
    const colorMap = {}
    groups.forEach((g, i) => { colorMap[g] = palette[i % palette.length] })

    // One violin trace per sample (grouped by colorBy value for legend)
    const legendShown = new Set()
    const traces = data.map(d => {
      const grp        = getGroup(d)
      const showLegend = !legendShown.has(grp)
      if (showLegend) legendShown.add(grp)
      const col = colorMap[grp]
      const displayName = sampleLabels[d.sample] ?? d.sample
      return {
        type: 'violin',
        x0:   displayName,
        y:    d.values,
        name: grp,
        legendgroup: grp,
        scalegroup:  d.sample,
        box:      { visible: true, width: 0.5 },
        meanline: { visible: true, color: col },
        points:   showPoints ? 'all' : false,
        jitter:   0.4,
        pointpos: 0,
        marker:   { size: 2.5, opacity: 0.3, color: col },
        fillcolor: col + '55',
        line:     { color: col, width: 1.5 },
        opacity:  1,
        showlegend: showLegend,
        hovertemplate: `<b>${displayName}</b><br>%{y:.3f}<extra>${grp}</extra>`,
      }
    })

    const yTitle = countType === 'raw' ? 'log₂(count + 1)' : 'VST value'

    const tickvals = data.map(d => sampleLabels[d.sample] ?? d.sample)
    const ticktext = data.map(d => sampleLabels[d.sample] ?? d.sample)

    const layout = {
      paper_bgcolor: 'transparent',
      plot_bgcolor:  'transparent',
      font: { color: c.font, family: "'Inter', system-ui" },
      violinmode: 'overlay',
      xaxis: {
        title: { text: 'Sample', standoff: 10 },
        color: c.axis, tickfont: { size: 9 },
        tickangle: data.length > 10 ? -45 : 0,
        tickvals, ticktext,
        gridcolor: c.grid, showgrid: false,
      },
      yaxis: {
        title: { text: yTitle, standoff: 10 },
        gridcolor: c.grid, zerolinecolor: c.zeroline, color: c.axis,
        tickfont: { size: 11 }, showgrid: true,
      },
      legend: {
        font: { size: 11 }, bgcolor: 'transparent',
        orientation: 'h',
        x: 0.5, xanchor: 'center',
        y: -0.18, yanchor: 'top',
      },
      margin: { t: 36, r: 20, b: data.length > 10 ? 140 : 90, l: 68 },
      modebar: { bgcolor: 'transparent', color: c.font, activecolor: 'var(--accent)' },
      hoverlabel: {
        bgcolor: 'rgba(13,20,36,0.9)',
        bordercolor: 'rgba(var(--accent-rgb),0.4)',
        font: { color: '#e2e8f0', size: 12 },
      },
    }

    Plotly.react(plotRef.current, traces, layout, {
      responsive: false,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    }).then(() => {
      plotRef.current?.querySelectorAll('.modebar-container, .modebar, .modebar-group')
        .forEach(el => el.style.setProperty('background', 'transparent', 'important'))
    })
  }, [countDist, countType, showPoints, paletteName, colorBy, sampleMeta, sampleLabels])

  if (!countDist?.vst?.length) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>
        <p style={{ fontSize: '0.9rem', marginBottom: 6 }}>No count data available.</p>
        <p style={{ fontSize: '0.78rem', opacity: 0.7 }}>
          Run a new analysis (not resumed from session) to load count distributions.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>

        {/* Type toggle */}
        <div style={{
          display: 'flex', gap: 4, padding: '3px', borderRadius: 8,
          background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
        }}>
          {[
            ['raw', (
              <><svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
                <rect x="1" y="6" width="2.5" height="6" rx="0.5" fill="currentColor" opacity="0.7"/>
                <rect x="5" y="3" width="2.5" height="9" rx="0.5" fill="currentColor"/>
                <rect x="9" y="1" width="2.5" height="11" rx="0.5" fill="currentColor" opacity="0.7"/>
              </svg> Raw counts (log₂)</>
            )],
            ['vst', (
              <><svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
                <path d="M1 10 Q3 2 5 6 Q7 10 9 4 Q11 0 12 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                <circle cx="5" cy="6" r="1.2" fill="currentColor"/>
                <circle cx="9" cy="4" r="1.2" fill="currentColor"/>
              </svg> VST (varianceStabilizingTransformation)</>
            )],
          ].map(([key, lbl]) => (
            <button key={key} onClick={() => setCountType(key)}
                    style={{ ...TAB_BTN(countType === key), display: 'flex', alignItems: 'center', gap: 5 }}>
              {lbl}
            </button>
          ))}
        </div>

        {/* Jitter points toggle */}
        <button
          onClick={() => setShowPoints(p => !p)}
          style={{
            padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)',
            cursor: 'pointer', fontSize: '0.78rem', fontWeight: showPoints ? 600 : 400,
            background: showPoints ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
            color: showPoints ? 'var(--text-1)' : 'var(--text-3)',
            transition: 'all 0.15s',
          }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }}>
            <circle cx="3" cy="9" r="1.5" fill="currentColor" opacity="0.6"/>
            <circle cx="7" cy="5" r="1.5" fill="currentColor"/>
            <circle cx="11" cy="8" r="1.5" fill="currentColor" opacity="0.6"/>
            <circle cx="5" cy="10" r="1.5" fill="currentColor" opacity="0.8"/>
            <circle cx="10" cy="3" r="1.5" fill="currentColor" opacity="0.7"/>
          </svg>Points
        </button>

        {/* Color by */}
        {metaCols.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Color by</span>
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

        {/* Palette picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Palette</span>
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
      </div>

      {/* Violin plot — resizable */}
      <div ref={outerRef}
           className="resizable-plot"
           style={{ width: '100%', height: 538 }}>
        <div ref={plotRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  )
}
