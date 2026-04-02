# gsea.R — GSEA analysis helpers sourced by plumber.R
# Provides: gsea_preview(), gsea_run(), gsea_curve()

`%||%` <- function(x, y) if (!is.null(x) && length(x) > 0) x else y

# Resolve dirs the same way plumber.R does — self-contained, no lexical dependency
.upload_dir  <- function() Sys.getenv("UPLOAD_DIR",  file.path(dirname(getwd()), "data", "uploads"))
.results_dir <- function() Sys.getenv("RESULTS_DIR", file.path(dirname(getwd()), "data", "results"))

# ── Internal: derive cache file path ──────────────────────────────────────────
.gsea_cache_path <- function(session_id, contrast_label, collection, subcategory, species) {
  key <- paste0(
    session_id, "_gsea_",
    gsub("[^A-Za-z0-9]", "_", paste0(collection, "_", subcategory %||% "none")),
    "_", gsub("[^A-Za-z0-9]", "_", contrast_label %||% "default")
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

  # Row medians for pre-filtering
  row_meds        <- rowMedians(counts)
  names(row_meds) <- rownames(counts)

  cutoff <- if (filter_method == "quantile") {
    as.numeric(quantile(row_meds, as.numeric(filter_value), na.rm = TRUE))
  } else {
    as.numeric(filter_value)
  }
  genes_pass <- names(row_meds)[!is.na(row_meds) & row_meds >= cutoff]

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

  # Per-sample KDE of log1p(normalised counts)
  kdes <- lapply(seq_len(n_samp), function(j) {
    vals <- log1p(counts[, j])
    dens <- density(vals, bw = "nrd0", n = 256, from = 0)
    list(
      sample = colnames(counts)[j],
      x = round(as.numeric(dens$x), 4),
      y = round(as.numeric(dens$y), 8)
    )
  })

  # Row medians of normalised counts — used for the filter cutoff
  row_meds        <- rowMedians(counts)
  names(row_meds) <- rownames(counts)

  # 101-point quantile table (0%…100%) for slider interpolation
  q_probs <- seq(0, 1, by = 0.01)
  q_vals  <- quantile(row_meds, q_probs, na.rm = TRUE)

  # Downsampled sorted row medians (up to 2000 pts) for accurate gene-count calc in JS
  all_meds  <- sort(row_meds, na.last = FALSE)
  n_total   <- length(all_meds)
  ds_idx    <- unique(round(seq(1, n_total, length.out = min(2000L, n_total))))
  meds_ds   <- round(as.numeric(all_meds[ds_idx]), 2)

  list(
    kdes           = kdes,
    quantileValues = round(as.numeric(q_vals), 2),
    mediansSample  = meds_ds,          # sorted, for JS binary-search gene count
    quartiles = list(
      q25 = round(as.numeric(q_vals[26]), 2),
      q50 = round(as.numeric(q_vals[51]), 2),
      q75 = round(as.numeric(q_vals[76]), 2),
      q90 = round(as.numeric(q_vals[91]), 2)
    ),
    n_genes  = n_genes,
    n_samples = n_samp
  )
}

# ── gsea_run: fgsea against a MSigDB collection ────────────────────────────────
gsea_run <- function(session_id, contrast_label, rank_method, collection, subcategory,
                     species, min_size, max_size, filter_method, filter_value, ann_map) {
  if (!requireNamespace("fgsea",   quietly = TRUE)) stop("R package 'fgsea' is not installed on the server")
  if (!requireNamespace("msigdbr", quietly = TRUE)) stop("R package 'msigdbr' is not installed on the server")
  library(fgsea); library(msigdbr)

  stats_vec <- .build_ranked_vec(session_id, contrast_label, rank_method,
                                  filter_method, filter_value, ann_map)

  use_symbols <- !is.null(ann_map) && length(ann_map) > 0

  msig <- tryCatch(
    msigdbr(species = species, category = collection, subcategory = subcategory),
    error = function(e) stop("Failed to load MSigDB gene sets: ", e$message)
  )
  if (nrow(msig) == 0) stop("No gene sets returned for the selected collection/species")

  gene_sets <- if (use_symbols) {
    split(msig$gene_symbol, msig$gs_name)
  } else {
    msig_ens <- msig[!is.na(msig$ensembl_gene) & nchar(msig$ensembl_gene) > 0, ]
    split(msig_ens$ensembl_gene, msig_ens$gs_name)
  }
  if (length(gene_sets) == 0) stop("No gene sets found for the selected collection")

  t0 <- proc.time()["elapsed"]
  set.seed(42L)
  fgsea_res <- tryCatch(
    fgsea(
      pathways    = gene_sets,
      stats       = stats_vec,
      minSize     = as.integer(min_size),
      maxSize     = as.integer(max_size),
      nPermSimple = 1000L,
      eps         = 0
    ),
    error = function(e) stop("fgsea failed: ", e$message)
  )
  elapsed <- as.numeric(proc.time()["elapsed"] - t0)

  fgsea_res <- fgsea_res[order(fgsea_res$padj, na.last = TRUE), ]

  results_out <- lapply(seq_len(nrow(fgsea_res)), function(i) {
    r  <- fgsea_res[i, ]
    le <- paste(unlist(r$leadingEdge), collapse = ",")
    list(
      pathway      = r$pathway,
      NES          = round(as.numeric(r$NES), 3),
      pvalue       = signif(as.numeric(r$pval), 3),
      padj         = signif(as.numeric(r$padj), 3),
      size         = as.integer(r$size),
      ES           = round(as.numeric(r$ES), 3),
      leadingEdge  = le,
      leadingEdgeN = length(unlist(r$leadingEdge))
    )
  })

  ranked_out <- lapply(seq_along(stats_vec), function(i) {
    list(gene = names(stats_vec)[i], score = round(as.numeric(stats_vec[i]), 4))
  })

  # Cache stats_vec + gene_sets for the fast /curve endpoint
  cache_path <- .gsea_cache_path(session_id, contrast_label, collection, subcategory, species)
  tryCatch(
    saveRDS(list(stats_vec = stats_vec, gene_sets = gene_sets), cache_path),
    error = function(e) message("[gsea] Cache save failed: ", e$message)
  )

  list(
    results    = results_out,
    rankedList = ranked_out,
    meta = list(
      n_genes_ranked = length(stats_vec),
      n_pathways     = nrow(fgsea_res),
      collection     = collection,
      species        = species,
      contrastLabel  = contrast_label,
      elapsedSecs    = round(elapsed, 1)
    )
  )
}

# ── gsea_curve: weighted running enrichment score for one pathway ──────────────
gsea_curve <- function(session_id, contrast_label, pathway,
                        collection, subcategory, species) {
  cache_path <- .gsea_cache_path(session_id, contrast_label, collection, subcategory, species)
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
