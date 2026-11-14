import json
from pathlib import Path

from geoalchemy2.shape import from_shape
from shapely.geometry import shape
from sqlalchemy import select

from app.database.session import session_factory
from app.models import CaseStudy, Location

LOCATIONS = [
    ("kuttanad", "Kuttanad-Alappuzha, Kerala", "India", "Asia", "flood", "How does comparable GCOV backscatter change across the draft Kuttanad study window?"),
    ("xingu", "Xingu / Amazon", "Brazil", "South America", "forest", "Where do independently validated forest-disturbance candidates occur?"),
    ("north-jakarta", "North Jakarta", "Indonesia", "Asia", "deformation", "Can quality-controlled interferometry constrain line-of-sight deformation?"),
    ("khumbu", "Khumbu", "Nepal", "Asia", "glacier", "Can quality-screened offsets constrain glacier movement?"),
    ("tillaberi", "Tillaberi", "Niger", "Africa", "agriculture", "What seasonal surface-response changes are supported by observations and rainfall?"),
    ("paradise", "Paradise, California", "USA", "North America", "wildfire", "What radar changes coincide with independently mapped wildfire perimeters?"),
    ("campi-flegrei", "Campi Flegrei", "Italy", "Europe", "deformation", "What referenced line-of-sight displacement is supported by quality-controlled interferograms?"),
    ("queensland", "Queensland", "Australia", "Oceania", "wildfire", "What surface changes align with independently validated fire and vegetation disturbance?"),
]


def seed_locations(session):
    aoi = json.loads(Path("config/kuttanad_aoi.geojson").read_text())["features"][0]["geometry"]
    for slug, name, country, continent, theme, question in LOCATIONS:
        location = session.scalar(select(Location).where(Location.slug == slug))
        if location is None:
            location = Location(name=name, slug=slug, country=country, continent=continent, hazard_type=theme,
                                is_active=slug == "kuttanad", geometry=from_shape(shape(aoi), srid=4326) if slug == "kuttanad" else None,
                                description="Draft rectangular AOI, not an authoritative floodplain boundary" if slug == "kuttanad" else "Research location; boundary, archive availability and scientific workflow are unverified")
            session.add(location)
            session.flush()
        if session.scalar(select(CaseStudy).where(CaseStudy.slug == slug)) is None:
            session.add(CaseStudy(location_id=location.id, slug=slug, title=name, scientific_question=question,
                                  data_status="unverified", priority=1 if slug == "kuttanad" else 2))
    session.commit()


if __name__ == "__main__":
    with session_factory() as session:
        seed_locations(session)
    print("Reference locations seeded idempotently; no satellite observations or results fabricated")