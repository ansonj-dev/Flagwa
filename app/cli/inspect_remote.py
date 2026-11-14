import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from app.core.exceptions import FlagwaError
from app.schemas.catalog import Scene
from app.services.nisar.remote_product import open_remote_product
from app.services.processing.hdf5_reader import inspect_product


def main():
    parser = argparse.ArgumentParser(description="Inspect a genuine ASF product via bounded authenticated HTTP range access")
    parser.add_argument("scene_id")
    parser.add_argument("--max-mib", type=int, default=32, choices=range(1, 257))
    parser.add_argument("--out", type=Path, default=Path("storage/audit/remote_hdf5.json"))
    args = parser.parse_args()
    Scene(scene_id=args.scene_id, source="ASF")
    try:
        with open_remote_product(args.scene_id, args.max_mib * 1024 * 1024) as (product, budget):
            inspection = inspect_product(product)
        report = {"status": "success", "scene_id": args.scene_id, "synthetic": False,
                  "requested_range_bytes": budget.requested, "full_product_downloaded": False,
                  "inspection": inspection, "executed_at": datetime.now(timezone.utc).isoformat()}
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2))
        print(json.dumps({key: value for key, value in report.items() if key != "inspection"} | {
            "dataset_count": len(inspection["datasets"]), "frequency_groups": inspection["frequency_groups"],
            "covariance_layers": inspection["covariance_layers"], "identification": inspection["identification"]}, indent=2))
        return 0
    except FlagwaError as error:
        print(json.dumps({"status": "failed", "code": error.code, "message": error.message}))
        return 1
    except Exception as error:
        print(json.dumps({"status": "failed", "code": "REMOTE_INSPECTION_FAILED", "error_type": type(error).__name__,
                          "message": "Remote HDF5 inspection failed; no raw URL or credential is logged"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())