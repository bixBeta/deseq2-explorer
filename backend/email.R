library(blastula)

send_results_email <- function(to_email, design, sig_count, up_count, dn_count,
                                top_genes, session_id, app_url) {
  subject <- sprintf("DESeq2 complete: %s vs %s — %d DEGs",
                     design$contrast, design$reference, sig_count)

  top_tbl <- if (length(top_genes) > 0) {
    rows <- paste(
      sapply(top_genes, function(g)
        sprintf("<tr><td>%s</td><td>%.2f</td><td>%.2e</td></tr>",
                g$gene, g$log2FC, g$padj)),
      collapse = "\n"
    )
    sprintf('<table style="border-collapse:collapse;font-family:monospace;font-size:13px;">
      <tr style="color:#888"><th>Gene</th><th>log2FC</th><th>padj</th></tr>
      %s</table>', rows)
  } else "No significant genes found."

  body <- sprintf('
    <div style="font-family:Inter,system-ui,sans-serif;max-width:600px;margin:0 auto;background:#070b14;color:#f1f5f9;padding:32px;border-radius:12px;">
      <h2 style="margin:0 0 4px;background:linear-gradient(135deg,#6366f1,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">
        DESeq2 ExploreR
      </h2>
      <p style="color:#64748b;font-size:13px;margin:0 0 24px;">Analysis complete</p>

      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:16px;margin-bottom:20px;">
        <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;">
          <strong style="color:#f1f5f9">%s</strong> vs <strong style="color:#f1f5f9">%s</strong>
        </p>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <span style="color:#6366f1;font-size:13px;">%d DEGs (padj &lt; 0.05)</span>
          <span style="color:#34d399;font-size:13px;">↑ %d up</span>
          <span style="color:#f87171;font-size:13px;">↓ %d down</span>
        </div>
      </div>

      <h3 style="color:#94a3b8;font-size:13px;margin:0 0 8px;">Top DE genes</h3>
      %s

      <div style="margin-top:24px;">
        <a href="%s" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
          Resume Session →
        </a>
      </div>
    </div>',
    design$contrast, design$reference,
    sig_count, up_count, dn_count,
    top_tbl,
    app_url
  )

  smtp_host  <- Sys.getenv("SMTP_HOST",  "smtp.gmail.com")
  smtp_port  <- as.integer(Sys.getenv("SMTP_PORT", "587"))
  smtp_user  <- Sys.getenv("SMTP_USER",  "")
  smtp_pass  <- Sys.getenv("SMTP_PASS",  "")
  from_email <- Sys.getenv("FROM_EMAIL", smtp_user)

  if (smtp_user == "") {
    message("[email] SMTP_USER not set — skipping email")
    return(invisible(FALSE))
  }

  tryCatch({
    msg <- compose_email(body = md(body))
    smtp_send(
      msg,
      to      = to_email,
      from    = from_email,
      subject = subject,
      credentials = creds_envvar(
        user        = smtp_user,
        pass_envvar = "SMTP_PASS",
        host        = smtp_host,
        port        = smtp_port,
        use_ssl     = FALSE
      )
    )
    message("[email] Sent to ", to_email)
    TRUE
  }, error = function(e) {
    message("[email] Failed: ", e$message)
    FALSE
  })
}
