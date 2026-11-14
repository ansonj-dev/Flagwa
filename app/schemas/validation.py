from pydantic import BaseModel, ConfigDict, Field


class ReviewChecklist(BaseModel):
    model_config = ConfigDict(extra="forbid")
    temporal_alignment: bool = False
    reference_independence: bool = False
    geometry_quality: bool = False
    classification_review: bool = False
    uncertainty_review: bool = False


class ValidationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reference_layer_id: str
    reference_positive_values: list[int] = Field(min_length=1, max_length=100)
    minimum_iou: float = Field(ge=0, le=1, allow_inf_nan=False)
    minimum_precision: float = Field(ge=0, le=1, allow_inf_nan=False)
    minimum_recall: float = Field(ge=0, le=1, allow_inf_nan=False)
    minimum_valid_pixels: int = Field(default=100, ge=1)
    minimum_reference_positive_pixels: int = Field(default=1, ge=1)
    minimum_coverage: float = Field(default=.9, gt=0, le=1, allow_inf_nan=False)
    maximum_reference_age_days: float = Field(default=3, ge=0, le=30, allow_inf_nan=False)
    reviewed_by: str = Field(min_length=3, max_length=120)
    review_notes: str = Field(min_length=20, max_length=3000)
    independence_statement: str = Field(min_length=20, max_length=3000)
    checklist: ReviewChecklist = Field(default_factory=ReviewChecklist)
    approve: bool = False