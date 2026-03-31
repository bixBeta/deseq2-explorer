import { useEffect, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import GeneViolinModal from './GeneViolinModal'

const CTRL_LABEL = {
  fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)',
  letterSpacing: '0.04em', textTransform: 'uppercase',
}

export default function MAPlot({ design, session, annMap }) {
  const plotRef = useRef(null)

  const [fdr,       setFdr]       = useState(0.05)
  const [fc,        setFc]        = useState(1.5)
  const [topN,      setTopN]      = useState(15)
  const [size,      setSize]      = useState(8)
  const [labelBy,   setLabelBy]   = useState('padj')   // 'padj' | 'fc'

  const [rawPoints,  setRawPoints]  = useState(null)
  const [plotLabel,  setPlotLabel]  = useState('')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)

  const [violinGene,   setViolinGene]   = useState(null)
  const [violinSymbol, setViolinSymbol] = useState(null)

  // ── Fetch raw data when session / contrast changes ──────────────────────────
  useEffect(() => {
    if (!session?.sessionId) return
    const label = design?.contrast && design?.reference
      ? `${design.contrast} vs ${design.reference}` : null

    setLoading(true); setError(null); setRawPoints(null)
    const ctrl = new AbortController()

    fetch('/api/maplot', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: session.sessionId, label, annMap: annMap || null }),
      signal:  ctrl.signal,
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setRawPoints(data.points || [])
        setPlotLabel(data.label || '')
        setLoading(false)
      })
      .catch(e => {
        if (e.name !== 'AbortError') { setError(e.message); setLoading(false) }
      })

    return () => ctrl.abort()
  }, [session, design, annMap])

  // ── Re-draw whenever data or display params change (no re-fetch) ────────────
  useEffect(() => {
    if (!rawPoints || !plotRef.current) return

    const log2fc_thresh = Math.log2(fc)

    const classified = rawPoints.map(p => {
      let group = 'ns'
      if (p.padj != null && p.padj < fdr && p.log2FC != null) {
        if      (p.log2FC >=  log2fc_thresh) group = 'up'
        else if (p.log2FC <= -log2fc_thresh) group = 'down'
      }
      return { ...p, group }
    })

    const byGroup = { up: [], down: [], ns: [] }
    classified.forEach(p => byGroup[p.group].push(p))

    const makeTrace = (pts, color, name, opacity) => ({
      x: pts.map(p => Math.log10((p.baseMean ?? 0) + 1)),
      y: pts.map(p => p.log2FC ?? 0),
      mode: 'markers',
      type: 'scatter',
      name,
      marker: { color, size, opacity },
      customdata: pts.map(p => [p.geneId, p.gene, p.baseMean, p.log2FC, p.padj]),
      hovertemplate:
        '<b>%{customdata[1]}</b><br>' +
        'baseMean: %{customdata[2]}<br>' +
        'log₂FC: %{customdata[3]}<br>' +
        'padj: %{customdata[4]}<extra></extra>',
    })

    const up   = byGroup.up
    const down = byGroup.down
    const ns   = byGroup.ns

    const traces = [
      makeTrace(ns,   'darkgray', `Not significant (${ns.length})`,   0.35),
      makeTrace(up,   '#B31B21',  `Up (${up.length})`,                0.75),
      makeTrace(down, '#1465AC',  `Down (${down.length})`,            0.75),
    ]

    // Top-N persistent labels — sorted by padj or absolute FC
    const sig = classified
      .filter(p => p.group !== 'ns' && p.padj != null && p.log2FC != null)
      .sort((a, b) => labelBy === 'fc'
        ? Math.abs(b.log2FC) - Math.abs(a.log2FC)
        : a.padj - b.padj)
      .slice(0, topN)

    const annotations = sig.map(p => ({
      x: Math.log10((p.baseMean ?? 0) + 1),
      y: p.log2FC ?? 0,
      text: p.gene,
      showarrow: true,
      arrowhead: 0,
      arrowwidth: 1,
      arrowcolor: '#94a3b8',
      ax: 0, ay: -18,
      font: { size: 9, color: '#1e293b' },
      bgcolor: 'rgba(255,255,255,0.75)',
      borderpad: 2,
    }))

    const layout = {
      title: { text: plotLabel, font: { size: 14, color: getComputedStyle(document.documentElement).getPropertyValue('--text-1').trim() || '#1e293b' } },
      xaxis: {
        title: 'log₁₀(baseMean + 1)',
        gridcolor: getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#e2e8f0',
        zeroline: false,
        color: getComputedStyle(document.documentElement).getPropertyValue('--text-2').trim() || '#475569',
      },
      yaxis: {
        title: 'log₂ Fold Change',
        gridcolor: getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#e2e8f0',
        zeroline: true,
        zerolinecolor: getComputedStyle(document.documentElement).getPropertyValue('--text-3').trim() || '#94a3b8',
        zerolinewidth: 1.5,
        color: getComputedStyle(document.documentElement).getPropertyValue('--text-2').trim() || '#475569',
      },
      plot_bgcolor:  getComputedStyle(document.documentElement).getPropertyValue('--bg-panel').trim()  || '#ffffff',
      paper_bgcolor: getComputedStyle(document.documentElement).getPropertyValue('--bg-panel').trim()  || '#ffffff',
      legend: {
        orientation: 'h', y: -0.13, x: 0.5, xanchor: 'center',
        font: { size: 11, color: getComputedStyle(document.documentElement).getPropertyValue('--text-2').trim() || '#475569' },
      },
      annotations,
      height: 800,
      width: plotRef.current ? plotRef.current.clientWidth : undefined,
      margin: { t: 50, r: 24, b: 70, l: 64 },
      hovermode: 'closest',
      shapes: [
        {
          type: 'line', x0: 0, x1: 1, xref: 'paper',
          y0:  Math.log2(fc), y1:  Math.log2(fc),
          line: { color: '#94a3b8', dash: 'dot', width: 1 },
        },
        {
          type: 'line', x0: 0, x1: 1, xref: 'paper',
          y0: -Math.log2(fc), y1: -Math.log2(fc),
          line: { color: '#94a3b8', dash: 'dot', width: 1 },
        },
      ],
    }

    const config = {
      responsive: true,
      autosize: true,
      displaylogo: false,
      toImageButtonOptions: { filename: 'maplot', scale: 2, format: 'png' },
      modeBarButtonsToRemove: ['select2d', 'lasso2d'],
    }

    Plotly.react(plotRef.current, traces, layout, config)

    // Click a point → open violin modal
    plotRef.current.removeAllListeners?.('plotly_click')
    plotRef.current.on('plotly_click', e => {
      const pt = e.points?.[0]
      if (!pt?.customdata) return
      const [geneId, gene] = pt.customdata
      setViolinGene(geneId)
      setViolinSymbol(gene !== geneId ? gene : null)
    })
  }, [rawPoints, fdr, fc, topN, size, labelBy, plotLabel])

  if (!session?.sessionId) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>
        Session not available — please re-run the analysis to view the MA plot.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Controls ── */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={CTRL_LABEL}>FDR</span>
          <select value={fdr} onChange={e => setFdr(+e.target.value)}
                  style={{ fontSize: '0.78rem', padding: '2px 6px', minWidth: 72 }}>
            {[0.001, 0.01, 0.05, 0.1].map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={CTRL_LABEL}>FC</span>
          <input type="range" min={1} max={6} step={0.1} value={fc}
                 onChange={e => setFc(+e.target.value)} style={{ width: 80 }} />
          <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--accent-text)', minWidth: 34 }}>
            {fc.toFixed(1)}×
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={CTRL_LABEL}>Labels</span>
          <input type="number" min={0} max={50} value={topN}
                 onChange={e => setTopN(Math.max(0, Math.min(50, +e.target.value || 0)))}
                 style={{
                   width: 52, fontSize: '0.78rem', padding: '2px 6px', textAlign: 'center',
                   background: 'var(--bg-card2)', border: '1px solid var(--border)',
                   borderRadius: 6, color: 'var(--text-1)',
                 }} />
          <span style={CTRL_LABEL}>by</span>
          <select value={labelBy} onChange={e => setLabelBy(e.target.value)}
                  style={{ fontSize: '0.78rem', padding: '2px 6px' }}>
            <option value="padj">padj</option>
            <option value="fc">|FC|</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={CTRL_LABEL}>Size</span>
          <input type="range" min={5} max={20} step={0.5} value={size}
                 onChange={e => setSize(+e.target.value)} style={{ width: 70 }} />
          <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--accent-text)', minWidth: 24 }}>
            {size}
          </span>
        </div>

        {loading && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', fontStyle: 'italic',
                         display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              border: '2px solid var(--accent)', borderTopColor: 'transparent',
              display: 'inline-block', animation: 'spin 0.7s linear infinite',
            }} />
            Loading…
          </span>
        )}

        <span style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginLeft: 'auto' }}>
          Click a point to open violin plot
        </span>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, fontSize: '0.82rem',
          background: 'rgba(248,113,113,0.08)', color: '#f87171',
          border: '1px solid rgba(248,113,113,0.2)',
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Plot ── */}
      {!rawPoints && !loading && !error && (
        <div style={{ height: 480, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--text-3)', fontSize: '0.85rem' }}>
          Waiting for data…
        </div>
      )}
      <div ref={plotRef} style={{ width: '100%', height: 800,
                                   display: rawPoints ? 'block' : 'none' }} />

      {/* ── Violin modal on point click ── */}
      {violinGene && (
        <GeneViolinModal
          gene={violinGene}
          symbol={violinSymbol}
          session={session}
          contrast={{
            label:     plotLabel,
            treatment: design?.contrast,
            reference: design?.reference,
          }}
          column={design?.column}
          onClose={() => { setViolinGene(null); setViolinSymbol(null) }}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
