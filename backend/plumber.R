library(plumber)
library(jsonlite)
library(digest)
library(uuid)

source("db.R")
source("email.R")

UPLOAD_DIR    <- Sys.getenv("UPLOAD_DIR",  file.path(dirname(getwd()), "data", "uploads"))
RESULTS_DIR   <- Sys.getenv("RESULTS_DIR", file.path(dirname(getwd()), "data", "results"))
APP_URL       <- Sys.getenv("APP_URL",     "http://localhost")
SESSION_LIMIT <- 5L

dir.create(UPLOAD_DIR,  showWarnings = FALSE, recursive = TRUE)
dir.create(RESULTS_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Start 4 mirai parallel daemons at API launch ─────────────────────────────
# Workers persist between requests, ready for parallel contrast execution.
# Each DESeq2 results() call per contrast is dispatched to its own worker.
HAS_MIRAI <- tryCatch({
  library(mirai)
  daemons(4)
  message("[mirai] 4 parallel daemons started")
  TRUE
}, error = function(e) {
  warning("[mirai] not available – running contrasts sequentially: ", e$message)
  FALSE
})

# ── Helpers ───────────────────────────────────────────────────────────────────
.serialize_df <- function(df) {
  lapply(seq_len(nrow(df)), function(i) {
    r <- df[i, ]
    list(
      gene     = r$gene,
      baseMean = round(r$baseMean, 3),
      log2FC   = if (is.na(r$log2FC))  NULL else round(r$log2FC,  4),
      lfcSE    = if (is.na(r$lfcSE))   NULL else round(r$lfcSE,   4),
      stat     = if (is.na(r$stat))    NULL else round(r$stat,    4),
      pvalue   = if (is.na(r$pvalue))  NULL else signif(r$pvalue, 4),
      padj     = if (is.na(r$padj))    NULL else signif(r$padj,   4)
    )
  })
}

.summary_stats <- function(df, alpha = 0.05) {
  sig <- df[!is.na(df$padj) & df$padj < alpha, ]
  up  <- sum(sig$log2FC > 0, na.rm = TRUE)
  list(total = nrow(sig), up = up, down = nrow(sig) - up)
}

.row_to_session <- function(row, i = 1) {
  has_results <- !is.na(row$results_path[i]) && nchar(row$results_path[i]) > 0 && file.exists(row$results_path[i])
  has_data    <- !is.na(row$rds_path[i])     && nchar(row$rds_path[i]) > 0     && file.exists(row$rds_path[i])
  design      <- tryCatch(
    if (!is.na(row$design_json[i]) && nchar(row$design_json[i]) > 0) fromJSON(row$design_json[i]) else NULL,
    error = function(e) NULL
  )
  list(
    sessionId  = row$id[i],
    name       = if (!is.na(row$name[i]) && nchar(row$name[i]) > 0) row$name[i] else paste("Session", i),
    createdAt  = row$created_at[i],
    updatedAt  = row$updated_at[i],
    hasResults = has_results,
    hasData    = has_data,
    design     = design
  )
}

# ── CORS filter ───────────────────────────────────────────────────────────────
#* @filter cors
function(req, res) {
  res$setHeader("Access-Control-Allow-Origin",  "*")
  res$setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res$setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req$REQUEST_METHOD == "OPTIONS") { res$status <- 200; return(list()) }
  plumber::forward()
}

# ── Session: auth ─────────────────────────────────────────────────────────────
#* @post /api/session/auth
#* @serializer unboxedJSON
function(req, res) {
  body  <- fromJSON(rawToChar(req$bodyRaw))
  email <- body$email; pin <- body$pin
  if (is.null(email) || is.null(pin)) stop("email and pin are required")
  if (nchar(pin) < 4 || nchar(pin) > 8) stop("PIN must be 4-8 digits")
  pin_hash <- digest(pin, algo = "sha256")
  rows     <- session_list(email, pin_hash)
  sessions_out <- if (nrow(rows) == 0) list()
                  else lapply(seq_len(nrow(rows)), function(i) .row_to_session(rows, i))
  list(sessions = sessions_out)
}

# ── Session: create ───────────────────────────────────────────────────────────
#* @post /api/session/create
#* @serializer unboxedJSON
function(req, res) {
  body  <- fromJSON(rawToChar(req$bodyRaw))
  email <- body$email; pin <- body$pin; name <- body$name
  if (is.null(email) || is.null(pin)) stop("email and pin are required")
  if (nchar(pin) < 4 || nchar(pin) > 8) stop("PIN must be 4-8 digits")
  pin_hash <- digest(pin, algo = "sha256")
  n <- session_count(email, pin_hash)
  if (n >= SESSION_LIMIT) {
    res$status <- 409
    return(list(
      error        = paste0("Session limit reached (", SESSION_LIMIT, "/", SESSION_LIMIT,
                            "). Please delete an older session first."),
      limitReached = TRUE
    ))
  }
  list(sessionId = session_create(email, pin_hash, name))
}

# ── Session: load by ID (returns full data + results if saved) ────────────────
#* @post /api/session/load
#* @serializer unboxedJSON
function(req, res) {
  body       <- fromJSON(rawToChar(req$bodyRaw))
  email      <- body$email; pin <- body$pin; session_id <- body$sessionId
  if (is.null(email) || is.null(pin)) stop("email and pin are required")
  if (is.null(session_id) || session_id == "") stop("sessionId is required")
  pin_hash <- digest(pin, algo = "sha256")
  row      <- session_load_by_id(session_id, email, pin_hash)
  if (nrow(row) == 0) { res$status <- 401; return(list(error = "Session not found")) }

  has_results <- !is.na(row$results_path[1]) && nchar(row$results_path[1]) > 0 && file.exists(row$results_path[1])
  has_rds     <- !is.na(row$rds_path[1])     && nchar(row$rds_path[1]) > 0     && file.exists(row$rds_path[1])
  design      <- tryCatch(
    if (!is.na(row$design_json[1]) && nchar(row$design_json[1]) > 0) fromJSON(row$design_json[1]) else NULL,
    error = function(e) NULL
  )

  columns <- NULL; levels_out <- NULL; metadata_rows <- NULL
  if (has_rds) tryCatch({
    obj    <- readRDS(row$rds_path[1])
    counts <- as.matrix(obj$counts)
    meta   <- as.data.frame(obj$metadata)
    columns    <- colnames(meta)
    levels_out <- lapply(setNames(columns, columns), function(col) {
      sort(unique(as.character(meta[[col]])))
    })
    samples       <- colnames(counts)
    metadata_rows <- lapply(samples, function(samp) {
      r        <- as.list(as.character(meta[samp, ])); names(r) <- colnames(meta); r$sample <- samp; r
    })
  }, error = function(e) NULL)

  results_out <- NULL
  if (has_results) tryCatch({
    saved <- readRDS(row$results_path[1])
    alpha <- if (!is.null(design$params$alpha)) design$params$alpha else 0.05

    if ("contrasts" %in% names(saved)) {
      # New multi-contrast format
      contrasts_out <- lapply(saved$contrasts, function(ct) {
        list(treatment = ct$treatment,
             reference = if (!is.null(ct$reference)) ct$reference else NULL,
             label     = ct$label,
             results   = .serialize_df(ct$results),
             summary   = .summary_stats(ct$results, alpha))
      })
    } else {
      # Old single-contrast format → wrap in array
      ct_label <- if (!is.null(design$contrast)) paste(design$contrast, "vs", design$reference) else "Contrast 1"
      contrasts_out <- list(list(
        treatment = design$contrast,
        reference = design$reference,
        label     = ct_label,
        results   = .serialize_df(saved$results),
        summary   = .summary_stats(saved$results, alpha)
      ))
    }
    pca_scores <- saved$pca$scores
    cd_out <- if ("count_dist" %in% names(saved)) saved$count_dist else NULL
    results_out <- list(
      contrasts  = contrasts_out,
      pca        = list(
        scores   = lapply(seq_len(nrow(pca_scores)), function(i) as.list(pca_scores[i, ])),
        variance = as.numeric(saved$pca$variance)
      ),
      countDist  = cd_out
    )
  }, error = function(e) NULL)

  ann_map_out <- tryCatch(
    if (!is.na(row$ann_map_json[1]) && nchar(row$ann_map_json[1]) > 0)
      fromJSON(row$ann_map_json[1]) else NULL,
    error = function(e) NULL
  )

  ann_details_out <- tryCatch(
    if (!is.na(row$ann_details_json[1]) && nchar(row$ann_details_json[1]) > 0)
      fromJSON(row$ann_details_json[1]) else NULL,
    error = function(e) NULL
  )

  list(
    sessionId    = row$id[1],
    name         = if (!is.na(row$name[1])) row$name[1] else "Session",
    hasResults   = has_results,
    hasData      = has_rds,
    design       = design,
    columns      = columns,
    levels       = levels_out,
    metadataRows = metadata_rows,
    results      = results_out,
    annMap       = ann_map_out,
    annDetails   = ann_details_out
  )
}

