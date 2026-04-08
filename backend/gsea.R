# gsea.R — GSEA analysis helpers sourced by plumber.R
# Provides: gsea_preview(), gsea_run(), gsea_curve()

`%||%` <- function(x, y) if (!is.null(x) && length(x) > 0) x else y

# Resolve dirs the same way plumber.R does — self-contained, no lexical dependency
.upload_dir  <- function() Sys.getenv("UPLOAD_DIR",  file.path(dirname(getwd()), "data", "uploads"))
.results_dir <- function() Sys.getenv("RESULTS_DIR", file.path(dirname(getwd()), "data", "results"))

# ── Internal: derive cache file path ──────────────────────────────────────────
.gsea_cache_path <- function(session_id, contrast_label, collection, subcategory, species, run_id = NULL) {
  key <- paste0(
    session_id, "_gsea_",
    gsub("[^A-Za-z0-9]", "_", paste0(collection, "_", subcategory %||% "none")),
    "_", gsub("[^A-Za-z0-9]", "_", contrast_label %||% "default"),
    if (!is.null(run_id)) paste0("_", run_id) else ""
  )
  file.path(.results_dir(), paste0(key, ".rds"))
}

# ── Internal: locate contrast results from saved RDS ──────────────────────────
.get_contrast <- function(saved, label) {
  if ("contrasts" %in% names(saved)) {
    labels <- sapply(saved$contrasts, function(ct) ct$label)
    idx    <- if (!is.null(label) && label %in% labels) which(labels == label)[1L] else 1L
    saved$contrasts[[idx]]
  } else {
    list(results = saved$results, label = label)
  }
}

# ── Internal: build the ranked statistics vector ───────────────────────────────
.build_ranked_vec <- function(session_id, contrast_label, rank_method,
                               filter_method, filter_value, ann_map) {
  results_path <- file.path(.results_dir(), paste0(session_id, "_results.rds"))
  upload_path  <- file.path(.upload_dir(),  paste0(session_id, ".rds"))
  if (!file.exists(results_path)) stop("Results not found — please run DESeq2 first")
  if (!file.exists(upload_path))  stop("Upload not found")

  library(matrixStats)
  saved  <- readRDS(results_path)

  # Use DESeq2 normalised counts for the row-median filter (consistent with preview)
  counts <- if (!is.null(saved$norm_matrix)) {
    as.matrix(saved$norm_matrix)
  } else {
    if (!file.exists(upload_path)) stop("Upload not found")
    as.matrix(readRDS(upload_path)$counts)
  }

  # baseMean per gene (mean of normalised counts across all samples) — filter on this
  base_means        <- rowMeans(counts)
  names(base_means) <- rownames(counts)

  cutoff <- if (filter_method == "quantile") {
    as.numeric(quantile(base_means, as.numeric(filter_value), na.rm = TRUE))
  } else {
    as.numeric(filter_value)             # "count" mode — absolute baseMean threshold
  }
  genes_pass <- names(base_means)[!is.na(base_means) & base_means >= cutoff]

  ct_obj <- .get_contrast(saved, contrast_label)
  res_df <- ct_obj$results
  res_df <- res_df[res_df$gene %in% genes_pass & !is.na(res_df$log2FC), ]
  if (nrow(res_df) == 0) stop("No genes pass the filter — try lowering the cutoff")

  rank_score <- switch(rank_method,
    "log2FC" = res_df$log2FC,
    "stat"   = {
      s <- res_df$stat
      if (all(is.na(s))) res_df$log2FC else ifelse(is.na(s), res_df$log2FC, s)
    },
    "signed_logpadj" = {
      pj <- res_df$padj; pj[is.na(pj)] <- 1; pj <- pmax(pj, 1e-300)
      sign(res_df$log2FC) * -log10(pj)
    },
    res_df$log2FC
  )

  stats_vec <- setNames(as.numeric(rank_score), as.character(res_df$gene))
  stats_vec <- stats_vec[!is.na(stats_vec) & is.finite(stats_vec)]

  # Translate to gene symbols via annMap
  if (!is.null(ann_map) && length(ann_map) > 0) {
    sym_vec   <- unlist(ann_map)
    new_names <- ifelse(names(stats_vec) %in% names(sym_vec),
                        sym_vec[names(stats_vec)], names(stats_vec))
    names(stats_vec) <- new_names
  }

  # Remove duplicates — keep highest absolute score
  if (any(duplicated(names(stats_vec)))) {
    ord       <- order(-abs(stats_vec))
    stats_vec <- stats_vec[ord][!duplicated(names(stats_vec)[ord])]
  }

  sort(stats_vec, decreasing = TRUE)
}

