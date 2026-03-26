import { useState, useRef, useCallback, useMemo, useEffect } from 'react'

// g:Profiler organism codes (used only for the g:Profiler method)
const ORGANISMS = [
  { value: 'hsapiens',      label: 'Human (H. sapiens)',         human: true  },
  { value: 'mmusculus',     label: 'Mouse (M. musculus)',         human: false },
  { value: 'rnorvegicus',   label: 'Rat (R. norvegicus)',         human: false },
  { value: 'drerio',        label: 'Zebrafish (D. rerio)',        human: false },
  { value: 'dmelanogaster', label: 'Fruit fly (D. melanogaster)', human: false },
  { value: 'celegans',      label: 'C. elegans',                  human: false },
  { value: 'scerevisiae',   label: 'Yeast (S. cerevisiae)',       human: false },
  { value: 'athaliana',     label: 'Arabidopsis (A. thaliana)',   human: false },
]

// BioMart organism codes → Ensembl dataset names ({value}_gene_ensembl)
// Only Ensembl vertebrate/metazoan mart (ensembl.org). Plants/fungi use
// separate Ensembl marts and require a custom dataset name.
const BIOMART_ORGANISMS = [
  // ── Mammals ──────────────────────────────────────────────────────────
  { value: 'hsapiens',       label: 'Human (H. sapiens)',             human: true  },
  { value: 'mmusculus',      label: 'Mouse (M. musculus)',             human: false },
  { value: 'rnorvegicus',    label: 'Rat (R. norvegicus)',             human: false },
  { value: 'sscrofa',        label: 'Pig (S. scrofa)',                 human: false },
  { value: 'btaurus',        label: 'Cow (B. taurus)',                 human: false },
  { value: 'ggallus',        label: 'Chicken (G. gallus)',             human: false },
  { value: 'cfamiliaris',    label: 'Dog (C. familiaris)',             human: false },
  { value: 'ecaballus',      label: 'Horse (E. caballus)',             human: false },
  { value: 'oaries',         label: 'Sheep (O. aries)',                human: false },
  { value: 'mmulatta',       label: 'Macaque (M. mulatta)',            human: false },
  { value: 'ptroglodytes',   label: 'Chimpanzee (P. troglodytes)',     human: false },
  { value: 'fcatus',         label: 'Cat (F. catus)',                  human: false },
  // ── Other vertebrates ────────────────────────────────────────────────
  { value: 'drerio',         label: 'Zebrafish (D. rerio)',            human: false },
  { value: 'xtropicalis',    label: 'Xenopus (X. tropicalis)',         human: false },
  { value: 'ggallus',        label: 'Chicken (G. gallus)',             human: false },
  // ── Invertebrates ────────────────────────────────────────────────────
  { value: 'dmelanogaster',  label: 'Fruit fly (D. melanogaster)',     human: false },
  { value: 'celegans',       label: 'C. elegans',                      human: false },
  // ── Fungi / Plants ───────────────────────────────────────────────────
  // These require Ensembl Fungi/Plants marts — use "Custom dataset" below
  { value: 'scerevisiae',    label: 'Yeast (S. cerevisiae) ¹',        human: false },
  { value: 'athaliana',      label: 'Arabidopsis (A. thaliana) ¹',    human: false },
  // ── Custom ───────────────────────────────────────────────────────────
  { value: '__custom__',     label: 'Custom dataset…',                 human: false },
]

// Map Ensembl ID prefix → organism value for auto-detection
const ENSEMBL_PREFIXES = [
  [/^ENSG\d/,       'hsapiens'],
  [/^ENSMUSG\d/,    'mmusculus'],
  [/^ENSRNOG\d/,    'rnorvegicus'],
  [/^ENSDARG\d/,    'drerio'],
  [/^FBgn\d/,       'dmelanogaster'],
  [/^WBGene\d/,     'celegans'],
  [/^Y[A-P][LR]\d/, 'scerevisiae'],
  [/^AT\dG\d/,      'athaliana'],
]

const CHUNK = 8 * 1024 * 1024   // 8 MB per chunk

// Detect API base URL (same origin in prod, :8000 in dev)
const API = import.meta.env.VITE_API_URL ?? ''

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
    id:          id.split('.')[0].trim(),
    name:        name,
    description: get('gene_description') || get('gene_biotype') || null,
  }
}

