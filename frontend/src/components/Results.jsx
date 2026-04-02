import { useState, useMemo } from 'react'
import MAPlot          from './MAPlot'
import PCAPlot         from './PCAPlot'
import CountsPlot      from './CountsPlot'
import ResultsTable    from './ResultsTable'
import AnnotationPanel from './AnnotationPanel'
import ComparePanel    from './ComparePanel'
import GSEAExplorer    from './GSEAExplorer'

const STORAGE_KEY = 'deseq2_tab_icons'

const DEFAULT_TABS = [
  { key: 'counts',   label: 'Counts',      icon: '▦'  },
  { key: 'annotate', label: 'Annotate',    icon: '◈'  },
  { key: 'ma',       label: 'MA Plot',     icon: '╱╲' },
  { key: 'pca',      label: 'PCA',         icon: '●●' },
  { key: 'table',    label: 'DE Results',  icon: '▤'  },
  { key: 'compare',  label: 'Compare',     icon: '⊕'  },
  { key: 'gsea',     label: 'GSEA',        icon: '⟳', navy: true },
]

function loadIcons() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
function saveIcons(icons) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(icons)) } catch {}
}

export default function Results({ results, design, onBack, onEditSamples, session, annMap, annDetails, sampleLabels = {}, onAnnotate, onGseaRunsChange }) {
  const [activeIdx,   setActiveIdx]   = useState(0)
  const [vizTab,      setVizTab]      = useState('counts')
  const [customIcons, setCustomIcons] = useState(loadIcons)   // { key: icon }
  const [editingIcon, setEditingIcon] = useState(null)        // tab key being edited
  const [iconDraft,   setIconDraft]   = useState('')

  const tabs = DEFAULT_TABS.map(t => ({
    ...t, icon: customIcons[t.key] ?? t.icon,
  }))

  function startEdit(key, currentIcon, e) {
    e.stopPropagation()
    setEditingIcon(key)
    setIconDraft(currentIcon)
  }
  function commitEdit(key) {
    const trimmed = iconDraft.trim()
    const updated = { ...customIcons }
    if (trimmed) updated[key] = trimmed
    else delete updated[key]
    setCustomIcons(updated)
    saveIcons(updated)
    setEditingIcon(null)
  }

  // Normalise: handle both new {contrasts:[…]} and old {results:[…]} formats
  const contrastList = useMemo(() => {
    if (!results) return []
    if (results.contrasts?.length) return results.contrasts
    if (results.results) return [{
      treatment: design?.contrast,
      label:     `${design?.contrast ?? '?'} vs ${design?.reference ?? '?'}`,
      results:   results.results,
      summary:   null,
    }]
    return []
  }, [results, design])

  const pca        = results?.pca
  const countDist  = results?.countDist
  const active     = contrastList[activeIdx] ?? contrastList[0]

  const maDesign = useMemo(() => ({
    ...design,
    contrast:  active?.treatment,
    reference: active?.reference,
  }), [design, active?.treatment, active?.reference])

  const geneIds = useMemo(
    () => (active?.results || []).map(r => r.gene).filter(Boolean),
    [active]
  )

  const summary = useMemo(() => {
    if (!active) return { total: 0, up: 0, down: 0 }
    if (active.summary) return active.summary
    const sig  = (active.results || []).filter(r => r.padj != null && r.padj < (design?.params?.alpha ?? 0.05))
    const up   = sig.filter(r => r.log2FC > 0).length
    return { total: sig.length, up, down: sig.length - up }
  }, [active, design])

  if (!contrastList.length) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: 40 }}>
        <p>No results to display.</p>
        <button className="btn-ghost" style={{ marginTop: 16 }} onClick={onBack}>← Back</button>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Top bar: back + contrast tabs + summary chips ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-ghost" onClick={onBack}>← Back</button>
          {onEditSamples && (
            <button onClick={onEditSamples}
                    className="text-xs px-3 py-1.5 rounded-lg transition-all"
                    style={{ background: 'rgba(20,184,166,0.1)', color: '#0f766e',
                             border: '1px solid rgba(20,184,166,0.2)', cursor: 'pointer' }}>
              ✏️ Edit Samples
            </button>
          )}
          <button onClick={onBack}
                  className="text-xs px-3 py-1.5 rounded-lg transition-all"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)',
                           border: '1px solid var(--border)', cursor: 'pointer' }}>
            + Add Contrast
          </button>

          {/* Contrast tab bar (scrollable) */}
          <div style={{
            display: 'flex', gap: 4, overflowX: 'auto', flex: 1,
            borderBottom: '1px solid var(--border)', paddingBottom: 0,
          }}>
            {contrastList.map((c, i) => (
              <button key={c.treatment ?? i}
                      onClick={() => setActiveIdx(i)}
                      className="text-xs px-3 py-2 rounded-t-lg transition-all whitespace-nowrap"
                      style={{
                        background:   i === activeIdx ? 'var(--bg-card2)' : 'transparent',
                        color:        i === activeIdx ? 'var(--text-1)'   : 'var(--text-3)',
                        borderBottom: i === activeIdx ? '2px solid var(--accent)' : '2px solid transparent',
                        fontWeight:   i === activeIdx ? 600 : 400,
                      }}>
                {c.label ?? c.treatment ?? `Contrast ${i + 1}`}
              </button>
            ))}
          </div>
        </div>

        {/* Summary chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingLeft: 2 }}>
          <span className="stat-chip" style={{ color: 'var(--accent)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
            {summary.total.toLocaleString()} DEGs
          </span>
          <span className="stat-chip" style={{ color: '#059669' }}>↑ {summary.up.toLocaleString()} up</span>
          <span className="stat-chip" style={{ color: '#f87171' }}>↓ {summary.down.toLocaleString()} down</span>
          {design?.params && (
            <span className="stat-chip" style={{ color: 'var(--text-3)', fontSize: '0.68rem' }}>
              α={design.params.alpha}
              {design.params.lfcThreshold > 0 && ` · |LFC|>${design.params.lfcThreshold}`}
            </span>
          )}
        </div>
      </div>

      {/* ── Viz tab bar ── */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', alignItems: 'flex-end' }}>
        {tabs.map(t => {
          const active = vizTab === t.key
          const isCompare = t.key === 'compare'
          const compareReady = isCompare && contrastList.length >= 2
          return (
            <div key={t.key} style={{ position: 'relative' }}
                 onMouseEnter={e => e.currentTarget.querySelector('.icon-edit-btn')?.style && (e.currentTarget.querySelector('.icon-edit-btn').style.opacity = '1')}
                 onMouseLeave={e => e.currentTarget.querySelector('.icon-edit-btn')?.style && (e.currentTarget.querySelector('.icon-edit-btn').style.opacity = '0')}>

              <button onClick={() => setVizTab(t.key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '7px 14px', cursor: 'pointer',
                        background:   active ? (t.navy ? 'rgba(30,64,175,0.1)' : 'var(--bg-card2)') : 'transparent',
                        color:        active ? (t.navy ? '#60a5fa' : 'var(--text-1)') : isCompare && !compareReady ? 'var(--text-3)' : t.navy ? 'rgba(96,165,250,0.6)' : 'var(--text-3)',
                        borderBottom: active ? `2px solid ${t.navy ? '#3b82f6' : 'var(--accent)'}` : compareReady && !active ? '2px solid rgba(var(--accent-rgb),0.3)' : '2px solid transparent',
                        fontWeight:   active ? 600 : 400,
                        fontSize: '0.82rem', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                        borderRadius: '6px 6px 0 0', whiteSpace: 'nowrap',
                        transition: 'color 0.15s, background 0.15s',
                        opacity: isCompare && !compareReady ? 0.45 : 1,
                      }}>
                {editingIcon === t.key ? (
                  <input
                    autoFocus
                    value={iconDraft}
                    onChange={e => setIconDraft(e.target.value)}
                    onBlur={() => commitEdit(t.key)}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(t.key); if (e.key === 'Escape') setEditingIcon(null) }}
                    onClick={e => e.stopPropagation()}
                    placeholder={t.icon}
                    style={{
                      width: 36, fontSize: '0.85rem', textAlign: 'center',
                      background: 'rgba(var(--accent-rgb),0.12)', border: '1px solid rgba(var(--accent-rgb),0.4)',
                      borderRadius: 4, color: 'var(--text-1)', padding: '1px 4px',
                    }}
                  />
                ) : (
                  <span style={{ fontSize: '0.9rem', fontFamily: 'monospace', letterSpacing: '-0.02em' }}>{t.icon}</span>
                )}
                {t.label}
              </button>

              {/* Edit pencil — shown on hover */}
              {editingIcon !== t.key && (
                <button
                  className="icon-edit-btn"
                  onClick={e => startEdit(t.key, t.icon, e)}
                  title="Customize icon"
                  style={{
                    position: 'absolute', top: 2, right: 2,
                    opacity: 0, transition: 'opacity 0.15s',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '0.6rem', color: 'var(--text-3)', padding: '1px 3px',
                    lineHeight: 1,
                  }}>
                  ✎
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Content ── */}
      <div className="glass" style={{ padding: 20, minHeight: 480 }}>
        <div style={{ display: vizTab === 'counts' ? 'block' : 'none' }}>
          <CountsPlot countDist={countDist} design={design} metadata={pca?.scores} sampleLabels={sampleLabels} />
        </div>
        <div style={{ display: vizTab === 'ma' ? 'block' : 'none' }}>
          <MAPlot
            design={maDesign}
            session={session}
            annMap={annMap}
          />
        </div>
        <div style={{ display: vizTab === 'pca' ? 'block' : 'none' }}>
          <PCAPlot pca={pca} design={design} sampleLabels={sampleLabels} annMap={annMap} />
        </div>
        <div style={{ display: vizTab === 'table' ? 'block' : 'none' }}>
          <ResultsTable
            results={active?.results}
            label={active?.label}
            session={session}
            contrast={{ treatment: active?.treatment, reference: active?.reference, label: active?.label }}
            column={design?.column}
            annMap={annMap}
            annDetails={annDetails}
          />
        </div>
        <div style={{ display: vizTab === 'annotate' ? 'block' : 'none' }}>
          <AnnotationPanel geneIds={geneIds} annMap={annMap} onAnnotate={(map, details) => { onAnnotate(map, details); if (map) setVizTab('table') }} />
        </div>
        <div style={{ display: vizTab === 'compare' ? 'block' : 'none' }}>
          <ComparePanel session={session} contrasts={contrastList} annMap={annMap} annDetails={annDetails} pca={pca} sampleLabels={sampleLabels} />
        </div>
        <div style={{ display: vizTab === 'gsea' ? 'block' : 'none' }}>
          <GSEAExplorer
            session={session}
            contrastLabel={active?.label}
            annMap={annMap}
            onRunsChange={onGseaRunsChange}
          />
        </div>
      </div>
    </div>
  )
}
