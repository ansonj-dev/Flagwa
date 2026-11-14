"""Search the ASF catalog for NISAR GCOV over Kuttanad and export an audit inventory.

This script performs catalog discovery only. It does not download products.
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
from datetime import date
from pathlib import Path
from typing import Any

import asf_search as asf

LOG = logging.getLogger("flagwa.nisar.audit")

# Draft AOI only: longitude, latitude. Replace with a refined, defensible polygon.
AOI_WKT = (
    "POLYGON((76.25 9.20, 76.55 9.20, 76.55 9.50, "
    "76.25 9.50, 76.25 9.20))"
)

DEFAULT_WINDOWS = {
    "VALIDATED": ("2026-10-21", "2026-11-14"),
    # Conservative end date; the published provisional archive extends partway into Oct 23.
    "PROVISIONAL": ("2026-06-17", "2026-10-22"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=Path("data/audit"))
    parser.add_argument("--validated-start", default=DEFAULT_WINDOWS["VALIDATED"][0])
    parser.add_argument("--validated-end", default=DEFAULT_WINDOWS["VALIDATED"][1])
    parser.add_argument("--provisional-start", default=DEFAULT_WINDOWS["PROVISIONAL"][0])
    parser.add_argument("--provisional-end", default=DEFAULT_WINDOWS["PROVISIONAL"][1])
    parser.add_argument("--max-results", type=int, default=500)
    parser.add_argument("--maturity", choices=["BOTH", "VALIDATED", "PROVISIONAL"], default="BOTH")
    parser.add_argument("--log-level", default="INFO")
    return parser.parse_args()


def _first(props: dict[str, Any], names: tuple[str, ...]) -> Any:
    for name in names:
        value = props.get(name)
        if value not in (None, ""):
            return value
    return ""


def _export_features(
    geojson: dict[str, Any],
    maturity: str,
    start_date: str,
    end_date: str,
    raw_path: Path,
) -> list[dict[str, Any]]:
    raw_path.write_text(json.dumps(geojson, indent=2, ensure_ascii=False), encoding="utf-8")
    features = geojson.get("features", []) if isinstance(geojson, dict) else []
    rows: list[dict[str, Any]] = []
    for feature in features:
        props = feature.get("properties") or {}
        if not isinstance(props, dict):
            props = {"properties_as_text": str(props)}
        granule = _first(props, ("granuleName", "granule_name", "sceneName", "scene_name", "fileID", "fileId", "id"))
        rows.append(
            {
                "site_id": "kerala_kuttanad",
                "query_maturity": maturity,
                "query_start": start_date,
                "query_end": end_date,
                "granule_id": granule or feature.get("id", ""),
                "acquisition_start_utc": _first(props, ("startTime", "start_time", "acquisitionDate", "acquisition_date")),
                "acquisition_end_utc": _first(props, ("stopTime", "endTime", "stop_time", "end_time")),
                "flight_direction": _first(props, ("flightDirection", "flight_direction", "orbitDirection")),
                "relative_orbit": _first(props, ("relativeOrbit", "relative_orbit", "track")),
                "frame": _first(props, ("frameNumber", "frame", "asfFrame", "asf_frame")),
                "processing_level": _first(props, ("processingLevel", "processing_level")) or "GCOV",
                "polarization": _first(props, ("polarization", "polarizationList", "mainBandPolarization")),
                "product_baseline_or_crid": _first(props, ("processingDate", "crid", "compositeReleaseId", "productVersion")),
                "file_name": _first(props, ("fileName", "file_name", "productName", "granuleName")),
                "file_size": _first(props, ("fileSize", "size", "bytes")),
                "url": _first(props, ("url", "downloadUrl", "download_url")),
                "raw_properties_json": json.dumps(props, ensure_ascii=False, sort_keys=True),
                "geometry_json": json.dumps(feature.get("geometry"), ensure_ascii=False),
            }
        )
    return rows


def run_query(maturity: str, start_date: str, end_date: str, max_results: int, out_dir: Path) -> tuple[list[dict[str, Any]], int]:
    LOG.info("Searching NISAR GCOV | maturity=%s | %s to %s", maturity, start_date, end_date)
    results = asf.search(
        dataset="NISAR",
        processingLevel="GCOV",
        dataMaturity=maturity,
        intersectsWith=AOI_WKT,
        start=start_date,
        end=end_date,
        maxResults=max_results,
    )
    if hasattr(results, "raise_if_incomplete"):
        results.raise_if_incomplete()
    geojson = results.geojson()
    out_file = out_dir / f"kerala_nisar_{maturity.lower()}.geojson"
    rows = _export_features(geojson, maturity, start_date, end_date, out_file)
    LOG.info("%s returned %d feature(s); saved %s", maturity, len(rows), out_file)
    return rows, len(rows)


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=getattr(logging, str(args.log_level).upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(message)s",
    )
    args.out_dir.mkdir(parents=True, exist_ok=True)

    windows = {
        "VALIDATED": (args.validated_start, args.validated_end),
        "PROVISIONAL": (args.provisional_start, args.provisional_end),
    }
    maturities = ["VALIDATED", "PROVISIONAL"] if args.maturity == "BOTH" else [args.maturity]
    all_rows: list[dict[str, Any]] = []
    summary: dict[str, Any] = {
        "site_id": "kerala_kuttanad",
        "aoi_wkt": AOI_WKT,
        "product": "NISAR GCOV",
        "catalog": "ASF DAAC Search / CMR via asf_search",
        "run_date_local": date.today().isoformat(),
        "maturity_queries": {},
        "note": "Catalog search only. No granules downloaded. Confirm pair compatibility manually.",
    }

    for maturity in maturities:
        start_date, end_date = windows[maturity]
        rows, count = run_query(maturity, start_date, end_date, args.max_results, args.out_dir)
        all_rows.extend(rows)
        summary["maturity_queries"][maturity] = {
            "start": start_date,
            "end": end_date,
            "count": count,
            "geojson": f"kerala_nisar_{maturity.lower()}.geojson",
        }

    csv_path = args.out_dir / "kerala_nisar_scene_inventory.csv"
    fieldnames = list(all_rows[0].keys()) if all_rows else [
        "site_id", "query_maturity", "query_start", "query_end", "granule_id",
        "acquisition_start_utc", "acquisition_end_utc", "flight_direction", "relative_orbit",
        "frame", "processing_level", "polarization", "product_baseline_or_crid",
        "file_name", "file_size", "url", "raw_properties_json", "geometry_json",
    ]
    with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    summary["total_records"] = len(all_rows)
    summary_path = args.out_dir / "audit_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("\nFLAGWA Kerala NISAR catalog audit complete")
    print(f"Records: {len(all_rows)}")
    print(f"Inventory: {csv_path}")
    print(f"Summary:   {summary_path}")
    if not all_rows:
        print("No records matched this AOI/date/maturity/product query. Widen the AOI/date window and inspect Vertex.")
    else:
        print("Review acquisition dates, orbit direction, polarization, coverage, maturity and CRID before selecting a pair.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