# ── Example data session (no auth required) ────────────────────────────────────
#* @get /api/session/example
#* @serializer unboxedJSON
function(req, res) {
  backend_dir          <- getwd()
  example_data_path    <- file.path(backend_dir, "example_data.rds")
  example_results_src  <- file.path(backend_dir, "example_results.rds")
  example_results_dest <- file.path(RESULTS_DIR, "example_results.rds")
  example_upload_dest  <- file.path(UPLOAD_DIR,  "example.rds")

  if (!file.exists(example_data_path)) {
    res$status <- 404
    return(list(error = "No example data configured. Place example_data.rds in the backend directory."))
  }

  obj <- tryCatch(readRDS(example_data_path),
                  error = function(e) stop("Cannot read example_data.rds: ", e$message))
  if (!is.list(obj) || !("counts" %in% names(obj)) || !("metadata" %in% names(obj)))
    stop("example_data.rds must be a named list with 'counts' and 'metadata'")

  counts <- as.matrix(obj$counts)
  meta   <- as.data.frame(obj$metadata)

  columns    <- colnames(meta)
  levels_out <- lapply(setNames(columns, columns), function(col) sort(unique(as.character(meta[[col]]))))
  samples    <- colnames(counts)
  meta_rows  <- lapply(samples, function(samp) {
    r <- as.list(as.character(meta[samp, ])); names(r) <- colnames(meta); r$sample <- samp; r
  })

  # Always sync example files to data dirs (ensures consistency after server restart)
  file.copy(example_data_path, example_upload_dest, overwrite = TRUE)
  if (file.exists(example_results_src))
    file.copy(example_results_src, example_results_dest, overwrite = TRUE)

  has_results <- file.exists(example_results_dest)
  results_out <- NULL
  design_out  <- NULL

  if (has_results) tryCatch({
    saved  <- readRDS(example_results_dest)
    alpha  <- 0.05
    # column is stored at top-level of results RDS (new format); fall back to first metadata column
    saved_col <- if (!is.null(saved$column) && nchar(saved$column) > 0) saved$column else columns[1]
    if ("contrasts" %in% names(saved)) {
      design_out <- list(
        column    = saved_col,
        contrasts = lapply(saved$contrasts, function(ct)
          list(treatment = ct$treatment, reference = ct$reference))
      )
      contrasts_out <- lapply(saved$contrasts, function(ct)
        list(treatment = ct$treatment, reference = ct$reference, label = ct$label,
             results   = .serialize_df(ct$results),
             summary   = .summary_stats(ct$results, alpha)))
    } else {
      contrasts_out <- list(list(
        treatment = "Treatment", reference = "Control",
        label     = "Treatment vs Control",
        results   = .serialize_df(saved$results),
        summary   = .summary_stats(saved$results, alpha)
      ))
    }
    pca_scores <- saved$pca$scores
    cd_out     <- if ("count_dist" %in% names(saved)) saved$count_dist else NULL
    results_out <- list(
      contrasts = contrasts_out,
      pca       = list(
        scores   = lapply(seq_len(nrow(pca_scores)), function(i) as.list(pca_scores[i, ])),
        variance = as.numeric(saved$pca$variance)
      ),
      countDist = cd_out
    )
  }, error = function(e) message("[example] Results load error: ", e$message))

  list(
    sessionId    = "example",
    isExample    = TRUE,
    geneCount    = nrow(counts),
    sampleCount  = ncol(counts),
    hasData      = TRUE,
    hasResults   = has_results,
    columns      = columns,
    levels       = levels_out,
    metadataRows = meta_rows,
    design       = design_out,
    results      = results_out
  )
}

# ── Session: delete ───────────────────────────────────────────────────────────
#* @post /api/session/delete
#* @serializer unboxedJSON
function(req, res) {
  body       <- fromJSON(rawToChar(req$bodyRaw))
  email      <- body$email; pin <- body$pin; session_id <- body$sessionId
  if (is.null(email) || is.null(pin)) stop("email and pin are required")
  if (is.null(session_id) || session_id == "") stop("sessionId is required")
  pin_hash <- digest(pin, algo = "sha256")
  ok <- session_delete(session_id, email, pin_hash)
  if (!ok) { res$status <- 403; return(list(error = "Session not found or access denied")) }
  list(ok = TRUE)
}

# ── MA Plot: server-side ggmaplot() rendering ────────────────────────────────
#* @post /api/maplot
#* @serializer unboxedJSON
function(req, res) {
  body       <- fromJSON(rawToChar(req$bodyRaw))
  session_id <- body$sessionId
  label      <- body$label          # e.g. "Treatment_B vs ctrl"
  fdr        <- if (!is.null(body$fdr))    as.numeric(body$fdr)    else 0.05
  fc         <- if (!is.null(body$fc))     as.numeric(body$fc)     else 1.5
  top_n      <- if (!is.null(body$topN))   as.integer(body$topN)   else 15L
  pt_size    <- if (!is.null(body$size))   as.numeric(body$size)   else 0.5
  fmt        <- if (!is.null(body$format) && body$format %in% c("pdf", "svg")) body$format else "png"
  out_dpi    <- if (!is.null(body$dlDpi)) as.integer(body$dlDpi) else 100L
  ann_map    <- body$annMap   # named list gene_id -> symbol, or NULL

  if (is.null(session_id) || session_id == "") stop("sessionId is required")

  if (!requireNamespace("ggpubr",   quietly = TRUE)) stop("R package 'ggpubr' is not installed on the server")
  if (!requireNamespace("ggplot2",  quietly = TRUE)) stop("R package 'ggplot2' is not installed on the server")
  if (!requireNamespace("ggrepel", quietly = TRUE))  stop("R package 'ggrepel' is not installed on the server")

  results_path <- file.path(RESULTS_DIR, paste0(session_id, "_results.rds"))
  if (!file.exists(results_path)) stop("Results not found — please run DESeq2 first")

  saved  <- readRDS(results_path)

  # Locate contrast by label (fall back to first)
  res_df <- if ("contrasts" %in% names(saved)) {
    labels <- sapply(saved$contrasts, function(ct) ct$label)
    idx    <- if (!is.null(label) && label %in% labels) which(labels == label)[1] else 1L
    saved$contrasts[[idx]]$results
  } else {
    saved$results
  }
  if (is.null(res_df) || nrow(res_df) == 0) stop("No results found for this contrast")

  # Build data.frame in the format ggmaplot expects
  plot_df <- data.frame(
    baseMean       = as.numeric(res_df$baseMean),
    log2FoldChange = as.numeric(res_df$log2FC),
    padj           = as.numeric(res_df$padj),
    row.names      = res_df$gene,
    stringsAsFactors = FALSE
  )
  plot_df <- plot_df[!is.na(plot_df$baseMean) & is.finite(plot_df$baseMean), ]

  # Remap gene IDs to symbols when annotation map is provided
  if (!is.null(ann_map) && length(ann_map) > 0) {
    ann_vec  <- unlist(ann_map)          # named character vector: gene_id -> symbol
    rn       <- rownames(plot_df)
    idx      <- match(rn, names(ann_vec))
    mask     <- !is.na(idx)
    rn[mask] <- ann_vec[idx[mask]]
    rownames(plot_df) <- make.unique(rn)   # avoid duplicate labels
  }

  library(ggpubr); library(ggplot2)

  ct_label <- if (!is.null(label) && nchar(label) > 0) label else "MA Plot"

  p <- tryCatch(
    ggmaplot(plot_df,
      fdr    = fdr, fc = fc, top = top_n, size = pt_size,
      select.top.method  = "padj",
      palette            = c("#B31B21", "#1465AC", "darkgray"),
      legend             = "top",
      main               = ct_label,
      font.label         = c(10, "bold", "black"),
      label.rectangle    = FALSE,
      ggtheme            = theme_bw(base_size = 13)
    ),
    error = function(e) stop("ggmaplot: ", e$message)
  )

  tmp <- tempfile(fileext = paste0(".", fmt))
  on.exit(unlink(tmp), add = TRUE)
  ggplot2::ggsave(tmp, p, width = 8, height = 10, dpi = out_dpi, bg = "white")

  img_bytes <- readBin(tmp, "raw", file.info(tmp)$size)
  list(image = jsonlite::base64_enc(img_bytes), format = fmt)
}

