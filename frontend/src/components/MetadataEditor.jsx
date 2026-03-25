import { useState, useCallback, useRef } from 'react'

export default function MetadataEditor({ parseInfo, metaState, onConfirm, onBack }) {
  const { columns = [], geneCount, sampleCount } = parseInfo || {}

  // rows: array of { sample, col1, col2, ... }
  const [rows, setRows]         = useState(metaState?.rows || [])
  const [selected, setSelected] = useState(metaState?.selected || new Set(rows.map(r => r.sample)))
  const [editCell, setEditCell] = useState(null)   // { rowIdx, col }
  const [editVal, setEditVal]   = useState('')
  const [undoStack, setUndoStack] = useState(null)  // { rows, indices } of last removal
  const undoTimerRef = useRef(null)

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
    const removed = rows
      .map((r, i) => ({ row: r, index: i }))
      .filter(({ row }) => selected.has(row.sample))
    setUndoStack({ removed })
    setRows(prev => prev.filter(r => !selected.has(r.sample)))
    setSelected(new Set())
    // Auto-clear undo after 8s
    clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => setUndoStack(null), 8000)
  }

  function undoRemove() {
    if (!undoStack) return
    clearTimeout(undoTimerRef.current)
    setRows(prev => {
      const next = [...prev]
      // Re-insert removed rows at their original indices
      for (const { row, index } of undoStack.removed) {
        const clampedIdx = Math.min(index, next.length)
        next.splice(clampedIdx, 0, row)
      }
      return next
    })
    setUndoStack(null)
  }

  function startEdit(rowIdx, col) {
    setEditCell({ rowIdx, col })
    setEditVal(rows[rowIdx][col] ?? '')
  }

  function commitEdit() {
    if (!editCell) return
    setRows(prev => {
      const next = [...prev]
      next[editCell.rowIdx] = { ...next[editCell.rowIdx], [editCell.col]: editVal }
      return next
    })
    setEditCell(null)
  }

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') setEditCell(null)
  }, [editCell, editVal])

  function confirm() {
    onConfirm({ rows, selected })
  }

  const thStyle = {
    padding: '8px 10px',
    textAlign: 'left',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--text-3)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
    background: 'var(--bg-card2)',
    position: 'sticky', top: 0, zIndex: 1,
  }

  return (
    <div style={{ width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 16 }}>
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
        <button
          className="btn-danger"
          disabled={nSelected === 0}
          onClick={removeSelected}>
          ✕ Remove {nSelected > 0 ? nSelected : ''} selected
        </button>
        {undoStack && (
          <button
            onClick={undoRemove}
            style={{
              padding: '5px 12px',
              fontSize: '0.78rem',
              borderRadius: 6,
              border: '1px solid var(--accent)',
              background: 'rgba(var(--accent-rgb),0.12)',
              color: 'var(--accent-text)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              animation: 'fadeIn 0.15s ease',
            }}>
            ↩ Undo remove ({undoStack.removed.length})
          </button>
        )}
        <span className="flex-1" />
        <button className="btn-primary" onClick={confirm} disabled={rows.length === 0}>
          Continue to Design →
        </button>
      </div>

      {/* Table */}
      <div className="glass" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 36, textAlign: 'center' }}>
                <input type="checkbox" checked={allChecked} onChange={toggleAll}
                  style={{ width: 14, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
              </th>
              <th style={thStyle}>Sample</th>
              {columns.map(col => (
                <th key={col} style={thStyle}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const isChecked = selected.has(row.sample)
              const rowBg = !isChecked
                ? 'rgba(239,68,68,0.04)'
                : ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'
              return (
                <tr key={row.sample} style={{ background: rowBg, opacity: isChecked ? 1 : 0.45 }}>
                  <td style={{ padding: '6px 10px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
                    <input type="checkbox" checked={isChecked} onChange={() => toggleRow(row.sample)}
                      style={{ width: 14, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  </td>
                  <td style={{ padding: '6px 10px', fontWeight: 500, color: 'var(--text-2)',
                               borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                    {row.sample}
                  </td>
                  {columns.map(col => {
                    const isEditing = editCell?.rowIdx === ri && editCell?.col === col
                    return (
                      <td key={col}
                        style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)', minWidth: 90 }}>
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={handleKeyDown}
                            style={{ padding: '3px 6px', fontSize: '0.78rem', borderRadius: 4, width: '100%' }}
                          />
                        ) : (
                          <span
                            onClick={() => isChecked && startEdit(ri, col)}
                            style={{
                              display: 'block',
                              padding: '3px 6px',
                              borderRadius: 4,
                              color: 'var(--text-1)',
                              cursor: isChecked ? 'text' : 'default',
                              minHeight: 24,
                              transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => { if (isChecked) e.target.style.background = 'var(--bg-card2)' }}
                            onMouseLeave={e => { e.target.style.background = 'transparent' }}
                          >
                            {row[col] ?? ''}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs" style={{ color: 'var(--text-3)' }}>
        Tip: uncheck samples to exclude them from the DESeq2 run · click a cell to edit its value · changes apply only to this session
      </p>
    </div>
  )
}
