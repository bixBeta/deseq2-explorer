library(httr2)

# ── send_results_email ────────────────────────────────────────────────────────
# Posts to the Cloudflare Worker relay (NOTIFY_URL).
# Credentials never touch user machines — they live in Cloudflare secrets.
# If NOTIFY_URL is unset the function is a no-op (email notifications off).
send_results_email <- function(to_email, design, sig_count, up_count, dn_count,
                                top_genes, session_id, app_url) {

  notify_url   <- Sys.getenv("NOTIFY_URL",   "")
  notify_token <- Sys.getenv("NOTIFY_TOKEN", "")

  if (nchar(notify_url) == 0) {
    message("[email] NOTIFY_URL not configured — skipping notification")
    return(invisible(FALSE))
  }

  contrast_str <- paste(design$contrast, collapse = ", ")
  subject      <- sprintf("DESeq2 ExploreR: analysis complete — %d DEGs found", sig_count)
  html         <- .build_email_html(contrast_str, sig_count, up_count, dn_count,
                                    top_genes, session_id, app_url)

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
.build_email_html <- function(contrast_str, sig_count, up_count, dn_count,
                               top_genes, session_id, app_url) {

  top_rows_html <- if (length(top_genes) > 0) {
    rows <- paste(sapply(top_genes, function(g) {
      fc_color <- if (g$log2FC > 0) "#4ade80" else "#f87171"
      sprintf(
        '<tr>
           <td style="padding:6px 12px;border-bottom:1px solid #1e293b;color:#e2e8f0">%s</td>
           <td style="padding:6px 12px;border-bottom:1px solid #1e293b;text-align:right;color:%s;font-weight:600">%+.3f</td>
           <td style="padding:6px 12px;border-bottom:1px solid #1e293b;text-align:right;color:#94a3b8">%.2e</td>
         </tr>',
        .htmlEscape(g$gene), fc_color, g$log2FC, g$padj
      )
    }), collapse = "")

    sprintf('
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Top Genes</div>
      <table style="width:100%%;border-collapse:collapse;font-size:13px;margin-bottom:6px">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px 12px;border-bottom:1px solid #334155;color:#475569;font-weight:500">Gene</th>
            <th style="text-align:right;padding:6px 12px;border-bottom:1px solid #334155;color:#475569;font-weight:500">log2FC</th>
            <th style="text-align:right;padding:6px 12px;border-bottom:1px solid #334155;color:#475569;font-weight:500">padj</th>
          </tr>
        </thead>
        <tbody>%s</tbody>
      </table>', rows)
  } else ""

  sprintf('<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#070b14;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#f1f5f9">
  <div style="max-width:560px;margin:40px auto;background:#0d1421;border:1px solid rgba(255,255,255,0.08);border-radius:14px;overflow:hidden">

    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px">
      <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-.01em">DESeq2 ExploreR</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:3px">Analysis Complete</div>
    </div>

    <div style="padding:28px 32px">

      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:16px 20px;margin-bottom:22px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Contrast</div>
        <div style="font-size:15px;font-weight:600;color:#e2e8f0">%s</div>
      </div>

      <table style="width:100%%;border-collapse:separate;border-spacing:8px;margin:-8px -8px 16px">
        <tr>
          <td style="background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.25);border-radius:10px;padding:16px;text-align:center">
            <div style="font-size:26px;font-weight:700;color:#818cf8">%d</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:3px">Total DEGs</div>
          </td>
          <td style="background:rgba(74,222,128,.07);border:1px solid rgba(74,222,128,.2);border-radius:10px;padding:16px;text-align:center">
            <div style="font-size:26px;font-weight:700;color:#4ade80">%d</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:3px">Upregulated</div>
          </td>
          <td style="background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.2);border-radius:10px;padding:16px;text-align:center">
            <div style="font-size:26px;font-weight:700;color:#f87171">%d</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:3px">Downregulated</div>
          </td>
        </tr>
      </table>

      %s

      <a href="%s" style="display:block;text-align:center;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;padding:13px 24px;border-radius:9px;font-weight:600;font-size:14px;margin-top:22px">
        Resume Session &rarr;
      </a>
    </div>

    <div style="padding:14px 32px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:#334155;text-align:center">
      Session ID: <code style="color:#475569;font-family:monospace">%s</code>
    </div>

  </div>
</body>
</html>',
    contrast_str,
    sig_count, up_count, dn_count,
    top_rows_html,
    app_url,
    session_id
  )
}

# Minimal HTML escaping for user-supplied strings inserted into email body
.htmlEscape <- function(x) {
  x <- gsub("&",  "&amp;",  x, fixed = TRUE)
  x <- gsub("<",  "&lt;",   x, fixed = TRUE)
  x <- gsub(">",  "&gt;",   x, fixed = TRUE)
  x <- gsub('"',  "&quot;", x, fixed = TRUE)
  x
}
