import { useState, useRef, useCallback } from 'react'

const ORGANISMS = [
  { value: 'hsapiens',      label: 'Human (H. sapiens)' },
  { value: 'mmusculus',     label: 'Mouse (M. musculus)' },
  { value: 'rnorvegicus',   label: 'Rat (R. norvegicus)' },
  { value: 'drerio',        label: 'Zebrafish (D. rerio)' },
  { value: 'dmelanogaster', label: 'Fruit fly (D. melanogaster)' },
  { value: 'celegans',      label: 'C. elegans' },
  { value: 'scerevisiae',   label: 'Yeast (S. cerevisiae)' },
  { value: 'athaliana',     label: 'Arabidopsis (A. thaliana)' },
]

const CHUNK = 8 * 1024 * 1024   // 8 MB per chunk

// Parse a single GTF attribute string → { id, name, description } or null
function parseGTFAttrs(attrs) {
  const get = (key) => {
    const m = attrs.match(new RegExp(`${key}[=\\s]+"?([^";]+)"?`))
    return m ? m[1].trim() : null
  }
  const id   = get('gene_id')
  const name = get('gene_name')
  if (!id || !name) return null
  return {
    id:          id.split('.')[0].trim(),   // strip version suffix
    name:        name,
    description: get('gene_description') || get('gene_biotype') || null,
  }
}

