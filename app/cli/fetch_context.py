import argparse
import json

from geoalchemy2.shape import to_shape
from shapely.geometry import mapping
from sqlalchemy import select

from app.core.exceptions import FlagwaError
from app.database.session import session_factory
from app.models import Location
from app.services.context.ingestion import import_discovered, import_osm
from app.services.context.providers import ContextProviders
from app.services.nisar.scene_metadata import public_metadata


def main():
    parser = argparse.ArgumentParser(description="Discover real context datasets; import only explicitly selected, licensed assets")
    parser.add_argument("--provider", required=True, choices=["osm", "worldpop", "worldcover", "dem", "boundaries", "rainfall"])
    parser.add_argument("--location", default="kuttanad")
    parser.add_argument("--country", default="IND")
    parser.add_argument("--layer", default="settlements", choices=["settlements", "infrastructure", "hydrology"])
    parser.add_argument("--boundary-level", default="ADM2", choices=["ADM0", "ADM1", "ADM2", "ADM3"])
    parser.add_argument("--collection-id")
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--item-id")
    parser.add_argument("--asset-key")
    parser.add_argument("--units")
    parser.add_argument("--license", dest="license_value")
    parser.add_argument("--version")
    parser.add_argument("--import", dest="import_data", action="store_true")
    args = parser.parse_args()
    providers = ContextProviders()
    try:
        with session_factory() as session:
            location = session.scalar(select(Location).where(Location.slug == args.location))
            if not location or location.geometry is None:
                raise FlagwaError("AOI_NOT_CONFIGURED", "Location has no configured study polygon", 422)
            aoi = mapping(to_shape(location.geometry))
            if args.provider == "osm":
                if args.import_data:
                    layer = import_osm(session, providers, args.location, args.layer)
                    print(json.dumps({"id": layer.id, "source": layer.source, "version": layer.version}))
                else:
                    collection, provenance = providers.osm(aoi, args.layer)
                    print(json.dumps({"features_returned": len(collection["features"]), "provenance": provenance}, indent=2))
                return 0
            if args.provider == "worldpop":
                items = providers.worldpop(args.country)
            elif args.provider in {"worldcover", "dem"}:
                items = providers.planetary(args.provider, aoi)
            elif args.provider == "boundaries":
                items = providers.boundaries(args.country, args.boundary_level)
            else:
                items = providers.rainfall(aoi, args.collection_id, args.start, args.end)
            if not args.import_data:
                print(json.dumps(public_metadata({"provider": args.provider, "items": items}), indent=2))
                return 0
            item = next((item for item in items if item.get("id") == args.item_id), None)
            if item is None or not args.asset_key or not args.units:
                raise FlagwaError("CONTEXT_SELECTION_REQUIRED", "Import requires an actual discovered --item-id, --asset-key and verified --units", 422)
            layer = import_discovered(session, providers, args.location, item, args.asset_key, args.units, args.license_value, args.version)
            print(json.dumps({"id": layer.id, "source": layer.source, "version": layer.version}))
            return 0
    except FlagwaError as error:
        print(json.dumps({"success": False, "code": error.code, "message": error.message}))
        return 1
    finally:
        providers.close()


if __name__ == "__main__":
    raise SystemExit(main())