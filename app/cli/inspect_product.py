import argparse
import json
from pathlib import Path

from app.services.processing.hdf5_reader import inspect_product


def main():
    parser = argparse.ArgumentParser(description="Inspect actual HDF5 layers, frequency groups, coordinates and fill values")
    parser.add_argument("product", type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect_product(args.product), indent=2))


if __name__ == "__main__":
    main()