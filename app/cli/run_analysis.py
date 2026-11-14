import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.workers.celery_app import celery_app


def main():
    parser = argparse.ArgumentParser(description="Submit an explicitly selected pair to the local API; never selects arbitrary scenes")
    parser.add_argument("--before", required=True)
    parser.add_argument("--after", required=True)
    parser.add_argument("--water-layer", required=True)
    parser.add_argument("--location", default="kuttanad")
    parser.add_argument("--polarization", default="HHHH")
    parser.add_argument("--frequency-group", default="A", choices=["A", "B"])
    parser.add_argument("--quality-values", required=True, help="Comma-separated reviewed valid subswath codes")
    parser.add_argument("--quality-rule-source", required=True)
    parser.add_argument("--threshold-basis", required=True)
    parser.add_argument("--acquire-subsets", action="store_true")
    parser.add_argument("--wait", action="store_true")
    parser.add_argument("--out", type=Path, default=Path("storage/audit/live_workflow.json"))
    args = parser.parse_args()
    settings = get_settings()
    headers = {}
    if settings.admin_api_key.get_secret_value():
        headers["X-Admin-Key"] = settings.admin_api_key.get_secret_value()
    report = {"executed_at": datetime.now(timezone.utc).isoformat(), "synthetic": False,
              "source_scenes": [args.before, args.after], "full_products_downloaded": False, "acquisition_jobs": []}
    try:
        with httpx.Client(base_url="http://127.0.0.1:8000", headers=headers, timeout=90) as client:
            def call(method, path, **kwargs):
                response = client.request(method, path, **kwargs)
                data = response.json()
                if not response.is_success:
                    error = data.get("error", {})
                    raise FlagwaError(error.get("code", "API_REQUEST_FAILED"), error.get("message", "API request failed"), response.status_code)
                return data["data"]

            if args.acquire_subsets:
                for scene_id in report["source_scenes"]:
                    job = call("POST", f"/api/v1/scenes/{scene_id}/download", json={"mode": "aoi_subset", "location_slug": args.location,
                               "polarization": args.polarization, "frequency_group": args.frequency_group, "max_remote_mib": 128})
                    report["acquisition_jobs"].append(job["id"])
                    if args.wait:
                        completed = celery_app.AsyncResult(job["id"]).get(timeout=600)
                        if completed["status"] != "COMPLETED":
                            raise FlagwaError("ACQUISITION_FAILED", "Selective acquisition did not complete; inspect its job record", 409)
            pair = {"before_scene_id": args.before, "after_scene_id": args.after, "location_slug": args.location,
                    "polarization": args.polarization, "frequency_group": args.frequency_group}
            report["compatibility"] = call("POST", "/api/v1/catalog/nisar/compatibility-check", json=pair)
            if not report["compatibility"]["compatible"]:
                raise FlagwaError("INCOMPATIBLE_SCENES", "; ".join(report["compatibility"]["blockers"]), 422)
            payload = pair | {"permanent_water_layer_id": args.water_layer, "parameters": {
                "quality_valid_values": [int(value.strip()) for value in args.quality_values.split(",")],
                "quality_rule_source": args.quality_rule_source, "threshold_basis": args.threshold_basis}}
            job = call("POST", "/api/v1/analysis/flood", json=payload)
            report["analysis_job_id"] = job["id"]
            report["status"] = "queued"
            if args.wait:
                completed = celery_app.AsyncResult(job["id"]).get(timeout=600)
                if completed["status"] != "COMPLETED":
                    raise FlagwaError("ANALYSIS_FAILED", "Processing did not complete; inspect its job record", 409)
                report["result"] = call("GET", f"/api/v1/results/{job['id']}")
                report["exports"] = {}
                for name in ["geotiff", "geojson", "summary"]:
                    response = client.get(f"/api/v1/exports/{job['id']}/{name}")
                    if response.status_code != 200 or not response.content:
                        raise FlagwaError("EXPORT_VERIFICATION_FAILED", "Generated export could not be retrieved", 500)
                    report["exports"][name] = {"http_status": response.status_code, "bytes": len(response.content)}
                report["status"] = "completed_pending_scientific_validation"
        code = 0
    except FlagwaError as error:
        report.update(status="failed", error={"code": error.code, "message": error.message})
        code = 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())