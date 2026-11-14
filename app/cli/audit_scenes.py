import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from app.core.exceptions import FlagwaError
from app.schemas.catalog import CatalogSearch
from app.services.nisar.asf_client import ASFClient


def main():
    parser = argparse.ArgumentParser(description="Public, metadata-only NISAR audit; never downloads products")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--maturity", choices=["VALIDATED", "PROVISIONAL", "BETA"], default="VALIDATED")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--out", type=Path, default=Path("storage/audit/latest.json"))
    args = parser.parse_args()
    aoi = json.loads(Path("config/kuttanad_aoi.geojson").read_text())["features"][0]["geometry"]
    query = CatalogSearch(aoi=aoi, start=args.start, end=args.end, data_maturity=args.maturity, limit=args.limit)
    report = {"executed_at": datetime.now(timezone.utc).isoformat(), "query": query.model_dump(mode="json"),
              "synthetic": False, "download_attempted": False}
    try:
        scenes, more = ASFClient().search(query)
        report.update(status="success", scenes=[scene.model_dump(mode="json") for scene in scenes], has_more=more)
        print(json.dumps({"status": "success", "returned": len(scenes), "has_more": more,
                          "observations": [{"scene_id": scene.scene_id, "acquisition_datetime": str(scene.acquisition_datetime),
                                            "data_maturity": scene.data_maturity, "frequency": scene.frequency,
                                            "property_names": sorted(scene.metadata["original"].get("properties", {}))} for scene in scenes]}, indent=2))
        code = 0
    except FlagwaError as error:
        report.update(status="failed", error={"code": error.code, "message": error.message})
        print(json.dumps(report["error"]))
        code = 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())