from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import mapping, shape
from sqlalchemy.dialects.postgresql import insert

from app.models import SatelliteScene
from app.schemas.catalog import Scene


def persist_scene(session, scene: Scene):
    values = dict(scene_id=scene.scene_id, provider=scene.source, satellite=scene.dataset,
                  product_type=scene.product_type, data_maturity=scene.data_maturity,
                  acquisition_datetime=scene.acquisition_datetime, processing_datetime=scene.processing_datetime,
                  frequency=scene.frequency, polarization=scene.polarizations,
                  flight_direction=scene.flight_direction, orbit_information={key: value for key, value in scene.orbit_information.items() if value is not None},
                  footprint=from_shape(shape(scene.geometry), srid=4326) if scene.geometry else None,
                  metadata_json=scene.metadata)
    statement = insert(SatelliteScene).values(**values)
    update_values = {key: getattr(statement.excluded, key) for key in values if key not in {"scene_id", "metadata_json", "orbit_information"}}
    update_values["metadata_json"] = SatelliteScene.metadata_json.op("||")(statement.excluded.metadata_json)
    update_values["orbit_information"] = SatelliteScene.orbit_information.op("||")(statement.excluded.orbit_information)
    session.execute(statement.on_conflict_do_update(index_elements=["scene_id"], set_=update_values))


def scene_model(record):
    return Scene(scene_id=record.scene_id, source=record.provider, dataset=record.satellite,
                 product_type=record.product_type, data_maturity=record.data_maturity,
                 acquisition_datetime=record.acquisition_datetime, processing_datetime=record.processing_datetime,
                 frequency=record.frequency, polarizations=record.polarization, flight_direction=record.flight_direction,
                 geometry=mapping(to_shape(record.footprint)) if record.footprint is not None else None,
                 orbit_information=record.orbit_information, download_available=bool(record.metadata_json.get("original", {}).get("properties", {}).get("url"))
                 or record.provider == "BHOONIDHI", metadata=record.metadata_json)