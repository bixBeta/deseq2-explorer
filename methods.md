# Methods

## Heatmap

Heatmaps are generated using the [`heatmaply`](https://cran.r-project.org/package=heatmaply) R package, which produces interactive Plotly-based heatmaps.

### Gene selection

Differentially expressed genes (DEGs) are filtered from DESeq2 results using user-defined thresholds:

- **FDR** — adjusted p-value (Benjamini–Hochberg) < threshold (default: 0.05)
- **|log₂FC|** — absolute fold change ≥ threshold (default: 0, i.e. no FC filter)

When multiple contrasts are active, genes can be drawn from:

| Gene set | Behaviour |
|---|---|
| Union | All DEGs across any active contrast |
| Intersection | Only DEGs shared across all active contrasts |
| Single contrast | DEGs from one selected contrast |

If the filtered gene list exceeds `topN` (default: 50), genes are ranked by mean absolute log₂FC (log₂FC mode) or by row variance (normalized counts mode) and the top N are retained.

### Display modes

**Normalized counts (VST Z-score)**
VST-normalized counts are extracted from the DESeq2 `varianceStabilizingTransformation()` output (run with `blind = FALSE`). Each gene (row) is Z-score standardized across samples. Genes with zero variance are set to 0. This is the default display mode.

**log₂FC across contrasts**
A matrix of log₂ fold changes is built with genes as rows and contrasts as columns. Missing values (gene not tested in a contrast) are set to 0. No additional scaling is applied.

### Clustering

Hierarchical clustering is performed independently on rows and columns using base R `hclust()` (via `heatmaply`'s internal pipeline). The distance matrix is computed by a user-selected method:

| Method | Formula |
|---|---|
| Pearson (default) | `1 − cor(x, method = "pearson")` |
| Spearman | `1 − cor(x, method = "spearman")` |
| Kendall | `1 − cor(x, method = "kendall")` |
| Euclidean | `dist(x, method = "euclidean")` |
| Manhattan | `dist(x, method = "manhattan")` |

Correlation distances are computed using `cor()` from base R with `use = "pairwise.complete.obs"`. Euclidean and Manhattan distances use `dist()` from base R. Clustering can be toggled independently for rows and columns; disabling clustering removes the dendrogram entirely.

### Colour scale

The heatmap colour palette is user-configurable. A three-point colour gradient (low → mid → high) is interpolated to 256 colours using `grDevices::colorRampPalette()`. The default palette is blue → white → red.

### Column annotation

An optional annotation bar above the sample columns is drawn using sample metadata. The user selects a metadata column (e.g. treatment group); group colours are assigned from a fixed qualitative palette via `grDevices::colorRampPalette()`.
