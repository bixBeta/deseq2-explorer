library(blastula)

send_results_email <- function(to_email, design, sig_count, up_count, dn_count,
                                top_genes, session_id, app_url) {
  contrast_str  <- paste(design$contrast,  collapse = ", ")
  reference_str <- paste(design$reference, collapse = ", ")

  subject <- sprintf("DESeq2 complete: %s vs %s — %d DEGs",
                     contrast_str, reference_str, sig_count)

  body_md <- sprintf(
"## DESeq2 ExploreR — Analysis Complete

**Contrast:** %s vs %s

| | |
|---|---|
| Total DEGs (padj < 0.05) | **%d** |
| Upregulated | **%d** |
| Downregulated | **%d** |

**Session ID:** `%s`

[Resume Session](%s)",
    contrast_str, reference_str,
    sig_count, up_count, dn_count,
    session_id,
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
    msg <- compose_email(body = md(body_md))
    use_ssl <- smtp_port == 465
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
        use_ssl     = use_ssl
      )
    )
    message("[email] Sent to ", to_email)
    TRUE
  }, error = function(e) {
    message("[email] Failed: ", e$message)
    FALSE
  })
}
