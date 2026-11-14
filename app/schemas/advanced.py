from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.catalog import CompatibilityRequest, SCENE_ID_PATTERN

ValidCode = Annotated[int, Field(ge=1, le=254)]
SceneIdentifier = Annotated[str, Field(pattern=SCENE_ID_PATTERN)]
DatasetPath = Annotated[str, Field(pattern=r"^/[A-Za-z0-9_./-]{1,500}$")]


class GCOVParameters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    quality_valid_values: list[ValidCode] = Field(min_length=1, max_length=100)
    quality_rule_source: str = Field(min_length=20, max_length=2000)
    scientific_basis: str = Field(min_length=20, max_length=2000)


class ForestParameters(GCOVParameters):
    co_drop_db: float = Field(default=-3, ge=-30, lt=0, allow_inf_nan=False)
    cross_drop_db: float = Field(default=-3, ge=-30, lt=0, allow_inf_nan=False)
    smoothing_kernel: int = Field(default=3, ge=1, le=9)
    minimum_component_pixels: int = Field(default=4, ge=1, le=10000)

    @field_validator("smoothing_kernel")
    @classmethod
    def odd_kernel(cls, value):
        if value % 2 != 1:
            raise ValueError("Smoothing kernel must be odd")
        return value


class ForestRequest(CompatibilityRequest):
    polarization: Literal["HHHH", "VVVV"] = "HHHH"
    cross_polarization: Literal["HVHV", "VHVH"] = "HVHV"
    landcover_layer_id: str
    forest_classes: list[int] = Field(min_length=1, max_length=50)
    independent_validation_layer_id: str | None = None
    forest_loss_positive_values: list[int] = Field(default=[1], min_length=1, max_length=100)
    parameters: ForestParameters

    @model_validator(mode="after")
    def matching_channels(self):
        if {"HHHH": "HVHV", "VVVV": "VHVH"}[self.polarization] != self.cross_polarization:
            raise ValueError("Co- and cross-polarization terms must share the transmit polarization")
        return self


class WildfireParameters(GCOVParameters):
    minimum_change_db: float = Field(default=3, gt=0, le=30, allow_inf_nan=False)
    smoothing_kernel: int = Field(default=3, ge=1, le=9)
    minimum_component_pixels: int = Field(default=4, ge=1, le=10000)

    @field_validator("smoothing_kernel")
    @classmethod
    def odd_kernel(cls, value):
        return ForestParameters.odd_kernel(value)


class WildfireRequest(ForestRequest):
    landcover_layer_id: str | None = None
    forest_classes: list[int] = Field(default_factory=list)
    burn_perimeter_layer_id: str
    optical_burn_layer_id: str
    event_datetime: AwareDatetime
    parameters: WildfireParameters


class AgricultureParameters(GCOVParameters):
    minimum_observations: int = Field(default=3, ge=3, le=24)
    minimum_span_days: float = Field(default=24, ge=1, le=3660, allow_inf_nan=False)


class AgricultureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    location_slug: str = Field(default="kuttanad", pattern=r"^[a-z0-9-]{1,100}$")
    scene_ids: list[SceneIdentifier] = Field(min_length=3, max_length=24)
    polarization: Literal["HHHH", "HVHV", "VVVV", "VHVH", "RHRH", "RVRV"] = "HHHH"
    frequency_group: Literal["A", "B"] = "A"
    landcover_layer_id: str
    agriculture_classes: list[int] = Field(min_length=1, max_length=50)
    rainfall_layer_id: str | None = None
    parameters: AgricultureParameters

    @model_validator(mode="after")
    def enough_distinct_dates(self):
        if len(set(self.scene_ids)) != len(self.scene_ids) or len(self.scene_ids) < self.parameters.minimum_observations:
            raise ValueError("Enough distinct source scenes are required")
        return self


class ProductRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scene_id: SceneIdentifier
    location_slug: str = Field(pattern=r"^[a-z0-9-]{1,100}$")


class GlacierParameters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    minimum_quality: float = Field(ge=0, allow_inf_nan=False)
    quality_metric: Literal["correlation", "snr"]
    quality_rule_source: str = Field(min_length=20)
    scientific_basis: str = Field(min_length=20)
    along_track_pixel_spacing_m: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    slant_range_pixel_spacing_m: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    pixel_spacing_source: str | None = None


class GlacierRequest(ProductRequest):
    along_track_dataset: DatasetPath
    slant_range_dataset: DatasetPath
    quality_dataset: DatasetPath
    glacier_layer_id: str
    glacier_classes: list[int] = Field(default=[1], min_length=1, max_length=50)
    parameters: GlacierParameters


class DeformationParameters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    minimum_coherence: float = Field(default=.3, ge=0, le=1, allow_inf_nan=False)
    reference_point: tuple[float, float]
    reference_justification: str = Field(min_length=20)
    phase_to_range_sign: Literal[-1, 1]
    phase_convention_source: str = Field(min_length=20)
    correction_assessment: str = Field(min_length=20)

    @field_validator("reference_point")
    @classmethod
    def valid_reference(cls, value):
        longitude, latitude = value
        if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
            raise ValueError("Reference point must be finite WGS84 longitude, latitude")
        return value


class DeformationRequest(ProductRequest):
    phase_dataset: DatasetPath
    coherence_dataset: DatasetPath
    connected_components_dataset: DatasetPath
    center_frequency_dataset: DatasetPath
    phase_correction_layer_ids: list[str] = Field(default_factory=list, max_length=10)
    parameters: DeformationParameters