export default function AnnotationPanel({ geneIds, annMap, onAnnotate }) {
  const [method,         setMethod]         = useState('gprofiler')
  const [org,            setOrg]            = useState('hsapiens')
  const [customDataset,  setCustomDataset]  = useState('')   // full BioMart dataset name when org === '__custom__'
  const [wantOrthologs,  setWantOrthologs]  = useState(false)
  const [loading,        setLoading]        = useState(false)
  const [progress,       setProgress]       = useState(0)
  const [stage,          setStage]          = useState('')   // BioMart stage label
  const [gtfFile,        setGtfFile]        = useState(null)
  const [error,          setError]          = useState(null)
  const [preview,        setPreview]        = useState(null)
  const [dragging,       setDragging]       = useState(false)
  const fileRef      = useRef()
  const abortRef     = useRef(false)
  const progressTimer = useRef(null)

  // Resolve effective organism value sent to backend
  // For BioMart: if custom dataset, send the full dataset name; otherwise send the code
  const effectiveBiomartOrg = org === '__custom__' ? (customDataset.trim() || '') : org

  const isHuman = (method === 'biomart'
    ? BIOMART_ORGANISMS.find(o => o.value === org)
    : ORGANISMS.find(o => o.value === org)
  )?.human ?? false

  // ── Auto-detect ID type from the submitted gene IDs ───────────────────────
  // 'ncbi'    → purely numeric IDs (any organism, incl. bacteria)
  // 'ensembl' → ENS* prefix IDs
  // 'unknown' → anything else (let user pick organism for BioMart)
  const { idType, detectedOrg } = useMemo(() => {
    if (!geneIds?.length) return { idType: 'unknown', detectedOrg: null }
    const sample = geneIds.slice(0, Math.min(20, geneIds.length))
    if (sample.every(id => /^\d+$/.test(String(id).trim()))) {
      return { idType: 'ncbi', detectedOrg: null }
    }
    for (const id of sample) {
      for (const [re, orgVal] of ENSEMBL_PREFIXES) {
        if (re.test(id)) return { idType: 'ensembl', detectedOrg: orgVal }
      }
    }
    return { idType: 'unknown', detectedOrg: null }
  }, [geneIds])

  // Auto-set organism when switching to BioMart tab and we detected one
  useEffect(() => {
    if (method === 'biomart' && detectedOrg) setOrg(detectedOrg)
  }, [method, detectedOrg])

  function resetState() {
    setPreview(null); setError(null); setGtfFile(null); setProgress(0)
  }

  // ── g:Profiler ───────────────────────────────────────────────────────────────
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

  // ── BioMart / NCBI annotation ────────────────────────────────────────────────
  // Routes to NCBI E-summary for numeric IDs (any organism incl. bacteria)
  // or Ensembl BioMart for ENS* IDs.
  async function fetchAnnotation() {
    if (!geneIds?.length) return
    setLoading(true); setError(null); setPreview(null)

    const useNcbi = idType === 'ncbi'
    setProgress(5)
    setStage(useNcbi ? 'Connecting to NCBI E-summary…' : 'Connecting to Ensembl BioMart…')

    // Animate progress slowly up to 85% while waiting
    clearInterval(progressTimer.current)
    progressTimer.current = setInterval(() => {
      setProgress(p => {
        if (p >= 85) { clearInterval(progressTimer.current); return p }
        return p + (p < 40 ? 3 : p < 65 ? 1.5 : 0.5)
      })
    }, 800)

    const endpoint = useNcbi ? `${API}/api/annotate/ncbi` : `${API}/api/annotate/biomart`
    const payload  = useNcbi
      ? { gene_ids: geneIds }
      : { gene_ids: geneIds, organism: effectiveBiomartOrg, want_orthologs: wantOrthologs && !isHuman }

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      clearInterval(progressTimer.current)
      setProgress(90); setStage('Parsing response…')

      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error ?? `Server error ${resp.status}`)

      setProgress(95); setStage('Building annotation map…')

      // Build annMap (geneId → symbol) and annDetails (geneId → description + orthologs)
      // NOTE: chr/start/end are NOT fetched from BioMart — they are assembly-dependent.
      //       Use a GTF file if chromosomal coordinates are needed.
      const map     = {}
      const details = {}
      let hasOrtho  = false

      // safeStr: extract a clean string from whatever the backend sends.
      // • plain string "BRCA1"   → "BRCA1"
      // • single-element array   → unwrap first, then check  (plumber without auto_unbox)
      // • named-vector object    → rejected  (prevents "[object Object]")
      // • null / undefined / ""  → null
      const safeStr = v => {
        if (Array.isArray(v)) v = v.length === 1 ? v[0] : null
        if (v != null && (typeof v === 'string' || typeof v === 'number') && String(v).trim().length > 0)
          return String(v).trim()
        return null
      }

      for (const [gid, ann] of Object.entries(data.annotations ?? {})) {
        if (!ann || typeof ann !== 'object') continue
        const sym = safeStr(ann.symbol)
        if (sym) map[gid] = sym
        details[gid] = {
          description:   safeStr(ann.description),
          biotype:       safeStr(ann.biotype),
          humanOrtholog: safeStr(ann.humanOrtholog),
        }
        if (ann.humanOrtholog) hasOrtho = true
      }

      setProgress(100); setStage('')
      const dVals      = Object.values(details)
      const hasBiotype = dVals.some(d => d.biotype)
      const hasDesc    = dVals.some(d => d.description)
      setPreview({
        mapped:       Object.keys(map).length,
        total:        geneIds.length,
        map,
        detailsMap:   Object.keys(details).length > 0 ? details : null,
        hasOrthologs: hasOrtho,
        hasBiotype,
        hasCoords:    false,
        hasDesc,
        source:       useNcbi ? 'ncbi' : 'biomart',
      })
    } catch (e) {
      clearInterval(progressTimer.current)
      setError(e.message)
    } finally {
      setLoading(false)
      setStage('')
    }
  }

  // ── GTF chunk-based parser ───────────────────────────────────────────────────
  function parseGTF(file) {
    abortRef.current = false
    setLoading(true); setError(null); setPreview(null); setProgress(0)
    setGtfFile({ name: file.name, size: file.size })

    const symbolMap  = {}
    const detailsMap = {}
    let   offset     = 0
    let   leftover   = ''
    const total      = file.size
    const decoder    = new TextDecoder()

    function processLine(line) {
      if (!line || line.startsWith('#')) return
      const cols = line.split('\t')
      if (cols.length < 9) return
      const parsed = parseGTFAttrs(cols[8])
      if (!parsed || !parsed.id || !parsed.name || parsed.id === parsed.name) return
      const { id, name, description } = parsed
      if (!symbolMap[id]) symbolMap[id] = name
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
        const text  = decoder.decode(new Uint8Array(e.target.result), { stream: true })
        const lines = (leftover + text).split('\n')
        leftover    = lines.pop()
        for (const line of lines) processLine(line)
        offset += CHUNK
        setProgress(Math.min(100, Math.round(offset / total * 100)))
        if (offset < total) {
          setTimeout(readChunk, 0)
        } else {
          if (leftover) processLine(leftover)
          setProgress(100)
          const dVals = Object.values(detailsMap)
          setPreview({
            mapped:     Object.keys(symbolMap).length,
            total:      geneIds?.length ?? 0,
            map:        symbolMap,
            detailsMap: Object.keys(detailsMap).length > 0 ? detailsMap : null,
            hasCoords:  dVals.some(d => d.chr),
            hasDesc:    dVals.some(d => d.description),
            hasGO:      false,
            hasBiotype: false,
            hasOrthologs: false,
          })
          setLoading(false)
        }
      }
      fr.onerror = () => { setError('Failed to read file chunk'); setLoading(false) }
      fr.readAsArrayBuffer(slice)
    }
    readChunk()
  }

  function handleFileInput(file) {
    if (!file) return
    if (!file.name.match(/\.(gtf|gff|gff3)$/i)) {
      setError('Please upload a .gtf, .gff, or .gff3 file'); return
    }
    parseGTF(file)
  }

  const onInputChange = e  => handleFileInput(e.target.files?.[0])
  const onDrop        = useCallback(e => {
    e.preventDefault(); setDragging(false)
    handleFileInput(e.dataTransfer.files?.[0])
  }, [])
  const onDragOver    = e  => { e.preventDefault(); setDragging(true) }
  const onDragLeave   = () => setDragging(false)

  // ── Styles ───────────────────────────────────────────────────────────────────
  const pill = (active) => ({
    padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem', cursor: 'pointer',
    background: active ? 'rgba(var(--accent-rgb),0.15)' : 'rgba(255,255,255,0.04)',
    color:      active ? 'var(--accent-text)' : 'var(--text-3)',
    border:     `1px solid ${active ? 'rgba(var(--accent-rgb),0.4)' : 'var(--border)'}`,
    fontWeight: active ? 600 : 400,
  })

  const METHODS = [
    ['gprofiler', '⊹ g:Profiler'],
    ['biomart',   '⬡ BioMart'],
    ['gtf',       '≋ GTF / GFF'],
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 660 }}>
      <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-1)' }}>
        Gene Annotation
      </h3>

      {/* Applied banner */}
      {annMap && !preview && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', borderRadius: 8,
                      background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}>
          <span style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 600 }}>
            ✓ {Object.keys(annMap).length.toLocaleString()} symbols active
          </span>
          <button onClick={() => onAnnotate(null, null)} style={{
            padding: '4px 12px', borderRadius: 6, fontSize: '0.75rem',
            background: 'rgba(248,113,113,0.08)', color: '#f87171',
            border: '1px solid rgba(248,113,113,0.2)', cursor: 'pointer',
          }}>Remove</button>
        </div>
      )}

      {/* Method toggle */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {METHODS.map(([v, l]) => (
          <button key={v} onClick={() => { setMethod(v); resetState() }} style={pill(method === v)}>
            {l}
          </button>
        ))}
      </div>

      {/* ── g:Profiler ── */}
      {method === 'gprofiler' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <OrgSelector value={org} onChange={setOrg} />
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-3)' }}>
            Queries the g:Profiler REST API to convert {(geneIds?.length ?? 0).toLocaleString()} gene IDs → HGNC symbols. Returns symbols only (no coordinates).
          </p>
          <FetchButton loading={loading} onClick={fetchGprofiler} label="Fetch Symbols" />
        </div>
      )}

      {/* ── BioMart / NCBI ── */}
      {method === 'biomart' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Experimental notice */}
          <div style={{ padding: '8px 12px', borderRadius: 7, fontSize: '0.74rem',
                        background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)',
                        color: '#d97706', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.9rem' }}>⚠</span>
            <span><strong>Experimental</strong> — BioMart queries depend on Ensembl API availability and may be slow or incomplete for some organisms.</span>
          </div>

          {/* Auto-detected ID type banner */}
          {idType === 'ncbi' ? (
            <div style={{ padding: '9px 14px', borderRadius: 8, fontSize: '0.76rem',
                          background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.2)',
                          color: '#059669' }}>
              🔬 Detected <strong>NCBI gene IDs</strong> — will query NCBI E-summary.
              Works for any organism including bacteria, archaea, and fungi.
            </div>
          ) : idType === 'ensembl' ? (
            <div style={{ padding: '9px 14px', borderRadius: 8, fontSize: '0.76rem',
                          background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)',
                          color: 'var(--accent-text)' }}>
              🧬 Detected <strong>Ensembl gene IDs</strong> — will query Ensembl BioMart.
            </div>
          ) : (
            <div style={{ padding: '9px 14px', borderRadius: 8, fontSize: '0.76rem',
                          background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
                          color: 'var(--text-3)' }}>
              ℹ️ ID format unrecognised — select organism below to query BioMart.
            </div>
          )}

          {/* Organism selector + ortholog toggle — only relevant for Ensembl/BioMart */}
          {idType !== 'ncbi' && (<>
            <BiomartOrgSelector value={org} customDataset={customDataset}
              onChange={v => { setOrg(v); setWantOrthologs(false) }}
              onCustomChange={setCustomDataset} />
            {!isHuman && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                              padding: '10px 14px', borderRadius: 8,
                              background: wantOrthologs ? 'rgba(var(--accent-rgb),0.08)' : 'rgba(255,255,255,0.03)',
                              border: `1px solid ${wantOrthologs ? 'rgba(var(--accent-rgb),0.3)' : 'var(--border)'}` }}>
                <input type="checkbox" checked={wantOrthologs}
                  onChange={e => setWantOrthologs(e.target.checked)}
                  style={{ accentColor: 'var(--accent)', width: 15, height: 15, cursor: 'pointer' }} />
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-1)' }}>
                    Fetch 1:1 human orthologs
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 2 }}>
                    Adds a Human Ortholog column for genes with a strict one-to-one mapping to <em>H. sapiens</em>
                  </div>
                </div>
              </label>
            )}
          </>)}

          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-3)' }}>
            {idType === 'ncbi'
              ? `Queries NCBI E-summary for ${(geneIds?.length ?? 0).toLocaleString()} gene IDs. Returns symbol, full gene name, and gene type. No organism selection needed.`
              : `Queries Ensembl BioMart for ${(geneIds?.length ?? 0).toLocaleString()} gene IDs. Returns symbol, description, and biotype.${!isHuman ? ' Ortholog lookup adds several seconds.' : ''} Chromosomal coordinates require a GTF file.`
            }
          </p>

          {/* Progress bar (shown while loading) */}
          {loading && method === 'biomart' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-3)' }}>{stage || 'Querying…'}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{Math.round(progress)}%</span>
              </div>
              <div style={{ width: '100%', height: 6, borderRadius: 99,
                            background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 99,
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg,var(--accent),var(--accent2))',
                  transition: 'width 0.6s ease',
                }} />
              </div>
            </div>
          )}

          <FetchButton loading={loading} onClick={fetchAnnotation}
            label={idType === 'ncbi' ? 'Fetch from NCBI' : 'Fetch from BioMart'} />
        </div>
      )}

      {/* ── GTF upload ── */}
      {method === 'gtf' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-3)' }}>
            Upload a GTF / GFF file. Requires{' '}
            <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: 4 }}>gene_id</code> and{' '}
            <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: 4 }}>gene_name</code>{' '}
            attributes. Large files are processed in chunks.
          </p>

          {/* Drop zone */}
          <div
            onClick={() => !loading && fileRef.current?.click()}
            onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
            style={{
              border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 12, padding: '28px 20px', textAlign: 'center',
              cursor: loading ? 'wait' : 'pointer',
              background: dragging ? 'rgba(var(--accent-rgb),0.06)' : 'rgba(255,255,255,0.02)',
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            {gtfFile && !loading ? (
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
                <div style={{ width: '100%', maxWidth: 320, height: 6, borderRadius: 99,
                              background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99, width: `${progress}%`,
                    background: 'linear-gradient(90deg,var(--accent),var(--accent2))',
                    transition: 'width 0.2s ease',
                  }} />
                </div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>{progress}%</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '1.8rem', opacity: 0.5 }}>📄</span>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-2)', fontWeight: 500 }}>
                  Drop GTF / GFF file here
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>or click to browse</span>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".gtf,.gff,.gff3" onChange={onInputChange} style={{ display: 'none' }} />
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
          {/* Stats row */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ padding: '8px 14px', borderRadius: 8, flexShrink: 0,
                          background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-1)', fontWeight: 600 }}>
                {preview.mapped.toLocaleString()} / {preview.total.toLocaleString()} genes mapped
              </span>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-3)', marginLeft: 8 }}>
                ({Math.round(preview.mapped / Math.max(preview.total, 1) * 100)}%)
              </span>
              {preview.source && (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginLeft: 10, opacity: 0.7 }}>
                  via {preview.source === 'ncbi' ? 'NCBI E-summary' : 'Ensembl BioMart'}
                </span>
              )}
            </div>
            {preview.hasCoords && (
              <div style={{ padding: '8px 14px', borderRadius: 8, fontSize: '0.74rem',
                            color: '#059669', background: 'rgba(52,211,153,0.06)',
                            border: '1px solid rgba(52,211,153,0.15)', flexShrink: 0 }}>
                ✓ Chromosomal coordinates (chr · start · end)
              </div>
            )}
            {preview.hasDesc && (
              <div style={{ padding: '8px 14px', borderRadius: 8, fontSize: '0.74rem',
                            color: '#059669', background: 'rgba(52,211,153,0.06)',
                            border: '1px solid rgba(52,211,153,0.15)', flexShrink: 0 }}>
                ✓ Gene descriptions available
              </div>
            )}
            {preview.hasBiotype && (
              <div style={{ padding: '8px 14px', borderRadius: 8, fontSize: '0.74rem',
                            color: '#0369a1', background: 'rgba(3,105,161,0.06)',
                            border: '1px solid rgba(3,105,161,0.2)', flexShrink: 0 }}>
                ✓ Gene biotype available
              </div>
            )}
            {preview.hasOrthologs && (
              <div style={{ padding: '8px 14px', borderRadius: 8, fontSize: '0.74rem',
                            color: '#7c3aed', background: 'rgba(124,58,237,0.06)',
                            border: '1px solid rgba(124,58,237,0.2)', flexShrink: 0 }}>
                ✓ 1:1 human orthologs found
              </div>
            )}
          </div>

          {/* Preview table */}
          <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)', position: 'sticky', top: 0 }}>
                  <th style={thS}>Gene ID</th>
                  <th style={thS}>Symbol</th>
                  {preview.hasCoords   && <th style={thS}>Location</th>}
                  {preview.hasDesc     && <th style={thS}>Description</th>}
                  {preview.hasBiotype  && <th style={thS}>Biotype</th>}
                  {preview.hasOrthologs && <th style={{ ...thS, color: '#7c3aed' }}>Human Ortholog</th>}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Show up to 50 genes — union of mapped symbols + detail entries
                  const ids = [...new Set([
                    ...Object.keys(preview.map),
                    ...Object.keys(preview.detailsMap ?? {}),
                  ])].slice(0, 50)
                  return ids.map(id => {
                    const sym = preview.map[id] ?? null
                    const det = preview.detailsMap?.[id]
                    const loc = det?.chr
                      ? `${det.chr}:${det.start?.toLocaleString() ?? '?'}–${det.end?.toLocaleString() ?? '?'}`
                      : '—'
                    return (
                      <tr key={id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '4px 10px', color: 'var(--text-3)', fontFamily: 'monospace', fontSize: '0.72rem' }}>{id}</td>
                        <td style={{ padding: '4px 10px', color: sym ? 'var(--text-1)' : 'var(--text-3)', fontWeight: sym ? 500 : 400 }}>
                          {sym ?? <span style={{ opacity: 0.4 }}>N/A</span>}
                        </td>
                        {preview.hasCoords && <td style={{ padding: '4px 10px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{loc}</td>}
                        {preview.hasDesc && (
                          <td style={{ padding: '4px 10px', color: 'var(--text-3)', maxWidth: 180,
                                       overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {det?.description ?? '—'}
                          </td>
                        )}
                        {preview.hasBiotype && (
                          <td style={{ padding: '4px 10px', color: 'var(--text-3)', fontSize: '0.7rem' }}>
                            {det?.biotype ?? '—'}
                          </td>
                        )}
                        {preview.hasOrthologs && (
                          <td style={{ padding: '4px 10px', color: '#7c3aed', fontWeight: 500 }}>
                            {det?.humanOrtholog ?? '—'}
                          </td>
                        )}
                      </tr>
                    )
                  })
                })()}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { onAnnotate(preview.map, preview.detailsMap ?? null); setPreview(null) }}
              style={{
                padding: '7px 20px', borderRadius: 8, fontSize: '0.82rem',
                background: 'linear-gradient(135deg,var(--accent),var(--accent2))', color: 'white',
                border: 'none', cursor: 'pointer', fontWeight: 600,
              }}
            >
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