# ── Session: save (persist edited metadata / sample selection) ────────────────
#* @post /api/session/save
#* @serializer unboxedJSON
function(req, res) {
  body        <- fromJSON(rawToChar(req$bodyRaw))
  email       <- body$email; pin <- body$pin; session_id <- body$sessionId
  keep_samps  <- body$keepSamples
  edited_meta <- body$editedMeta
  ann_map     <- body$annMap      # named list gene_id -> symbol, or NULL
  ann_details <- body$annDetails  # named list gene_id -> { description, biotype, ... }

  if (is.null(email) || is.null(pin)) stop("email and pin are required")
  if (is.null(session_id) || session_id == "") stop("sessionId is required")
  pin_hash <- digest(pin, algo = "sha256")
  row <- session_load_by_id(session_id, email, pin_hash)
  if (nrow(row) == 0) { res$status <- 401; return(list(error = "Session not found")) }

  rds_path <- file.path(UPLOAD_DIR, paste0(session_id, ".rds"))
  if (!file.exists(rds_path)) { res$status <- 404; return(list(error = "Upload not found")) }

  obj    <- readRDS(rds_path)
  counts <- as.matrix(obj$counts)
  meta   <- as.data.frame(obj$metadata)

  # Apply sample filter
  if (!is.null(keep_samps) && length(keep_samps) > 0) {
    valid  <- intersect(keep_samps, colnames(counts))
    counts <- counts[, valid, drop = FALSE]
    meta   <- meta[valid, , drop = FALSE]
  }

  # Apply metadata edits
  if (!is.null(edited_meta) && length(edited_meta) > 0) {
    if (is.data.frame(edited_meta)) {
      for (i in seq_len(nrow(edited_meta))) {
        samp <- as.character(edited_meta$sample[i])
        if (!is.na(samp) && samp %in% rownames(meta))
          for (cn in setdiff(colnames(edited_meta), "sample"))
            if (cn %in% colnames(meta)) meta[samp, cn] <- as.character(edited_meta[i, cn])
      }
    } else {
      for (row_data in edited_meta) {
        samp <- row_data[["sample"]]
        if (!is.null(samp) && samp %in% rownames(meta))
          for (cn in setdiff(names(row_data), "sample"))
            if (cn %in% colnames(meta)) meta[samp, cn] <- as.character(row_data[[cn]])
      }
    }
  }

  saveRDS(list(counts = counts, metadata = meta), rds_path)

  # Persist annotation map and details if provided
  ann_map_json     <- if (!is.null(ann_map)     && length(ann_map)     > 0) toJSON(ann_map,     auto_unbox = TRUE) else NULL
  ann_details_json <- if (!is.null(ann_details) && length(ann_details) > 0) toJSON(ann_details, auto_unbox = TRUE) else NULL
  session_update(session_id, ann_map_json = ann_map_json, ann_details_json = ann_details_json)

  list(ok = TRUE)
}

# ── Parse RDS ─────────────────────────────────────────────────────────────────
#* @post /api/parse
#* @serializer unboxedJSON
function(req, res) {
  session_id <- req$args$sessionId
  if (is.null(session_id) || session_id == "") stop("sessionId query parameter is required")
  body <- tryCatch(fromJSON(rawToChar(req$bodyRaw)), error = function(e) stop("Invalid body: ", e$message))
  if (is.null(body$data) || nchar(body$data) == 0) stop("No file data received")

  raw_bytes <- jsonlite::base64_dec(body$data)
  tmp <- tempfile(fileext = ".rds"); on.exit(unlink(tmp), add = TRUE)
  writeBin(raw_bytes, tmp)

  obj <- tryCatch(readRDS(tmp), error = function(e) stop("Cannot read RDS: ", e$message))
  if (!is.list(obj))                  stop("RDS must be a named list")
  if (!("counts"   %in% names(obj)))  stop("Missing 'counts' element")
  if (!("metadata" %in% names(obj)))  stop("Missing 'metadata' element")

  counts <- as.matrix(obj$counts); meta <- as.data.frame(obj$metadata)
  if (!is.numeric(counts))            stop("counts must be numeric")
  if (nrow(meta) != ncol(counts))     stop("metadata rows must match counts columns")

  dest <- file.path(UPLOAD_DIR, paste0(session_id, ".rds"))
  file.copy(tmp, dest, overwrite = TRUE)
  session_update(session_id, rds_path = dest)

  columns    <- colnames(meta)
  levels_out <- lapply(setNames(columns, columns), function(col) sort(unique(as.character(meta[[col]]))))
  samples    <- colnames(counts)
  meta_rows  <- lapply(samples, function(samp) {
    r <- as.list(as.character(meta[samp, ])); names(r) <- colnames(meta); r$sample <- samp; r
  })

  list(geneCount = nrow(counts), sampleCount = ncol(counts),
       columns = columns, levels = levels_out, metadataRows = meta_rows)
}

