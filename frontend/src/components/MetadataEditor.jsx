import { useState, useRef, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function MetadataEditor({ parseInfo, metaState, sampleLabels = {}, onConfirm, onBack }) {
  const _cols = parseInfo?.columns
  const baseCols = Array.isArray(_cols) ? _cols
                 : typeof _cols === 'string' ? [_cols]
                 : (_cols && typeof _cols === 'object') ? Object.values(_cols)
                 : []
  const { geneCount, sampleCount } = parseInfo || {}

  const [rows, setRows]         = useState(metaState?.rows || [])
  const [selected, setSelected] = useState(metaState?.selected || new Set(rows.map(r => r.sample)))
  const [labels, setLabels]     = useState(sampleLabels)
  const [undoStack, setUndoStack] = useState(null)
  const [extraCols, setExtraCols] = useState([])   // user-added columns
  const [deletedCols, setDeletedCols] = useState(new Set())  // user-deleted base columns
  const [newColName, setNewColName] = useState('')
  const [addingCol, setAddingCol]   = useState(false)
  const [expanded, setExpanded] = useState(false)
  const undoTimerRef = useRef(null)
  const newColRef    = useRef(null)

  // Escape key collapses fullscreen
  useEffect(() => {
    if (!expanded) return
    const handler = e => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [expanded])

  // All visible columns = base (minus deleted) + user-added
  const columns = useMemo(
    () => [...baseCols.filter(c => !deletedCols.has(c)), ...extraCols],
    [baseCols, deletedCols, extraCols]
  )

  // Per-column unique value lists for autocomplete
  const colSuggestions = useMemo(() => {
    const map = {}
    columns.forEach(col => {
      map[col] = [...new Set(rows.map(r => String(r[col] ?? '')).filter(Boolean))]
    })
    return map
  }, [columns, rows])

  const allChecked = rows.length > 0 && rows.every(r => selected.has(r.sample))
  const nSelected  = rows.filter(r => selected.has(r.sample)).length

  function toggleAll() {
    if (allChecked) setSelected(new Set())
    else setSelected(new Set(rows.map(r => r.sample)))
  }

  function toggleRow(sample) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(sample) ? next.delete(sample) : next.add(sample)
      return next
    })
  }

  function removeSelected() {
    const removed = rows.map((r, i) => ({ row: r, index: i })).filter(({ row }) => selected.has(row.sample))
    setUndoStack({ removed })
    setRows(prev => prev.filter(r => !selected.has(r.sample)))
    setSelected(new Set())
    clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => setUndoStack(null), 8000)
  }

  function undoRemove() {
    if (!undoStack) return
    clearTimeout(undoTimerRef.current)
    setRows(prev => {
      const next = [...prev]
      for (const { row, index } of undoStack.removed) {
        next.splice(Math.min(index, next.length), 0, row)
      }
      return next
    })
    setUndoStack(null)
  }

  function updateCell(rowIdx, col, value) {
    setRows(prev => {
      const next = [...prev]
      next[rowIdx] = { ...next[rowIdx], [col]: value }
      return next
    })
  }

  function addColumn() {
    const name = newColName.trim()
    if (!name || columns.includes(name)) return
    setExtraCols(prev => [...prev, name])
    setRows(prev => prev.map(r => ({ ...r, [name]: '' })))
    setNewColName('')
    setAddingCol(false)
  }

  function deleteColumn(col) {
    if (baseCols.includes(col)) {
      setDeletedCols(prev => new Set([...prev, col]))
    } else {
      setExtraCols(prev => prev.filter(c => c !== col))
      setRows(prev => prev.map(r => { const next = { ...r }; delete next[col]; return next }))
    }
  }

  function confirm() {
    onConfirm({ rows, selected, labels, columns })
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const thBase = {
    background: 'var(--bg-card2)',
    borderBottom: '1px solid var(--border)',
    borderRight: '1px solid var(--border)',
    position: 'sticky', top: 0, zIndex: 2,
    whiteSpace: 'nowrap',
  }
  const thLabel = {
    padding: '8px 12px',
    fontSize: '0.72rem', fontWeight: 600,
    color: 'var(--text-3)',
    textTransform: 'uppercase', letterSpacing: '0.04em',
  }
  const tdBase = {
    borderBottom: '1px solid var(--border)',
    borderRight: '1px solid var(--border)',
    padding: 0,
  }
  const cellInp = {
    width: '100%', background: 'transparent', border: 'none',
    padding: '6px 10px', color: 'var(--text-1)',
    fontSize: '0.81rem', outline: 'none', minWidth: 90,
  }

  const inner = (
    <div style={expanded ? {
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'var(--bg-panel)', padding: '16px 20px',
      display: 'flex', flexDirection: 'column', gap: 16,
      overflow: 'hidden',
    } : { width: '100%', maxWidth: 960, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-1)' }}>
          Review samples &amp; metadata
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          {geneCount?.toLocaleString()} genes · {sampleCount} samples loaded ·{' '}
          <span style={{ color: 'var(--accent)' }}>{nSelected} selected</span>
          {' '}— click any cell to edit, uncheck to exclude
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn-danger" disabled={nSelected === 0} onClick={removeSelected}>
          ✕ Remove {nSelected > 0 ? nSelected : ''} selected
        </button>
        {undoStack && (
          <button onClick={undoRemove} style={{
            padding: '5px 12px', fontSize: '0.78rem', borderRadius: 6,
            border: '1px solid var(--accent)', background: 'rgba(var(--accent-rgb),0.12)',
            color: 'var(--accent-text)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            ↩ Undo remove ({undoStack.removed.length})
          </button>
        )}

        {/* Add column */}
        {addingCol ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              ref={newColRef}
              autoFocus
              value={newColName}
              onChange={e => setNewColName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addColumn(); if (e.key === 'Escape') { setAddingCol(false); setNewColName('') } }}
              placeholder="Column name…"
              style={{
                padding: '4px 8px', fontSize: '0.78rem', borderRadius: 5,
                border: '1px solid var(--accent)', background: 'var(--bg-card)',
                color: 'var(--text-1)', outline: 'none', width: 140,
              }}
            />
            <button onClick={addColumn} style={{
              padding: '4px 10px', fontSize: '0.78rem', borderRadius: 5, cursor: 'pointer',
              background: 'rgba(var(--accent-rgb),0.15)', border: '1px solid var(--accent)',
              color: 'var(--accent-text)',
            }}>Add</button>
            <button onClick={() => { setAddingCol(false); setNewColName('') }} style={{
              padding: '4px 8px', fontSize: '0.78rem', borderRadius: 5, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)',
            }}>✕</button>
          </div>
        ) : (
          <button onClick={() => setAddingCol(true)} style={{
            padding: '5px 12px', fontSize: '0.78rem', borderRadius: 6, cursor: 'pointer',
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
            color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 4,
          }}>
            + Add Column
          </button>
        )}

        <span className="flex-1" />
        <button
          onClick={() => setExpanded(v => !v)}
          title={expanded ? 'Exit fullscreen (Esc)' : 'Expand to fullscreen'}
          style={{
            padding: '5px 12px', fontSize: '0.78rem', borderRadius: 6, cursor: 'pointer',
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
            color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          {expanded ? '⊠ Collapse' : '⛶ Expand'}
        </button>
        <button className="btn-primary" onClick={confirm} disabled={rows.length === 0}>
          Continue to Design →
        </button>
      </div>

      {/* Autocomplete datalists — one per column */}
      {columns.map(col => (
        <datalist key={col} id={`dl-${col}`}>
          {(colSuggestions[col] || []).map(v => <option key={v} value={v} />)}
        </datalist>
      ))}

      {/* Table */}
      <div className="glass" style={{
        overflow: 'auto',
        maxHeight: expanded ? 'calc(100vh - 200px)' : 'calc(100vh - 280px)',
        flex: expanded ? '1 1 0' : undefined,
        borderRadius: 10,
      }}>
        <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: '0.81rem' }}>
          <thead>
            <tr>
              {/* Checkbox col */}
              <th style={{ ...thBase, width: 40, textAlign: 'center', borderRight: '1px solid var(--border)' }}>
                <input type="checkbox" checked={allChecked} onChange={toggleAll}
                  style={{ width: 14, cursor: 'pointer', accentColor: 'var(--accent)' }} />
              </th>
              {/* Sample col */}
              <th style={{ ...thBase }}>
                <div style={{ ...thLabel }}>Sample</div>
              </th>
              {/* Display Name col */}
              <th style={{ ...thBase }}>
                <div style={{ ...thLabel, color: 'var(--accent)' }}>Display Name</div>
              </th>
              {/* Metadata cols */}
              {columns.map((col, ci) => (
                <th key={col} style={{ ...thBase, ...(ci === columns.length - 1 ? { borderRight: 'none' } : {}) }}>
                  <div style={{ ...thLabel, display: 'flex', alignItems: 'center', gap: 4, paddingRight: 6 }}>
                    <span style={{ flex: 1 }}>{col}</span>
                    <button
                      onClick={() => deleteColumn(col)}
                      title={`Delete column "${col}"`}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text-3)', fontSize: '0.7rem', lineHeight: 1,
                        padding: '1px 3px', borderRadius: 3, opacity: 0.6,
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#f87171' }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.color = 'var(--text-3)' }}
                    >✕</button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const isChecked = selected.has(row.sample)
              return (
                <tr key={row.sample} style={{ opacity: isChecked ? 1 : 0.4 }}>

                  {/* Checkbox */}
                  <td style={{ ...tdBase, textAlign: 'center', padding: '6px 10px', width: 40 }}>
                    <input type="checkbox" checked={isChecked} onChange={() => toggleRow(row.sample)}
                      style={{ width: 14, cursor: 'pointer', accentColor: 'var(--accent)' }} />
                  </td>

                  {/* Sample name */}
                  <td style={{ ...tdBase }}>
                    <div style={{
                      padding: '6px 12px', color: 'var(--text-2)',
                      fontFamily: 'monospace', fontSize: '0.8rem',
                      whiteSpace: 'nowrap', minWidth: 130,
                    }}>
                      {row.sample}
                    </div>
                  </td>

                  {/* Display Name — editable input */}
                  <td style={{ ...tdBase }}>
                    <input
                      style={{
                        ...cellInp,
                        color: labels[row.sample] && labels[row.sample] !== row.sample
                          ? 'var(--accent-text)' : 'var(--text-1)',
                        fontStyle: labels[row.sample] && labels[row.sample] !== row.sample
                          ? 'italic' : 'normal',
                        cursor: isChecked ? 'text' : 'default',
                      }}
                      value={labels[row.sample] ?? row.sample}
                      disabled={!isChecked}
                      spellCheck={false}
                      onChange={e => setLabels(prev => ({ ...prev, [row.sample]: e.target.value || row.sample }))}
                      onFocus={e => { e.target.style.background = 'rgba(99,102,241,0.08)' }}
                      onBlur={e => { e.target.style.background = 'transparent' }}
                    />
                  </td>

                  {/* Metadata cells — editable inputs with autocomplete */}
                  {columns.map((col, ci) => (
                    <td key={col} style={{
                      ...tdBase,
                      ...(ci === columns.length - 1 ? { borderRight: 'none' } : {}),
                    }}>
                      <input
                        list={`dl-${col}`}
                        style={{ ...cellInp, cursor: isChecked ? 'text' : 'default' }}
                        value={row[col] ?? ''}
                        disabled={!isChecked}
                        spellCheck={false}
                        onChange={e => updateCell(ri, col, e.target.value)}
                        onFocus={e => { e.target.style.background = 'rgba(99,102,241,0.08)' }}
                        onBlur={e => { e.target.style.background = 'transparent' }}
                      />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs" style={{ color: 'var(--text-3)' }}>
        Tip: uncheck samples to exclude them · click{' '}
        <span style={{ color: 'var(--accent)' }}>Display Name</span>{' '}
        to rename a sample in all plots · click any metadata cell to edit · type to autocomplete from existing values
      </p>
    </div>
  )

  return expanded ? createPortal(inner, document.body) : inner
}
