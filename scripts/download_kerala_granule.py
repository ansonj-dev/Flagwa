"""Download one selected NISAR granule from ASF using an Earthdata user token."""
from __future__ import annotations

import argparse
import os
from pathlib import Path

import asf_search as asf
from dotenv import load_dotenv


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--granule-id", required=True, help="Exact granule identifier from the audit CSV")
    parser.add_argument("--out-dir", type=Path, default=Path("data/raw/kerala_gcov"))
    args = parser.parse_args()

    token = os.getenv("EARTHDATA_TOKEN", "").strip()
    if not token:
        raise SystemExit("EARTHDATA_TOKEN is not set. Set it in your current shell; do not put it in source code.")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    results = asf.granule_search([args.granule_id])
    if len(results) == 0:
        raise SystemExit("No ASF granule found for that exact ID. Copy the ID from the audit CSV and try again.")
    if hasattr(results, "raise_if_incomplete"):
        results.raise_if_incomplete()

    session = asf.ASFSession().auth_with_token(token)
    print(f"Downloading one selected granule into: {args.out_dir.resolve()}")
    results.download(path=str(args.out_dir), session=session, processes=1)
    print("Download command completed. Inspect the files, sizes and product metadata before processing.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
