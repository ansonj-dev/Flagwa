import argparse
import json
from pathlib import Path

from app.database.session import session_factory
from app.schemas.analysis import ContextRegistration
from app.services.study_areas import set_study_area


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Replace a study AOI explicitly, preserving source provenance and refusing active jobs")
    parser.add_argument("geojson", type=Path)
    parser.add_argument("--metadata", required=True, type=Path)
    parser.add_argument("--reviewed-by", required=True)
    parser.add_argument("--feature-id")
    args = parser.parse_args()
    registration = ContextRegistration.model_validate_json(args.metadata.read_text())
    with session_factory() as session:
        layer = set_study_area(session, args.geojson, registration, args.reviewed_by, args.feature_id)
        print(json.dumps({"boundary_layer_id": layer.id, "version": layer.version, "status": "operator_reviewed_not_scientific_event_validation"}))