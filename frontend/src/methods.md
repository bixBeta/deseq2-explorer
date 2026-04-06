# Methods

## Table of Contents

- [Input Data](#input-data)
- [Pre-filtering](#pre-filtering)
- [Differential Expression Analysis](#differential-expression-analysis)
- [MA Plot](#ma-plot)
- [Principal Component Analysis](#principal-component-analysis)
- [Count Distributions](#count-distributions)
- [Gene Violin Plot](#gene-violin-plot)
- [Multi-group Gene Plot](#multi-group-gene-plot)
- [UpSet Plot](#upset-plot)
- [Heatmap](#heatmap)
- [Gene Annotation](#gene-annotation)
- [Gene Set Enrichment Analysis (GSEA)](#gene-set-enrichment-analysis-gsea)
- [GSEA Compare — Pathway Overlap Analysis](#gsea-compare--pathway-overlap-analysis)

---

## Input Data

Data are supplied as an R `.rds` file containing a named list with two required elements:

- **`counts`** — a numeric matrix of raw integer counts (genes × samples; rownames = gene IDs, colnames = sample IDs)
- **`metadata`** — a data frame with one row per sample (rownames = sample IDs) and one or more columns describing experimental covariates

Counts are rounded to the nearest integer before analysis. Metadata columns are coerced to character to prevent factor-level integer encoding.

Alternatively, a plain `prcomp` object or a named list with `$scores`/`$variance`/`$loadings` elements can be supplied for PCA-only sessions.

---

## Pre-filtering

Before DESeq2 model fitting, low-expression genes are removed. A gene is retained if it has a count ≥ `minCount` (default: 1) in at least `minSamples` (default: 2) samples. This reduces the multiple-testing burden without discarding informative genes.

```r
dds <- dds[rowSums(counts(dds) >= min_count) >= min_samp, ]
```

---

## Differential Expression Analysis

Differential expression is performed using [DESeq2](https://bioconductor.org/packages/DESeq2/) (Love *et al.*, 2014). A single design formula `~ column` is fitted, where `column` is the user-selected metadata variable. The reference level is set via `relevel()` to the user-specified reference group before model fitting.

### Model fitting

```r
meta[[column]] <- relevel(factor(meta[[column]]), ref = fit_ref)

dds <- DESeqDataSetFromMatrix(
  countData = counts, colData = meta,
  design    = as.formula(paste("~", column))
)
dds <- DESeq(dds, fitType = fit_type, quiet = TRUE)
```

`DESeq()` is called with a user-selectable dispersion estimation method (`fitType`; default: `"parametric"`). The fitted model is reused across all contrasts in a single session.

### Contrast extraction

Results for each pairwise contrast (treatment vs. reference) are extracted with `results()` using the following parameters:

| Parameter | Default | Description |
|---|---|---|
| `alpha` | 0.05 | FDR threshold for independent filtering |
| `lfcThreshold` | 0 | Minimum absolute log₂FC for hypothesis testing |
| `independentFiltering` | `TRUE` | Automatic low-count filtering to maximise discoveries |
| `cooksCutoff` | `TRUE` | Flag outlier samples via Cook's distance |

```r
res_obj <- results(dds,
  contrast             = c(column, ct$treatment, ct$reference),
  alpha                = alpha,
  lfcThreshold         = lfc_thresh,
  independentFiltering = ind_filt,
  cooksCutoff          = cooks_cut
)
```

Multiple contrasts are dispatched in parallel using the [`mirai`](https://cran.r-project.org/package=mirai) package when available, with sequential fallback.

### Multiple testing correction

p-values are adjusted using the Benjamini–Hochberg (BH) procedure, as implemented in `results()`. Genes are considered significantly differentially expressed at padj < `alpha`.

### Normalisation for display

Size-factor-normalised counts are computed and stored alongside results. Per-group mean normalised counts (treatment and reference) are attached to each result table for display.

```r
norm_mat <- counts(dds, normalized = TRUE)
```

---

## MA Plot

The MA plot displays log₂ fold change (M) against mean normalised expression (A, i.e. `baseMean`) for all tested genes. Points are coloured by significance status (padj < threshold). Non-significant points are downsampled to a maximum of 10,000 for rendering performance (significant points are always shown in full). A horizontal reference line is drawn at log₂FC = 0. The plot is rendered client-side using [Plotly.js](https://plotly.com/javascript/).

```r
NS_MAX <- 10000L
is_sig  <- sapply(points, function(p) !is.null(p$padj) && !is.na(p$padj) && p$padj < 0.05)
ns_idx  <- which(!is_sig)
if (length(ns_idx) > NS_MAX) { set.seed(42L); ns_idx <- sample(ns_idx, NS_MAX) }
points  <- points[sort(c(which(is_sig), ns_idx))]
```

---

## Principal Component Analysis

PCA is computed on `varianceStabilizingTransformation(dds, blind = TRUE)` counts, matching the DESeq2 `plotPCA()` convention for exploratory ordination. The top N most variable genes (by row variance) are selected using `rowVars()` from the `matrixStats` package, and `prcomp()` is applied to the transposed matrix (`scale. = FALSE`). By default, all genes are used (`ntop = NULL`); the user can restrict to the top N via the frontend control (UI default: 500).

```r
vsd_blind <- varianceStabilizingTransformation(dds, blind = TRUE)
pca_mat   <- assay(vsd_blind)
rv        <- rowVars(pca_mat)
n_top     <- if (is.null(ntop)) nrow(pca_mat) else min(ntop, nrow(pca_mat))
top_genes <- pca_mat[order(rv, decreasing = TRUE)[seq_len(n_top)], ]
pca_obj   <- prcomp(t(top_genes), scale. = FALSE)
variance  <- summary(pca_obj)$importance["Proportion of Variance", ] * 100
```

All principal components (up to n_samples − 1) are returned. Variance explained per PC is taken from `summary(pca_obj)$importance`. The top 50 genes per PC by absolute loading are stored and returned as the loadings table.

The PCA scatter plot (2D and 3D) and scree plot are rendered client-side using Plotly.js. Points can be coloured by any metadata column.

---

## Count Distributions

To display per-sample count distributions, a random subsample of up to 3,000 genes is drawn from the full count matrix. Two distributions are computed per sample:

- **Raw counts** — log₂(count + 1) transformation of raw integer counts
- **VST** — values from `varianceStabilizingTransformation(dds, blind = FALSE)`

```r
dist_idx <- sample(nrow(vst_mat), min(3000, nrow(vst_mat)))
raw_log2 <- log2(counts(dds)[dist_idx, , drop = FALSE] + 1)
vst_sub  <- vst_mat[dist_idx, , drop = FALSE]
```

Distributions are visualised as violin plots with embedded box plots using Plotly.js.

---

## Gene Violin Plot

Single-gene expression is visualised as a violin + jitter + box plot using [`ggpubr`](https://cran.r-project.org/package=ggpubr) (`ggviolin()`). Expression values are log₂-transformed raw integer counts (`log2(counts + 1)`). A Wilcoxon rank-sum test (`wilcox.test`) is applied between the two contrast groups using `stat_compare_means()`, with significance annotations (`ns / * / ** / *** / ****`) and exact p-value label. DESeq2 statistics (baseMean, log₂FC, lfcSE, p-value, padj) for the gene in the selected contrast are displayed alongside the plot.

```r
p <- ggviolin(df, x = "group", y = "expr", fill = "group",
              add        = c("jitter", "boxplot"),
              add.params = list(fill = "white", width = 0.15, size = 1.2, alpha = 0.6)) +
  stat_compare_means(method = "wilcox.test", label = "p.signif") +
  stat_compare_means(label = "p.format", label.y.npc = 0.92)
```

---

## Multi-group Gene Plot

When more than two groups are present, expression for a single gene is shown across all groups simultaneously. A global Kruskal–Wallis test is applied, followed by pairwise Wilcoxon rank-sum tests with `hide.ns = TRUE` to show only significant pairwise comparisons. All pairwise combinations are generated with `combn()`.

```r
all_comparisons <- combn(all_groups, 2, simplify = FALSE)

p <- ggviolin(df, x = "group", y = "expr", fill = "group", ...) +
  stat_compare_means(method = "kruskal.test", label.y = y_max * 1.35) +
  stat_compare_means(comparisons = all_comparisons, method = "wilcox.test",
                     label = "p.signif", hide.ns = TRUE)
```

---

## UpSet Plot

DEG overlap across contrasts is visualised as an UpSet diagram using the [`UpSetR`](https://cran.r-project.org/package=UpSetR) package. Each set contains the significant DEGs for one contrast (padj < FDR threshold, |log₂FC| ≥ user threshold). Sets are converted to a binary membership matrix with `UpSetR::fromList()` and rendered with `UpSetR::upset()`, ordered by intersection frequency. Only contrasts with at least one DEG are included; a minimum of two non-empty contrasts is required.

```r
gene_sets <- lapply(contrasts, function(ct) {
  df  <- ct$results
  sig <- df[!is.na(df$padj) & df$padj < fdr & abs(df$log2FC) >= lfc, ]
  sig$gene
})
UpSetR::upset(UpSetR::fromList(gene_sets), order.by = "freq")
```

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

**Normalized counts (Z-score)**
Expression values are taken from the session's stored log₂-transformed counts (`norm_matrix`, computed as `log2(size-factor-normalised counts + 1)`), with VST (`varianceStabilizingTransformation(dds, blind = FALSE)`) used as a fallback when `norm_matrix` is not available. Each gene (row) is Z-score standardized across samples. Genes with zero variance are set to 0. This is the default display mode.

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

### Colour scale

The heatmap colour palette is user-configurable. A three-point colour gradient (low → mid → high) is interpolated to 256 colours using `grDevices::colorRampPalette()`. The default palette is blue → white → red.

### Column annotation

An optional annotation bar above the sample columns is drawn using sample metadata. The user selects a metadata column (e.g. treatment group); group colours are assigned from a fixed qualitative palette.

---

## Gene Annotation

Gene IDs (Ensembl, NCBI/Entrez, or RefSeq) can be annotated with gene symbols, descriptions, and biotypes using two complementary services.

### Ensembl REST + BioMart (primary for Ensembl IDs)

Annotation is performed in up to three phases:

**Phase 1 — Ensembl REST API** (`POST /lookup/id`): Genes are submitted in batches of 1,000. The structured JSON response returns `display_name` (symbol), `description`, and `biotype` directly without TSV parsing.

```r
body_json <- paste0('{"ids":[', paste0('"', batch, '"', collapse = ","), ']}')
resp <- httr::POST("https://rest.ensembl.org/lookup/id",
  httr::add_headers(`Content-Type` = "application/json", `Accept` = "application/json"),
  body = body_json, encode = "raw", httr::timeout(90))
```

**Phase 2 — BioMart XML fallback**: If Phase 1 returns fewer than 5% of submitted IDs, the BioMart XML API is queried in batches of 500 for `ensembl_gene_id`, `external_gene_name`, `description`, and `gene_biotype`.

```r
.query_biomart(.build_biomart_xml(dataset, paste(batch, collapse = ","),
  c("ensembl_gene_id","external_gene_name","description","gene_biotype")))
```

**Phase 3 — Human 1:1 orthologs (optional)**: For non-human organisms, one-to-one human orthologs are retrieved via BioMart (`hsapiens_homolog_ensembl_gene`, `hsapiens_homolog_associated_gene_name`, `hsapiens_homolog_orthology_type = "ortholog_one2one"`).

### NCBI E-utilities (for NCBI/Entrez and RefSeq IDs)

NCBI gene IDs or RefSeq accessions are annotated using the NCBI E-summary API (`esummary.fcgi`), which is organism-agnostic and works for all species with NCBI gene records.

---

## Gene Set Enrichment Analysis (GSEA)

GSEA is performed using [`clusterProfiler::GSEA()`](https://bioconductor.org/packages/clusterProfiler/) (Yu *et al.*, 2012) with the fgsea permutation backend, against gene sets from the [MSigDB](https://www.gsea-msigdb.org/gsea/msigdb/) database, accessed via the [`msigdbr`](https://cran.r-project.org/package=msigdbr) R package.

### Pre-filter: low-count gene removal

Before ranking, genes are filtered by **baseMean** — the mean of DESeq2-normalised counts (`rowMeans(counts(dds, normalized = TRUE))`) across all samples. Two filter modes are available:

- **baseMean cutoff** (default) — retain genes with baseMean ≥ N normalised counts (default: 10). The slider and number input set N directly.
- **Quantile** — retain genes above the Nth percentile of baseMean (default: 25th). The resolved baseMean threshold is shown alongside the slider.

The density distribution of per-sample normalised counts (log₁p-transformed) is shown in a modal panel to guide cutoff selection. The red dashed vertical line marks `log₁p(cutoff)` on the x-axis; genes whose baseMean falls to the left of the line are excluded from the ranked list.

```r
base_means <- rowMeans(counts(dds, normalized = TRUE))

cutoff <- if (filter_method == "quantile") {
  quantile(base_means, filter_value, na.rm = TRUE)   # filter_value = 0–1
} else {
  filter_value                                        # absolute count threshold
}
genes_pass <- names(base_means)[base_means >= cutoff]
```

### Ranked gene list construction

After filtering, a ranked list is built from the selected contrast's DESeq2 results using one of three scoring methods:

| Method | Formula | Description |
|---|---|---|
| log₂ Fold Change | `log2FC` | Simple, interpretable |
| Wald Statistic | `stat` | Accounts for LFC uncertainty |
| sign(FC) × −log₁₀(padj) | `sign(log2FC) × −log10(padj)` | Significance-weighted ranking |

```r
rank_score <- switch(rank_method,
  "log2FC"         = res_df$log2FC,
  "stat"           = ifelse(is.na(res_df$stat), res_df$log2FC, res_df$stat),
  "signed_logpadj" = sign(res_df$log2FC) * -log10(pmax(res_df$padj, 1e-300))
)
stats_vec <- sort(setNames(rank_score, res_df$gene), decreasing = TRUE)
```

If gene annotation has been applied, Ensembl IDs are translated to gene symbols before ranking. Duplicate gene names are resolved by retaining the entry with the highest absolute score.

### Gene set retrieval

Gene sets are downloaded from MSigDB using `msigdbr()` for the selected species and collection. Available collections include:

| Collection | Description |
|---|---|
| H | Hallmark gene sets |
| C2: KEGG | KEGG canonical pathways |
| C2: Reactome | Reactome biological pathways |
| C2: WikiPathways | Community-curated pathways |
| C5: GO:BP/MF/CC | Gene Ontology (Biological Process, Molecular Function, Cellular Component) |
| C6 | Oncogenic signatures |
| C7: ImmuneSigDB | Immune cell signatures |
| C8 | Cell type gene sets |

```r
msig      <- msigdbr(species = species, category = collection, subcategory = subcategory)
gene_sets <- split(msig$gene_symbol, msig$gs_name)   # if annotation available
```

### GSEA run

```r
set.seed(42L)
gsea_res <- clusterProfiler::GSEA(
  geneList      = stats_vec,       # named sorted numeric vector
  TERM2GENE     = term2gene,       # two-column data frame: term, gene
  minGSSize     = min_size,        # default: 15
  maxGSSize     = max_size,        # default: 500
  pvalueCutoff  = 1,               # return all; filtered client-side
  pAdjustMethod = padj_method,     # default: "BH"
  by            = "fgsea",         # fgsea permutation backend
  eps           = 0,               # exact p-values via adaptive permutation
  seed          = TRUE,
  verbose       = FALSE
)
```

p-values are adjusted using the method selected by the user (default: Benjamini–Hochberg), passed directly to `GSEA()`. Results are filtered to pathways with padj ≤ the user-defined cutoff (default: 0.25) before display.

### Enrichment curve (mountain plot)

For each selected pathway, the weighted running enrichment score is computed from the cached ranked statistics vector:

```r
abs_scores <- abs(stats_vec)
total_abs  <- sum(abs_scores[in_path])
miss_inc   <- -1 / (n - n_path)

es <- numeric(n + 1)
for (i in seq_len(n)) {
  es[i + 1] <- es[i] + if (in_path[i]) abs_scores[i] / total_abs else miss_inc
}
```

The enrichment curve, peak position, rug marks (pathway gene positions in the ranked list), and leading-edge gene names are returned for interactive display. Per-pathway curves are cached in an RDS sidecar file after each run so that repeated pathway clicks are served instantly.

### Multiple runs and contrast isolation

All GSEA runs are stored in component state keyed by contrast label. Switching contrasts resets the active run view to show only runs belonging to the current contrast; all prior runs across all contrasts remain in memory for the session.

---

### GSEA Visualisation Plots

All plots are rendered server-side using [`enrichplot`](https://bioconductor.org/packages/enrichplot/) and [`ggplot2`](https://ggplot2.tidyverse.org/), saved as PNG at 150 dpi, and returned as base64-encoded images. Common parameters shared by all plot types:

| Parameter | Default | Description |
|---|---|---|
| `n_show` | 20 | Number of top pathways to display |
| `font_size` | 11 | Base font size (pt) |
| `color_pos` | `#e63946` | Colour for positive enrichment / high values |
| `color_neg` | `#457b9d` | Colour for negative enrichment / low values |
| `width` × `height` | 9 × 7 in | Output image dimensions |

The `gsea_result` object is a `gseaResult` S4 object returned by `clusterProfiler::GSEA()` and cached to disk after each run. The `stats_vec` named numeric vector (the ranked gene list) is also cached alongside it.

#### Dot Plot

Displays the top `n_show` pathways ranked by p.adjust. The x-axis shows NES (Normalised Enrichment Score), dot size reflects the number of genes in the leading edge, and dot colour (fill) encodes adjusted p-value.

```r
suppressWarnings(
  dotplot(gsea_result, showCategory = n_show, font.size = font_size,
          label_format = 40, x = "NES", color = "p.adjust") +
    scale_fill_gradient(low = color_pos, high = color_neg) +
    theme_bw(base_size = font_size) +
    ggtitle("GSEA Dot Plot")
)
```

> **Note:** `dotplot()` maps p.adjust to the `fill` aesthetic, not `color`. `scale_fill_gradient` is required; `scale_color_gradient` has no effect. The `suppressWarnings()` suppresses the "scale already present" message when overriding enrichplot's default fill scale.

#### Ridge Plot

Shows the fold-change distribution of leading-edge genes for each of the top `n_show` pathways as overlapping density ridges. Useful for seeing whether enrichment is driven by a broad shift or a few extreme outliers.

```r
# showCategory must be numeric (double) — inherits(n, "numeric") returns FALSE for integers
suppressWarnings(
  ridgeplot(gsea_result, showCategory = as.numeric(n_show)) +
    scale_fill_gradient(low = color_neg, high = color_pos) +
    theme_bw(base_size = font_size) +
    ggtitle("GSEA Ridge Plot — Leading Edge Expression")
)
```

> **Note:** `ridgeplot()` internally checks `inherits(showCategory, "numeric")`, which returns `FALSE` for R integers. `as.numeric()` coercion is required.

#### Heat Plot

A gene × pathway heatmap where columns are pathways and rows are leading-edge genes. Cell colour encodes the gene's ranking score (fold change), making it easy to see which genes drive enrichment across multiple pathways simultaneously.

```r
# pathway_sel: character vector of pathway IDs; defaults to top min(n_show, 10) by padj
suppressWarnings(
  heatplot(gsea_result, foldChange = stats_vec, showCategory = pathway_sel) +
    scale_fill_gradient2(low = color_neg, mid = "white", high = color_pos, midpoint = 0) +
    theme_bw(base_size = font_size) +
    theme(axis.text.x = element_text(angle = 90, hjust = 1, vjust = 0.5)) +
    ggtitle("GSEA Heat Plot — Leading Edge Genes")
)
```

#### UpSet Plot

Visualises the overlap of leading-edge gene sets across the top `n_show` (capped at 15) pathways as an UpSet diagram. Intersection sizes are shown as bars; set sizes are shown as a horizontal bar chart. Ordered by intersection frequency.

```r
# enrichplot::upsetplot for gseaResult returns a UpSetR object, not ggplot2
# Must use png()/print()/dev.off() pipeline
res_df    <- as.data.frame(gsea_result)
sel       <- head(res_df$ID[order(res_df$p.adjust)], n_up)   # n_up = min(n_show, 15)
core      <- res_df$core_enrichment[match(sel, res_df$ID)]
gene_sets <- setNames(
  lapply(core, function(x) strsplit(x, "/")[[1]]),
  substr(sel, 1, 40)
)
png(tmp, width = round(w * 150), height = round(h * 150), res = 150)
print(UpSetR::upset(UpSetR::fromList(gene_sets), nsets = length(gene_sets),
                    sets.bar.color = color_pos, main.bar.color = color_neg,
                    text.scale = font_size / 11, order.by = "freq"))
dev.off()
```

> **Note:** `enrichplot::upsetplot()` on a `gseaResult` object returns a `UpSetR` object (not ggplot2), which cannot be passed to `ggsave()`. The `png()/print()/dev.off()` pipeline is required.

#### Enrichment Map

A network graph where nodes are pathways and edges connect pathways that share a high proportion of leading-edge genes (Jaccard similarity). Node colour encodes p.adjust; node size encodes gene set size. Clustered pathways with similar biology are naturally positioned together.

```r
gsea_result2 <- pairwise_termsim(gsea_result)
emapplot(gsea_result2, showCategory = n_show,
         color = "p.adjust", layout = "kk") +
  scale_color_gradient(low = color_pos, high = color_neg) +
  theme_void(base_size = font_size) +
  ggtitle("Enrichment Map")
```

`pairwise_termsim()` pre-computes the term similarity matrix required by `emapplot()`. The Kamada–Kawai (`"kk"`) layout is used for stable, aesthetically balanced placement.

#### Concept Network (cnetplot)

A bipartite network connecting selected pathways (large nodes) to their individual leading-edge genes (small nodes), coloured by fold change. Shows gene-level detail and which genes are shared across pathways.

```r
# pathway_sel: character vector of pathway IDs; defaults to top 5 by padj
cnetplot(gsea_result, foldChange = stats_vec,
         showCategory = pathway_sel,
         circular     = isTRUE(params$circular),
         colorEdge    = TRUE, node_label = "all") +
  scale_color_gradient2(low = color_neg, mid = "white", high = color_pos, midpoint = 0) +
  theme_void(base_size = font_size) +
  ggtitle("Concept Network — Gene-Pathway Links")
```

The `circular` layout option arranges pathway nodes in a ring when multiple pathways are shown, which can reduce edge crossing for dense networks.

#### GSEA Plot (Enrichment Score Curve)

The classic GSEA mountain plot showing the running enrichment score curve, ranked gene position rug, and ranking metric bar for one or more pathways. Each pathway gets a distinct colour interpolated between `color_pos` and `color_neg`. Pathway labels have their collection prefix stripped (e.g. `HALLMARK_`, `KEGG_`) and are truncated to 30 characters to prevent label overlap. A p-value table is appended below.

```r
# pathway_sel: character vector; defaults to top min(n_show, 3) by padj
gsea_tmp <- gsea_result
idx <- match(pathway_sel, gsea_tmp@result$ID)
gsea_tmp@result$Description[idx] <- substr(
  gsub("^[A-Z0-9]+_", "", gsea_tmp@result$Description[idx]), 1, 30
)
# gseaplot2 returns a cowplot composite — cannot use + operator on result
n_paths <- length(pathway_sel)
colors  <- if (n_paths == 1) color_pos else colorRampPalette(c(color_pos, color_neg))(n_paths)
enrichplot::gseaplot2(gsea_tmp, geneSetID = pathway_sel,
                      color = colors, base_size = font_size,
                      pvalue_table = TRUE)
```

> **Note:** `gseaplot2()` returns a `cowplot` composite object. The `+` operator cannot be used to add ggplot2 layers to it; all styling must be done via its own parameters before the call.

---

## GSEA Compare — Pathway Overlap Analysis

The **GSEA Compare** tab allows cross-run, cross-contrast comparison of GSEA results by analysing the overlap between the leading-edge gene sets of selected pathways.

### Leading-edge genes

The leading-edge subset is the core set of genes that drive a pathway's enrichment score in GSEA. These are the genes ranked before the peak of the running enrichment score — i.e. the genes that contribute most to the observed enrichment. Leading-edge gene sets are extracted directly from the stored GSEA result objects (`core_enrichment` field of the `clusterProfiler::GSEA()` output, stored as `/`-delimited gene symbol strings).

### Overlap metrics

Three pairwise overlap metrics are computed between the leading-edge sets of any two selected pathways (A and B):

| Metric | Formula | Range | Notes |
|---|---|---|---|
| **Count** | ∣A ∩ B∣ | 0 … min(∣A∣, ∣B∣) | Raw shared gene count; does not normalise for set size |
| **Jaccard index** | ∣A ∩ B∣ / ∣A ∪ B∣ | 0 – 1 | Penalises both sets for unshared genes; symmetric; best when comparing pathways of similar size |
| **Overlap coefficient** (Szymkiewicz–Simpson) | ∣A ∩ B∣ / min(∣A∣, ∣B∣) | 0 – 1 | Reaches 1.0 when the smaller set is entirely contained in the larger one; ideal for detecting subset/redundancy relationships |

```
Jaccard(A, B)  = |A ∩ B| / |A ∪ B|
Overlap(A, B)  = |A ∩ B| / min(|A|, |B|)
```

All three metrics are displayed in the pairwise overlap matrix. The matrix can be exported as CSV for downstream analysis.

### Pathway selection

Pathways are drawn from all GSEA runs in the current session. Runs are filterable by adjusted p-value cutoff and by a top-N per run limit. A free-text search box further narrows the pathway list by name. Selected pathways are summarised in a detail table (paginated, 20 rows per page) showing pathway name, run label, contrast, NES, padj, and leading-edge gene count, with row hover highlighting for readability.
