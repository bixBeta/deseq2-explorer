library(httr2)

# ── Light mode colour tokens (matches body.light in index.css) ────────────────
.C <- list(
  bg_app    = "#f0f4ff",   # --bg-app
  bg_panel  = "#ffffff",   # --bg-panel
  bg_card   = "#f8fafc",   # subtle card / alternating row
  border    = "#e2e8f0",   # --border (materialised)
  text_1    = "#1e293b",   # --text-1
  text_2    = "#475569",   # --text-2
  text_3    = "#94a3b8",   # --text-3
  accent    = "#6366f1",   # --accent (indigo theme)
  accent2   = "#8b5cf6",   # --accent2
  up        = "#059669",   # green — upregulated
  down      = "#dc2626",   # red — downregulated
  grad_hdr  = "linear-gradient(135deg,#6366f1,#8b5cf6)"
)

# ── send_results_email ────────────────────────────────────────────────────────
# Posts to the Cloudflare Worker relay (NOTIFY_URL).
# Credentials never touch user machines — they live in Cloudflare secrets.
# If NOTIFY_URL is unset the function is a no-op (email notifications off).
send_results_email <- function(to_email, deseq2_params, contrast_summary,
                                session_id, app_url) {

  notify_url   <- Sys.getenv("NOTIFY_URL",   "")
  notify_token <- Sys.getenv("NOTIFY_TOKEN", "")

  if (nchar(notify_url) == 0) {
    message("[email] NOTIFY_URL not configured — skipping notification")
    return(invisible(FALSE))
  }

  n_contrasts <- length(contrast_summary)
  subject     <- sprintf("DESeq2 ExploreR: analysis complete (%d contrast%s)",
                          n_contrasts, if (n_contrasts == 1) "" else "s")
  html        <- .build_email_html(deseq2_params, contrast_summary, session_id, app_url)

  tryCatch({
    resp <- request(notify_url) |>
      req_headers(
        Authorization  = paste("Bearer", notify_token),
        `Content-Type` = "application/json"
      ) |>
      req_body_json(list(to = to_email, subject = subject, html = html)) |>
      req_error(is_error = \(r) FALSE) |>
      req_perform()

    if (resp_status(resp) == 200L) {
      message("[email] Sent to ", to_email)
      invisible(TRUE)
    } else {
      message("[email] Relay returned ", resp_status(resp), ": ", resp_body_string(resp))
      invisible(FALSE)
    }
  }, error = function(e) {
    message("[email] Failed: ", e$message)
    invisible(FALSE)
  })
}

