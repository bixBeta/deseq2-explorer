import { useState, useEffect } from 'react'

// ── Section data ──────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'overview',      icon: '◈', label: 'Overview'          },
  { id: 'upload',        icon: '↑', label: 'Upload'            },
  { id: 'metadata',      icon: '⊞', label: 'Metadata Editor'   },
  { id: 'design',        icon: '⚙', label: 'Design & Analysis' },
  { id: 'results',       icon: '◉', label: 'Results'           },
  { id: 'pca',           icon: '✦', label: 'PCA Explorer'      },
  { id: 'compare',       icon: '▦', label: 'Compare Panel'     },
  { id: 'annotation',    icon: '⊕', label: 'Annotation'        },
  { id: 'tips',          icon: '★', label: 'Tips & Shortcuts'  },
]

// ── Reusable sub-components ───────────────────────────────────────────────────
function H2({ children }) {
  return (
    <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent)',
                 marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: 8 }}>
      {children}
    </h2>
  )
}

function H3({ children }) {
  return (
    <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-1)',
                 margin: '1rem 0 0.35rem' }}>
      {children}
    </h3>
  )
}

function P({ children }) {
  return (
    <p style={{ fontSize: '0.82rem', color: 'var(--text-2)', lineHeight: 1.65,
                margin: '0 0 0.6rem' }}>
      {children}
    </p>
  )
}

function Ul({ items }) {
  return (
    <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.25rem' }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: '0.82rem', color: 'var(--text-2)',
                             lineHeight: 1.65, marginBottom: '0.25rem' }}>
          {item}
        </li>
      ))}
    </ul>
  )
}

function Badge({ children, color = 'var(--accent)' }) {
  return (
    <code style={{ fontSize: '0.72rem', padding: '1px 6px', borderRadius: 4,
                   background: 'rgba(var(--accent-rgb),0.1)', color,
                   border: '1px solid rgba(var(--accent-rgb),0.25)', fontFamily: 'monospace',
                   whiteSpace: 'nowrap' }}>
      {children}
    </code>
  )
}

function Card({ children }) {
  return (
    <div style={{ background: 'rgba(var(--accent-rgb),0.04)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '12px 16px', marginBottom: '1rem' }}>
      {children}
    </div>
  )
}

function StepRow({ n, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: '0.6rem', alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                     background: 'rgba(var(--accent-rgb),0.15)', border: '1px solid rgba(var(--accent-rgb),0.35)',
                     display: 'flex', alignItems: 'center', justifyContent: 'center',
                     fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent)' }}>
        {n}
      </span>
      <span style={{ fontSize: '0.82rem', color: 'var(--text-2)', lineHeight: 1.65, paddingTop: 1 }}>
        {children}
      </span>
    </div>
  )
}

// ── Section content ───────────────────────────────────────────────────────────
function SectionOverview() {
  return (
    <>
      <H2>◈ Overview</H2>
      <P>
        DESeq2 ExploreR is a full-stack web application for differential expression analysis
        using DESeq2. It guides you from raw count data to interactive visualizations
        without writing a single line of R.
      </P>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem' }}>
          {[
            ['Upload', 'Count matrix + sample sheet'],
            ['Metadata', 'Review samples, add covariates'],
            ['Design', 'Define contrasts, run DESeq2'],
            ['Results', 'PCA, DE tables, volcano plots'],
            ['Compare', 'Multi-contrast heatmaps & tables'],
            ['Annotation', 'Add gene symbols & descriptions'],
          ].map(([label, desc]) => (
            <div key={label}>
              <span style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--accent)' }}>{label} </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>— {desc}</span>
            </div>
          ))}
        </div>
      </Card>
      <H3>Workflow</H3>
      <StepRow n={1}>Upload your count matrix and optional metadata CSV.</StepRow>
      <StepRow n={2}>Review and configure sample metadata in the Metadata Editor.</StepRow>
      <StepRow n={3}>Build contrasts in the Design Panel and run DESeq2.</StepRow>
      <StepRow n={4}>Explore results — PCA, DE table, volcano plot, and more.</StepRow>
      <StepRow n={5}>Optionally annotate genes using a GTF file or TSV symbol map.</StepRow>
      <StepRow n={6}>Use the Compare Panel to visualise results across all contrasts.</StepRow>
      <H3>Sessions</H3>
      <P>
        Your work is saved automatically in a session identified by a short ID. You can
        resume any session from the session picker. Share your session ID with collaborators
        so they can load the same data and results.
      </P>
    </>
  )
}

