from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from shapely.geometry import box, mapping, shape

SCENE_ID_PATTERN = r"^[A-Za-z0-9_.-]{1,300}$"


class CatalogSearch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["ASF", "BHOONIDHI"] = "ASF"
    dataset: Literal["NISAR"] = "NISAR"
    aoi: dict | None = None
    bbox: tuple[float, float, float, float] | None = None
    start: AwareDatetime
    end: AwareDatetime
    product_type: Literal["GCOV", "GSLC", "GUNW", "GOFF", "SME2", "RSLC", "RIFG", "RUNW", "ROFF"] = "GCOV"
    data_maturity: Literal["VALIDATED", "PROVISIONAL", "BETA"] | None = "VALIDATED"
    frequency: Literal["L", "S"] = "L"
    frequency_group: Literal["A", "B"] = "A"
    flight_direction: Literal["ASCENDING", "DESCENDING"] | None = None
    polarization: Literal["HH", "HH+HV", "HH+VV", "HH+HV+VH+VV", "VV", "VV+VH", "LH+LV", "RH+RV"] | None = None
    relative_orbit: int | None = Field(default=None, ge=1, le=173)
    frame: int | None = Field(default=None, ge=1, le=176)
    frame_coverage: Literal["FULL", "PARTIAL"] | None = None
    limit: int = Field(default=25, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=400)

    @model_validator(mode="after")
    def valid_query(self):
        if self.start >= self.end:
            raise ValueError("start must be before end")
        if (self.aoi is None) == (self.bbox is None):
            raise ValueError("Provide exactly one of aoi or bbox")
        if self.bbox is not None:
            west, south, east, north = self.bbox
            if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
                raise ValueError("Invalid WGS84 bbox; split dateline-crossing searches")
            self.aoi = mapping(box(*self.bbox))
        try:
            polygon = shape(self.aoi)
            west, south, east, north = polygon.bounds
            parts = [polygon] if polygon.geom_type == "Polygon" else list(polygon.geoms) if polygon.geom_type == "MultiPolygon" else []
            vertices = sum(len(part.exterior.coords) for part in parts)
            valid = (bool(parts) and polygon.is_valid and not polygon.is_empty
                     and all(part.is_valid and not part.interiors for part in parts)
                     and -180 <= west < east <= 180 and -90 <= south < north <= 90 and vertices <= 400)
        except (ValueError, TypeError, KeyError):
            valid = False
        if not valid:
            raise ValueError("AOI must be a valid WGS84 Polygon or MultiPolygon, without holes, at most 400 vertices")
        if (self.provider == "ASF" and self.frequency != "L") or (self.provider == "BHOONIDHI" and self.frequency != "S"):
            raise ValueError("Use ASF for L-band and the separately authorized Bhoonidhi adapter for S-band")
        if self.provider == "ASF" and self.data_maturity is None:
            raise ValueError("ASF discovery requires an explicit maturity; search provisional separately")
        return self


class Scene(BaseModel):
    scene_id: str = Field(pattern=SCENE_ID_PATTERN)
    dataset: str | None = None
    product_type: str | None = None
    data_maturity: str | None = None
    acquisition_datetime: datetime | None = None
    processing_datetime: datetime | None = None
    flight_direction: str | None = None
    geometry: dict | None = None
    polarizations: list[str] = Field(default_factory=list)
    frequency: str | None = None
    source: str
    orbit_information: dict = Field(default_factory=dict)
    download_available: bool = False
    metadata: dict = Field(default_factory=dict)


class CompatibilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    before_scene_id: str = Field(pattern=SCENE_ID_PATTERN)
    after_scene_id: str = Field(pattern=SCENE_ID_PATTERN)
    location_slug: str = Field(default="kuttanad", pattern=r"^[a-z0-9-]{1,100}$")
    polarization: Literal["HHHH", "HVHV", "VVVV", "VHVH", "RHRH", "RVRV"] = "HHHH"
    frequency_group: Literal["A", "B"] = "A"


class DownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["full", "aoi_subset"] = "full"
    location_slug: str = Field(default="kuttanad", pattern=r"^[a-z0-9-]{1,100}$")
    polarization: Literal["HHHH", "HVHV", "VVVV", "VHVH", "RHRH", "RVRV"] = "HHHH"
    frequency_group: Literal["A", "B"] = "A"
    max_remote_mib: int = Field(default=128, ge=4, le=256)
    additional_polarizations: list[Literal["HHHH", "HVHV", "VVVV", "VHVH", "RHRH", "RVRV"]] = Field(default_factory=list, max_length=5)
    replace_existing: bool = False

    @model_validator(mode="after")
    def distinct_terms(self):
        if self.polarization in self.additional_polarizations or len(set(self.additional_polarizations)) != len(self.additional_polarizations):
            raise ValueError("Requested covariance terms must be distinct")
        return self