from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.catalog import CompatibilityRequest


class FloodParameters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    after_db_max: float = Field(default=-17.0, ge=-60, le=10, allow_inf_nan=False)
    change_db_max: float = Field(default=-3.0, ge=-30, lt=0, allow_inf_nan=False)
    before_db_min: float = Field(default=-14.0, ge=-60, le=10, allow_inf_nan=False)
    threshold_basis: str = Field(min_length=20, max_length=2000)
    quality_valid_values: list[Annotated[int, Field(ge=1, le=254)]] = Field(min_length=1, max_length=100)
    quality_rule_source: str = Field(min_length=10, max_length=2000)
    permanent_water_values: list[int] = Field(default=[1], min_length=1, max_length=100)
    max_slope_degrees: float = Field(default=5.0, ge=0, le=90, allow_inf_nan=False)

    @model_validator(mode="after")
    def distinct_water_states(self):
        if self.before_db_min <= self.after_db_max:
            raise ValueError("before_db_min must be brighter than after_db_max for new open-water candidates")
        return self


class AnalysisRequest(CompatibilityRequest):
    model_config = ConfigDict(extra="forbid")
    permanent_water_layer_id: str | None = None
    slope_layer_id: str | None = None
    parameters: FloodParameters | None = None


class ValidationEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: Literal["potential_inundation", "forest_disturbance_candidates", "fire_associated_radar_optical_candidates"]
    sensor: str = Field(min_length=2, max_length=200)
    observation_datetime: AwareDatetime
    independent_of_nisar: bool
    mapping_method: str = Field(min_length=20, max_length=2000)


class ContextRegistration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    location_slug: str
    layer_type: Literal["population", "settlements", "infrastructure", "landcover", "permanent_water", "hydrology", "elevation", "slope", "boundaries", "rainfall", "forest_loss", "fire_perimeter", "optical_burn", "glacier_extent", "phase_correction", "independent_validation"]
    source: str = Field(min_length=1)
    source_url: str = Field(pattern=r"^https://")
    license: str = Field(min_length=1)
    version: str = Field(min_length=1)
    retrieved_at: str
    crs: str
    resolution: str
    processing_notes: str
    units: str
    provider_metadata: dict = Field(default_factory=dict)
    validation_evidence: ValidationEvidence | None = None
    is_synthetic: bool = Field(default=False, description="Test fixtures/simulated observations, not synthetic-aperture radar instruments")

    @field_validator("source_url")
    @classmethod
    def public_source_reference(cls, value):
        parsed = urlparse(value)
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Use a public HTTPS source reference without credentials, query tokens or fragments")
        return value