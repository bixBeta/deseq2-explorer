import { useState, useCallback } from 'react'

export default function Uploader({ session, onParsed }) {
  const [dragging, setDragging]   = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [fileName, setFileName]   = useState(null)

  const upload = useCallback(async (file) => {
    if (!file) return
    setFileName(file.name)
    setLoading(true)
    setError(null)
    try {
      // Encode file as base64 to avoid binary transport issues
      const arrayBuffer = await file.arrayBuffer()
      const uint8 = new Uint8Array(arrayBuffer)
      let binary = ''
      for (let i = 0; i < uint8.length; i += 8192) {
        binary += String.fromCharCode(...uint8.subarray(i, i + 8192))
      }
      const base64 = btoa(binary)

      const res = await fetch(`/api/parse?sessionId=${session.sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: base64 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Parse failed')
      onParsed(data)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [session, onParsed])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) upload(file)
  }, [upload])

  const onDragOver = (e) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)

  return (
    <div className="w-full max-w-xl">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-1)' }}>Upload your RDS file</h2>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          Must be a named list with <code style={{ background:'var(--bg-card2)', padding:'1px 6px', borderRadius:4, color:'var(--accent-text)' }}>counts</code> and{' '}
          <code style={{ background:'var(--bg-card2)', padding:'1px 6px', borderRadius:4, color:'var(--accent-text)' }}>metadata</code>
        </p>
      </div>

      <label
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className="glass flex flex-col items-center justify-center gap-3 p-12 cursor-pointer transition-all"
        style={{
          borderColor: dragging ? 'var(--accent)' : 'var(--border)',
          background: dragging ? 'rgba(var(--accent-rgb),0.08)' : 'var(--bg-card)',
          minHeight: 200,
        }}
      >
        {loading ? (
          <>
            <div className="text-3xl animate-spin">⟳</div>
            <p style={{ color: 'var(--text-2)' }}>Parsing <strong>{fileName}</strong>…</p>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Running DESeq2 validation</p>
          </>
        ) : (
          <>
            <div className="text-4xl">📦</div>
            <p className="font-medium" style={{ color: 'var(--text-1)' }}>
              {dragging ? 'Drop it!' : 'Drag & drop your RDS file here'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>or click to browse</p>
            <div className="flex gap-2 mt-1">
              {['.rds', '.RDS', '.Rds'].map(ext => (
                <span key={ext} className="text-xs px-2 py-0.5 rounded glass2" style={{ color: 'var(--text-3)' }}>
                  {ext}
                </span>
              ))}
            </div>
          </>
        )}
        <input type="file" accept=".rds,.RDS,.Rds" className="hidden"
          onChange={e => upload(e.target.files[0])} disabled={loading} />
      </label>

      {error && (
        <div className="mt-4 text-sm px-4 py-3 rounded-lg"
             style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
          ⚠ {error}
        </div>
      )}

      {/* Format hint */}
      <div className="glass mt-5 p-4">
        <p className="text-xs font-mono mb-2" style={{ color: 'var(--text-3)' }}>Expected R structure:</p>
        <pre className="text-xs leading-relaxed" style={{ color: 'var(--accent-text)' }}>{
`saveRDS(
  list(
    counts   = count_matrix,   # genes × samples
    metadata = coldata_df      # samples × conditions
  ),
  "data.rds"
)`}
        </pre>
      </div>
    </div>
  )
}
