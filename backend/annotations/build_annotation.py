#!/usr/bin/env python3
"""
build_annotation.py — convert an Excel annotation sheet to a TSV for DESeq2 ExploreR
and append the entry to manifest.json.

Usage:
    python build_annotation.py <excel_file> \
        --id       grcz11 \
        --label    "Danio rerio (GRCz11 ENSEMBL)" \
        --assembly GRCz11 \
        [--sheet   0]

The script auto-detects columns regardless of case/spacing variations and maps them to
the canonical set:  gene_id | symbol | description | biotype | locus

Column aliases recognised (case-insensitive, strip whitespace):
  gene_id     : gene_id, gene id, geneid, ensembl_gene_id, ensembl id,
                ensemblid, id, feature_id, feature id
  symbol      : symbol, gene_symbol, gene symbol, gene_name, gene name,
                hgnc_symbol, mgi_symbol, name, gene
  description : description, gene_description, gene description, desc,
                full_name, fullname, function, product
  biotype     : biotype, gene_biotype, gene biotype, gene_type, gene type,
                type, class, feature_type
  locus       : locus, location, position, genomic_position, chr, coordinates,
                chr_start_end, chrom_loc
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    sys.exit("pandas is required:  pip install pandas openpyxl")

# ── Canonical column aliases ──────────────────────────────────────────────────
ALIASES = {
    "gene_id": [
        "gene_id", "gene id", "geneid", "ensembl_gene_id", "ensembl id",
        "ensemblid", "ensembl", "id", "feature_id", "feature id",
        "gene_stable_id", "gene stable id",
    ],
    "symbol": [
        "symbol", "gene_symbol", "gene symbol", "gene_name", "gene name",
        "hgnc_symbol", "mgi_symbol", "name", "gene", "approved_symbol",
        "approved symbol", "external_gene_name", "gene_short_name",
    ],
    "description": [
        "description", "gene_description", "gene description", "desc",
        "full_name", "fullname", "function", "product", "gene_description",
        "note", "definition",
    ],
    "biotype": [
        "biotype", "gene_biotype", "gene biotype", "gene_type", "gene type",
        "type", "class", "feature_type", "transcript_biotype",
    ],
    "locus": [
        "locus", "location", "position", "genomic_position", "chr",
        "coordinates", "chr_start_end", "chrom_loc", "chromosomal_location",
        "map_location", "map location",
    ],
}

def normalise(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).strip().lower())

def detect_columns(raw_cols):
    """Return dict canonical_name → actual_column_name for each matched alias."""
    norm_to_raw = {normalise(c): c for c in raw_cols}
    mapping = {}
    for canon, aliases in ALIASES.items():
        for alias in aliases:
            if alias in norm_to_raw:
                mapping[canon] = norm_to_raw[alias]
                break
    return mapping

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("excel", help="Path to the input Excel file")
    ap.add_argument("--id",       required=True, help="Short machine ID, e.g. grcz11")
    ap.add_argument("--label",    required=True,
                    help='Human label, e.g. "Danio rerio (GRCz11 ENSEMBL)"')
    ap.add_argument("--assembly", default=None,
                    help="Assembly string stored in manifest ncbi field")
    ap.add_argument("--sheet",    default=0,
                    help="Sheet name or 0-based index (default: 0)")
    args = ap.parse_args()

    xls_path  = Path(args.excel)
    ann_dir   = Path(__file__).parent
    out_tsv   = ann_dir / f"{args.id}.tsv"
    manifest  = ann_dir / "manifest.json"

    if not xls_path.exists():
        sys.exit(f"File not found: {xls_path}")

    # ── Read Excel ────────────────────────────────────────────────────────────
    sheet = int(args.sheet) if str(args.sheet).isdigit() else args.sheet
    print(f"Reading {xls_path.name}  sheet={sheet!r} …")
    df = pd.read_excel(xls_path, sheet_name=sheet, dtype=str)
    df.columns = df.columns.astype(str).str.strip()

    print(f"  Raw columns: {list(df.columns)}")
    mapping = detect_columns(df.columns)
    print(f"  Column mapping: {mapping}")

    missing = [c for c in ("gene_id",) if c not in mapping]   # symbol etc. optional
    if missing:
        sys.exit(f"Could not detect required column(s): {missing}\n"
                 f"Raw headers were: {list(df.columns)}")

    # ── Build output dataframe ────────────────────────────────────────────────
    out = pd.DataFrame()
    for canon in ["gene_id", "symbol", "description", "biotype", "locus"]:
        if canon in mapping:
            out[canon] = df[mapping[canon]].fillna("").str.strip()
        else:
            print(f"  WARNING: '{canon}' column not found — will be empty")
            out[canon] = ""

    # Drop rows with empty gene_id
    out = out[out["gene_id"].str.len() > 0].drop_duplicates(subset="gene_id")

    n_genes   = len(out)
    has_sym   = out["symbol"].str.len().gt(0).any()

    print(f"  Genes after dedup: {n_genes}")
    print(f"  Has symbol:        {has_sym}")

    # ── Write TSV ─────────────────────────────────────────────────────────────
    out.to_csv(out_tsv, sep="\t", index=False)
    print(f"  → {out_tsv}")

    # ── Update manifest ───────────────────────────────────────────────────────
    entries = json.loads(manifest.read_text()) if manifest.exists() else []

    # Remove existing entry with same id
    entries = [e for e in entries if e["id"] != args.id]
    entries.append({
        "id":         args.id,
        "label":      args.label,
        "taxon":      None,
        "ncbi":       args.assembly or args.id,
        "file":       out_tsv.name,
        "genes":      n_genes,
        "hasCoords":  False,
        "hasSymbol":  bool(has_sym),
        "created":    date.today().isoformat(),
    })

    # Sort alphabetically by label for a tidy dropdown
    entries.sort(key=lambda e: e["label"].lower())

    manifest.write_text(json.dumps(entries, indent=2))
    print(f"  → manifest.json updated ({len(entries)} entries)")

if __name__ == "__main__":
    main()