# ── gsea_preview: per-sample KDE distributions + row-median filter stats ────────
gsea_preview <- function(session_id, contrast_label) {
  results_path <- file.path(.results_dir(), paste0(session_id, "_results.rds"))
  if (!file.exists(results_path)) stop("Results not found — please run DESeq2 first")

  library(matrixStats)
  saved  <- readRDS(results_path)

  # Prefer DESeq2-normalised counts; fall back to raw if not yet available
  counts <- if (!is.null(saved$norm_matrix)) {
    as.matrix(saved$norm_matrix)
  } else {
    upload_path <- file.path(.upload_dir(), paste0(session_id, ".rds"))
    if (!file.exists(upload_path)) stop("Upload not found")
    as.matrix(readRDS(upload_path)$counts)
  }

  n_genes  <- nrow(counts)
  n_samp   <- ncol(counts)

  # Per-sample size factors (named vector, NA if not saved yet)
  sf_vec <- if (!is.null(saved$size_factors)) saved$size_factors else setNames(rep(NA_real_, n_samp), colnames(counts))

  # Per-sample KDE of log1p(normalised counts)
  kdes <- lapply(seq_len(n_samp), function(j) {
    sname <- colnames(counts)[j]
    vals  <- log1p(counts[, j])
    dens  <- density(vals, bw = "nrd0", n = 256, from = 0)
    list(
      sample      = sname,
      size_factor = round(as.numeric(sf_vec[sname]), 4),
      x = round(as.numeric(dens$x), 4),
      y = round(as.numeric(dens$y), 8)
    )
  })

  # baseMean per gene (mean of normalised counts across all samples)
  base_means <- rowMeans(counts)

  # 101-point quantile table (0%…100%) for quantile-mode slider interpolation
  q_vals <- quantile(base_means, seq(0, 1, by = 0.01), na.rm = TRUE)

  # Full sorted baseMeans — JS binary-searches for live gene count (no subsampling)
  bm_sorted <- round(as.numeric(sort(base_means, na.last = FALSE)), 2)

  list(
    kdes           = kdes,
    baseMeans      = bm_sorted,                          # sorted, for JS binary-search
    quantileValues = round(as.numeric(q_vals), 2),       # 101 values for quantile mode
    bmMax          = round(max(base_means, na.rm = TRUE), 2),
    n_genes        = n_genes,
    n_samples      = n_samp
  )
}

