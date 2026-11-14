import numpy as np
from rasterio.enums import Resampling
from rasterio.warp import reproject

from app.services.processing.hdf5_reader import RasterLayer


def align_to(reference: RasterLayer, other: RasterLayer, categorical=False):
    target = np.full(reference.data.shape, np.nan, dtype="float32")
    source_data = np.where(other.quality, other.data, np.nan) if other.quality is not None else other.data
    reproject(source=source_data, destination=target, src_transform=other.transform, src_crs=other.crs,
              dst_transform=reference.transform, dst_crs=reference.crs, src_nodata=np.nan,
              dst_nodata=np.nan, resampling=Resampling.nearest if categorical else Resampling.bilinear, num_threads=1)
    quality = None
    if other.quality is not None:
        quality = np.zeros(reference.data.shape, dtype="uint8")
        reproject(source=other.quality.astype("uint8"), destination=quality,
                  src_transform=other.transform, src_crs=other.crs, dst_transform=reference.transform,
                  dst_crs=reference.crs, src_nodata=0, dst_nodata=0, resampling=Resampling.nearest)
        quality = quality.astype(bool)
    return RasterLayer(target, reference.crs, reference.transform, quality,
                       dict(other.metadata or {}, alignment="nearest categorical values on reference grid" if categorical else "bilinear values in declared source units; nearest quality; reference grid"))


def read_context_grid(path, reference, categorical=True):
    import rasterio

    with rasterio.open(path) as source:
        output = np.full(reference.data.shape, np.nan, dtype="float32")
        if not source.crs:
            raise ValueError("Context raster has no CRS")
        reproject(source=rasterio.band(source, 1), destination=output,
                  src_transform=source.transform, src_crs=source.crs, src_nodata=source.nodata,
                  dst_transform=reference.transform, dst_crs=reference.crs, dst_nodata=np.nan,
                  resampling=Resampling.nearest if categorical else Resampling.bilinear)
    return output