export default function AnnotationPanel({ geneIds, annMap, onAnnotate }) {
  const [method,   setMethod]   = useState('gprofiler')
  const [org,      setOrg]      = useState('hsapiens')
  const [loading,  setLoading]  = useState(false)
  const [progress, setProgress] = useState(0)      // 0-100
  const [gtfFile,  setGtfFile]  = useState(null)   // { name, size }
  const [error,    setError]    = useState(null)
  const [preview,  setPreview]  = useState(null)
  const [dragging, setDragging] = useState(false)
  const fileRef   = useRef()
  const abortRef  = useRef(false)

  // ── g:Profiler ──────────────────────────────────────────────────────────────
  async function fetchGprofiler() {
    if (!geneIds?.length) return
    setLoading(true); setError(null); setPreview(null); setProgress(0)
    try {
      const resp = await fetch('https://biit.cs.ut.ee/gprofiler/api/convert/convert/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organism: org, query: geneIds, target: 'HGNC', numeric_ns: 'ENTREZGENE_ACC' }),
      })
      if (!resp.ok) throw new Error(`g:Profiler API returned ${resp.status}`)
      const data = await resp.json()
      const map = {}
      for (const r of (data.result || [])) {
        if (r.converted && r.converted !== 'N/A' && r.converted !== 'None' && !map[r.incoming]) {
          map[r.incoming] = r.converted
        }
      }
      setPreview({ mapped: Object.keys(map).length, total: geneIds.length, map })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── GTF chunk-based parser with progress ────────────────────────────────────
  function parseGTF(file) {
    abortRef.current = false
    setLoading(true); setError(null); setPreview(null); setProgress(0)
    setGtfFile({ name: file.name, size: file.size })

    const symbolMap  = {}
    const detailsMap = {}   // gene_id → { chr, start, end, description }
    let   offset     = 0
    let   leftover   = ''
    const total      = file.size
    const decoder    = new TextDecoder()

    function processLine(line) {
      if (!line || line.startsWith('#')) return
      const cols = line.split('\t')
      if (cols.length < 9) return
      const attrs  = cols[8]
      const parsed = parseGTFAttrs(attrs)
      if (!parsed || !parsed.id || !parsed.name || parsed.id === parsed.name) return
      const { id, name, description } = parsed
      if (!symbolMap[id]) symbolMap[id] = name
      // Prefer 'gene' feature row for coords; fall back to first occurrence
      const feature = cols[2]
      if (!detailsMap[id] || feature === 'gene') {
        detailsMap[id] = {
          chr:         cols[0],
          start:       parseInt(cols[3], 10) || null,
          end:         parseInt(cols[4], 10) || null,
          description: description,
        }
      }
    }

    function readChunk() {
      if (abortRef.current) { setLoading(false); return }

      const slice = file.slice(offset, offset + CHUNK)
      const fr    = new FileReader()

      fr.onload = e => {
        // Use ArrayBuffer → TextDecoder for reliable UTF-8 handling
        const text  = decoder.decode(new Uint8Array(e.target.result), { stream: true })
        const lines = (leftover + text).split('\n')
        leftover    = lines.pop()   // last (possibly incomplete) line

        for (const line of lines) processLine(line)

        offset += CHUNK
        const pct = Math.min(100, Math.round(offset / total * 100))
        setProgress(pct)

        if (offset < total) {
          // Yield to the event loop before next chunk so UI updates
          setTimeout(readChunk, 0)
        } else {
          if (leftover) processLine(leftover)
          setProgress(100)
          setPreview({
            mapped:     Object.keys(symbolMap).length,
            total:      geneIds?.length ?? 0,
            map:        symbolMap,
            detailsMap: Object.keys(detailsMap).length > 0 ? detailsMap : null,
          })
          setLoading(false)
        }
      }

      fr.onerror = () => {
        setError('Failed to read file chunk')
        setLoading(false)
      }

      fr.readAsArrayBuffer(slice)
    }

    readChunk()
  }

  function handleFileInput(file) {
    if (!file) return
    if (!file.name.endsWith('.gtf') && !file.name.endsWith('.gff') && !file.name.endsWith('.gff3')) {
      setError('Please upload a .gtf, .gff, or .gff3 file')
      return
    }
    parseGTF(file)
  }

  const onInputChange  = e  => handleFileInput(e.target.files?.[0])
  const onDrop         = useCallback(e => {
    e.preventDefault(); setDragging(false)
    handleFileInput(e.dataTransfer.files?.[0])
  }, [])
  const onDragOver     = e  => { e.preventDefault(); setDragging(true) }
  const onDragLeave    = () => setDragging(false)

  // ── Styles ──────────────────────────────────────────────────────────────────
  const pillStyle = (active) => ({
    padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem', cursor: 'pointer',
    background: active ? 'rgba(var(--accent-rgb),0.15)' : 'rgba(255,255,255,0.04)',
    color:      active ? 'var(--accent-text)' : 'var(--text-3)',
    border:     `1px solid ${active ? 'rgba(var(--accent-rgb),0.4)' : 'var(--border)'}`,
    fontWeight: active ? 600 : 400,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 640 }}>
      <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-1)' }}>
        Gene Annotation
      </h3>

      {/* Applied banner */}
      {annMap && !preview && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', borderRadius: 8,
                      background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}>
          <span style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 600 }}>
            ✓ {Object.keys(annMap).length.toLocaleString()} symbols active — table, MA plot &amp; violin plots use gene symbols
            {annMap._hasDetails && <span style={{ fontSize: '0.74rem', fontWeight: 400, marginLeft: 8 }}>· chr / start / end / description available</span>}
          </span>
          <button onClick={() => onAnnotate(null, null)} style={{
            padding: '4px 12px', borderRadius: 6, fontSize: '0.75rem',
            background: 'rgba(248,113,113,0.08)', color: '#f87171',
            border: '1px solid rgba(248,113,113,0.2)', cursor: 'pointer',
          }}>Remove</button>
        </div>
      )}

      {/* Method toggle */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[['gprofiler', '🌐 g:Profiler API'], ['gtf', '📄 GTF / GFF Upload']].map(([v, l]) => (
          <button key={v} onClick={() => { setMethod(v); setPreview(null); setError(null); setGtfFile(null); setProgress(0) }} style={pillStyle(method === v)}>
            {l}
          </button>
        ))}
      </div>

      {/* ── g:Profiler ── */}
      {method === 'gprofiler' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Organism</label>
            <select value={org} onChange={e => setOrg(e.target.value)} style={{ flex: 1, fontSize: '0.8rem' }}>
              {ORGANISMS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-3)' }}>
            Queries the g:Profiler REST API to convert {geneIds?.length?.toLocaleString() ?? 0} gene IDs → HGNC symbols. Requires internet access.
          </p>
          <button onClick={fetchGprofiler} disabled={loading} style={{
            alignSelf: 'flex-start', padding: '7px 18px', borderRadius: 8,
            background: 'rgba(var(--accent-rgb),0.15)', color: 'var(--accent-text)',
            border: '1px solid rgba(var(--accent-rgb),0.3)', fontSize: '0.8rem',
            cursor: loading ? 'wait' : 'pointer', fontWeight: 600,
          }}>
            {loading ? '⟳ Fetching…' : 'Fetch Symbols'}
          </button>
        </div>
      )}

      {/* ── GTF upload ── */}
      {method === 'gtf' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-3)' }}>
            Upload a GTF / GFF file. Requires <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: 4 }}>gene_id</code> and{' '}
            <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: 4 }}>gene_name</code> attributes.
            Ensembl version suffixes are stripped automatically. Large files are processed in chunks.
          </p>

          {/* Drop zone */}
          <div
            onClick={() => !loading && fileRef.current?.click()}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            style={{
              border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 12,
              padding: '28px 20px',
              textAlign: 'center',
              cursor: loading ? 'wait' : 'pointer',
              background: dragging ? 'rgba(var(--accent-rgb),0.06)' : 'rgba(255,255,255,0.02)',
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            {gtfFile && !loading ? (
              // File loaded state
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '1.4rem' }}>✅</span>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-1)', fontWeight: 600 }}>{gtfFile.name}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                  {(gtfFile.size / 1024 / 1024).toFixed(1)} MB · click to replace
                </span>
              </div>
            ) : loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-2)', fontWeight: 500 }}>
                  Parsing {gtfFile?.name ?? 'file'}…
                </span>
                {/* Progress bar */}
                <div style={{ width: '100%', maxWidth: 320, height: 6, borderRadius: 99,
                              background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99,
                    width: `${progress}%`,
                    background: 'linear-gradient(90deg,var(--accent),var(--accent2))',
                    transition: 'width 0.2s ease',
                  }} />
                </div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{progress}%</span>
              </div>
            ) : (
              // Empty state
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '1.8rem', opacity: 0.5 }}>📄</span>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-2)', fontWeight: 500 }}>
                  Drop GTF / GFF file here
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>or click to browse</span>
              </div>
            )}
          </div>

          {/* Hidden file input */}
          <input ref={fileRef} type="file" accept=".gtf,.gff,.gff3"
                 onChange={onInputChange} style={{ display: 'none' }} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: '0.78rem',
                      background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: '#f87171' }}>
          ⚠ {error}
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: '10px 16px', borderRadius: 8,
                        background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-1)', fontWeight: 600 }}>
              {preview.mapped.toLocaleString()} / {preview.total.toLocaleString()} genes mapped
            </span>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-3)', marginLeft: 10 }}>
              ({Math.round(preview.mapped / Math.max(preview.total, 1) * 100)}%)
            </span>
          </div>

          {preview.detailsMap && (
            <div style={{ fontSize: '0.74rem', color: '#059669', padding: '6px 12px',
                          background: 'rgba(52,211,153,0.06)', borderRadius: 6,
                          border: '1px solid rgba(52,211,153,0.15)' }}>
              ✓ GTF coordinates detected — chr, start, end, and description will be available in Table Explorer
            </div>
          )}

          <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 500 }}>Gene ID</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 500 }}>Symbol</th>
                  {preview.detailsMap && <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 500 }}>Chr</th>}
                  {preview.detailsMap && <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 500 }}>Description</th>}
                </tr>
              </thead>
              <tbody>
                {Object.entries(preview.map).slice(0, 30).map(([id, sym]) => {
                  const det = preview.detailsMap?.[id]
                  return (
                    <tr key={id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '4px 10px', color: 'var(--text-3)', fontFamily: 'monospace', fontSize: '0.72rem' }}>{id}</td>
                      <td style={{ padding: '4px 10px', color: 'var(--text-1)', fontWeight: 500 }}>{sym}</td>
                      {preview.detailsMap && <td style={{ padding: '4px 10px', color: 'var(--text-3)' }}>{det?.chr ?? '—'}</td>}
                      {preview.detailsMap && <td style={{ padding: '4px 10px', color: 'var(--text-3)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{det?.description ?? '—'}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { onAnnotate(preview.map, preview.detailsMap ?? null); setPreview(null) }} style={{
              padding: '7px 20px', borderRadius: 8, fontSize: '0.82rem',
              background: 'linear-gradient(135deg,var(--accent),var(--accent2))', color: 'white',
              border: 'none', cursor: 'pointer', fontWeight: 600,
            }}>
              ✓ Apply Annotations
            </button>
            <button onClick={() => { setPreview(null); setGtfFile(null); setProgress(0) }} style={{
              padding: '7px 14px', borderRadius: 8, fontSize: '0.8rem',
              background: 'rgba(255,255,255,0.04)', color: 'var(--text-3)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