# ── gsea_run: clusterProfiler::GSEA against a MSigDB collection ───────────────
gsea_run <- function(session_id, contrast_label, rank_method, collection, subcategory,
                     species, min_size, max_size, score_type, n_perm, padj_method,
                     filter_method, filter_value, ann_map, run_id = NULL) {
  if (!requireNamespace("clusterProfiler", quietly = TRUE)) stop("R package 'clusterProfiler' is not installed on the server")
  if (!requireNamespace("msigdbr",         quietly = TRUE)) stop("R package 'msigdbr' is not installed on the server")
  library(clusterProfiler); library(msigdbr)

  stats_vec <- .build_ranked_vec(session_id, contrast_label, rank_method,
                                  filter_method, filter_value, ann_map)

  use_symbols <- !is.null(ann_map) && length(ann_map) > 0

  msig <- tryCatch(
    msigdbr(species = species, category = collection, subcategory = subcategory),
    error = function(e) stop("Failed to load MSigDB gene sets: ", e$message)
  )
  if (nrow(msig) == 0) stop("No gene sets returned for the selected collection/species")

  # TERM2GENE: two-column data frame required by clusterProfiler::GSEA
  term2gene <- if (use_symbols) {
    msig[, c("gs_name", "gene_symbol")]
  } else {
    msig_ens <- msig[!is.na(msig$ensembl_gene) & nchar(msig$ensembl_gene) > 0, ]
    msig_ens[, c("gs_name", "ensembl_gene")]
  }
  colnames(term2gene) <- c("term", "gene")
  if (nrow(term2gene) == 0) stop("No gene sets found for the selected collection")

  padj_method <- padj_method %||% "BH"

  t0 <- proc.time()["elapsed"]
  set.seed(42L)
  gsea_res <- tryCatch(
    clusterProfiler::GSEA(
      geneList     = stats_vec,         # named, sorted numeric vector
      TERM2GENE    = term2gene,
      minGSSize    = as.integer(min_size),
      maxGSSize    = as.integer(max_size),
      pvalueCutoff = 1,                 # return all; we filter client-side
      pAdjustMethod = padj_method,
      by           = "fgsea",           # use fgsea backend for speed
      eps          = 0,
      seed         = TRUE,
      verbose      = FALSE
    ),
    error = function(e) stop("clusterProfiler::GSEA failed: ", e$message)
  )
  elapsed <- as.numeric(proc.time()["elapsed"] - t0)

  res_df <- as.data.frame(gsea_res)

  # Reconstruct gene_sets list for the curve cache (needed by gsea_curve)
  gene_sets <- split(term2gene$gene, term2gene$term)

  results_out <- lapply(seq_len(nrow(res_df)), function(i) {
    r  <- res_df[i, ]
    le <- as.character(r$core_enrichment %||% "")
    le_genes <- if (nchar(le) > 0) strsplit(le, "/")[[1]] else character(0)
    list(
      pathway      = as.character(r$ID),
      NES          = round(as.numeric(r$NES), 3),
      pvalue       = signif(as.numeric(r$pvalue), 3),
      padj         = signif(as.numeric(r$p.adjust), 3),
      size         = as.integer(r$setSize),
      ES           = round(as.numeric(r$enrichmentScore), 3),
      leadingEdge  = paste(le_genes, collapse = ","),
      leadingEdgeN = length(le_genes)
    )
  })

  # Sort by padj
  ord         <- order(sapply(results_out, `[[`, "padj"), na.last = TRUE)
  results_out <- results_out[ord]

  ranked_out <- lapply(seq_along(stats_vec), function(i) {
    list(gene = names(stats_vec)[i], score = round(as.numeric(stats_vec[i]), 4))
  })

  # Cache stats_vec + gene_sets + gseaResult for curve + plots endpoints
  cache_path <- .gsea_cache_path(session_id, contrast_label, collection, subcategory, species, run_id)
  tryCatch(
    saveRDS(list(stats_vec = stats_vec, gene_sets = gene_sets, gsea_result = gsea_res), cache_path),
    error = function(e) message("[gsea] Cache save failed: ", e$message)
  )

  list(
    results    = results_out,
    rankedList = ranked_out,
    meta = list(
      n_genes_ranked = length(stats_vec),
      n_pathways     = nrow(res_df),
      collection     = collection,
      species        = species,
      contrastLabel  = contrast_label,
      elapsedSecs    = round(elapsed, 1)
    )
  )
}

# ── gsea_curve: weighted running enrichment score for one pathway ──────────────
gsea_curve <- function(session_id, contrast_label, pathway,
                        collection, subcategory, species, run_id = NULL) {
  cache_path <- .gsea_cache_path(session_id, contrast_label, collection, subcategory, species, run_id)
  if (!file.exists(cache_path)) stop("GSEA cache not found — please run GSEA first")

  cache     <- readRDS(cache_path)
  stats_vec <- cache$stats_vec
  gene_sets <- cache$gene_sets

  if (!(pathway %in% names(gene_sets))) stop("Pathway not found in gene set index")

  pw_genes <- gene_sets[[pathway]]
  n        <- length(stats_vec)
  in_path  <- names(stats_vec) %in% pw_genes
  n_path   <- sum(in_path)
  if (n_path == 0) stop("No pathway genes found in the ranked list — check gene ID type")

  abs_scores <- abs(stats_vec)
  total_abs  <- sum(abs_scores[in_path])
  miss_inc   <- if (n > n_path) -1 / (n - n_path) else 0

  es <- numeric(n + 1)
  for (i in seq_len(n)) {
    es[i + 1] <- es[i] + if (in_path[i]) abs_scores[i] / total_abs else miss_inc
  }

  # Downsample to ≤800 points for lean payload
  idx  <- unique(c(1L, round(seq(1L, n + 1L, length.out = 800L)), n + 1L))
  x_ds <- seq(0, 1, length.out = n + 1L)[idx]
  y_ds <- es[idx]

  # Normalised positions + gene names for rug plot hover
  hit_indices <- which(in_path)
  hit_pos     <- hit_indices / n
  hit_genes   <- names(stats_vec)[hit_indices]

  list(
    x        = round(x_ds,   5),
    y        = round(y_ds,   5),
    hits     = round(hit_pos, 5),
    hitGenes = hit_genes,
    n        = n,
    nHits    = n_path
  )
}

