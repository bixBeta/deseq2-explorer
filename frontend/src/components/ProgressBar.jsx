import { useEffect, useState } from 'react'

/**
 * Animated indeterminate progress bar.
 * Simulates progress: ramps to ~85% while active, snaps to 100% on complete.
 * Props:
 *   active  — bool: true while loading
 *   label   — string: message shown below the bar
 */
export default function ProgressBar({ active, label }) {
  const [progress, setProgress] = useState(0)
  const [visible,  setVisible]  = useState(false)

  useEffect(() => {
    if (active) {
      setProgress(0)
      setVisible(true)
      // Ramp to ~85% over ~8 s, slowing as it approaches
      let current = 0
      const tick = () => {
        current += (85 - current) * 0.035
        setProgress(current)
      }
      const id = setInterval(tick, 120)
      return () => clearInterval(id)
    } else {
      // Complete and fade out
      setProgress(100)
      const t = setTimeout(() => { setVisible(false); setProgress(0) }, 500)
      return () => clearTimeout(t)
    }
  }, [active])

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      {/* slim top bar */}
      <div style={{ width: '100%', height: 3, background: 'rgba(45,212,191,0.15)' }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: 'linear-gradient(90deg, #0e7490, #2dd4bf)',
          transition: progress === 100 ? 'width 0.3s ease' : 'width 0.12s linear',
          boxShadow: '0 0 8px rgba(45,212,191,0.6)',
        }} />
      </div>

      {/* floating label card */}
      {label && (
        <div style={{
          marginTop: 10,
          padding: '8px 18px',
          borderRadius: 10,
          background: 'rgba(7,11,20,0.88)',
          border: '1px solid rgba(45,212,191,0.2)',
          backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}>
          {/* spinner dot */}
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#2dd4bf',
            animation: 'pg-pulse 1s ease-in-out infinite',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: '0.8rem', color: '#e2e8f0' }}>{label}</span>
          <span style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace' }}>
            {Math.round(progress)}%
          </span>
        </div>
      )}

      <style>{`
        @keyframes pg-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>
    </div>
  )
}