# ── Run DESeq2 (parallel contrasts via mirai) ─────────────────────────────────
#* @post /api/deseq2
#* @serializer unboxedJSON
function(req, res) {
  body        <- fromJSON(rawToChar(req$bodyRaw))
  session_id  <- body$sessionId
  column      <- body$column
  notify      <- isTRUE(body$notify)
  keep_samps  <- body$keepSamples
  edited_meta <- body$editedMeta

  # ── Parse contrasts — two accepted formats ──────────────────────────────────
  # New pairwise: { contrasts: [{treatment:"A", reference:"ctrl"}, ...] }
  # Old shared:   { reference:"ctrl", contrasts: ["A","B"] }
  raw_contrasts <- body$contrasts
  if (is.null(raw_contrasts) && !is.null(body$contrast))
    raw_contrasts <- list(body$contrast)                      # very old single string
  if (is.null(raw_contrasts) || length(raw_contrasts) == 0)
    stop("contrasts is required")

  # fromJSON auto-simplifies [{treatment,reference},…] → data.frame; handle all cases
  contrasts_list <- if (is.data.frame(raw_contrasts)) {
    # Pairwise array auto-simplified to data frame by fromJSON
    lapply(seq_len(nrow(raw_contrasts)), function(i)
      list(treatment = as.character(raw_contrasts$treatment[i]),
           reference = as.character(raw_contrasts$reference[i])))
  } else if (is.list(raw_contrasts) && length(raw_contrasts) > 0 &&
             is.list(raw_contrasts[[1]])) {
    # Pairwise array kept as list-of-lists
    lapply(raw_contrasts, function(ct)
      list(treatment = as.character(ct$treatment),
           reference = as.character(ct$reference)))
  } else {
    # Old string array with shared reference
    shared_ref <- if (!is.null(body$reference)) as.character(body$reference)
                  else stop("reference is required")
    lapply(as.character(raw_contrasts), function(t)
      list(treatment = t, reference = shared_ref))
  }

  # DESeq2 parameters (with defaults)
  p          <- body$params
  alpha      <- if (!is.null(p$alpha))               as.numeric(p$alpha)            else 0.05
  lfc_thresh <- if (!is.null(p$lfcThreshold))        as.numeric(p$lfcThreshold)     else 0
  min_count  <- if (!is.null(p$minCount))            as.integer(p$minCount)         else 1L
  min_samp   <- if (!is.null(p$minSamples))          as.integer(p$minSamples)       else 2L
  fit_type   <- if (!is.null(p$fitType))             as.character(p$fitType)        else "parametric"
  ind_filt   <- if (!is.null(p$independentFiltering)) isTRUE(p$independentFiltering) else TRUE
  cooks_cut  <- if (!is.null(p$cooksCutoff))         isTRUE(p$cooksCutoff)          else TRUE

  if (is.null(session_id) || is.null(column)) stop("sessionId and column are required")

  rds_path <- file.path(UPLOAD_DIR, paste0(session_id, ".rds"))
  if (!file.exists(rds_path)) stop("Upload not found — please re-upload your RDS")

  library(DESeq2)
  library(matrixStats)

  obj    <- readRDS(rds_path)
  counts <- round(as.matrix(obj$counts))
  meta   <- as.data.frame(obj$metadata)

  # ── Sample filter ──
  if (!is.null(keep_samps) && length(keep_samps) > 0) {
    valid  <- intersect(keep_samps, colnames(counts))
    counts <- counts[, valid, drop = FALSE]
    meta   <- meta[valid, , drop = FALSE]
  }

  # ── Apply edited metadata ──
  if (!is.null(edited_meta) && length(edited_meta) > 0) {
    if (is.data.frame(edited_meta)) {
      for (i in seq_len(nrow(edited_meta))) {
        samp <- as.character(edited_meta$sample[i])
        if (!is.na(samp) && samp %in% rownames(meta))
          for (cn in setdiff(colnames(edited_meta), "sample"))
            if (cn %in% colnames(meta)) meta[samp, cn] <- as.character(edited_meta[i, cn])
      }
    } else {
      for (row in edited_meta) {
        samp <- row[["sample"]]
        if (!is.null(samp) && samp %in% rownames(meta))
          for (cn in setdiff(names(row), "sample"))
            if (cn %in% colnames(meta)) meta[samp, cn] <- as.character(row[[cn]])
      }
    }
  }

  if (!(column %in% colnames(meta))) stop("Column '", column, "' not found in metadata")

  # Use first contrast's reference for DESeq model fitting
  fit_ref <- contrasts_list[[1]]$reference
  meta[[column]] <- relevel(factor(meta[[column]]), ref = fit_ref)

  dds <- DESeqDataSetFromMatrix(
    countData = counts, colData = meta,
    design    = as.formula(paste("~", column))
  )
  dds <- dds[rowSums(counts(dds) >= min_count) >= min_samp, ]
  dds <- DESeq(dds, fitType = fit_type, quiet = TRUE)

  # ── Per-contrast results() — each contrast has its own treatment + reference ──
  run_one_contrast <- function(ct) {
    res_obj <- results(dds,
      contrast             = c(column, ct$treatment, ct$reference),
      alpha                = alpha,
      lfcThreshold         = lfc_thresh,
      independentFiltering = ind_filt,
      cooksCutoff          = cooks_cut
    )
    res_df         <- as.data.frame(res_obj)
    res_df$gene    <- rownames(res_df)
    names(res_df)[names(res_df) == "log2FoldChange"] <- "log2FC"
    res_df[order(res_df$padj, na.last = TRUE), ]
  }

  if (HAS_MIRAI && length(contrasts_list) > 1) {
    jobs <- lapply(contrasts_list, function(ct) {
      mirai({
        library(DESeq2)
        res_obj <- results(dds,
          contrast             = c(column, ct$treatment, ct$reference),
          alpha                = alpha,
          lfcThreshold         = lfc_thresh,
          independentFiltering = ind_filt,
          cooksCutoff          = cooks_cut
        )
        res_df         <- as.data.frame(res_obj)
        res_df$gene    <- rownames(res_df)
        names(res_df)[names(res_df) == "log2FoldChange"] <- "log2FC"
        res_df[order(res_df$padj, na.last = TRUE), ]
      }, dds = dds, column = column, ct = ct,
         alpha = alpha, lfc_thresh = lfc_thresh,
         ind_filt = ind_filt, cooks_cut = cooks_cut)
    })
    result_dfs <- lapply(seq_along(jobs), function(i) {
      r <- jobs[[i]][]
      if (inherits(r, "miraiError")) {
        warning("mirai worker failed for contrast ", i, ": ", as.character(r), " — sequential fallback")
        run_one_contrast(contrasts_list[[i]])
      } else r
    })
  } else {
    result_dfs <- lapply(contrasts_list, run_one_contrast)
  }

  # ── PCA using varianceStabilizingTransformation() — up to 10 PCs ─────────────
  vsd     <- varianceStabilizingTransformation(dds, blind = FALSE)
  vst_mat <- assay(vsd)
  rv      <- rowVars(vst_mat)
  top500  <- vst_mat[order(rv, decreasing = TRUE)[seq_len(min(500, nrow(vst_mat)))], ]
  pca_obj <- prcomp(t(top500), scale. = FALSE)
  n_pc    <- min(10, ncol(pca_obj$x))
  scores  <- as.data.frame(pca_obj$x[, 1:n_pc, drop = FALSE])
  scores$sample <- rownames(scores)
  for (col in colnames(meta)) scores[[col]] <- as.character(meta[scores$sample, col])
  variance <- summary(pca_obj)$importance["Proportion of Variance", 1:n_pc] * 100
  pca_list <- list(
    scores   = lapply(seq_len(nrow(scores)), function(i) as.list(scores[i, ])),
    variance = as.numeric(variance)
  )

  # ── Count distributions for violin plots (sampled genes for performance) ───────
  samp_cond <- setNames(as.character(meta[[column]]), rownames(meta))
  dist_idx  <- sample(nrow(vst_mat), min(3000, nrow(vst_mat)))
  raw_log2  <- log2(counts(dds)[dist_idx, , drop = FALSE] + 1)
  vst_sub   <- vst_mat[dist_idx, , drop = FALSE]
  make_dist <- function(mat) {
    lapply(colnames(mat), function(s)
      list(sample    = s,
           condition = if (s %in% names(samp_cond)) samp_cond[[s]] else "Unknown",
           values    = as.numeric(mat[, s])))
  }
  count_dist <- list(raw = make_dist(raw_log2), vst = make_dist(vst_sub))

  # ── Build output for newly computed contrasts ──────────────────────────────────
  contrasts_out <- lapply(seq_along(contrasts_list), function(i) {
    ct <- contrasts_list[[i]]; df <- result_dfs[[i]]
    list(treatment = ct$treatment,
         reference = ct$reference,
         label     = paste(ct$treatment, "vs", ct$reference),
         results   = .serialize_df(df),
         summary   = .summary_stats(df, alpha))
  })

  # ── Persist: load existing saved contrasts, merge (new replaces same label) ──
  results_path <- file.path(RESULTS_DIR, paste0(session_id, "_results.rds"))
  old_saved <- if (file.exists(results_path)) {
    tryCatch({
      s <- readRDS(results_path)
      if ("contrasts" %in% names(s)) s$contrasts else list()
    }, error = function(e) list())
  } else list()

  new_labels <- sapply(contrasts_list, function(ct) paste(ct$treatment, "vs", ct$reference))
  old_kept   <- Filter(function(oc) !(oc$label %in% new_labels), old_saved)
  new_saved  <- lapply(seq_along(contrasts_list), function(i) {
    ct <- contrasts_list[[i]]
    list(treatment = ct$treatment, reference = ct$reference,
         label     = paste(ct$treatment, "vs", ct$reference),
         results   = result_dfs[[i]])
  })
  norm_mat <- counts(dds, normalized = TRUE)

  saveRDS(list(contrasts   = c(old_kept, new_saved),
               pca         = list(scores = scores, variance = variance),
               count_dist  = count_dist,
               column      = column,
               vst_matrix  = vst_mat,
               norm_matrix = norm_mat),
          results_path)

  design_json <- toJSON(list(
    column    = column,
    contrasts = lapply(contrasts_list, function(ct)
                  list(treatment = ct$treatment, reference = ct$reference)),
    params    = list(alpha = alpha, lfcThreshold = lfc_thresh,
                     minCount = min_count, minSamples = min_samp,
                     fitType = fit_type, independentFiltering = ind_filt,
                     cooksCutoff = cooks_cut)
  ), auto_unbox = TRUE)
  session_update(session_id, design_json = design_json, results_path = results_path)

  # ── Email notification ──
  if (notify) {
    sig_rows  <- result_dfs[[1]][!is.na(result_dfs[[1]]$padj) & result_dfs[[1]]$padj < alpha, ]
    sig_count <- nrow(sig_rows); up_count <- sum(sig_rows$log2FC > 0, na.rm = TRUE)
    top_genes <- lapply(seq_len(min(10, nrow(sig_rows))), function(i)
      list(gene = sig_rows$gene[i], log2FC = sig_rows$log2FC[i], padj = sig_rows$padj[i]))
    con <- get_db()
    email_addr <- dbGetQuery(con, "SELECT email FROM sessions WHERE id=?", list(session_id))$email
    dbDisconnect(con)
    ct_summary <- paste(sapply(contrasts_list, function(ct)
                    paste(ct$treatment, "vs", ct$reference)), collapse = ", ")
    send_results_email(
      to_email   = email_addr,
      design     = list(contrast = ct_summary),
      sig_count  = sig_count, up_count = up_count, dn_count = sig_count - up_count,
      top_genes  = top_genes, session_id = session_id, app_url = APP_URL
    )
  }

  list(contrasts = contrasts_out, pca = pca_list, countDist = count_dist)
}

