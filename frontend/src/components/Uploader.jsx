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
            <svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Document shape */}
              <rect x="6" y="4" width="32" height="40" rx="4" fill="#1e3a5f" opacity="0.85"/>
              <path d="M30 4 L38 12 L30 12 Z" fill="#0d2240" opacity="0.9"/>
              <rect x="30" y="4" width="8" height="8" rx="1" fill="#2a4f7c" opacity="0.7"/>
              {/* R circle badge */}
              <circle cx="36" cy="36" r="14" fill="#2166ac"/>
              <circle cx="36" cy="36" r="13" fill="url(#rgrad)"/>
              <defs>
                <radialGradient id="rgrad" cx="40%" cy="35%" r="60%">
                  <stop offset="0%" stopColor="#4a90d9"/>
                  <stop offset="100%" stopColor="#1a5a9a"/>
                </radialGradient>
              </defs>
              {/* R letter */}
              <text x="36" y="42" textAnchor="middle" fontFamily="'Georgia',serif" fontWeight="bold"
                    fontSize="17" fill="white" letterSpacing="-0.5">R</text>
            </svg>
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
