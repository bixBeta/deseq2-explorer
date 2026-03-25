library(plumber)

pr("plumber.R") |>
  pr_set_error(function(req, res, err) {
    res$status <- 500
    list(error = conditionMessage(err))
  }) |>
  pr_run(host = "0.0.0.0", port = 8000, quiet = FALSE)
