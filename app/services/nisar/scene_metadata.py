import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from app.schemas.catalog import Scene


def parse_datetime(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except ValueError:
        return None


def polarizations(value):
    if isinstance(value, list):
        return sorted({term for item in value for term in polarizations(item)})
    if not isinstance(value, str):
        return []
    return sorted(set(re.findall(r"(?<![A-Z])[HVLR][HV](?![A-Z])", value.upper())))


def normalize_asf(feature: dict) -> Scene:
    props = feature.get("properties") or {}
    scene_id = props.get("sceneName") or props.get("granuleName") or feature.get("id") or props.get("fileID")
    instrument = props.get("instrument") or props.get("sensor")
    frequency = {"L-SAR": "L", "LSAR": "L", "S-SAR": "S", "SSAR": "S"}.get(instrument)
    provenance = {}
    if not frequency and isinstance(scene_id, str) and scene_id.startswith(("NISAR_L", "NISAR_S")):
        frequency = scene_id[6]
        provenance["frequency"] = "NISAR instrument code in provider scene identifier"
    maturity = props.get("dataMaturity")
    if not maturity:
        collection = props.get("collectionName") or ""
        maturity = next((value for value in ("VALIDATED", "PROVISIONAL", "BETA") if value in collection.upper()), None)
        if maturity:
            provenance["data_maturity"] = "provider collectionName"
    if not maturity and props.get("collectionName"):
        from asf_search.CMR.datasets import get_nisar_collection_by_maturity

        for candidate in ["VALIDATED", "PROVISIONAL", "BETA"]:
            if props["collectionName"] in get_nisar_collection_by_maturity([candidate]):
                maturity = candidate
                provenance["data_maturity"] = "provider collectionName matched installed ASF collection maturity mapping"
                break
    return Scene(
        scene_id=scene_id, dataset=props.get("platform"), product_type=props.get("processingLevel"),
        data_maturity=maturity, acquisition_datetime=parse_datetime(props.get("startTime")),
        processing_datetime=parse_datetime(props.get("processingDate")), flight_direction=props.get("flightDirection"),
        geometry=feature.get("geometry"), polarizations=polarizations(props.get("mainBandPolarization") or props.get("polarization")),
        frequency=frequency, source="ASF", download_available=bool(props.get("url")),
        orbit_information={key: props.get(key) for key in ["pathNumber", "frameNumber", "lookDirection", "beamModeType", "rangeBandwidth", "crid"]},
        metadata={"original": feature, "normalization_provenance": provenance},
    )


def public_metadata(value):
    if isinstance(value, dict):
        output = {}
        for key, item in value.items():
            if key == "license" and isinstance(item, str):
                output[key] = item
            elif key == "source_url" and isinstance(item, str):
                parsed = urlparse(item)
                if parsed.scheme == "https" and parsed.hostname and not (parsed.username or parsed.password or parsed.query or parsed.fragment):
                    output[key] = item
            elif not any(word in key.lower() for word in ("password", "token", "secret", "authorization", "cookie", "url", "href", "path", "username")):
                output[key] = public_metadata(item)
        return output
    if isinstance(value, list):
        return [public_metadata(item) for item in value]
    if isinstance(value, str) and ("://" in value or value.startswith("/")):
        return "[redacted resource reference]"
    return value