# ── HTML email builder ────────────────────────────────────────────────────────
.build_email_html <- function(deseq2_params, contrast_summary, session_id, app_url) {

  # ── DESeq2 parameters table rows (alternating bg) ──
  param_labels <- c("FDR threshold (alpha)", "LFC threshold", "Min count",
                    "Min samples", "Fit type", "Independent filtering", "Cook's cutoff")
  param_values <- list(deseq2_params$alpha, deseq2_params$lfcThreshold,
                       deseq2_params$minCount, deseq2_params$minSamples,
                       deseq2_params$fitType, deseq2_params$independentFiltering,
                       deseq2_params$cooksCutoff)

  param_rows <- paste(mapply(function(label, value, i) {
    val_str  <- if (is.logical(value)) ifelse(value, "TRUE", "FALSE") else as.character(value)
    row_bg   <- if (i %% 2 == 0) .C$bg_card else .C$bg_panel
    sprintf('
      <tr style="background:%s">
        <td style="padding:9px 16px;border-bottom:1px solid %s;color:%s;font-size:13px;width:55%%">%s</td>
        <td style="padding:9px 16px;border-bottom:1px solid %s;color:%s;font-size:13px;font-family:monospace">%s</td>
      </tr>',
      row_bg,
      .C$border, .C$text_2, label,
      .C$border, .C$text_1, .htmlEscape(val_str)
    )
  }, param_labels, param_values, seq_along(param_labels)), collapse = "")

  # ── Per-contrast results table rows ──
  contrast_rows <- paste(mapply(function(ct, i) {
    row_bg <- if (i %% 2 == 0) .C$bg_card else .C$bg_panel
    sprintf('
      <tr style="background:%s">
        <td style="padding:9px 16px;border-bottom:1px solid %s;color:%s;font-size:13px">%s</td>
        <td style="padding:9px 16px;border-bottom:1px solid %s;color:%s;font-size:14px;font-weight:700;text-align:center">%d</td>
        <td style="padding:9px 16px;border-bottom:1px solid %s;color:%s;font-size:14px;font-weight:700;text-align:center">%d</td>
        <td style="padding:9px 16px;border-bottom:1px solid %s;color:%s;font-size:14px;font-weight:700;text-align:center">%d</td>
      </tr>',
      row_bg,
      .C$border, .C$text_1, .htmlEscape(ct$contrast),
      .C$border, .C$accent,  ct$total,
      .C$border, .C$up,      ct$up,
      .C$border, .C$down,    ct$down
    )
  }, contrast_summary, seq_along(contrast_summary)), collapse = "")

  sprintf('<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:%s;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:%s">
  <div style="max-width:600px;margin:36px auto;background:%s;border:1px solid %s;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07)">

    <!-- Header -->
    <div style="background:%s;padding:24px 28px">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%%"><tr>
        <td style="width:72px;vertical-align:middle;padding-right:16px">
          <img src="https://raw.githubusercontent.com/bixBeta/deseq2-explorer/main/frontend/public/email-logo.png"
               width="60" height="60" alt="DESeq2 ExploreR"
               style="display:block;border-radius:14px;border:0" />
        </td>
        <td style="vertical-align:middle">
          <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-.01em">DESeq2 ExploreR</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:3px">Analysis Complete</div>
        </td>
      </tr></table>
    </div>

    <div style="padding:28px">

      <!-- DESeq2 Parameters -->
      <div style="font-size:11px;font-weight:600;color:%s;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">DESeq2 Parameters</div>
      <table cellpadding="0" cellspacing="0" style="width:100%%;border-collapse:collapse;border:1px solid %s;border-radius:8px;overflow:hidden;margin-bottom:28px">
        <tbody>%s</tbody>
      </table>

      <!-- Results Summary -->
      <div style="font-size:11px;font-weight:600;color:%s;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Results Summary</div>
      <table cellpadding="0" cellspacing="0" style="width:100%%;border-collapse:collapse;border:1px solid %s;border-radius:8px;overflow:hidden;margin-bottom:28px">
        <thead>
          <tr style="background:%s">
            <th style="text-align:left;padding:9px 16px;border-bottom:1px solid %s;color:%s;font-size:12px;font-weight:600">Contrast</th>
            <th style="text-align:center;padding:9px 16px;border-bottom:1px solid %s;color:%s;font-size:12px;font-weight:600">Total</th>
            <th style="text-align:center;padding:9px 16px;border-bottom:1px solid %s;color:%s;font-size:12px;font-weight:600">Up</th>
            <th style="text-align:center;padding:9px 16px;border-bottom:1px solid %s;color:%s;font-size:12px;font-weight:600">Down</th>
          </tr>
        </thead>
        <tbody>%s</tbody>
      </table>

      <!-- CTA -->
      <a href="%s" style="display:block;text-align:center;background:%s;color:#fff;text-decoration:none;padding:13px 24px;border-radius:9px;font-weight:600;font-size:14px">
        Resume Session &rarr;
      </a>
    </div>

    <!-- Footer -->
    <div style="padding:14px 28px;border-top:1px solid %s;background:%s;font-size:11px;color:%s;text-align:center">
      Session ID: <code style="color:%s;font-family:monospace;font-size:11px">%s</code>
    </div>

  </div>
</body>
</html>',
    # body bg, body text
    .C$bg_app, .C$text_1,
    # container bg, border
    .C$bg_panel, .C$border,
    # header gradient
    .C$grad_hdr,
    # params section label, params table border, param rows
    .C$text_3, .C$border, param_rows,
    # results section label, results table border
    .C$text_3, .C$border,
    # thead bg, thead border×4, thead text colors
    .C$bg_card,
    .C$border, .C$text_2,
    .C$border, .C$accent,
    .C$border, .C$up,
    .C$border, .C$down,
    # contrast rows
    contrast_rows,
    # CTA button
    app_url, .C$grad_hdr,
    # footer
    .C$border, .C$bg_card, .C$text_3, .C$text_2, session_id
  )
}

# ── Minimal HTML escaping ─────────────────────────────────────────────────────
.htmlEscape <- function(x) {
  x <- gsub("&",  "&amp;",  x, fixed = TRUE)
  x <- gsub("<",  "&lt;",   x, fixed = TRUE)
  x <- gsub(">",  "&gt;",   x, fixed = TRUE)
  x <- gsub('"',  "&quot;", x, fixed = TRUE)
  x
}
