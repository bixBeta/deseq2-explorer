# Methods

## Table of Contents

- [Input Data](#input-data)
- [Pre-filtering](#pre-filtering)
- [Differential Expression Analysis](#differential-expression-analysis)
- [MA Plot](#ma-plot)
- [Principal Component Analysis](#principal-component-analysis)
- [Count Distributions](#count-distributions)
- [Gene Violin Plot](#gene-violin-plot)
- [UpSet Plot](#upset-plot)
- [Heatmap](#heatmap)

---

## Input Data

Data are supplied as an R `.rds` file containing a named list with two required elements:

- **`counts`** — a numeric matrix of raw integer counts (genes × samples; rownames = gene IDs, colnames = sample IDs)
- **`metadata`** — a data frame with one row per sample (rownames = sample IDs) and one or more columns describing experimental covariates

Counts are rounded to the nearest integer before analysis. Metadata columns are coerced to character to prevent factor-level integer encoding.

---

## Pre-filtering

Before DESeq2 model fitting, low-expression genes are removed. A gene is retained if it has a count ≥ `minCount` (default: 1) in at least `minSamples` (default: 2) samples. This reduces the multiple-testing burden without discarding informative genes.

---

## Differential Expression Analysis

Differential expression is performed using [DESeq2](https://bioconductor.org/packages/DESeq2/) (Love *et al.*, 2014). A single design formula `~ column` is fitted, where `column` is the user-selected metadata variable. The reference level is set via `relevel()` to the user-specified reference group before model fitting.

### Model fitting

`DESeq()` is called with a user-selectable dispersion estimation method (`fitType`; default: `"parametric"`). The fitted model is reused across all contrasts in a single session.

### Contrast extraction

Results for each pairwise contrast (treatment vs. reference) are extracted with `results()` using the following parameters:

| Parameter | Default | Description |
|---|---|---|
| `alpha` | 0.05 | FDR threshold for independent filtering |
| `lfcThreshold` | 0 | Minimum absolute log₂FC for hypothesis testing |
| `independentFiltering` | `TRUE` | Automatic low-count filtering to maximise discoveries |
| `cooksCutoff` | `TRUE` | Flag outlier samples via Cook's distance |

Multiple contrasts are dispatched in parallel using the [`mirai`](https://cran.r-project.org/package=mirai) package when available, with sequential fallback.

### Multiple testing correction

p-values are adjusted using the Benjamini–Hochberg (BH) procedure, as implemented in `results()`. Genes are considered significantly differentially expressed at padj < `alpha`.

### Normalisation for display

Size-factor-normalised counts (`counts(dds, normalized = TRUE)`) are computed and stored alongside results. Per-group mean normalised counts (treatment and reference) are attached to each result table for display.

---

## MA Plot

The MA plot displays log₂ fold change (M) against mean normalised expression (A, i.e. `baseMean`) for all tested genes. Points are coloured by significance status (padj < threshold). A horizontal reference line is drawn at log₂FC = 0. The plot is rendered client-side using [Plotly.js](https://plotly.com/javascript/).

---

## Principal Component Analysis

PCA is computed on `varianceStabilizingTransformation(dds, blind = FALSE)` counts. The top 500 most variable genes (by row variance across samples, computed with `rowVars()` from `matrixStats`) are selected, and `prcomp()` is applied to the transposed matrix (`scale. = FALSE`). Up to 10 principal components are returned. Variance explained per PC is taken from `summary(pca_obj)$importance["Proportion of Variance", ]`.

The PCA scatter plot and scree plot are rendered client-side using Plotly.js. Points can be coloured by any metadata column.

---

## Count Distributions

To display per-sample count distributions, a random subsample of up to 3,000 genes is drawn from the full count matrix. Two distributions are computed per sample:

- **Raw counts** — log₂(count + 1) transformation of raw integer counts
- **VST** — values from `varianceStabilizingTransformation(dds, blind = FALSE)`

Distributions are visualised as violin plots with embedded box plots using Plotly.js.

---

## Gene Violin Plot

Single-gene expression is visualised as a violin + jitter + box plot using [`ggpubr`](https://cran.r-project.org/package=ggpubr) (`ggviolin()`). Expression is shown as log₂(raw count + 1). A Wilcoxon rank-sum test (`wilcox.test`) is applied between the two groups using `stat_compare_means()`, with significance annotations (ns / \* / \*\* / \*\*\* / \*\*\*\*) and exact p-value label. DESeq2 statistics (baseMean, log₂FC, lfcSE, p-value, padj) for the gene in the selected contrast are displayed alongside the plot.

---

## UpSet Plot

DEG overlap across contrasts is visualised as an UpSet diagram using the [`UpSetR`](https://cran.r-project.org/package=UpSetR) package. Each set contains the significant DEGs for one contrast (padj < FDR threshold, |log₂FC| ≥ user threshold). Sets are converted to a binary membership matrix with `UpSetR::fromList()` and rendered with `UpSetR::upset()`, ordered by intersection frequency. Only contrasts with at least one DEG are included; a minimum of two non-empty contrasts is required.

---

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