function SectionUpload() {
  return (
    <>
      <H2>↑ Upload</H2>
      <P>
        The upload step accepts a <Badge>counts.csv</Badge> file (raw integer counts, genes × samples)
        and an optional <Badge>metadata.csv</Badge> file (samples × variables).
      </P>
      <H3>Count matrix format</H3>
      <Ul items={[
        'First column: gene IDs (e.g. Ensembl IDs or gene symbols).',
        'Remaining columns: one per sample — column name = sample name.',
        'Values must be raw (un-normalised) integer counts.',
        'No row-sum filtering required — DESeq2 handles low-count genes internally.',
      ]} />
      <H3>Metadata CSV (optional)</H3>
      <Ul items={[
        'First column: sample names matching the count matrix column names exactly.',
        'Additional columns: any categorical or numerical covariates (e.g. condition, batch, sex).',
        'If not provided, you can add metadata manually in the Metadata Editor.',
      ]} />
      <Card>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
          Example count matrix header
        </span>
        <code style={{ fontSize: '0.72rem', color: 'var(--accent-text)', fontFamily: 'monospace', display: 'block', lineHeight: 1.7 }}>
          gene_id, Sample_A1, Sample_A2, Sample_B1, Sample_B2<br />
          ENSG00000001, 120, 134, 890, 920<br />
          ENSG00000002, 0, 2, 5, 3
        </code>
      </Card>
      <H3>File size</H3>
      <P>
        Files up to ~50 MB are handled comfortably in-browser. Larger matrices (tens of
        thousands of genes × hundreds of samples) are supported — parsing may take a few
        seconds.
      </P>
    </>
  )
}

function SectionMetadata() {
  return (
    <>
      <H2>⊞ Metadata Editor</H2>
      <P>
        After upload, the Metadata Editor displays a table of all samples with their
        associated metadata columns. Here you review, edit, and prepare samples before
        running DESeq2.
      </P>
      <H3>Selecting samples</H3>
      <P>
        Use the checkboxes in the first column to include or exclude individual samples
        from the analysis. Excluded samples are greyed out and will not be passed to DESeq2.
        This is useful for removing outliers without editing your original files.
      </P>
      <H3>Editing values</H3>
      <P>
        Click any cell to edit its value inline. Changes are reflected immediately in
        the design formula builder on the next step.
      </P>
      <H3>Adding columns</H3>
      <P>
        Use the <Badge>+ Add column</Badge> button to introduce new covariates (e.g. a
        batch variable) that were not present in the original metadata file.
      </P>
      <H3>Proceeding</H3>
      <P>
        Click <Badge>Confirm &amp; Continue</Badge> once you are satisfied with the metadata.
        You can always return to this step from the Results view by clicking <Badge>← Edit Samples</Badge>.
      </P>
    </>
  )
}

function SectionDesign() {
  return (
    <>
      <H2>⚙ Design &amp; Analysis</H2>
      <P>
        The Design Panel is where you specify the statistical model and define the
        comparisons (contrasts) you want DESeq2 to test.
      </P>
      <H3>Design formula</H3>
      <P>
        Select the metadata column to include in the model formula (e.g. <Badge>~ condition</Badge>).
        Columns with at least two distinct levels are shown.
      </P>
      <H3>Contrasts</H3>
      <P>
        A contrast specifies the two groups to compare. For each contrast choose:
      </P>
      <Ul items={[
        'Factor — the metadata column used for comparison.',
        'Numerator — the condition of interest (e.g. Treatment).',
        'Denominator — the reference/baseline condition (e.g. Control).',
      ]} />
      <P>
        You can add multiple contrasts. All will be tested in a single DESeq2 run sharing
        the same size factors and dispersion estimates.
      </P>
      <H3>Running the analysis</H3>
      <P>
        Click <Badge>Run DESeq2</Badge>. The server fits the negative binomial model,
        estimates dispersions, and performs Wald tests for each contrast. Results are
        streamed back and stored in your session.
      </P>
      <H3>LFC shrinkage</H3>
      <P>
        Log₂ fold-changes are shrunk using the <Badge>apeglm</Badge> method by default,
        reducing noise for low-count genes and improving rankings for downstream analyses.
      </P>
    </>
  )
}

