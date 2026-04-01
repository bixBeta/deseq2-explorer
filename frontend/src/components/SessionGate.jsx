import { useState } from 'react'
import ProgressBar from './ProgressBar'

const HEX = 'M 37,20 L 28.5,34.7 L 11.5,34.7 L 3,20 L 11.5,5.3 L 28.5,5.3 Z'

function TRExLogoLarge() {
  return (
    <svg width="48" height="48" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="trex-lg-bg" x1="3" y1="5" x2="37" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#1e1b4b"/>
          <stop offset="100%" stopColor="#312e81"/>
        </linearGradient>
      </defs>
      <path d={HEX} fill="url(#trex-lg-bg)" stroke="#6d28d9" strokeWidth="1"/>
      <text x="20" y="17" textAnchor="middle" fill="#c4b5fd"
            fontFamily="Inter,system-ui,sans-serif" fontWeight="700" fontSize="10">TR</text>
      <text x="20" y="29" textAnchor="middle" fill="#c4b5fd"
            fontFamily="Inter,system-ui,sans-serif" fontWeight="700" fontSize="10">Ex</text>
    </svg>
  )
}

function AppIconLarge() {
  return (
    <svg width="48" height="48" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
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

const STEPS = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M7 10h6M10 7v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Upload',
    desc: 'Load a DESeq2 RDS result or raw count matrix with metadata',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Analyse',
    desc: 'Run DESeq2 with custom contrasts, FDR thresholds and LFC shrinkage',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M3 14 Q6 6 10 10 Q14 14 17 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
      </svg>
    ),
    title: 'Explore',
    desc: 'Interactive PCA, MA plots, heatmaps, violin plots and DE tables',
  },
]

