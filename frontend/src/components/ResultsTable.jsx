import { useState, useMemo, useEffect, useTransition } from 'react'
import GeneViolinModal from './GeneViolinModal'

const PAGE_SIZE = 25

function fmt(val, digits = 3) {
  if (val == null) return 'NA'
  const n = Number(val)
  if (!isFinite(n)) return 'NA'
  if (Math.abs(n) < 0.001 || Math.abs(n) >= 1e4) return n.toExponential(2)
  return n.toFixed(digits)
}

// Safe comparator — never returns NaN
function cmp(a, b, dir) {
  const av = (a != null && isFinite(a)) ? Number(a) : Infinity
  const bv = (b != null && isFinite(b)) ? Number(b) : Infinity
  if (av === bv) return 0
  return dir === 'asc' ? av - bv : bv - av
}

export default function ResultsTable({ results, label, session, contrast, column, annMap, annDetails }) {
  const [query,   setQuery]   = useState('')
  const [sortKey, setSortKey] = useState('padj')
  const [sortDir, setSortDir] = useState('asc')
  const [page,    setPage]    = useState(1)
  const [selectedGene, setSelectedGene] = useState(null)
  const [isPending, startTransition] = useTransition()

  const sigCount = useMemo(
    () => (results || []).filter(r => r.padj != null && r.padj < 0.05).length,
    [results]
  )

  const filtered = useMemo(() => {
    let rows = results || []
    if (query) {
      const lq = query.toLowerCase()
      rows = rows.filter(r =>
        r.gene?.toLowerCase().includes(lq) ||
        (annMap && annMap[r.gene]?.toLowerCase().includes(lq))
      )
    }
    return [...rows].sort((a, b) => cmp(a[sortKey], b[sortKey], sortDir))
  }, [results, query, sortKey, sortDir, annMap])

  useEffect(() => { setPage(1) }, [query, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function toggleSort(key) {
    startTransition(() => {
      if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
      else { setSortKey(key); setSortDir('asc') }
    })
  }

  function downloadCSV() {
    const hasDet = !!annDetails
    const header = annMap
      ? (hasDet ? 'symbol,gene_id,description,baseMean,log2FC,lfcSE,stat,pvalue,padj' : 'symbol,gene_id,baseMean,log2FC,lfcSE,stat,pvalue,padj')
      : 'gene,baseMean,log2FC,lfcSE,stat,pvalue,padj'
    const rows = (results || []).map(r => {
      if (annMap) {
        const sym  = annMap[r.gene] || 'N/A'
        const desc = hasDet ? `"${(annDetails[r.gene]?.description ?? '').replace(/"/g,'""')}"` : null
        const base = [sym, r.gene, r.baseMean, r.log2FC, r.lfcSE, r.stat, r.pvalue, r.padj]
        if (hasDet) base.splice(2, 0, desc)
        return base.join(',')
      }
      return [r.gene, r.baseMean, r.log2FC, r.lfcSE, r.stat, r.pvalue, r.padj].join(',')
    })
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: label ? `deseq2_${label.replace(/\s+/g, '_')}.csv` : 'deseq2_results.csv',
    })
    a.click()
  }

  const cols = [
    { key: 'gene',        label: 'Gene',        sortable: false },
    ...(annDetails ? [{ key: 'description', label: 'Description', sortable: false }] : []),
    { key: 'baseMean',    label: 'baseMean',    sortable: true },
    { key: 'log2FC',      label: 'log₂FC',      sortable: true },
    { key: 'lfcSE',       label: 'lfcSE',       sortable: false },
    { key: 'pvalue',      label: 'p-value',     sortable: true },
    { key: 'padj',        label: 'padj',        sortable: true },
  ]

  const canPlot = !!(session?.sessionId && contrast?.treatment && contrast?.reference)

  const pgBtn = (disabled) => ({
    padding: '3px 9px', borderRadius: 6, border: '1px solid var(--border)',
    cursor: disabled ? 'default' : 'pointer', fontSize: '0.75rem',
    background: disabled ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.04)',
    color: disabled ? 'var(--accent-text)' : 'var(--text-3)',
    fontWeight: disabled ? 600 : 400,
  })

  return (
    <div className="flex flex-col gap-3 h-full">

      {/* Controls */}
      <div className="flex items-center gap-3">
        <input style={{ flex: 1 }} value={query}
          onChange={e => { setQuery(e.target.value); setPage(1) }}
          placeholder="Search gene…" />
        <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
          {sigCount.toLocaleString()} sig · {filtered.length.toLocaleString()} shown
          {isPending && ' …'}
        </span>
        {canPlot && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-3)', whiteSpace: 'nowrap',
                         display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
            Click row to plot
          </span>
        )}
        <button className="btn-ghost" onClick={downloadCSV}>⬇ CSV</button>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1 rounded-xl" style={{ border: '1px solid var(--border)', opacity: isPending ? 0.6 : 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', tableLayout: 'auto' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.04)', position: 'sticky', top: 0, zIndex: 1 }}>
              {cols.map(c => (
                <th key={c.key}
                  onClick={() => c.sortable && toggleSort(c.key)}
                  style={{
                    padding: '8px 12px', textAlign: 'left',
                    fontWeight: 500, cursor: c.sortable ? 'pointer' : 'default',
                    borderBottom: '1px solid var(--border)',
                    borderRight: '1px solid var(--border)',
                    whiteSpace: 'nowrap',
                    color: sortKey === c.key ? 'var(--accent)' : 'var(--text-3)',
                    userSelect: 'none',
                  }}>
                  {c.label} {c.sortable && (sortKey === c.key ? (sortDir === 'asc' ? '↑' : '↓') : '↕')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => {
              const sig = r.padj != null && r.padj < 0.05
              return (
                <tr
                  key={r.gene}
                  className="de-row"
                  onClick={() => { const sym = annMap?.[r.gene]; canPlot && setSelectedGene({ id: r.gene, symbol: (sym && sym !== 'None' && sym !== 'N/A') ? sym : null }) }}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: i % 2 ? 'rgba(255,255,255,0.01)' : 'transparent',
                    cursor: canPlot ? 'pointer' : 'default',
                  }}
                >
                  <td style={{ padding: '6px 12px', borderRight: '1px solid var(--border)' }}>
                    {annMap ? (
                      <span>
                        <span style={{ color: annMap[r.gene] ? (sig ? 'var(--accent-text)' : 'var(--text-1)') : 'var(--text-3)',
                                       fontWeight: sig ? 600 : 500, fontStyle: annMap[r.gene] ? 'normal' : 'italic' }}>
                          {annMap[r.gene] || 'N/A'}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-3)', fontFamily: 'monospace', lineHeight: 1.3 }}>
                          {r.gene}
                        </span>
                      </span>
                    ) : (
                      <span style={{ color: sig ? 'var(--accent-text)' : 'var(--text-1)', fontWeight: sig ? 600 : 400 }}>
                        {r.gene}
                      </span>
                    )}
                  </td>
                  {annDetails && (
                    <td style={{ padding: '6px 12px', color: 'var(--text-3)', borderRight: '1px solid var(--border)',
                                 maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                 fontSize: '0.74rem' }}
                        title={annDetails[r.gene]?.description ?? ''}>
                      {annDetails[r.gene]?.description ?? '—'}
                    </td>
                  )}
                  <td style={{ padding: '6px 12px', color: 'var(--text-2)', borderRight: '1px solid var(--border)' }}>{fmt(r.baseMean)}</td>
                  <td style={{ padding: '6px 12px', borderRight: '1px solid var(--border)', color: r.log2FC > 0 ? '#34d399' : r.log2FC < 0 ? '#f87171' : 'var(--text-2)' }}>
                    {fmt(r.log2FC, 2)}
                  </td>
                  <td style={{ padding: '6px 12px', color: 'var(--text-2)', borderRight: '1px solid var(--border)' }}>{fmt(r.lfcSE, 3)}</td>
                  <td style={{ padding: '6px 12px', color: 'var(--text-2)', borderRight: '1px solid var(--border)' }}>{fmt(r.pvalue)}</td>
                  <td style={{ padding: '6px 12px', color: sig ? '#fbbf24' : 'var(--text-3)' }}>
                    {fmt(r.padj)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
          Rows {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => setPage(1)} disabled={safePage === 1} style={pgBtn(safePage === 1)}>«</button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1} style={pgBtn(safePage === 1)}>‹</button>

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
            .reduce((acc, p, idx, arr) => {
              if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…')
              acc.push(p)
              return acc
            }, [])
            .map((p, i) =>
              p === '…'
                ? <span key={`e${i}`} style={{ fontSize: '0.75rem', color: 'var(--text-3)', padding: '0 4px' }}>…</span>
                : <button key={p} onClick={() => setPage(p)} style={pgBtn(p === safePage)}>{p}</button>
            )
          }

          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} style={pgBtn(safePage === totalPages)}>›</button>
          <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages} style={pgBtn(safePage === totalPages)}>»</button>
        </div>

        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
          Page {safePage} of {totalPages}
        </span>
      </div>

      {selectedGene && (
        <GeneViolinModal
          gene={selectedGene.id}
          symbol={selectedGene.symbol}
          session={session}
          contrast={contrast}
          column={column}
          onClose={() => setSelectedGene(null)}
        />
      )}
    </div>
  )
}