# ── Gene violin plot: single-gene counts across groups with Wilcox test ───────
#* @post /api/geneplot
#* @serializer unboxedJSON
function(req, res) {
  body       <- fromJSON(rawToChar(req$bodyRaw))
  session_id <- body$sessionId
  gene       <- body$gene
  symbol     <- body$symbol     # gene symbol (optional; used for plot title when annotation is applied)
  label      <- body$label      # contrast label e.g. "TreatB vs ctrl"
  treatment  <- body$treatment
  reference  <- body$reference
  column     <- body$column     # metadata column (optional; inferred if omitted)

  if (is.null(session_id) || session_id == "") stop("sessionId is required")
  if (is.null(gene) || gene == "")             stop("gene is required")

  if (!requireNamespace("ggpubr",  quietly = TRUE)) stop("R package 'ggpubr' is not installed")
  if (!requireNamespace("ggplot2", quietly = TRUE)) stop("R package 'ggplot2' is not installed")

  # Load raw counts + metadata from upload RDS
  rds_path <- file.path(UPLOAD_DIR, paste0(session_id, ".rds"))
  if (!file.exists(rds_path)) stop("Upload not found — please re-upload your data")
  obj    <- readRDS(rds_path)
  counts <- as.matrix(obj$counts)
  meta   <- as.data.frame(obj$metadata)

  if (!gene %in% rownames(counts))
    stop(paste0("Gene '", gene, "' not found in count matrix"))

  # Priority 1: explicitly passed column (covers example sessions and direct calls)
  group_col <- if (!is.null(column) && nchar(column) > 0 && column %in% colnames(meta)) column else NULL

  # Priority 2: read from results RDS (column saved since latest format)
  if (is.null(group_col)) tryCatch({
    results_path <- file.path(RESULTS_DIR, paste0(session_id, "_results.rds"))
    if (file.exists(results_path)) {
      sv <- readRDS(results_path)
      if (!is.null(sv$column) && nchar(sv$column) > 0 && sv$column %in% colnames(meta))
        group_col <- sv$column
    }
  }, error = function(e) NULL)

  # Priority 3: session DB design_json
  if (is.null(group_col)) tryCatch({
    con        <- get_db()
    design_row <- dbGetQuery(con, "SELECT design_json FROM sessions WHERE id = ?", list(session_id))
    dbDisconnect(con)
    if (nrow(design_row) > 0 && !is.na(design_row$design_json[1]) && nchar(design_row$design_json[1]) > 0) {
      dj <- fromJSON(design_row$design_json[1])
      if (!is.null(dj$column) && nchar(dj$column) > 0 && dj$column %in% colnames(meta))
        group_col <- dj$column
    }
  }, error = function(e) NULL)

  # Priority 4: infer by scanning metadata for a column containing both groups
  if (is.null(group_col)) {
    for (cn in colnames(meta)) {
      vals <- unique(as.character(meta[[cn]]))
      if (!is.null(treatment) && !is.null(reference) &&
          treatment %in% vals && reference %in% vals) { group_col <- cn; break }
    }
  }
  if (is.null(group_col))
    stop("Cannot identify group column — please ensure treatment/reference labels match your metadata")

  # Subset to only the two groups being compared
  groups_of_interest <- c(reference, treatment)
  keep <- rownames(meta)[as.character(meta[[group_col]]) %in% groups_of_interest]
  if (length(keep) < 2) stop("Not enough samples found for these groups")

  # Build data frame: log2(counts + 1) expression
  gene_counts <- as.numeric(counts[gene, keep])
  df <- data.frame(
    sample = keep,
    group  = factor(as.character(meta[keep, group_col]),
                    levels = c(reference, treatment)),
    expr   = log2(gene_counts + 1),
    stringsAsFactors = FALSE
  )

  library(ggpubr); library(ggplot2)

  my_comparisons <- list(c(reference, treatment))
  ct_label <- if (!is.null(label) && nchar(label) > 0) label else
              paste(treatment, "vs", reference)

  y_max <- max(df$expr, na.rm = TRUE)

  p <- ggviolin(df, x = "group", y = "expr", fill = "group",
                palette    = c("#1465AC", "#B31B21"),
                add        = "boxplot",
                add.params = list(fill = "white", width = 0.15),
                ylab       = "log2(counts + 1)",
                xlab       = "") +
    labs(title = if (!is.null(symbol) && nchar(trimws(symbol)) > 0) symbol else gene,
         subtitle = if (!is.null(symbol) && nchar(trimws(symbol)) > 0) paste0(gene, "  ·  ", ct_label) else ct_label) +
    stat_compare_means(
      comparisons = my_comparisons,
      method      = "wilcox.test",
      label       = "p.signif",
      size        = 5
    ) +
    stat_compare_means(
      method  = "wilcox.test",
      label.y = y_max * 1.3,
      size    = 3.5
    ) +
    theme_bw(base_size = 13) +
    theme(
      legend.position = "none",
      plot.title      = element_text(face = "bold", hjust = 0.5, size = 15),
      plot.subtitle   = element_text(hjust = 0.5, color = "grey50", size = 10)
    )

  tmp <- tempfile(fileext = ".png")
  on.exit(unlink(tmp), add = TRUE)
  ggplot2::ggsave(tmp, p, width = 5, height = 6, dpi = 140, bg = "white")

  img_bytes <- readBin(tmp, "raw", file.info(tmp)$size)
  list(image = jsonlite::base64_enc(img_bytes))
}

# ── UpSet plot: DEG overlap across contrasts ──────────────────────────────────
#* @post /api/upset
#* @serializer unboxedJSON
function(req, res) {
  body       <- fromJSON(rawToChar(req$bodyRaw))
  session_id <- body$sessionId
  fdr        <- if (!is.null(body$fdr))   as.numeric(body$fdr)   else 0.05
  min_lfc    <- if (!is.null(body$minLfc)) as.numeric(body$minLfc) else 0

  if (is.null(session_id) || session_id == "") stop("sessionId is required")

  results_path <- file.path(RESULTS_DIR, paste0(session_id, "_results.rds"))
  if (!file.exists(results_path)) stop("No results found for this session")
  saved <- readRDS(results_path)
  if (length(saved$contrasts) < 2) stop("Need at least 2 contrasts for UpSet plot")

  if (!requireNamespace("UpSetR", quietly = TRUE)) stop("R package 'UpSetR' is not installed")

  deg_lists <- lapply(saved$contrasts, function(ct) {
    df  <- ct$results
    sig <- df[!is.na(df$padj) & df$padj < fdr & !is.na(df$log2FC) & abs(df$log2FC) >= min_lfc, ]
    sig$gene
  })
  names(deg_lists) <- sapply(saved$contrasts, function(ct) ct$label)

  # Remove empty sets
  deg_lists <- deg_lists[sapply(deg_lists, length) > 0]
  if (length(deg_lists) < 2) stop("Fewer than 2 contrasts have significant DEGs at this threshold")

  m <- UpSetR::fromList(deg_lists)

  tmp <- tempfile(fileext = ".png")
  on.exit(unlink(tmp), add = TRUE)

  png(tmp, width = 900, height = 520, res = 130, bg = "white")
  print(UpSetR::upset(
    m,
    order.by        = "freq",
    sets.bar.color  = "#0e7490",
    main.bar.color  = "#0891b2",
    matrix.color    = "#0e7490",
    text.scale      = c(1.3, 1.1, 1.0, 1.0, 1.2, 1.0),
    point.size      = 3,
    line.size       = 0.8
  ))
  dev.off()

  img_bytes <- readBin(tmp, "raw", file.info(tmp)$size)
  list(image = jsonlite::base64_enc(img_bytes))
}

