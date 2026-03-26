library(DBI)
library(RSQLite)

DB_PATH <- Sys.getenv("DB_PATH", file.path(dirname(getwd()), "data", "sessions.db"))

get_db <- function() {
  dir.create(dirname(DB_PATH), showWarnings = FALSE, recursive = TRUE)
  con <- dbConnect(SQLite(), DB_PATH)
  dbExecute(con, "
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL,
      pin_hash      TEXT NOT NULL,
      name          TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      design_json   TEXT,
      rds_path      TEXT,
      results_path  TEXT,
      ann_map_json     TEXT,
      ann_details_json TEXT
    )
  ")
  # Safely add columns when upgrading from older schema
  for (col_def in c("name TEXT", "ann_map_json TEXT", "ann_details_json TEXT")) {
    tryCatch(
      dbExecute(con, paste("ALTER TABLE sessions ADD COLUMN", col_def)),
      error = function(e) invisible(NULL)
    )
  }
  con
}

# ── Create ────────────────────────────────────────────────────────────────────
session_create <- function(email, pin_hash, name = NULL) {
  id  <- uuid::UUIDgenerate()
  now <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
  if (is.null(name) || nchar(trimws(name)) == 0)
    name <- paste("Session", format(Sys.time(), "%b %d %H:%M", tz = "UTC"))
  con <- get_db()
  on.exit(dbDisconnect(con))
  dbExecute(con,
    "INSERT INTO sessions (id, email, pin_hash, name, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    list(id, email, pin_hash, name, now, now)
  )
  id
}

# ── List all sessions for a user (newest first) ───────────────────────────────
session_list <- function(email, pin_hash) {
  con <- get_db()
  on.exit(dbDisconnect(con))
  dbGetQuery(con,
    "SELECT * FROM sessions WHERE email = ? AND pin_hash = ? ORDER BY updated_at DESC",
    list(email, pin_hash)
  )
}

# ── Count sessions for a user ─────────────────────────────────────────────────
session_count <- function(email, pin_hash) {
  con <- get_db()
  on.exit(dbDisconnect(con))
  dbGetQuery(con,
    "SELECT COUNT(*) AS n FROM sessions WHERE email = ? AND pin_hash = ?",
    list(email, pin_hash)
  )$n
}

# ── Load most recent session (legacy / fallback) ──────────────────────────────
session_load <- function(email, pin_hash) {
  con <- get_db()
  on.exit(dbDisconnect(con))
  dbGetQuery(con,
    "SELECT * FROM sessions WHERE email = ? AND pin_hash = ? ORDER BY updated_at DESC LIMIT 1",
    list(email, pin_hash)
  )
}

# ── Load a specific session by ID (ownership verified) ───────────────────────
session_load_by_id <- function(id, email, pin_hash) {
  con <- get_db()
  on.exit(dbDisconnect(con))
  dbGetQuery(con,
    "SELECT * FROM sessions WHERE id = ? AND email = ? AND pin_hash = ?",
    list(id, email, pin_hash)
  )
}

# ── Update session fields ─────────────────────────────────────────────────────
session_update <- function(id, design_json = NULL, rds_path = NULL,
                           results_path = NULL, name = NULL,
                           ann_map_json = NULL, ann_details_json = NULL) {
  now <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
  con <- get_db()
  on.exit(dbDisconnect(con))
  if (!is.null(name))             dbExecute(con, "UPDATE sessions SET name=?,             updated_at=? WHERE id=?", list(name,             now, id))
  if (!is.null(design_json))      dbExecute(con, "UPDATE sessions SET design_json=?,      updated_at=? WHERE id=?", list(design_json,      now, id))
  if (!is.null(rds_path))         dbExecute(con, "UPDATE sessions SET rds_path=?,         updated_at=? WHERE id=?", list(rds_path,         now, id))
  if (!is.null(results_path))     dbExecute(con, "UPDATE sessions SET results_path=?,     updated_at=? WHERE id=?", list(results_path,     now, id))
  if (!is.null(ann_map_json))     dbExecute(con, "UPDATE sessions SET ann_map_json=?,     updated_at=? WHERE id=?", list(ann_map_json,     now, id))
  if (!is.null(ann_details_json)) dbExecute(con, "UPDATE sessions SET ann_details_json=?, updated_at=? WHERE id=?", list(ann_details_json, now, id))
  invisible(TRUE)
}

# ── Delete a session (verifies ownership, removes files) ─────────────────────
session_delete <- function(id, email, pin_hash) {
  con <- get_db()
  on.exit(dbDisconnect(con))
  row <- dbGetQuery(con,
    "SELECT rds_path, results_path FROM sessions WHERE id = ? AND email = ? AND pin_hash = ?",
    list(id, email, pin_hash)
  )
  if (nrow(row) == 0) return(FALSE)
  # Remove uploaded RDS and results files
  if (!is.na(row$rds_path[1])     && nchar(row$rds_path[1]) > 0     && file.exists(row$rds_path[1]))     unlink(row$rds_path[1])
  if (!is.na(row$results_path[1]) && nchar(row$results_path[1]) > 0 && file.exists(row$results_path[1])) unlink(row$results_path[1])
  dbExecute(con,
    "DELETE FROM sessions WHERE id = ? AND email = ? AND pin_hash = ?",
    list(id, email, pin_hash)
  )
  TRUE
}