// ── Small shared sub-components ───────────────────────────────────────────────

// g:Profiler organism selector
function OrgSelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <label style={{ fontSize: '0.78rem', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Organism</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1, fontSize: '0.8rem' }}>
        {ORGANISMS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// BioMart-specific organism selector — broader species list + custom dataset input
function BiomartOrgSelector({ value, customDataset, onChange, onCustomChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <label style={{ fontSize: '0.78rem', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Organism</label>
        <select value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1, fontSize: '0.8rem' }}>
          {BIOMART_ORGANISMS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {value === '__custom__' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            type="text"
            placeholder="e.g. sscrofa_gene_ensembl"
            value={customDataset}
            onChange={e => onCustomChange(e.target.value)}
            style={{
              fontSize: '0.8rem', padding: '6px 10px', borderRadius: 6,
              background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
              color: 'var(--text-1)', outline: 'none', width: '100%',
            }}
          />
          <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-3)' }}>
            Enter the full Ensembl BioMart dataset name. Vertebrates use{' '}
            <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: 3 }}>
              {'<species>_gene_ensembl'}
            </code>.
            Plants / fungi require{' '}
            <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: 3 }}>
              plants.ensembl.org
            </code>{' '}
            or{' '}
            <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: 3 }}>
              fungi.ensembl.org
            </code>{' '}
            marts — for those, use the GTF method instead.
          </p>
        </div>
      )}
      {(value === 'scerevisiae' || value === 'athaliana') && (
        <p style={{ margin: 0, fontSize: '0.72rem', color: '#d97706' }}>
          ¹ Yeast and Arabidopsis use separate Ensembl marts and may return limited results.
          The GTF method is recommended for these organisms.
        </p>
      )}
    </div>
  )
}

function FetchButton({ loading, onClick, label }) {
  return (
    <button onClick={onClick} disabled={loading} style={{
      alignSelf: 'flex-start', padding: '7px 18px', borderRadius: 8,
      background: 'rgba(var(--accent-rgb),0.15)', color: 'var(--accent-text)',
      border: '1px solid rgba(var(--accent-rgb),0.3)', fontSize: '0.8rem',
      cursor: loading ? 'wait' : 'pointer', fontWeight: 600,
    }}>
      {loading ? '⟳ Fetching…' : label}
    </button>
  )
}

const thS = { padding: '6px 10px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 500 }