function SectionResults() {
  return (
    <>
      <H2>◉ Results</H2>
      <P>
        The Results view is the main hub after a successful DESeq2 run. It contains tabs
        for each analysis output.
      </P>
      <H3>Contrast selector</H3>
      <P>
        If you defined multiple contrasts, use the dropdown at the top to switch between
        them. All result tabs update to reflect the selected contrast.
      </P>
      <H3>DE Results table</H3>
      <P>
        The table lists all genes with their DESeq2 statistics: base mean, log₂FC, lfcSE,
        p-value, and adjusted p-value (Benjamini–Hochberg). Columns are sortable.
        Use the <Badge>FDR ≤</Badge> slider and <Badge>|log₂FC| ≥</Badge> input to filter
        rows. Click <Badge>↓ CSV</Badge> to export the filtered table.
      </P>
      <H3>Volcano plot</H3>
      <P>
        Interactive Plotly scatter showing –log₁₀(padj) vs log₂FC. Significant genes
        (padj &lt; threshold) are highlighted. Hover over a point to see gene ID and statistics.
        Use the Plotly toolbar to zoom, pan, or download as PNG.
      </P>
      <H3>MA plot</H3>
      <P>
        Log₂FC vs mean expression (log₁₀ scale). Useful for identifying systematic
        fold-change biases related to expression level.
      </P>
      <H3>Counts plot</H3>
      <P>
        Click any gene in the DE table to see its normalised count distribution across
        samples, grouped by condition.
      </P>
    </>
  )
}

function SectionPCA() {
  return (
    <>
      <H2>✦ PCA Explorer</H2>
      <P>
        The PCA tab runs principal component analysis on the variance-stabilising
        transformed (VST) counts and displays an interactive scatter plot.
      </P>
      <H3>Scatter plot controls</H3>
      <Ul items={[
        'X / Y axis — choose which principal components to plot.',
        'Color by — color points by any metadata column.',
        'Point size / opacity — adjust visual density.',
        '2D / 3D toggle — switch to a 3D scatter when three PCs are selected.',
      ]} />
      <H3>Scree plot</H3>
      <P>
        Shows the percentage of variance explained by each PC. Useful for deciding how
        many components are worth exploring.
      </P>
      <H3>Interpreting PCA</H3>
      <P>
        Samples that cluster by condition show that the experimental effect is the dominant
        source of variation. Unexpected clustering by batch or other covariates suggests
        those variables should be included in the design formula.
      </P>
    </>
  )
}

function SectionCompare() {
  return (
    <>
      <H2>▦ Compare Panel</H2>
      <P>
        The Compare Panel aggregates results across all contrasts into four multi-contrast
        visualisations.
      </P>
      <H3>⊗ UpSet Plot</H3>
      <P>
        Visualises the overlap of significant DEGs between contrasts as an UpSet diagram —
        the modern alternative to Venn diagrams for more than two sets. Each bar represents
        an exclusive intersection.
      </P>
      <H3>▦ Heatmap</H3>
      <P>
        An interactive heatmap of the top N DEGs across samples, coloured by VST-normalised
        expression (z-scored per gene). Samples are grouped by metadata column. Hover over
        cells to see exact values. Generated via heatmaply on the server.
      </P>
      <H3>♩ Gene Explorer</H3>
      <P>
        Search for a gene ID or symbol and view its normalised count distribution as a
        violin/box plot across all contrasts simultaneously. Useful for validating
        individual gene results.
      </P>
      <H3>▤ Table Explorer</H3>
      <P>
        A pivot table with genes as rows and DESeq2 statistics (baseMean, log₂FC, p-value,
        padj) grouped by contrast as columns. Features:
      </P>
      <Ul items={[
        'Frozen gene columns (Gene ID, Symbol, Chr locus, Description) — always visible when scrolling horizontally.',
        'Click any column header to sort ascending / descending.',
        'Filter by FDR and gene name / symbol using the controls above the table.',
        'Download the full table as CSV with the ↓ CSV button.',
      ]} />
    </>
  )
}

function SectionAnnotation() {
  return (
    <>
      <H2>⊕ Annotation</H2>
      <P>
        Annotation enriches your results with human-readable gene symbols and descriptions.
        It is optional but recommended — once loaded, symbols appear throughout all result
        views.
      </P>
      <H3>GTF file</H3>
      <P>
        Upload a genome annotation file in GTF format (e.g. from Ensembl). The app extracts:
      </P>
      <Ul items={[
        'gene_name → gene symbol column in all tables.',
        'gene_biotype → description / biotype column.',
        'seqname, start, end → Chr locus column in the Table Explorer (e.g. 1:12,746,200–12,763,699).',
      ]} />
      <H3>TSV symbol map</H3>
      <P>
        A two-column TSV with gene IDs in column 1 and gene symbols in column 2. Faster to
        load than a full GTF but provides symbols only (no genomic coordinates or descriptions).
      </P>
      <H3>Preview &amp; apply</H3>
      <P>
        After selecting a file a preview shows the first mapped entries. Click{' '}
        <Badge>Apply Annotation</Badge> to propagate the mapping across all views.
        Annotations are stored in the session and persist on reload.
      </P>
    </>
  )
}