# ── gsea_plots: render clusterProfiler / enrichplot visualisations ──────────────
gsea_plots <- function(session_id, contrast_label, collection, subcategory, species,
                       plot_type, params, run_id = NULL) {
  cache_path <- .gsea_cache_path(session_id, contrast_label, collection, subcategory, species, run_id)
  if (!file.exists(cache_path)) stop("GSEA cache not found — please run GSEA first")

  cache       <- readRDS(cache_path)
  gsea_result <- cache$gsea_result
  stats_vec   <- cache$stats_vec
  if (is.null(gsea_result)) stop("GSEA result object not in cache — please re-run GSEA")

  if (!requireNamespace("clusterProfiler", quietly = TRUE)) stop("clusterProfiler not installed")
  if (!requireNamespace("ggplot2",         quietly = TRUE)) stop("ggplot2 not installed")
  if (!requireNamespace("enrichplot",      quietly = TRUE)) stop("enrichplot not installed")
  library(clusterProfiler); library(ggplot2); library(enrichplot)

  # Common params with defaults
  n_show     <- as.integer(params$n_show     %||% 20L)
  font_size  <- as.numeric(params$font_size  %||% 11)
  color_pos  <- as.character(params$color_pos %||% "#e63946")
  color_neg  <- as.character(params$color_neg %||% "#457b9d")
  label_fmt  <- as.character(params$label_fmt %||% "p.adjust")

  w   <- as.numeric(params$width  %||% 9)
  h   <- as.numeric(params$height %||% 7)
  tmp <- tempfile(fileext = ".png")
  on.exit(unlink(tmp), add = TRUE)

  p <- tryCatch({
    switch(plot_type,

      "dotplot" = {
        # dotplot maps p.adjust to fill (not color) — must use scale_fill_gradient
        suppressWarnings(
          dotplot(gsea_result, showCategory = n_show, font.size = font_size,
                  label_format = 40, x = "NES", color = "p.adjust") +
            scale_fill_gradient(low = color_pos, high = color_neg) +
            theme_bw(base_size = font_size) +
            ggtitle("GSEA Dot Plot")
        )
      },

      "ridgeplot" = {
        # showCategory must be numeric (double), not integer — inherits(n, "numeric") is FALSE for integers
        # scale_fill_gradient replaces ridgeplot's internal fill scale (expected, suppress the warning)
        suppressWarnings(
          ridgeplot(gsea_result, showCategory = as.numeric(n_show)) +
            scale_fill_gradient(low = color_neg, high = color_pos) +
            theme_bw(base_size = font_size) +
            ggtitle("GSEA Ridge Plot — Leading Edge Expression")
        )
      },

      "upsetplot" = {
        # enrichplot::upsetplot for gseaResult returns a UpSetR object, not ggplot2
        # Must use png()/print()/dev.off() and return directly
        n_up   <- min(n_show, 15L)
        res_df <- as.data.frame(gsea_result)
        sel    <- head(res_df$ID[order(res_df$p.adjust)], n_up)
        core   <- res_df$core_enrichment[match(sel, res_df$ID)]
        gene_sets <- setNames(
          lapply(core, function(x) strsplit(x, "/")[[1]]),
          substr(sel, 1, 40)
        )
        if (!requireNamespace("UpSetR", quietly = TRUE)) stop("UpSetR not installed")
        png(tmp, width = round(w * 150), height = round(h * 150), res = 150)
        tryCatch(
          print(UpSetR::upset(UpSetR::fromList(gene_sets), nsets = length(gene_sets),
                              sets.bar.color = color_pos, main.bar.color = color_neg,
                              text.scale = font_size / 7, order.by = "freq")),
          error = function(e) { dev.off(); stop(e$message) }
        )
        dev.off()
        b64_up <- paste0("data:image/png;base64,",
                         base64enc::base64encode(readBin(tmp, "raw", file.info(tmp)$size)))
        return(list(image = b64_up, plotType = plot_type))
      },

      "heatplot" = {
        pathway_sel <- as.character(params$pathways %||% character(0))
        if (length(pathway_sel) == 0) {
          res_df      <- as.data.frame(gsea_result)
          pathway_sel <- head(res_df$ID[order(res_df$p.adjust)], min(n_show, 10L))
        }
        suppressWarnings(
          heatplot(gsea_result, foldChange = stats_vec, showCategory = pathway_sel) +
            scale_fill_gradient2(low = color_neg, mid = "white", high = color_pos, midpoint = 0) +
            theme_bw(base_size = font_size) +
            theme(axis.text.x = element_text(angle = 90, hjust = 1, vjust = 0.5)) +
            ggtitle("GSEA Heat Plot — Leading Edge Genes")
        )
      },

      "emapplot" = {
        gsea_result2 <- pairwise_termsim(gsea_result)
        emapplot(gsea_result2, showCategory = n_show,
                 color = "p.adjust", layout = "kk") +
          scale_color_gradient(low = color_pos, high = color_neg) +
          theme_void(base_size = font_size) +
          ggtitle("Enrichment Map")
      },

      "cnetplot" = {
        pathway_sel <- as.character(params$pathways %||% character(0))
        if (length(pathway_sel) == 0) {
          res_df      <- as.data.frame(gsea_result)
          pathway_sel <- head(res_df$ID[order(res_df$p.adjust)], 5L)
        }
        cnetplot(gsea_result, foldChange = stats_vec,
                 showCategory = pathway_sel,
                 circular = isTRUE(params$circular),
                 colorEdge = TRUE, node_label = "all") +
          scale_color_gradient2(low = color_neg, mid = "white", high = color_pos, midpoint = 0) +
          theme_void(base_size = font_size) +
          ggtitle("Concept Network — Gene-Pathway Links")
      },

      "gsea_plot" = {
        pathway_sel <- as.character(params$pathways %||% character(0))
        if (length(pathway_sel) == 0) {
          res_df      <- as.data.frame(gsea_result)
          pathway_sel <- head(res_df$ID[order(res_df$p.adjust)], min(n_show, 3L))
        }
        # Shorten Description labels: strip leading collection prefix (e.g. HALLMARK_, KEGG_)
        # and truncate to avoid overlapping curve labels
        gsea_tmp <- gsea_result
        idx <- match(pathway_sel, gsea_tmp@result$ID)
        gsea_tmp@result$Description[idx] <- substr(
          gsub("^[A-Z0-9]+_", "", gsea_tmp@result$Description[idx]), 1, 30
        )
        # gseaplot2 returns a cowplot composite — cannot use + operator on it
        # Generate distinct colors per pathway interpolating between pos and neg
        n_paths <- length(pathway_sel)
        colors  <- if (n_paths == 1) color_pos else colorRampPalette(c(color_pos, color_neg))(n_paths)
        enrichplot::gseaplot2(gsea_tmp, geneSetID = pathway_sel,
                              color = colors, base_size = font_size,
                              pvalue_table = TRUE)
      },

      stop(paste0("Unknown plot type: ", plot_type))
    )
  }, error = function(e) stop("Plot generation failed: ", e$message))

  ggplot2::ggsave(tmp, p, width = w, height = h, dpi = 150, bg = "white")
  b64 <- paste0("data:image/png;base64,",
                base64enc::base64encode(readBin(tmp, "raw", file.info(tmp)$size)))
  list(image = b64, plotType = plot_type)
}