export default function SessionGate({ onAuth, onExample }) {
  const [email, setEmail]       = useState('')
  const [pin, setPin]           = useState('')
  const [loading, setLoading]   = useState(false)
  const [exLoading, setExLoading] = useState(false)
  const [error, setError]       = useState(null)
  const [showForm, setShowForm] = useState(false)   // false = path selector, true = sign-in form

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

    <div style={{
      width: '100%', maxWidth: 960,
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32,
      alignItems: 'start',
    }}>

      {/* ── Left: Hero + workflow steps ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Branding */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <AppIconLarge />
            <span style={{ fontSize: '1rem', color: 'var(--text-3)', opacity: 0.4, fontWeight: 200 }}>×</span>
            <TRExLogoLarge />
            <div>
              <h1 className="text-2xl font-bold gradient-text" style={{ lineHeight: 1.2 }}>DESeq2 ExploreR</h1>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginTop: 2 }}>
                Interactive differential expression analysis
              </p>
            </div>
          </div>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-2)', lineHeight: 1.7 }}>
            Upload your RNA-seq count matrix or pre-computed DESeq2 results, define
            contrasts, and explore differential expression through interactive
            visualisations — no command line required.
          </p>
        </div>

        {/* Workflow steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 14,
              padding: '12px 14px', borderRadius: 10,
              background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
            }}>
              <div style={{
                flexShrink: 0, width: 36, height: 36, borderRadius: 8,
                background: 'rgba(var(--accent-rgb),0.12)', border: '1px solid rgba(var(--accent-rgb),0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)',
              }}>
                {s.icon}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 700, color: 'var(--accent)',
                    background: 'rgba(var(--accent-rgb),0.12)', borderRadius: 4,
                    padding: '1px 6px', letterSpacing: '0.05em',
                  }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-1)' }}>{s.title}</span>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-3)', lineHeight: 1.5, margin: 0 }}>{s.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Developed by */}
        <p style={{ fontSize: '0.72rem', color: 'var(--text-3)', opacity: 0.6 }}>
          Built with DESeq2, R/Plumber, React & Plotly ·{' '}
          <a href="https://github.com/bixBeta" target="_blank" rel="noopener noreferrer"
             style={{ color: 'var(--accent)', textDecoration: 'none' }}>@bixBeta</a>
        </p>
      </div>

      {/* ── Right: Path selector or Sign-in form ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {!showForm ? (
          /* Path selector */
          <>
            <div style={{ marginBottom: 4 }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
                Get started
              </h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>
                Choose how you'd like to proceed
              </p>
            </div>

            {/* Try example */}
            <button onClick={tryExample} disabled={exLoading}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '16px 18px', borderRadius: 12, cursor: exLoading ? 'wait' : 'pointer',
                      background: 'rgba(45,212,191,0.07)',
                      border: '1px solid rgba(45,212,191,0.3)',
                      textAlign: 'left', transition: 'all 0.15s', width: '100%',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(45,212,191,0.12)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(45,212,191,0.07)'}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: 'rgba(45,212,191,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M5 2h10M6 2v4L3 13a1.5 1.5 0 001.4 2h11.2A1.5 1.5 0 0017 13l-3-7V2"
                        stroke="#0f766e" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="7.5" cy="11" r="0.9" fill="#0f766e"/>
                  <circle cx="10.5" cy="13" r="0.9" fill="#0f766e"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f766e', marginBottom: 2 }}>
                  {exLoading ? 'Loading example…' : 'Explore Example Data'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', lineHeight: 1.4 }}>
                  No account needed — browse a pre-loaded RNA-seq dataset instantly
                </div>
              </div>
            </button>

            {/* New user */}
            <button onClick={() => setShowForm(true)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '16px 18px', borderRadius: 12, cursor: 'pointer',
                      background: 'rgba(var(--accent-rgb),0.06)',
                      border: '1px solid rgba(var(--accent-rgb),0.25)',
                      textAlign: 'left', transition: 'all 0.15s', width: '100%',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.12)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.06)'}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: 'rgba(var(--accent-rgb),0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="7" r="3" stroke="var(--accent)" strokeWidth="1.4"/>
                  <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round"/>
                  <path d="M14 3v4M12 5h4" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--accent)', marginBottom: 2 }}>
                  New User
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', lineHeight: 1.4 }}>
                  Create a free account with your email + PIN to save sessions and results
                </div>
              </div>
            </button>

            {/* Returning user */}
            <button onClick={() => setShowForm(true)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '16px 18px', borderRadius: 12, cursor: 'pointer',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid var(--border)',
                      textAlign: 'left', transition: 'all 0.15s', width: '100%',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(168,85,247,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="7" r="3" stroke="var(--text-2)" strokeWidth="1.4"/>
                  <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="var(--text-2)" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-1)', marginBottom: 2 }}>
                  Returning User
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', lineHeight: 1.4 }}>
                  Sign in with your email + PIN to resume previous sessions
                  <br /><span style={{ visibility: 'hidden' }}>placeholder</span>
                </div>
              </div>
            </button>

            {error && (
              <div className="text-xs px-3 py-2 rounded-lg"
                   style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
                {error}
              </div>
            )}

            {/* ── Data Prep Tool link ── */}
            <div style={{ marginTop: 6, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 8 }}>
                Need to prepare your data first?
              </p>
              <a href="/prep/" target="_blank" rel="noopener noreferrer"
                 style={{
                   display: 'flex', alignItems: 'center', gap: 13,
                   padding: '13px 15px', borderRadius: 11,
                   background: 'rgba(99,102,241,0.04)',
                   border: '1px solid rgba(99,102,241,0.18)',
                   textDecoration: 'none', transition: 'all 0.15s',
                 }}
                 onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.1)'}
                 onMouseLeave={e => e.currentTarget.style.background = 'rgba(99,102,241,0.04)'}>
                <div style={{
                  width: 38, height: 38, borderRadius: 9, flexShrink: 0,
                  background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {/* wrench + table icon */}
                  <svg width="19" height="19" fill="none" stroke="#a5b4fc" strokeWidth="1.5" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="4" rx="1"/>
                    <rect x="3" y="10" width="18" height="4" rx="1"/>
                    <path d="M3 17h7M14 17h2M19 17h2" strokeLinecap="round"/>
                    <circle cx="11" cy="19" r="1.5" fill="#a5b4fc" stroke="none"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: '0.86rem', fontWeight: 600, color: '#7c83f5', marginBottom: 2 }}>
                    Data Prep Tool ↗
                  </div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-3)', lineHeight: 1.45 }}>
                    Build a DESeq2-ready RDS from a count matrix + metadata — runs in your browser
                  </div>
                </div>
              </a>
            </div>
          </>
        ) : (
          /* Sign-in form */
          <>
            <button onClick={() => { setShowForm(false); setError(null) }}
                    style={{
                      alignSelf: 'flex-start', background: 'none', border: 'none',
                      cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-3)',
                      display: 'flex', alignItems: 'center', gap: 4, padding: 0,
                    }}>
              ← Back
            </button>

            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
                Sign in
              </h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
                New users are created automatically on first sign-in
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
          </>
        )}
      </div>
    </div>
    </>
  )
}
