import argparse
import json
from pathlib import Path

from app.database.session import session_factory
from app.schemas.analysis import ContextRegistration
from app.services.study_areas import set_draft_study_area


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Register a sourced study boundary as draft; this does not certify operator review")
    parser.add_argument("geojson", type=Path)
    parser.add_argument("--metadata", required=True, type=Path)
    parser.add_argument("--feature-id")
    args = parser.parse_args()
    registration = ContextRegistration.model_validate_json(args.metadata.read_text())
    with session_factory() as session:
        layer = set_draft_study_area(session, args.geojson, registration, args.feature_id)
        print(json.dumps({"boundary_layer_id": layer.id, "version": layer.version, "status": "draft_or_unreviewed"}))