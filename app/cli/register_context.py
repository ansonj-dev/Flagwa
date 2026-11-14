import argparse
import json
from pathlib import Path

from app.database.session import session_factory
from app.schemas.analysis import ContextRegistration
from app.services.context.registry import register_context


def main():
    parser = argparse.ArgumentParser(description="Operator-only import of a reviewed local context dataset")
    parser.add_argument("product", type=Path)
    parser.add_argument("--metadata", required=True, type=Path)
    args = parser.parse_args()
    registration = ContextRegistration.model_validate_json(args.metadata.read_text())
    with session_factory() as session:
        layer = register_context(session, args.product, registration)
        print(json.dumps({"context_layer_id": layer.id, "source": layer.source, "version": layer.version}))


if __name__ == "__main__":
    main()