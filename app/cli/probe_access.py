import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from app.core.exceptions import FlagwaError
from app.schemas.catalog import Scene
from app.services.nisar.asf_client import ASFClient
from app.services.nisar.scene_download import asf_response


def probe_access(scene_id):
    Scene(scene_id=scene_id, source="ASF")
    feature = ASFClient().resolve(scene_id)
    response = asf_response(feature["properties"]["url"], "bytes=0-4095")
    try:
        if response.status_code != 206:
            raise FlagwaError("RANGE_ACCESS_UNAVAILABLE", "Provider did not honor the bounded range request; full download was not attempted", 502)
        data = next(response.iter_content(chunk_size=4096), b"")
        if not data.startswith(b"\x89HDF\r\n\x1a\n"):
            raise FlagwaError("INVALID_PRODUCT_HEADER", "Authorized range response was not an HDF5 product header", 502)
        return {"status": "success", "scene_id": scene_id, "bytes_read": len(data),
                "header_sha256": hashlib.sha256(data).hexdigest(), "hdf5_signature_verified": True,
                "content_range": response.headers.get("Content-Range"), "full_product_downloaded": False,
                "scientific_processing_demonstrated": False}
    finally:
        response.close()


def main():
    parser = argparse.ArgumentParser(description="Verify authorized access using only a 4096-byte product-header range request")
    parser.add_argument("scene_id")
    parser.add_argument("--out", type=Path, default=Path("storage/audit/access_probe.json"))
    args = parser.parse_args()
    try:
        report = probe_access(args.scene_id)
        code = 0
    except FlagwaError as error:
        report = {"status": "failed", "scene_id": args.scene_id, "error": {"code": error.code, "message": error.message}}
        code = 1
    report["executed_at"] = datetime.now(timezone.utc).isoformat()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())