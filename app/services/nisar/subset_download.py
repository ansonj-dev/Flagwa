import hashlib

import h5py
import numpy as np

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.services.nisar.remote_product import open_remote_product
from app.services.nisar.scene_download import scene_key
from app.services.processing.hdf5_reader import read_gcov
from app.services.storage import get_storage
from app.services.storage.local import LocalStorage


def write_subset(path, layer, scene_id, frequency_group, term):
    with h5py.File(path, "w") as product:
        product.attrs["flagwa_derivative"] = "AOI subset of genuine provider data; not a complete NISAR product"
        product.attrs["source_scene_id"] = scene_id
        group = product.create_group(f"science/LSAR/GCOV/grids/frequency{frequency_group}")
        group.create_dataset(term, data=layer.data, compression="gzip").attrs["units"] = "1"
        group.create_dataset("projection", data=layer.crs.to_epsg())
        group.create_dataset("xCoordinates", data=layer.transform.c + (np.arange(layer.data.shape[1]) + .5) * layer.transform.a)
        group.create_dataset("yCoordinates", data=layer.transform.f + (np.arange(layer.data.shape[0]) + .5) * layer.transform.e)
        if layer.quality_values is not None:
            dataset = group.create_dataset("mask", data=layer.quality_values, compression="gzip")
            dataset.attrs["_FillValue"] = 255
            dataset.attrs["description"] = "Original GCOV subswath quality codes; 0 invalid and 255 outside acquisition; original source codes preserved"
        identification = product.create_group("science/LSAR/identification")
        for key, value in layer.metadata.get("identification", {}).items():
            if isinstance(value, (str, int, float, bool)):
                identification.create_dataset(key, data=value)


def download_subset(scene, aoi, options, progress):
    if scene.provider != "ASF" or scene.product_type != "GCOV":
        raise FlagwaError("SUBSET_NOT_SUPPORTED", "Selective AOI acquisition currently supports ASF GCOV only", 422)
    settings, storage = get_settings(), get_storage()
    stage = LocalStorage(settings.local_storage_path)
    key = scene_key(scene.scene_id).replace("product.h5", f"subset-{options['frequency_group']}-{options['polarization']}.h5")
    target = stage.path(key + ".partial")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open_remote_product(scene.scene_id, options["max_remote_mib"] * 1024 * 1024) as (remote, budget):
            layer = read_gcov(remote, aoi, term=options["polarization"], frequency_group=options["frequency_group"],
                              quality_valid_values=list(range(1, 255)))
        progress(65)
        identification = layer.metadata.get("identification", {})
        if identification.get("granuleId") != scene.scene_id or identification.get("productType") != "GCOV":
            raise FlagwaError("PRODUCT_IDENTITY_MISMATCH", "Remote product identity does not match the selected catalogue scene", 422)
        write_subset(target, layer, scene.scene_id, options["frequency_group"], options["polarization"])
        progress(80)
        storage.put_file(target, key)
        digest = hashlib.sha256()
        with target.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        return key, {"mode": "aoi_subset", "full_product_downloaded": False, "synthetic": False,
                     "bytes": target.stat().st_size, "sha256": digest.hexdigest(), "checksum_scope": "derived AOI subset only",
                     "requested_range_bytes": budget.requested, "source_scene_id": scene.scene_id,
                     "frequency_group": options["frequency_group"], "polarization": options["polarization"],
                     "quality_codes_observed": np.unique(layer.quality_values).tolist() if layer.quality_values is not None else [],
                     "quality_note": "Acquisition excludes code 0 (invalid) and 255 (outside). Analysis must supply reviewed valid subswath codes.",
                     "aoi": aoi}
    finally:
        target.unlink(missing_ok=True)