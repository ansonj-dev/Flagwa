import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from app.core.exceptions import FlagwaError
from app.database.session import session_factory
from app.schemas.analysis import ContextRegistration
from app.services.context.providers import ContextProviders
from app.services.study_areas import set_draft_study_area


def select_feature(collection, feature_name=None, feature_id=None):
    if bool(feature_name) == bool(feature_id):
        raise FlagwaError("BOUNDARY_SELECTION_REQUIRED", "Supply exactly one feature name or feature ID", 422)
    features = collection.get("features", [])
    if feature_id:
        matches = [feature for feature in features
                   if str(feature.get("id", feature.get("properties", {}).get("shapeID"))) == feature_id]
    else:
        matches = [feature for feature in features
                   if str(feature.get("properties", {}).get("shapeName", feature.get("properties", {}).get("name", ""))).casefold() == feature_name.casefold()]
    if len(matches) != 1:
        raise FlagwaError("BOUNDARY_SELECTION_REQUIRED", f"Expected one matching source feature, found {len(matches)}; use its exact feature ID", 422)
    return matches[0]


def main():
    parser = argparse.ArgumentParser(description="Fetch one exact geoBoundaries feature and register it as a draft, unreviewed study area")
    parser.add_argument("--location", required=True)
    parser.add_argument("--country", required=True, help="ISO alpha-3 country code")
    parser.add_argument("--level", required=True, choices=["ADM0", "ADM1", "ADM2", "ADM3"])
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--feature-name")
    selection.add_argument("--feature-id")
    args = parser.parse_args()
    providers = ContextProviders()
    try:
        source = providers.boundaries(args.country.upper(), args.level)[0]
        collection = providers.json("GET", source["assets"]["geojson"]["href"], response_limit_bytes=64 * 1024 * 1024)
        feature = select_feature(collection, args.feature_name, args.feature_id)
        if not source.get("license") or not source.get("version"):
            raise FlagwaError("BOUNDARY_PROVENANCE_REQUIRED", "geoBoundaries did not report a license and version", 422)
        properties = feature.get("properties", {})
        registration = ContextRegistration(
            location_slug=args.location,
            layer_type="boundaries",
            source=source["source"],
            source_url=source["source_url"],
            license=source["license"],
            version=str(source["version"]),
            retrieved_at=datetime.now(timezone.utc).isoformat(),
            crs="EPSG:4326",
            resolution="vector",
            units="features",
            processing_notes="Exact geoBoundaries feature retained as a draft, unreviewed study area; it is not an observed hazard extent.",
            provider_metadata={"provider": "geoBoundaries gbOpen", "country": args.country.upper(), "level": args.level,
                               "source_feature_id": str(feature.get("id", properties.get("shapeID", ""))) or None,
                               "source_feature_properties": properties},
        )
        with TemporaryDirectory(prefix="source-aoi-") as directory:
            path = Path(directory) / "boundary.geojson"
            path.write_text(json.dumps({"type": "FeatureCollection", "features": [feature]}))
            with session_factory() as session:
                layer = set_draft_study_area(session, path, registration)
        print(json.dumps({"boundary_layer_id": layer.id, "location": args.location, "version": layer.version,
                          "status": "draft_or_unreviewed", "feature": properties.get("shapeName") or properties.get("name")}))
        return 0
    except FlagwaError as error:
        print(json.dumps({"success": False, "code": error.code, "message": error.message}))
        return 1
    finally:
        providers.close()


if __name__ == "__main__":
    raise SystemExit(main())