import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'

function extractSets(runs, padjCutoff, topN, searchQ) {
  const q = searchQ.trim().toLowerCase()
  const sets = []
  for (const run of runs) {
    const results = run.results ?? []
    let filtered = results.filter(r => (r.padj ?? 1) <= padjCutoff)
    if (q) filtered = filtered.filter(r => r.pathway.toLowerCase().includes(q))
    if (topN > 0) filtered = filtered.slice(0, topN)
    for (const r of filtered) {
      const genes = (r.leadingEdge ?? '').split(',').map(g => g.trim()).filter(Boolean)
      if (!genes.length) continue
      const shortContrast = run.contrastLabel?.replace(/\s+vs\s+/i, 'v') ?? run.id
      const shortPathway  = r.pathway.length > 32 ? r.pathway.slice(0, 32) + '…' : r.pathway
      const plotLabel = `${shortContrast}: ${shortPathway}`
      sets.push({
        id: `${run.id}::${r.pathway}`,
        pathway: r.pathway,
        plotLabel,
        displayLabel: `${run.contrastLabel} · ${run.collectionLabel}`,
        genes,
        geneSet: new Set(genes),
        nes: r.NES,
        padj: r.padj,
        run,
      })
    }
  }
  return sets
}

function downloadCSV(rows, filename) {
  if (!rows?.length) return
  const keys = Object.keys(rows[0])
  const csv  = [keys.join(','), ...rows.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n')
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: filename,
  })
  a.click(); URL.revokeObjectURL(a.href)
}

function SetRow({ item, selected, onToggle }) {
  return (
    <label style={{
      display: 'grid', gridTemplateColumns: '16px 1fr', gap: 8, padding: '6px 8px',
      borderRadius: 6, cursor: 'pointer',
      background: selected ? 'rgba(99,102,241,0.1)' : 'transparent',
      border: `1px solid ${selected ? 'rgba(99,102,241,0.3)' : 'transparent'}`,
      transition: 'background 0.12s',
    }}>
      <input type="checkbox" checked={selected} onChange={() => onToggle(item.id)}
             style={{ marginTop: 3, accentColor: '#6366f1' }} />
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontSize: '0.74rem', lineHeight: 1.35,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
             title={item.pathway}>
          {item.pathway}
        </div>
        <div style={{ fontSize: '0.64rem', color: 'var(--text-3)', marginTop: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.displayLabel}
        </div>
        <div style={{ marginTop: 2, fontSize: '0.63rem', color: 'var(--text-3)' }}>
          <span style={{ color: (item.nes ?? 0) >= 0 ? '#10b981' : '#f43f5e', marginRight: 6 }}>
            NES {item.nes != null ? item.nes.toFixed(2) : '—'}
          </span>
          padj {item.padj != null ? item.padj.toExponential(1) : '—'}
          {' · '}{item.genes.length} genes
        </div>
      </div>
    </label>
  )
}

// ── Simple mouse-follow tooltip (portaled to body to escape stacking contexts) ─
function useTooltip() {
  const [tip, setTip] = useState({ text: '', x: 0, y: 0, visible: false })
  const show = useCallback((text, e) => {
    setTip({ text, x: e.clientX + 14, y: e.clientY + 14, visible: true })
  }, [])
  const move = useCallback((e) => {
    setTip(prev => prev.visible ? { ...prev, x: e.clientX + 14, y: e.clientY + 14 } : prev)
  }, [])
  const hide = useCallback(() => setTip(prev => ({ ...prev, visible: false })), [])
  const node = tip.visible ? createPortal(
    <div style={{
      position: 'fixed', left: tip.x, top: tip.y, zIndex: 99999, pointerEvents: 'none',
      background: '#1e293b', color: '#f1f5f9', fontSize: '0.72rem', padding: '6px 10px',
      borderRadius: 6, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.12)', maxWidth: 420, whiteSpace: 'pre-wrap',
      lineHeight: 1.5,
    }}>
      {tip.text}
    </div>,
    document.body
  ) : null
  return { show, move, hide, node }
}

