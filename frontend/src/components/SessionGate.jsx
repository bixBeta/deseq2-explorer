import { useState } from 'react'
import ProgressBar from './ProgressBar'

const HEX = 'M 37,20 L 28.5,34.7 L 11.5,34.7 L 3,20 L 11.5,5.3 L 28.5,5.3 Z'

function AppIconLarge() {
  return (
    <svg width="56" height="56" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sg-bg" x1="3" y1="5" x2="37" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#1e1b4b"/>
          <stop offset="100%" stopColor="#312e81"/>
        </linearGradient>
        <linearGradient id="sg-acc" x1="3" y1="5" x2="37" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#2dd4bf"/>
          <stop offset="100%" stopColor="#818cf8"/>
        </linearGradient>
        <filter id="sg-shadow" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#2dd4bf" floodOpacity="0.35"/>
        </filter>
      </defs>
      <path d={HEX} fill="url(#sg-bg)" filter="url(#sg-shadow)"/>
      <path d="M 28.5,5.3 L 37,20" stroke="url(#sg-acc)" strokeWidth="2.5" strokeLinecap="round"/>
      <text x="20" y="25" textAnchor="middle" fill="white"
            fontFamily="Inter,system-ui,sans-serif" fontWeight="800" fontSize="15">D</text>
    </svg>
  )
}

export default function SessionGate({ onAuth, onExample }) {
  const [email, setEmail]     = useState('')
  const [pin, setPin]         = useState('')
  const [loading, setLoading] = useState(false)
  const [exLoading, setExLoading] = useState(false)
  const [error, setError]     = useState(null)

  async function tryExample() {
    setExLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/session/example')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Example data not available')
      onExample(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setExLoading(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/session/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pin }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Authentication failed')
      onAuth({ email, pin, sessions: data.sessions || [] })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
    <ProgressBar active={exLoading} label="Loading example data…" />
    <div className="w-full max-w-md">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="mx-auto mb-4" style={{ width: 56, height: 56 }}><AppIconLarge /></div>
        <h1 className="text-2xl font-bold gradient-text mb-1">DESeq2 ExploreR</h1>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          Differential expression analysis
        </p>
      </div>

      <form onSubmit={submit} className="glass p-6 flex flex-col gap-4">
        <div>
          <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--text-3)' }}>
            Email
          </label>
          <input type="email" required value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com" />
        </div>

        <div>
          <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--text-3)' }}>
            PIN{' '}
            <span style={{ fontWeight: 400 }}>(4–8 digits — same PIN always shows your sessions)</span>
          </label>
          <input type="password" inputMode="numeric" required
            minLength={4} maxLength={8}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••" />
        </div>

        {error && (
          <div className="text-xs px-3 py-2 rounded-lg"
               style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full justify-center mt-1" disabled={loading}>
          {loading
            ? <><span className="animate-spin inline-block">⟳</span> Verifying…</>
            : 'Continue →'}
        </button>
      </form>

      <p className="text-center text-xs mt-4" style={{ color: 'var(--text-3)' }}>
        New users will be prompted to create their first session after signing in
      </p>

      {/* Example data */}
      <div className="mt-6">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: '0.7rem', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>or explore without an account</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>
        <button
          onClick={tryExample}
          disabled={exLoading}
          className="w-full"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '10px 16px', borderRadius: 10, border: '1px solid rgba(45,212,191,0.25)',
            background: 'rgba(45,212,191,0.06)', color: '#0f766e',
            fontSize: '0.85rem', fontWeight: 500, cursor: exLoading ? 'wait' : 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M5 2h6M6 2v3.5L3 11a1.5 1.5 0 001.4 2h7.2A1.5 1.5 0 0013 11L10 5.5V2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="6.5" cy="9" r="0.75" fill="currentColor"/>
            <circle cx="9" cy="10.5" r="0.75" fill="currentColor"/>
          </svg>
          {exLoading ? 'Loading example…' : 'Browse Example Data'}
        </button>
      </div>
    </div>
    </>
  )
}