function SectionTips() {
  return (
    <>
      <H2>★ Tips &amp; Shortcuts</H2>
      <H3>Sessions</H3>
      <Ul items={[
        'Your session ID is shown in the header — click it to copy to clipboard.',
        'Use "New Session" to start fresh without logging out.',
        'Sessions persist on the server; reload the page and re-enter your credentials to resume.',
      ]} />
      <H3>Performance</H3>
      <Ul items={[
        'The Table Explorer renders up to 2,000 rows by default — use filters to narrow results before scrolling.',
        'Large GTF files (> 100 MB) may take a moment to parse; compressed .gz files are not yet supported.',
        'DESeq2 run time scales with sample count and the number of contrasts — typical runs finish in 10–60 s.',
      ]} />
      <H3>Data export</H3>
      <Ul items={[
        'Every result table has a ↓ CSV button that exports the currently filtered / sorted view.',
        'Plotly charts can be downloaded as PNG using the camera icon in the chart toolbar.',
        'The Table Explorer CSV includes all contrasts in a wide format.',
      ]} />
      <H3>Themes</H3>
      <P>
        Use the theme toggle (☀ / ☾) in the top-right corner to switch between light and
        dark mode. The accent colour palette can be changed in the settings panel if available.
      </P>
      <H3>Common issues</H3>
      <Ul items={[
        'Sample names in the count matrix must exactly match those in the metadata file (case-sensitive).',
        'DESeq2 requires at least 2 samples per group in a contrast.',
        'Genes with zero counts across all samples are automatically filtered out before fitting.',
        'If the volcano plot appears empty, check that your padj threshold is not too strict.',
      ]} />
    </>
  )
}

const SECTION_CONTENT = {
  overview:   SectionOverview,
  upload:     SectionUpload,
  metadata:   SectionMetadata,
  design:     SectionDesign,
  results:    SectionResults,
  pca:        SectionPCA,
  compare:    SectionCompare,
  annotation: SectionAnnotation,
  tips:       SectionTips,
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function HelpPanel({ onClose }) {
  const [active, setActive] = useState('overview')

  // Close on Escape
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const Content = SECTION_CONTENT[active]

  return (
    /* Backdrop */
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 200,
               background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
               display: 'flex', alignItems: 'center', justifyContent: 'center',
               padding: '24px' }}>

      {/* Modal shell */}
      <div style={{ width: '100%', maxWidth: 820, height: '78vh', display: 'flex',
                    borderRadius: 14, overflow: 'hidden',
                    border: '1px solid var(--border)',
                    boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
                    background: 'var(--bg-panel)' }}>

        {/* ── Sidebar ── */}
        <aside style={{ width: 190, flexShrink: 0,
                        background: 'rgba(var(--accent-rgb),0.03)',
                        borderRight: '1px solid var(--border)',
                        display: 'flex', flexDirection: 'column',
                        padding: '16px 0' }}>

          <div style={{ padding: '0 16px 14px', fontSize: '0.65rem', fontWeight: 700,
                        letterSpacing: '0.1em', textTransform: 'uppercase',
                        color: 'var(--text-3)' }}>
            Documentation
          </div>

          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActive(s.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8,
                             padding: '7px 16px', border: 'none', cursor: 'pointer',
                             textAlign: 'left', fontSize: '0.8rem', fontWeight: active === s.id ? 600 : 400,
                             color:      active === s.id ? 'var(--accent)' : 'var(--text-2)',
                             background: active === s.id ? 'rgba(var(--accent-rgb),0.1)' : 'transparent',
                             borderLeft: active === s.id ? '2px solid var(--accent)' : '2px solid transparent',
                             transition: 'all 0.12s' }}>
              <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </aside>

        {/* ── Content area ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

          {/* Header bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '14px 20px', borderBottom: '1px solid var(--border)',
                        flexShrink: 0 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
              DESeq2 ExploreR — Help &amp; Documentation
            </span>
            <button onClick={onClose}
                    style={{ background: 'transparent', border: '1px solid var(--border)',
                             borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
                             fontSize: '0.75rem', color: 'var(--text-3)',
                             transition: 'all 0.12s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'var(--text-1)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)' }}>
              ✕ Close
            </button>
          </div>

          {/* Scrollable content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
            <Content />
          </div>
        </div>
      </div>
    </div>
  )
}
