import inspect

import asf_search as asf
from shapely.geometry import shape

from app.core.config import get_settings
from app.core.exceptions import FlagwaError
from app.schemas.catalog import CatalogSearch
from app.services.nisar.earthdata_auth import BoundedASFSession
from app.services.nisar.scene_metadata import normalize_asf


class ASFClient:
    def search(self, query: CatalogSearch):
        kwargs = {
            "dataset": "NISAR", "processingLevel": query.product_type,
            "dataMaturity": query.data_maturity, "intersectsWith": shape(query.aoi).wkt,
            "start": query.start, "end": query.end, "maxResults": query.offset + query.limit + 1,
        }
        optional = {"flightDirection": query.flight_direction, "relativeOrbit": query.relative_orbit,
                    "frame": query.frame, "frameCoverage": query.frame_coverage}
        if query.polarization:
            optional["mainBandPolarization" if query.frequency_group == "A" else "sideBandPolarization"] = query.polarization
        kwargs.update({key: value for key, value in optional.items() if value is not None})
        if not kwargs.keys() <= inspect.signature(asf.search).parameters.keys():
            raise FlagwaError("ASF_VERSION_UNSUPPORTED", "Installed ASF SDK lacks required search parameters", 503)
        try:
            with BoundedASFSession(get_settings().provider_timeout_seconds) as session:
                results = asf.search(**kwargs, session=session)
                results.raise_if_incomplete()
                raw = results.geojson()
            features = raw.get("features", [])
            scenes = [normalize_asf(feature) for feature in features[query.offset:query.offset + query.limit]]
            return scenes, len(features) > query.offset + query.limit
        except FlagwaError:
            raise
        except Exception:
            raise FlagwaError("ASF_SEARCH_FAILED", "ASF catalogue request failed or returned incomplete metadata", 502) from None

    def resolve(self, scene_id):
        try:
            with BoundedASFSession(get_settings().provider_timeout_seconds) as session:
                results = asf.search(dataset="NISAR", granule_list=[scene_id], session=session)
                results.raise_if_incomplete()
                matches = [item for item in results.geojson().get("features", [])
                           if normalize_asf(item).scene_id == scene_id]
            if len(matches) != 1:
                raise FlagwaError("SCENE_NOT_FOUND", "Exact NISAR scene was not found at ASF", 404)
            return matches[0]
        except FlagwaError:
            raise
        except Exception:
            raise FlagwaError("ASF_RESOLVE_FAILED", "Could not resolve selected ASF scene", 502) from None