# ── Heatmap: log2FC or VST counts heatmap via heatmaply ──────────────────────
#* @post /api/heatmap
#* @serializer unboxedJSON
function(req, res) {
  body        <- fromJSON(rawToChar(req$bodyRaw))
  session_id  <- body$sessionId
  fdr         <- if (!is.null(body$fdr))        as.numeric(body$fdr)        else 0.05
  top_n       <- if (!is.null(body$topN))       as.integer(body$topN)       else 50L
  mode        <- if (!is.null(body$mode))       body$mode                   else "vst"
  cluster_rows <- if (!is.null(body$clusterRows)) isTRUE(body$clusterRows)  else TRUE
  cluster_cols <- if (!is.null(body$clusterCols)) isTRUE(body$clusterCols)  else TRUE
  dist_method  <- if (!is.null(body$distMethod)) body$distMethod            else "pearson"
  color_by     <- if (!is.null(body$colorBy) && nchar(body$colorBy) > 0) body$colorBy else NULL
  # geneSet: "union" | "intersection" | a contrast label string
  gene_set     <- if (!is.null(body$geneSet) && nchar(body$geneSet) > 0) body$geneSet else "union"

  if (is.null(session_id) || session_id == "") stop("sessionId is required")

  results_path <- file.path(RESULTS_DIR, paste0(session_id, "_results.rds"))
  if (!file.exists(results_path)) stop("No results found for this session")
  saved <- readRDS(results_path)
  if (length(saved$contrasts) < 1) stop("No contrasts found")

  if (!requireNamespace("heatmaply", quietly = TRUE)) stop("R package 'heatmaply' is not installed")
  if (!requireNamespace("ggplot2",   quietly = TRUE)) stop("R package 'ggplot2' is not installed")

  # ── Distance function factory ────────────────────────────────────────────────
  make_distfun <- function(method) {
    if (method %in% c("pearson", "spearman", "kendall")) {
      function(x) as.dist(1 - cor(t(x), method = method, use = "pairwise.complete.obs"))
    } else {
      function(x) dist(x, method = method)
    }
  }
  # heatmaply: NA disables dendrogram entirely; TRUE enables with clustering
  rowv_arg <- if (cluster_rows) TRUE else NA
  colv_arg <- if (cluster_cols) TRUE else NA

  # ── Gene selection helper (shared by both modes) ────────────────────────────
  sig_per_contrast <- lapply(saved$contrasts, function(ct) {
    df <- ct$results
    df$gene[!is.na(df$padj) & df$padj < fdr]
  })
  names(sig_per_contrast) <- sapply(saved$contrasts, function(ct) ct$label)

  all_sig <- if (gene_set == "union") {
    unique(unlist(sig_per_contrast))
  } else if (gene_set == "intersection") {
    if (length(sig_per_contrast) == 1) sig_per_contrast[[1]]
    else Reduce(intersect, sig_per_contrast)
  } else {
    # individual contrast label
    matched <- sig_per_contrast[[gene_set]]
    if (is.null(matched)) unique(unlist(sig_per_contrast)) else matched
  }

  if (length(all_sig) == 0) stop(paste0("No significant DEGs found for gene set '", gene_set, "' at FDR < ", fdr))

  if (mode == "lfc") {
    # ── Mode: log2FC across contrasts ──────────────────────────────────────────

    lfc_mat <- do.call(cbind, lapply(saved$contrasts, function(ct) {
      df <- ct$results; rownames(df) <- df$gene
      v  <- df[all_sig, "log2FC"]; v[is.na(v)] <- 0; v
    }))
    colnames(lfc_mat) <- sapply(saved$contrasts, function(ct) ct$label)
    rownames(lfc_mat) <- all_sig
    if (nrow(lfc_mat) > top_n) {
      row_abs <- rowMeans(abs(lfc_mat))
      lfc_mat <- lfc_mat[order(row_abs, decreasing = TRUE)[1:top_n], , drop = FALSE]
    }
    mat_plot <- lfc_mat

    fig <- heatmaply::heatmaply(
      mat_plot,
      Rowv              = rowv_arg,
      Colv              = colv_arg,
      distfun           = make_distfun(dist_method),
      scale             = "none",
      colors            = grDevices::colorRampPalette(c("#1565C0", "white", "#B71C1C"))(256),
      xlab              = "Contrast",
      ylab              = "Gene",
      main              = paste0("log2FC heatmap (FDR < ", fdr, ", top ", nrow(mat_plot), " genes)"),
      showticklabels    = c(TRUE, nrow(mat_plot) <= 60),
      plot_method       = "plotly",
      key.title         = "log2FC"
    )

  } else {
    # ── Mode: normalized counts (Z-scored, log2+1 transformed) ────────────────
    expr_mat <- if (!is.null(saved$norm_matrix)) saved$norm_matrix else saved$vst_matrix
    if (is.null(expr_mat)) stop("Normalized count matrix not found — please re-run the analysis")
    if (!is.null(saved$norm_matrix)) expr_mat <- log2(expr_mat + 1)

    all_sig <- all_sig[all_sig %in% rownames(expr_mat)]
    if (length(all_sig) == 0) stop(paste0("No genes from gene set '", gene_set, "' found in expression matrix"))

    sub_mat <- expr_mat[all_sig, , drop = FALSE]
    if (nrow(sub_mat) > top_n) {
      rv      <- apply(sub_mat, 1, var)
      sub_mat <- sub_mat[order(rv, decreasing = TRUE)[1:top_n], , drop = FALSE]
    }
    mat_scaled <- t(scale(t(sub_mat)))
    mat_scaled[!is.finite(mat_scaled)] <- 0

    # ── Column annotation — use colorBy if provided, else default group column ─
    col_annotation <- NULL
    ann_col <- if (!is.null(color_by)) color_by else saved$column
    if (!is.null(ann_col)) {
      rds_path <- file.path(UPLOAD_DIR, paste0(session_id, ".rds"))
      if (file.exists(rds_path)) {
        tryCatch({
          obj  <- readRDS(rds_path)
          meta <- as.data.frame(obj$metadata)
          samp_in_mat <- colnames(mat_scaled)
          if (ann_col %in% colnames(meta)) {
            grp_vec <- meta[samp_in_mat, ann_col]
            col_annotation <- data.frame(setNames(list(grp_vec), ann_col), row.names = samp_in_mat)
          }
        }, error = function(e) NULL)
      }
    }

    # ── Annotation bar colour palette ─────────────────────────────────────────
    ann_palette <- c("#800020", "#228B22", "#C9A227", "#555555",
                     "#4E6E8E", "#A0522D", "#BF5700", "#4B0082")
    col_side_palette_fn <- grDevices::colorRampPalette(ann_palette)

    fig <- heatmaply::heatmaply(
      mat_scaled,
      col_side_colors       = col_annotation,
      col_side_palette      = col_side_palette_fn,
      col_side_colors_size  = 0.3,
      Rowv                  = rowv_arg,
      Colv                  = colv_arg,
      distfun               = make_distfun(dist_method),
      scale                 = "none",
      colors                = grDevices::colorRampPalette(c("#1565C0", "white", "#B71C1C"))(256),
      xlab                  = "Sample",
      ylab                  = "Gene",
      main                  = paste0("Normalized counts Z-score (FDR < ", fdr, ", top ", nrow(mat_scaled), " genes)"),
      showticklabels        = c(TRUE, nrow(mat_scaled) <= 60),
      plot_method           = "plotly",
      key.title             = "Z-score"
    )
  }

  # Return available metadata columns alongside the plot (for frontend colorBy picker)
  meta_cols <- tryCatch({
    rds_path <- file.path(UPLOAD_DIR, paste0(session_id, ".rds"))
    obj <- readRDS(rds_path)
    colnames(as.data.frame(obj$metadata))
  }, error = function(e) character(0))

  fig_json <- plotly::plotly_json(fig, jsoneol = FALSE)
  list(plotlyJson = fig_json, metaCols = meta_cols)
}