# ── gsea_export_results: rbind full clusterProfiler results across runs ────────
gsea_export_results <- function(session_id, runs) {
  # runs: list of lists, each with keys:
  #   contrast_label, collection, subcategory, species, run_id,
  #   collection_label, rank_method

  KEEP_COLS <- c("ID", "Description", "setSize", "enrichmentScore", "NES",
                 "pvalue", "p.adjust", "qvalue", "rank",
                 "leading_edge", "core_enrichment")

  frames <- lapply(runs, function(run) {
    cache_path <- .gsea_cache_path(
      session_id,
      run$contrast_label %||% "",
      run$collection     %||% "H",
      run$subcategory,
      run$species        %||% "Homo sapiens",
      run$run_id
    )
    if (!file.exists(cache_path)) {
      message("[gsea_export] cache not found: ", cache_path)
      return(NULL)
    }
    cache       <- readRDS(cache_path)
    gsea_result <- cache$gsea_result
    if (is.null(gsea_result)) return(NULL)

    df <- as.data.frame(gsea_result)

    # Keep known columns that exist, drop any extras
    cols_present <- intersect(KEEP_COLS, colnames(df))
    df <- df[, cols_present, drop = FALSE]

    # Prepend identifying columns
    df <- cbind(
      contrast_label   = run$contrast_label   %||% "",
      collection       = run$collection_label %||% run$collection %||% "",
      rank_method      = run$rank_method      %||% "",
      df,
      stringsAsFactors = FALSE
    )
    df
  })

  frames <- Filter(Negate(is.null), frames)
  if (!length(frames)) stop("No cached GSEA results found — please re-run GSEA")

  combined <- do.call(rbind, frames)
  rownames(combined) <- NULL

  # Serialize rows as a list for JSON transport
  lapply(seq_len(nrow(combined)), function(i) as.list(combined[i, ]))
}
