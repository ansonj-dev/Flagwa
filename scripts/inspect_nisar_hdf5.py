"""List HDF5 datasets/groups in a NISAR product; does not assume a fixed internal path."""
from __future__ import annotations

import argparse
from pathlib import Path

import h5py


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("product", type=Path, help="Path to a downloaded NISAR .h5 product")
    parser.add_argument("--contains", default="", help="Optional case-insensitive substring filter")
    parser.add_argument("--output", type=Path, default=None, help="Optional text file for the listing")
    args = parser.parse_args()

    if not args.product.exists():
        raise SystemExit(f"File does not exist: {args.product}")

    lines: list[str] = []
    with h5py.File(args.product, "r") as h5:
        def visitor(name: str, obj: h5py.Group | h5py.Dataset) -> None:
            if args.contains and args.contains.lower() not in name.lower():
                return
            if isinstance(obj, h5py.Dataset):
                lines.append(f"DATASET  /{name}  shape={obj.shape}  dtype={obj.dtype}")
            else:
                lines.append(f"GROUP    /{name}")
        h5.visititems(visitor)

    text = "\n".join(lines) if lines else "No matching HDF5 paths found. Remove --contains to list all paths."
    print(text)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
        print(f"\nSaved listing: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