# ── Multi-group violin: all groups, KW + pairwise Wilcoxon, VST counts ───────
#* @post /api/geneplot/compare
#* @serializer unboxedJSON
function(req, res) {
  body       <- fromJSON(rawToChar(req$bodyRaw))
  session_id <- body$sessionId
  gene       <- body$gene
  symbol     <- body$symbol

  if (is.null(session_id) || session_id == "") stop("sessionId is required")
  if (is.null(gene) || gene == "")             stop("gene is required")

  if (!requireNamespace("ggpubr",  quietly = TRUE)) stop("R package 'ggpubr' is not installed")
  if (!requireNamespace("ggplot2", quietly = TRUE)) stop("R package 'ggplot2' is not installed")

  results_path <- file.path(RESULTS_DIR, paste0(session_id, "_results.rds"))
  if (!file.exists(results_path)) stop("No results found for this session")
  saved <- readRDS(results_path)

  # Use norm_matrix if available, fall back to vst_matrix for older results
  expr_mat <- if (!is.null(saved$norm_matrix)) saved$norm_matrix else saved$vst_matrix
  expr_label <- if (!is.null(saved$norm_matrix)) "normalized counts" else "VST counts"
  if (is.null(expr_mat)) stop("Normalized count matrix not found — please re-run the analysis to enable this feature")
  if (!gene %in% rownames(expr_mat)) stop(paste0("Gene '", gene, "' not found in results"))

  # Load metadata
  rds_path <- file.path(UPLOAD_DIR, paste0(session_id, ".rds"))
  if (!file.exists(rds_path)) stop("Upload not found — please re-upload your data")
  obj  <- readRDS(rds_path)
  meta <- as.data.frame(obj$metadata)

  group_col <- saved$column
  if (is.null(group_col) || !group_col %in% colnames(meta))
    stop("Cannot identify group column")

  # Align samples
  samp <- intersect(colnames(expr_mat), rownames(meta))
  if (length(samp) < 2) stop("Not enough samples")

  gene_expr <- as.numeric(expr_mat[gene, samp])
  groups    <- factor(as.character(meta[samp, group_col]))

  df <- data.frame(sample = samp, group = groups, expr = gene_expr, stringsAsFactors = FALSE)

  library(ggpubr); library(ggplot2)

  all_groups      <- levels(groups)
  all_comparisons <- combn(all_groups, 2, simplify = FALSE)

  # Color palette — up to 8 groups
  palette_colors <- c("#1565C0","#B71C1C","#2E7D32","#F57F17","#6A1B9A","#00838F","#D84315","#558B2F")
  pal <- palette_colors[seq_along(all_groups)]

  title_str    <- if (!is.null(symbol) && nchar(trimws(symbol)) > 0) symbol else gene
  subtitle_str <- if (!is.null(symbol) && nchar(trimws(symbol)) > 0) paste0(gene, "  ·  all groups  ·  ", expr_label) else paste0("all groups  ·  ", expr_label)

  y_max <- max(df$expr, na.rm = TRUE)

  p <- ggviolin(df, x = "group", y = "expr", fill = "group",
                palette    = pal,
                add        = "boxplot",
                add.params = list(fill = "white", width = 0.12),
                ylab       = expr_label,
                xlab       = "") +
    labs(title    = title_str,
         subtitle = subtitle_str) +
    stat_compare_means(
      method  = "kruskal.test",
      label.y = y_max * 1.35,
      size    = 3.5
    ) +
    stat_compare_means(
      comparisons = all_comparisons,
      method      = "wilcox.test",
      label       = "p.signif",
      size        = 4,
      hide.ns     = TRUE
    ) +
    theme_bw(base_size = 12) +
    theme(
      legend.position = "none",
      plot.title      = element_text(face = "bold", hjust = 0.5, size = 14),
      plot.subtitle   = element_text(hjust = 0.5, color = "grey50", size = 9),
      axis.text.x     = element_text(angle = if (length(all_groups) > 4) 30 else 0, hjust = 1)
    )

  tmp <- tempfile(fileext = ".png")
  on.exit(unlink(tmp), add = TRUE)
  ggplot2::ggsave(tmp, p, width = max(5, length(all_groups) * 1.4), height = 6.5, dpi = 140, bg = "white")

  img_bytes <- readBin(tmp, "raw", file.info(tmp)$size)
  list(image = jsonlite::base64_enc(img_bytes))
}

# ── BioMart annotation ─────────────────────────────────────────────────────────

.build_biomart_xml <- function(dataset, filter_values, attrs) {
  attr_lines <- paste(paste0('        <Attribute name="', attrs, '"/>'), collapse = "\n")
  paste0(
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE Query>',
    '<Query virtualSchemaName="default" formatter="TSV" header="1" uniqueRows="1" count="" datasetConfigVersion="0.6">',
    '  <Dataset name="', dataset, '" interface="default">',
    '    <Filter name="ensembl_gene_id" value="', filter_values, '"/>',
    "\n", attr_lines, "\n",
    '  </Dataset>',
    '</Query>'
  )
}

.query_biomart <- function(xml_query) {
  resp <- tryCatch(
    httr::POST(
      "https://www.ensembl.org/biomart/martservice",
      body   = list(query = xml_query),
      encode = "form",
      httr::timeout(120)
    ),
    error = function(e) { message("[BioMart] request error: ", e$message); NULL }
  )
  if (is.null(resp)) return(NULL)
  if (httr::status_code(resp) != 200) {
    message("[BioMart] HTTP ", httr::status_code(resp))
    return(NULL)
  }
  txt <- httr::content(resp, "text", encoding = "UTF-8")
  if (grepl("^ERROR", trimws(txt))) { message("[BioMart] error: ", substr(txt, 1, 200)); return(NULL) }
  txt
}

.parse_biomart_tsv <- function(txt) {
  if (is.null(txt) || nchar(trimws(txt)) == 0) return(NULL)
  tryCatch({
    con <- textConnection(txt)
    on.exit(close(con))
    read.table(con, header = TRUE, sep = "\t", quote = "", fill = TRUE,
               na.strings = c("", "NA"), check.names = FALSE, stringsAsFactors = FALSE)
  }, error = function(e) { message("[BioMart] parse error: ", e$message); NULL })
}

