import { useState, useEffect, useRef, Component } from 'react'
import SessionGate   from './components/SessionGate'
import SessionPicker from './components/SessionPicker'
import Uploader      from './components/Uploader'
import MetadataEditor from './components/MetadataEditor'
import DesignPanel   from './components/DesignPanel'
import Results       from './components/Results'
import ThemeToggle   from './components/ThemeToggle'
import HelpPanel     from './components/HelpPanel'
import ConsoleModal  from './components/ConsoleModal'

// ── Error boundary — catches render errors and shows a recovery UI ────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('App render error:', error, info) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 48, gap: 16, color: '#f1f5f9', textAlign: 'center',
      }}>
        <div style={{ fontSize: '2rem' }}>⚠</div>
        <div style={{ fontWeight: 600, fontSize: '1rem' }}>Something went wrong</div>
        <div style={{ fontSize: '0.8rem', color: '#94a3b8', maxWidth: 400, lineHeight: 1.6 }}>
          {this.state.error?.message || 'An unexpected error occurred.'}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 8, padding: '8px 20px', borderRadius: 8, cursor: 'pointer',
            background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
            color: '#a5b4fc', fontSize: '0.85rem', fontWeight: 500,
          }}>
          Reload page
        </button>
      </div>
    )
  }
}

// ── App icon variants — change ICON_VARIANT to 'A' | 'B' | 'C' to switch ────
const ICON_VARIANT = 'C'

// Flat-top hexagon path centered at (20,20) r=17
const HEX = 'M 37,20 L 28.5,34.7 L 11.5,34.7 L 3,20 L 11.5,5.3 L 28.5,5.3 Z'

function TRExLogo({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="trex-bg" x1="3" y1="5" x2="37" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#1e1b4b"/>
          <stop offset="100%" stopColor="#312e81"/>
        </linearGradient>
      </defs>
      <path d={HEX} fill="url(#trex-bg)" stroke="#6d28d9" strokeWidth="1"/>
      <text x="20" y="17" textAnchor="middle" fill="#c4b5fd"
            fontFamily="Inter,system-ui,sans-serif" fontWeight="700" fontSize="10">TR</text>
      <text x="20" y="29" textAnchor="middle" fill="#c4b5fd"
            fontFamily="Inter,system-ui,sans-serif" fontWeight="700" fontSize="10">Ex</text>
    </svg>
  )
}

function AppIcon({ variant = ICON_VARIANT }) {
  // Variant A — clean hexagon, deep indigo→violet, bold D
  if (variant === 'A') return (
    <svg width="34" height="34" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="hg-a" x1="3" y1="5" x2="37" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#4f46e5"/>
          <stop offset="100%" stopColor="#7c3aed"/>
        </linearGradient>
        <filter id="hf-a" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#4f46e5" floodOpacity="0.4"/>
        </filter>
      </defs>
      <path d={HEX} fill="url(#hg-a)" filter="url(#hf-a)"/>
      <text x="20" y="25" textAnchor="middle" fill="white"
            fontFamily="Inter,system-ui,sans-serif" fontWeight="800" fontSize="15">D</text>
    </svg>
  )

  // Variant B — hexagon with inner hex ring, indigo→cyan (AWS-like depth)
  if (variant === 'B') return (
    <svg width="34" height="34" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="hg-b" x1="3" y1="5" x2="37" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#0ea5e9"/>
          <stop offset="100%" stopColor="var(--accent)"/>
        </linearGradient>
        <filter id="hf-b" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#0ea5e9" floodOpacity="0.4"/>
        </filter>
      </defs>
      <path d={HEX} fill="url(#hg-b)" filter="url(#hf-b)"/>
      {/* inner ring */}
      <path d="M 31,20 L 25.5,29.5 L 14.5,29.5 L 9,20 L 14.5,10.5 L 25.5,10.5 Z"
            fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1"/>
      <text x="20" y="25" textAnchor="middle" fill="white"
            fontFamily="Inter,system-ui,sans-serif" fontWeight="800" fontSize="15">D</text>
    </svg>
  )

  // Variant C — dark hexagon with teal accent line, monochrome biotech feel
  return (
    <svg width="34" height="34" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="hg-c" x1="3" y1="5" x2="37" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#1e1b4b"/>
          <stop offset="100%" stopColor="#312e81"/>
        </linearGradient>
        <linearGradient id="hg-c2" x1="3" y1="5" x2="37" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#2dd4bf"/>
          <stop offset="100%" stopColor="#818cf8"/>
        </linearGradient>
        <filter id="hf-c" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#2dd4bf" floodOpacity="0.35"/>
        </filter>
      </defs>
      <path d={HEX} fill="url(#hg-c)" filter="url(#hf-c)"/>
      {/* teal accent edge on top-right */}
      <path d="M 28.5,5.3 L 37,20" stroke="url(#hg-c2)" strokeWidth="2.5" strokeLinecap="round"/>
      <text x="20" y="25" textAnchor="middle" fill="white"
            fontFamily="Inter,system-ui,sans-serif" fontWeight="800" fontSize="15">D</text>
    </svg>
  )
}