// ── Pairwise overlap matrix ───────────────────────────────────────────────────
function OverlapMatrix({ sets }) {
  const [metric, setMetric] = useState('count')
  const { show, move, hide, node: tipNode } = useTooltip()

  const matrix = useMemo(() => {
    return sets.map((a, i) =>
      sets.map((b, j) => {
        if (i === j) return null
        const inter = [...a.geneSet].filter(g => b.geneSet.has(g)).length
        const union = new Set([...a.geneSet, ...b.geneSet]).size
        return {
          count: inter,
          jaccard: union > 0 ? inter / union : 0,
          overlap_coef: Math.min(a.geneSet.size, b.geneSet.size) > 0
            ? inter / Math.min(a.geneSet.size, b.geneSet.size) : 0,
        }
      })
    )
  }, [sets])

  const maxCount = useMemo(() => Math.max(...matrix.flat().filter(Boolean).map(c => c.count), 1), [matrix])

  function cellColor(cell) {
    if (!cell) return 'transparent'
    const v = metric === 'count' ? cell.count / maxCount
      : metric === 'jaccard' ? cell.jaccard : cell.overlap_coef
    return `rgba(99,102,241,${(0.08 + v * 0.72).toFixed(2)})`
  }

  function cellValue(cell) {
    if (!cell) return '—'
    if (metric === 'count')   return cell.count
    if (metric === 'jaccard') return cell.jaccard.toFixed(2)
    return cell.overlap_coef.toFixed(2)
  }

  // Tooltip for intersection cells: show shared genes
  function intersectionTip(a, b, cell) {
    if (!cell || cell.count === 0) return null
    const shared = [...a.geneSet].filter(g => b.geneSet.has(g))
    return `${a.pathway}\n∩ ${b.pathway}\n\n${cell.count} shared genes:\n${shared.slice(0, 20).join(', ')}${shared.length > 20 ? ` … +${shared.length - 20} more` : ''}`
  }

  const COL_W = 110
  const ROW_LBL_W = 160
  const tdBase = { border: '1px solid var(--border)', fontSize: '0.68rem', padding: '5px 8px' }

  return (
    <div>
      {tipNode}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-2)', letterSpacing: '0.05em' }}>
          PAIRWISE OVERLAP
        </span>
        {['count', 'jaccard', 'overlap_coef'].map(m => (
          <button key={m} onClick={() => setMetric(m)}
                  style={{
                    fontSize: '0.65rem', padding: '2px 8px', borderRadius: 5, cursor: 'pointer', border: '1px solid',
                    background: metric === m ? 'rgba(99,102,241,0.15)' : 'transparent',
                    borderColor: metric === m ? 'rgba(99,102,241,0.4)' : 'var(--border)',
                    color: metric === m ? '#818cf8' : 'var(--text-3)',
                  }}>
            {m === 'count' ? 'Count' : m === 'jaccard' ? 'Jaccard' : 'Overlap coef.'}
          </button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed',
                        width: ROW_LBL_W + sets.length * COL_W }}>
          <colgroup>
            <col style={{ width: ROW_LBL_W }} />
            {sets.map((_, i) => <col key={i} style={{ width: COL_W }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...tdBase, background: 'var(--bg-card2)', textAlign: 'left' }}>Pathway</th>
              {sets.map((s, i) => (
                <th key={i}
                    onMouseEnter={e => show(s.pathway, e)}
                    onMouseMove={move}
                    onMouseLeave={hide}
                    style={{ ...tdBase, background: 'var(--bg-card2)', textAlign: 'center',
                             overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                             cursor: 'default' }}>
                  {s.pathway}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sets.map((rowSet, i) => (
              <tr key={i}>
                <td onMouseEnter={e => show(rowSet.pathway, e)}
                    onMouseMove={move}
                    onMouseLeave={hide}
                    style={{ ...tdBase, background: 'var(--bg-card2)', textAlign: 'left',
                             overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                             cursor: 'default', fontWeight: 500 }}>
                  {rowSet.pathway}
                </td>
                {matrix[i].map((cell, j) => {
                  const tip = i === j ? `${rowSet.pathway}\n${rowSet.genes.length} genes` : intersectionTip(rowSet, sets[j], cell)
                  return (
                    <td key={j}
                        onMouseEnter={tip ? e => show(tip, e) : undefined}
                        onMouseMove={tip ? move : undefined}
                        onMouseLeave={tip ? hide : undefined}
                        style={{
                          ...tdBase, textAlign: 'center',
                          background: i === j ? 'rgba(255,255,255,0.03)' : cellColor(cell),
                          color: cell ? 'var(--text-1)' : 'var(--text-3)',
                          fontWeight: cell?.count > 0 ? 600 : 400,
                          cursor: tip ? 'default' : undefined,
                        }}>
                      {i === j
                        ? <span style={{ opacity: 0.35, fontSize: '0.65rem' }}>{rowSet.genes.length}</span>
                        : cellValue(cell)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GSEACompare({ session, gseaRuns }) {
  const runs = gseaRuns ?? []

  const [padjCutoff, setPadjCutoff] = useState(0.05)
  const [topN,       setTopN]       = useState(0)
  const [searchQ,    setSearchQ]    = useState('')
  const [selected,   setSelected]   = useState(new Set())
  const [expandedGenes, setExpandedGenes] = useState(new Set())

  const allSets = useMemo(
    () => extractSets(runs, padjCutoff, topN, searchQ),
    [runs, padjCutoff, topN, searchQ]
  )

  const selectedSets = useMemo(
    () => allSets.filter(s => selected.has(s.id)),
    [allSets, selected]
  )

  function toggleItem(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function selectAll() { setSelected(new Set(allSets.map(s => s.id))) }
  function clearAll()  { setSelected(new Set()) }

  function exportTableCSV() {
    const rows = selectedSets.map(s => ({
      pathway:    s.pathway,
      contrast:   s.run.contrastLabel,
      collection: s.run.collectionLabel,
      NES:        s.nes != null ? s.nes.toFixed(3) : '',
      padj:       s.padj != null ? s.padj.toExponential(3) : '',
      n_genes:    s.genes.length,
      leading_edge: s.genes.join(';'),
    }))
    downloadCSV(rows, 'gsea_compare_pathways.csv')
  }

  const { show: showTip, move: moveTip, hide: hideTip, node: tipNode } = useTooltip()

  if (!runs.length) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: 60 }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>⟳</div>
        <p style={{ fontSize: '0.9rem' }}>No GSEA runs yet. Run at least two analyses in the GSEA tab first.</p>
      </div>
    )
  }

  const inputStyle = {
    background: 'var(--bg-card2)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '4px 8px', color: 'var(--text-1)', fontSize: '0.8rem',
  }

  const tdBase = { border: '1px solid var(--border)', padding: '6px 10px', fontSize: '0.75rem', verticalAlign: 'top' }

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      {tipNode}

      {/* ── Left panel ── */}
      <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="glass" style={{ padding: 12 }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-2)',
                        letterSpacing: '0.06em', marginBottom: 8 }}>
            FILTER PATHWAYS
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: '0.63rem', color: 'var(--text-3)' }}>padj ≤</span>
              <input type="number" step="0.01" min="0" max="1" value={padjCutoff}
                     onChange={e => setPadjCutoff(+e.target.value)} style={inputStyle} />
            </label>
            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: '0.63rem', color: 'var(--text-3)' }}>Top N (0=all)</span>
              <input type="number" step="1" min="0" value={topN}
                     onChange={e => setTopN(+e.target.value)} style={inputStyle} />
            </label>
          </div>
          <input type="text" placeholder="Search pathways…" value={searchQ}
                 onChange={e => setSearchQ(e.target.value)}
                 style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', outline: 'none' }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>
            {allSets.length} pathways · <strong style={{ color: 'var(--text-2)' }}>{selected.size}</strong> selected
          </span>
          <div style={{ display: 'flex', gap: 5 }}>
            {['All', 'Clear'].map(lbl => (
              <button key={lbl} onClick={lbl === 'All' ? selectAll : clearAll}
                      style={{
                        fontSize: '0.68rem', padding: '2px 8px', cursor: 'pointer',
                        background: lbl === 'All' ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)',
                        color: lbl === 'All' ? '#818cf8' : 'var(--text-3)',
                        border: `1px solid ${lbl === 'All' ? 'rgba(99,102,241,0.25)' : 'var(--border)'}`,
                        borderRadius: 5,
                      }}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowY: 'auto', maxHeight: 460, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {allSets.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: '0.78rem', textAlign: 'center', padding: '20px 0' }}>
              No significant pathways match filters.
            </div>
          ) : allSets.map(item => (
            <SetRow key={item.id} item={item} selected={selected.has(item.id)} onToggle={toggleItem} />
          ))}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {selectedSets.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: 60 }}>
            Select pathways from the left panel to populate the table.
          </div>
        ) : <>
          {/* Pathway details table */}
          <div className="glass" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-2)', letterSpacing: '0.06em' }}>
                SELECTED PATHWAYS ({selectedSets.length})
              </span>
              <button onClick={exportTableCSV}
                      style={{ fontSize: '0.68rem', padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                               background: 'rgba(99,102,241,0.1)', color: '#818cf8',
                               border: '1px solid rgba(99,102,241,0.25)' }}>
                ↓ CSV
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-card2)' }}>
                    {['Pathway', 'Contrast', 'Collection', 'NES', 'padj', 'n genes', 'Leading edge'].map(h => (
                      <th key={h} style={{ ...tdBase, fontWeight: 700, color: 'var(--text-2)',
                                           textAlign: h === 'NES' || h === 'padj' || h === 'n genes' ? 'right' : 'left',
                                           whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedSets.map((s, i) => {
                    const showAll = expandedGenes.has(s.id)
                    const preview = showAll ? s.genes : s.genes.slice(0, 2)
                    const remaining = s.genes.length - 2
                    return (
                      <tr key={s.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                        <td style={{ ...tdBase, whiteSpace: 'nowrap', maxWidth: 220, fontWeight: 500, cursor: 'default' }}
                            onMouseEnter={e => showTip(s.pathway, e)}
                            onMouseMove={moveTip}
                            onMouseLeave={hideTip}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                            {s.pathway}
                          </div>
                        </td>
                        <td style={{ ...tdBase, whiteSpace: 'nowrap', color: 'var(--text-2)' }}>{s.run.contrastLabel}</td>
                        <td style={{ ...tdBase, whiteSpace: 'nowrap', color: 'var(--text-2)' }}>{s.run.collectionLabel}</td>
                        <td style={{ ...tdBase, whiteSpace: 'nowrap', textAlign: 'right',
                                     color: (s.nes ?? 0) >= 0 ? '#10b981' : '#f43f5e', fontWeight: 600 }}>
                          {s.nes != null ? s.nes.toFixed(3) : '—'}
                        </td>
                        <td style={{ ...tdBase, whiteSpace: 'nowrap', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.7rem' }}>
                          {s.padj != null ? s.padj.toExponential(2) : '—'}
                        </td>
                        <td style={{ ...tdBase, whiteSpace: 'nowrap', textAlign: 'right', fontWeight: 600 }}>
                          {s.genes.length}
                        </td>
                        <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            {preview.map(g => (
                              <span key={g} style={{
                                fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4,
                                background: 'rgba(99,102,241,0.1)', color: '#818cf8',
                                border: '1px solid rgba(99,102,241,0.2)', fontFamily: 'monospace',
                              }}>{g}</span>
                            ))}
                            {remaining > 0 && (
                              <button onClick={() => setExpandedGenes(prev => {
                                const next = new Set(prev)
                                showAll ? next.delete(s.id) : next.add(s.id)
                                return next
                              })} style={{
                                fontSize: '0.65rem', padding: '1px 6px', borderRadius: 4,
                                background: 'rgba(255,255,255,0.05)', color: 'var(--text-3)',
                                border: '1px solid var(--border)', cursor: 'pointer', flexShrink: 0,
                              }}>
                                {showAll ? '▴ less' : `+${remaining} more`}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pairwise overlap matrix */}
          {selectedSets.length >= 2 && (
            <div className="glass" style={{ padding: 14 }}>
              <OverlapMatrix sets={selectedSets} />
            </div>
          )}
        </>}
      </div>
    </div>
  )
}
