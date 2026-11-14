import argparse
import json

from app.database.session import session_factory
from app.services.context.jrc import import_jrc_water


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import a real, source-attributed historical JRC permanent-water baseline")
    parser.add_argument("--location", default="kuttanad")
    args = parser.parse_args()
    with session_factory() as session:
        layer = import_jrc_water(session, args.location)
        print(json.dumps({"context_layer_id": layer.id, "source": layer.source, "version": layer.version, "provenance": layer.metadata_json}, indent=2))