const STEPS       = ['upload', 'metadata', 'design', 'results']
const STEP_LABELS = ['1. Upload', '2. Samples', '3. Design', '4. Results']

const ACCENT_THEMES = [
  { id: 'indigo',  label: 'Indigo',  color: '#6366f1' },
  { id: 'maroon',  label: 'Maroon',  color: '#9f1239' },
  { id: 'crimson', label: 'Crimson', color: '#b91c1c' },
  { id: 'forest',  label: 'Forest',  color: '#166534' },
  { id: 'ocean',   label: 'Ocean',   color: '#0e7490' },
  { id: 'amber',   label: 'Amber',   color: '#92400e' },
]

export default function App() {
  const [isDark, setIsDark]         = useState(false)   // light-mode default
  const accent = 'ocean'
  const [step,   setStep]           = useState('session')
  const [auth,   setAuth]           = useState(null)    // { email, pin }
  const [sessions, setSessions]     = useState([])
  const [session,  setSession]      = useState(null)    // { sessionId, email }
  const [parseInfo,   setParseInfo]   = useState(null)
  const [metaState,   setMetaState]   = useState(null)
  const [results,     setResults]     = useState(null)
  const [design,      setDesign]      = useState(null)
  const [annMap,      setAnnMap]      = useState(null)   // gene_id → symbol
  const [annDetails,  setAnnDetails]  = useState(null)   // gene_id → { chr, start, end, description } (GTF only)
  const [sampleLabels, setSampleLabels] = useState({})   // originalSample → displayName
  const [saveStatus,  setSaveStatus]  = useState('idle')   // 'idle' | 'saving' | 'saved'
  const [copied,      setCopied]      = useState(false)
  const [showHelp,    setShowHelp]    = useState(false)
  const [showConsole, setShowConsole] = useState(false)

  /* ── Theme ── */
  useEffect(() => {
    document.body.classList.toggle('light', !isDark)
    document.body.classList.toggle('dark',   isDark)
  }, [isDark])
  useEffect(() => { document.body.classList.add('light') }, [])
  useEffect(() => {
    document.body.setAttribute('data-accent', 'ocean')
  }, [])

  /* ── Auth: credentials verified → picker ── */
  function handleAuth({ email, pin, sessions: sess }) {
    setAuth({ email, pin })
    setSessions(sess || [])
    setStep('picker')
  }

  /* ── Example data (no auth) ── */
  function handleExample(data) {
    setSession({ sessionId: 'example', email: 'example', isExample: true })
    const norm = normParseInfo(data)
    setParseInfo({ columns: norm.columns, levels: norm.levels, metadataRows: norm.metadataRows })
    setMetaState({
      rows:     norm.metadataRows,
      selected: new Set(norm.metadataRows.map(r => r.sample)),
    })
    if (data.hasResults && data.results) {
      setResults(data.results)
      if (data.design) setDesign(data.design)
      setStep('results')
    } else {
      setStep('metadata')
    }
  }

  /* ── Session picker: new or resume ── */
  function handlePick(info) {
    setSession({ sessionId: info.sessionId, email: auth?.email || info.email })

    if (info.isNew) {
      setParseInfo(null); setMetaState(null); setResults(null); setDesign(null)
      setStep('upload')
      return
    }

    if (info.hasResults && info.results) {
      setResults(info.results)
      setDesign(info.design)
      if (info.annMap    && Object.keys(info.annMap).length    > 0) setAnnMap(info.annMap)
      if (info.annDetails && Object.keys(info.annDetails).length > 0) setAnnDetails(info.annDetails)
      if (info.sampleLabels && Object.keys(info.sampleLabels).length > 0) setSampleLabels(info.sampleLabels)
      // Restore metaState so "Add Contrast" can route back to the design panel
      if (info.metadataRows?.length > 0) {
        const norm = normParseInfo(info)
        setParseInfo({ columns: norm.columns, levels: norm.levels, metadataRows: norm.metadataRows })
        setMetaState({
          rows:     norm.metadataRows,
          selected: new Set(norm.metadataRows.map(r => r.sample)),
        })
      }
      setStep('results')
    } else if (info.hasData && info.metadataRows) {
      const norm = normParseInfo(info)
      setParseInfo({ columns: norm.columns, levels: norm.levels, metadataRows: norm.metadataRows })
      setMetaState({
        rows:     norm.metadataRows,
        selected: new Set(norm.metadataRows.map(r => r.sample)),
      })
      if (info.design) setDesign(info.design)
      setStep('metadata')
    } else {
      setStep('upload')
    }
  }

  /* ── Logout ── */
  function handleLogout() {
    setAuth(null); setSessions([]); setSession(null)
    setParseInfo(null); setMetaState(null); setResults(null); setDesign(null); setAnnMap(null); setAnnDetails(null)
    setSampleLabels({})
    setStep('session')
  }

  /* ── Start New Session (stay logged in) ── */
  function handleNewSession() {
    const isExample = session?.isExample
    setSession(null)
    setParseInfo(null); setMetaState(null); setResults(null); setDesign(null); setAnnMap(null); setAnnDetails(null)
    setSampleLabels({})
    setStep(isExample ? 'session' : 'picker')
  }

  /* ── Edit Samples after results (keeps results so user can navigate back) ── */
  function handleEditSamples() {
    setStep('metadata')
  }

  /* ── Build save payload (shared by manual save, autosave, beacon) ── */
  function buildSaveBody(ms = metaState, sl = sampleLabels) {
    const body = { sessionId: session.sessionId, email: auth.email, pin: auth.pin }
    if (ms) {
      body.keepSamples = [...ms.selected]
      body.editedMeta  = ms.rows.filter(r => ms.selected.has(r.sample))
    }
    if (annMap     && Object.keys(annMap).length     > 0) body.annMap     = annMap
    if (annDetails && Object.keys(annDetails).length > 0) body.annDetails = annDetails
    if (sl && Object.keys(sl).length > 0) body.sampleLabels = sl
    return body
  }

  /* ── Manual save (persist edited metadata / sample selection / annotations) ── */
  async function handleSave() {
    if (!session || !auth) return
    setSaveStatus('saving')
    try {
      const resp = await fetch('/api/session/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSaveBody()),
      })
      if (!resp.ok) throw new Error('Save failed')
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch (e) {
      console.error(e)
      setSaveStatus('idle')
    }
  }

  /* ── Tab-close beacon save ── */
  const annMapRef       = useRef(annMap)
  const annDetailsRef   = useRef(annDetails)
  const metaRef         = useRef(metaState)
  const sessionRef      = useRef(session)
  const authRef         = useRef(auth)
  const sampleLabelsRef = useRef(sampleLabels)
  useEffect(() => { annMapRef.current       = annMap        }, [annMap])
  useEffect(() => { annDetailsRef.current   = annDetails    }, [annDetails])
  useEffect(() => { metaRef.current         = metaState     }, [metaState])
  useEffect(() => { sessionRef.current      = session       }, [session])
  useEffect(() => { authRef.current         = auth          }, [auth])
  useEffect(() => { sampleLabelsRef.current = sampleLabels  }, [sampleLabels])

  useEffect(() => {
    function onUnload() {
      const s = sessionRef.current; const a = authRef.current
      if (!s || !a || s.isExample) return
      const ms = metaRef.current
      const am = annMapRef.current
      const ad = annDetailsRef.current
      const sl = sampleLabelsRef.current
      const body = { sessionId: s.sessionId, email: a.email, pin: a.pin }
      if (ms) {
        body.keepSamples = [...ms.selected]
        body.editedMeta  = ms.rows.filter(r => ms.selected.has(r.sample))
      }
      if (am && Object.keys(am).length > 0) body.annMap = am
      if (ad && Object.keys(ad).length > 0) body.annDetails = ad
      if (sl && Object.keys(sl).length > 0) body.sampleLabels = sl
      navigator.sendBeacon('/api/session/save', new Blob([JSON.stringify(body)], { type: 'application/json' }))
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  /* ── Normalise R JSON arrays ──────────────────────────────────────────────
   * jsonlite quirks:
   *   - unboxedJSON collapses a length-1 vector to a bare scalar string
   *   - a named list serialises as {} instead of []
   * Handle all three: array, string (unboxed), object (named list), null
   * ─────────────────────────────────────────────────────────────────────── */
  function toArr(v) {
    if (Array.isArray(v)) return v
    if (typeof v === 'string') return [v]           // unboxed single element
    if (v && typeof v === 'object') return Object.values(v)
    return []
  }
  function normParseInfo(raw) {
    return {
      ...raw,
      columns:      toArr(raw.columns),
      metadataRows: toArr(raw.metadataRows),
    }
  }

  /* ── Workflow ── */
  function handleParsed(info) {
    const norm = normParseInfo(info)
    setParseInfo(norm)
    const rows = norm.metadataRows
    setMetaState({
      rows,
      selected: new Set(rows.map(r => r.sample).filter(Boolean)),
    })
    setStep('metadata')
  }
  async function handleMetaConfirm(ms) {
    const newLabels = ms.labels || {}
    setMetaState(ms)
    setSampleLabels(newLabels)
    setStep('design')
    // Auto-persist edits so they survive logout/resume
    if (session && auth && !session.isExample) {
      try {
        await fetch('/api/session/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildSaveBody(ms, newLabels)),
        })
      } catch (e) {
        console.error('Auto-save metadata failed:', e)
      }
    }
  }
  function handleResults(res, des) { setResults(res); setDesign(des); setStep('results') }
  // From results: go to design in append-mode (results kept) or picker (no parse info)
  function handleResultsBack() { metaState ? setStep('design') : setStep('picker') }
  // Going back from design to samples clears results (sample change invalidates old contrasts)
  function handleDesignBackToSamples() { setResults(null); setStep('metadata') }

  const stepIdx = STEPS.indexOf(step)
  const inFlow  = stepIdx >= 0
  const showNav = step !== 'session'

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-app)' }}>

      {/* ── Header (frosted glass, like PCA explorer) ── */}
      <header className="flex items-center justify-between px-6 py-3 sticky top-0 z-[300]"
              style={{
                background: 'var(--bg-header)',
                borderBottom: '1px solid var(--border)',
                backdropFilter: 'blur(12px)',
              }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AppIcon />
          <span style={{ fontSize: '0.6rem', color: 'var(--text-3)', opacity: 0.4, fontWeight: 300 }}>×</span>
          <TRExLogo size={34} />
          <span className="font-bold text-base gradient-text" style={{ marginLeft: 6 }}>DESeq2 ExploreR</span>
        </div>

        {/* Step breadcrumb */}
        {inFlow && (
          <nav className="hidden sm:flex items-center gap-1">
            {STEPS.map((key, idx) => {
              const done   = idx < stepIdx
              const active = idx === stepIdx
              return (
                <span key={key} className="text-xs px-3 py-1 rounded-full transition-all"
                      style={{
                        background: active ? 'rgba(var(--accent-rgb),0.15)' : done ? 'rgba(var(--accent-rgb),0.08)' : 'transparent',
                        color:      active ? 'var(--accent)' : done ? 'var(--accent2)' : 'var(--text-3)',
                        border:     active ? '1px solid rgba(var(--accent-rgb),0.35)' : '1px solid transparent',
                        fontWeight: active ? 600 : 400,
                      }}>
                  {STEP_LABELS[idx]}
                </span>
              )
            })}
          </nav>
        )}

        {/* Right controls */}
        <div className="flex items-center gap-3">
          {showNav && auth && (
            <span className="text-xs hidden sm:block font-mono" style={{ color: 'var(--text-3)' }}>
              {auth.email}
            </span>
          )}
          {showNav && session?.isExample && (
            <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(45,212,191,0.1)', color: '#0f766e', border: '1px solid rgba(45,212,191,0.2)' }}>
              Example Data
            </span>
          )}
          {showNav && session && !session.isExample && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(session.sessionId)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              title="Copy session ID"
              className="text-xs px-2 py-1 rounded"
              style={{
                background: 'rgba(45,212,191,0.1)', color: '#0f766e',
                border: '1px solid rgba(45,212,191,0.2)',
                cursor: 'pointer', fontFamily: 'monospace',
                transition: 'all 0.15s',
              }}>
              {copied ? '✓ Copied' : `ID: ${session.sessionId}`}
            </button>
          )}
          {showNav && session && !session.isExample && metaState && (
            <button onClick={handleSave} disabled={saveStatus === 'saving'}
                    className="text-xs px-3 py-1.5 rounded-lg transition-all"
                    style={{
                      background: saveStatus === 'saved' ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.04)',
                      color:      saveStatus === 'saved' ? '#34d399' : 'var(--text-3)',
                      border:     '1px solid var(--border)',
                      cursor:     saveStatus === 'saving' ? 'wait' : 'pointer',
                    }}>
              {saveStatus === 'saving' ? '⏳ Saving…' : saveStatus === 'saved' ? '✓ Saved' : '💾 Save'}
            </button>
          )}
          {showNav && (
            <button onClick={handleNewSession}
                    className="text-xs px-3 py-1.5 rounded-lg transition-all"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
              New Session
            </button>
          )}
          {showNav && (
            <button onClick={handleLogout}
                    className="text-xs px-3 py-1.5 rounded-lg transition-all"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
              Logout
            </button>
          )}
          <button onClick={() => setShowConsole(true)}
                  title="Console — Methods & Session Parameters"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
                           borderRadius: 8, height: 30, padding: '0 10px', cursor: 'pointer',
                           fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-2)',
                           display: 'flex', alignItems: 'center', gap: 5,
                           fontFamily: 'monospace', transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.12)'; e.currentTarget.style.color = 'var(--accent)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'var(--text-2)' }}>
            <span style={{ fontSize:'0.8rem' }}>{'>'}</span> console
          </button>
          <button onClick={() => setShowHelp(true)}
                  title="Help & Documentation"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
                           borderRadius: 8, width: 30, height: 30, cursor: 'pointer',
                           fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-2)',
                           display: 'flex', alignItems: 'center', justifyContent: 'center',
                           transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.12)'; e.currentTarget.style.color = 'var(--accent)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'var(--text-2)' }}>
            ?
          </button>
          <ThemeToggle isDark={isDark} onToggle={() => setIsDark(d => !d)} />
        </div>
      </header>

      {/* ── Main (dot-grid background) ── */}
      <main className="flex-1 flex items-start justify-center p-6 pt-10 dot-grid">
       <ErrorBoundary key={step}>
        {step === 'session' && <SessionGate onAuth={handleAuth} onExample={handleExample} />}
        {step === 'picker'  && (
          <SessionPicker auth={auth} initialSessions={sessions}
                         onPick={handlePick} onLogout={handleLogout} />
        )}
        {step === 'upload'   && <Uploader session={session} onParsed={handleParsed} />}
        {step === 'metadata' && (
          <MetadataEditor parseInfo={parseInfo} metaState={metaState} sampleLabels={sampleLabels}
                          onConfirm={handleMetaConfirm}
                          onBack={results ? () => setStep('results') : () => setStep('upload')} />
        )}
        {step === 'design' && (
          <DesignPanel session={session} parseInfo={parseInfo} metaState={metaState}
                       initialDesign={design} existingResults={results}
                       onResults={handleResults}
                       onBack={results ? () => setStep('results') : handleDesignBackToSamples} />
        )}
        {step === 'results' && (
          <Results results={results} design={design} onBack={handleResultsBack}
                   onEditSamples={metaState ? handleEditSamples : null}
                   session={session} annMap={annMap} annDetails={annDetails}
                   sampleLabels={sampleLabels}
                   onAnnotate={(map, details) => { setAnnMap(map); setAnnDetails(details || null) }} />
        )}
       </ErrorBoundary>
      </main>

      {/* ── Footer ── */}
      <footer className="flex items-center justify-end px-6 py-2"
              style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-header)', backdropFilter: 'blur(8px)' }}>
        <span className="text-xs opacity-40" style={{ color: 'var(--text-3)' }}>
          developed by{' '}
          <a href="https://github.com/bixBeta" target="_blank" rel="noopener noreferrer"
             className="hover:opacity-70 transition-opacity" style={{ color: 'var(--accent)' }}>
            @bixBeta
          </a>
        </span>
      </footer>

      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      {showConsole && (
        <ConsoleModal
          onClose={() => setShowConsole(false)}
          session={session}
          design={design}
          results={results}
          parseInfo={parseInfo}
        />
      )}
    </div>
  )
}