#* Annotate Ensembl gene IDs.
#* Phase 1 — Ensembl REST API POST /lookup/id  (primary; structured JSON, no TSV parsing)
#* Phase 2 — BioMart fallback if REST returns < 5% of genes
#* Phase 3 — optional 1:1 human orthologs via BioMart (bulk-friendly)
#*
#* @post /api/annotate/biomart
#* @parser json
function(req, res) {
  body           <- req$body
  gene_ids       <- body$gene_ids
  organism       <- if (!is.null(body$organism) && nchar(body$organism) > 0) body$organism else "hsapiens"
  want_orthologs <- isTRUE(body$want_orthologs) && organism != "hsapiens"

  if (!is.character(gene_ids) || length(gene_ids) == 0) {
    res$status <- 400
    return(list(error = "gene_ids is required and must be a non-empty array"))
  }

  # Safe string extractor: returns a plain unnamed character or NULL.
  # Using [[1]] drops R row-names so jsonlite does NOT serialise the value as
  # a JSON object {"rowname":"value"} (which would appear as "[object Object]").
  .safe_str <- function(x) {
    if (is.null(x) || length(x) == 0) return(NULL)
    s <- trimws(as.character(x[[1]]))
    if (length(s) == 0 || is.na(s) || s %in% c("", "NA", "N/A", "None")) return(NULL)
    s
  }

  # ── Phase 1: Ensembl REST API POST /lookup/id ────────────────────────────
  # Returns structured JSON — no TSV parsing, no column-order ambiguity.
  # Batch max = 1000 per call.
  REST_URL <- "https://rest.ensembl.org/lookup/id"
  BATCH_R  <- 1000L
  base_map <- list()

  rest_batches <- split(gene_ids, ceiling(seq_along(gene_ids) / BATCH_R))
  for (batch in rest_batches) {
    # Build body as a plain string — avoids jsonlite auto_unbox pitfalls
    # (length-1 char vector unboxed to scalar → {"ids":"ENSG..."} instead of array).
    body_json <- paste0('{"ids":[', paste0('"', batch, '"', collapse = ","), ']}')

    resp <- tryCatch(
      httr::POST(REST_URL,
        httr::add_headers(`Content-Type` = "application/json", `Accept` = "application/json"),
        body = body_json, encode = "raw", httr::timeout(90)),
      error = function(e) { message("[REST] error: ", e$message); NULL }
    )

    if (is.null(resp)) { Sys.sleep(1); next }
    code <- httr::status_code(resp)
    if (code != 200) {
      txt <- tryCatch(httr::content(resp, "text", encoding = "UTF-8"), error = function(e) "")
      message("[REST] HTTP ", code, ": ", substr(txt, 1, 300))
      Sys.sleep(1); next
    }

    data <- tryCatch(
      jsonlite::fromJSON(httr::content(resp, "text", encoding = "UTF-8"),
                         simplifyVector = FALSE),
      error = function(e) { message("[REST] parse error: ", e$message); NULL }
    )
    if (is.null(data)) { Sys.sleep(1); next }

    for (gid in names(data)) {
      gene <- data[[gid]]
      if (is.null(gene) || !is.list(gene)) next
      sym <- .safe_str(gene$display_name)
      dsc <- .safe_str(gene$description)
      if (!is.null(dsc)) dsc <- trimws(sub("\\s*\\[Source:[^\\]]*\\]", "", dsc))
      bio <- .safe_str(gene$biotype)
      base_map[[gid]] <- list(
        symbol      = sym,
        description = if (!is.null(dsc) && nchar(dsc) > 0) dsc else NULL,
        biotype     = bio
      )
    }
    Sys.sleep(0.1)  # gentle rate-limit pause
  }
  message("[REST] mapped ", length(base_map), " / ", length(gene_ids), " genes")
  if (length(base_map) > 0) {
    g1 <- base_map[[1]]
    message("[REST] first entry — class(symbol):", class(g1$symbol),
            " is.null:", is.null(g1$symbol),
            " value:", if (is.null(g1$symbol)) "NULL" else paste0('"', g1$symbol, '"'))
  }

  # ── Phase 2: BioMart fallback (if REST returned almost nothing) ───────────
  rest_mapped_pct <- length(base_map) / max(length(gene_ids), 1)
  if (rest_mapped_pct < 0.05) {
    message("[BioMart] REST only returned ", round(rest_mapped_pct*100, 1),
            "% — falling back to BioMart XML")

    dataset    <- paste0(organism, "_gene_ensembl")
    base_attrs <- c("ensembl_gene_id", "external_gene_name", "description", "gene_biotype")
    BATCH_BM   <- 500L
    bm_batches <- split(gene_ids, ceiling(seq_along(gene_ids) / BATCH_BM))
    base_dfs   <- list()

    for (batch in bm_batches) {
      txt <- .query_biomart(.build_biomart_xml(dataset, paste(batch, collapse = ","), base_attrs))
      if (!is.null(txt)) {
        # Log first response for diagnosis
        if (length(base_dfs) == 0)
          message("[BioMart] first batch (500 chars): ", substr(txt, 1, 500))
        df <- .parse_biomart_tsv(txt)
        if (!is.null(df) && nrow(df) > 0) base_dfs <- c(base_dfs, list(df))
      }
    }

    if (length(base_dfs) > 0) {
      bm_df <- do.call(rbind, base_dfs)
      # Access columns by name to avoid column-order ambiguity
      id_col  <- if ("Gene stable ID" %in% names(bm_df)) "Gene stable ID" else names(bm_df)[1]
      sym_col <- if ("Gene name"       %in% names(bm_df)) "Gene name"       else names(bm_df)[2]
      dsc_col <- if ("Gene description"%in% names(bm_df)) "Gene description" else names(bm_df)[3]
      bio_col <- if ("Gene type"       %in% names(bm_df)) "Gene type"       else names(bm_df)[4]
      message("[BioMart] columns: ", paste(names(bm_df), collapse = " | "))

      for (i in seq_len(nrow(bm_df))) {
        gid <- .safe_str(bm_df[i, id_col])
        if (is.null(gid)) next
        sym <- .safe_str(bm_df[i, sym_col])
        dsc <- .safe_str(bm_df[i, dsc_col])
        if (!is.null(dsc)) dsc <- trimws(sub("\\s*\\[Source:[^\\]]*\\]", "", dsc))
        bio <- .safe_str(bm_df[i, bio_col])
        if (!gid %in% names(base_map)) {   # first occurrence wins
          base_map[[gid]] <- list(
            symbol      = sym,
            description = if (!is.null(dsc) && nchar(dsc) > 0) dsc else NULL,
            biotype     = bio
          )
        }
      }
      message("[BioMart] now mapped ", length(base_map), " / ", length(gene_ids), " genes")
    }
  }

  if (length(base_map) == 0) {
    res$status <- 502
    return(list(error = paste0(
      "Both Ensembl REST and BioMart returned no data for ", length(gene_ids),
      " gene IDs (organism: ", organism, "). ",
      "Sample IDs: ", paste(head(gene_ids, 3), collapse = ", "), ". ",
      "Check the R backend logs (docker logs / Rscript output) for HTTP errors."
    )))
  }

  # ── Phase 3 (optional): BioMart 1:1 human orthologs ─────────────────────
  ortho_attrs <- c("ensembl_gene_id", "hsapiens_homolog_ensembl_gene",
                   "hsapiens_homolog_associated_gene_name", "hsapiens_homolog_orthology_type")
  dataset     <- paste0(organism, "_gene_ensembl")
  ortho_index <- list()

  if (want_orthologs) {
    BATCH_BM   <- 500L
    bm_batches <- split(gene_ids, ceiling(seq_along(gene_ids) / BATCH_BM))
    ortho_dfs  <- list()
    for (batch in bm_batches) {
      txt <- .query_biomart(.build_biomart_xml(dataset, paste(batch, collapse = ","), ortho_attrs))
      df  <- .parse_biomart_tsv(txt)
      if (!is.null(df) && nrow(df) > 0) ortho_dfs <- c(ortho_dfs, list(df))
    }
    if (length(ortho_dfs) > 0) {
      oc <- do.call(rbind, ortho_dfs)
      for (i in seq_len(nrow(oc))) {
        gid    <- .safe_str(oc[i, 1])
        h_type <- .safe_str(oc[i, 4])
        if (is.null(gid) || is.null(h_type) || h_type != "ortholog_one2one") next
        h_id  <- .safe_str(oc[i, 2])
        h_sym <- .safe_str(oc[i, 3])
        if (!is.null(h_id) || !is.null(h_sym))
          ortho_index[[gid]] <- list(id = h_id, sym = h_sym)
      }
    }
  }

  # ── Build final response ──────────────────────────────────────────────────
  annotations <- list()
  for (gid in names(base_map)) {
    entry <- base_map[[gid]]
    if (!is.null(ortho_index[[gid]])) {
      entry$humanOrtholog   <- ortho_index[[gid]]$sym
      entry$humanOrthologId <- ortho_index[[gid]]$id
    }
    annotations[[gid]] <- entry
  }

  list(annotations = annotations, total = length(annotations),
       hasCoords = FALSE, hasOrthologs = want_orthologs)
}

#* Annotate NCBI gene IDs (numeric) using NCBI E-summary.
#* Works organism-agnostically — covers bacteria, archaea, fungi, plants,
#* and all animals. No organism parameter needed; each NCBI gene ID is unique
#* across all species.
#* @post /api/annotate/ncbi
#* @parser json
function(req, res) {
  body     <- req$body
  gene_ids <- body$gene_ids

  # Accept integer arrays too (JSON numbers)
  if (is.numeric(gene_ids)) gene_ids <- as.character(as.integer(gene_ids))
  if (!is.character(gene_ids) || length(gene_ids) == 0) {
    res$status <- 400
    return(list(error = "gene_ids must be a non-empty array of numeric NCBI gene IDs"))
  }

  .ncbi_str <- function(x) {
    if (is.null(x)) return(NULL)
    s <- trimws(as.character(x))
    if (length(s) == 0 || is.na(s) || s %in% c("", "NA", "N/A", "None", "0")) return(NULL)
    s
  }

  BATCH   <- 300L   # conservative batch; NCBI allows up to 500
  batches <- split(gene_ids, ceiling(seq_along(gene_ids) / BATCH))
  annotations <- list()

  for (batch in batches) {
    ids_str <- paste(batch, collapse = ",")

    resp <- tryCatch(
      httr::POST(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
        body   = list(db = "gene", id = ids_str, retmode = "json"),
        encode = "form",
        httr::timeout(60)
      ),
      error = function(e) { message("[NCBI] request error: ", e$message); NULL }
    )

    if (is.null(resp) || httr::status_code(resp) != 200) { Sys.sleep(0.5); next }

    data <- tryCatch(
      jsonlite::fromJSON(
        httr::content(resp, "text", encoding = "UTF-8"),
        simplifyVector = FALSE
      ),
      error = function(e) { message("[NCBI] parse error: ", e$message); NULL }
    )

    if (is.null(data) || is.null(data$result)) { Sys.sleep(0.5); next }

    for (uid in setdiff(names(data$result), "uids")) {
      gene <- data$result[[uid]]

      # Skip discontinued / merged entries
      status <- trimws(as.character(if (!is.null(gene$status)) gene$status else ""))
      if (status == "secondary") next

      sym  <- .ncbi_str(gene$name)
      desc <- .ncbi_str(gene$description)
      bio  <- .ncbi_str(gene$type)   # e.g. "protein-coding", "ncRNA", "pseudo"

      annotations[[uid]] <- list(
        symbol      = sym,
        description = desc,
        biotype     = bio
      )
    }

    Sys.sleep(0.4)   # NCBI rate limit: ≤ 3 req/sec without API key
  }

  if (length(annotations) == 0) {
    res$status <- 502
    return(list(error = "NCBI returned no data. Ensure gene_ids are valid numeric NCBI gene IDs."))
  }

  list(annotations = annotations, total = length(annotations), hasCoords = FALSE)
}
