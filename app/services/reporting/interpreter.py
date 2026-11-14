import json
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import get_settings


class ClauseSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    clause_ids: list[Literal["sources", "dates", "statistics"]] = Field(min_length=1, max_length=3)


def ai_configured(settings):
    return bool(settings.ai_enabled and settings.ai_provider.lower() == "openai"
                and settings.ai_model and settings.ai_api_key.get_secret_value())


def interpret_result(result, settings=None, client=None):
    settings = settings or get_settings()
    metadata = result.metadata_json
    clauses = {
        "sources": "Source observations: " + ", ".join(metadata.get("source_scenes", [])) + ".",
        "dates": "Recorded acquisition timestamps: " + ", ".join(metadata.get("acquisition_dates", [])) + ".",
        "statistics": "Computed statistics, not damage estimates: " + json.dumps(result.statistics, sort_keys=True) + ".",
    }
    selected = list(clauses)
    status = "disabled" if not settings.ai_enabled else "not_configured"
    if ai_configured(settings):
        owned_client = client is None
        client = client or httpx.Client(timeout=10, follow_redirects=False)
        try:
            response = client.post("https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {settings.ai_api_key.get_secret_value()}"},
                json={"model": settings.ai_model, "max_output_tokens": 256,
                      "instructions": "Select and order only existing clause IDs for a scientific summary. Do not create text, numbers, acquisitions, predictions or claims.",
                      "input": json.dumps({"available_clauses": clauses, "validation_status": result.validation_status}),
                      "text": {"format": {"type": "json_schema", "name": "flagwa_verified_clause_selection", "strict": True,
                                           "schema": ClauseSelection.model_json_schema()}}})
            if response.status_code != 200:
                raise ValueError("provider request failed")
            data = response.json()
            if data.get("status") not in (None, "completed"):
                raise ValueError("provider response incomplete")
            text = next(content["text"] for output in data.get("output", []) for content in output.get("content", [])
                        if content.get("type") == "output_text")
            selection = ClauseSelection.model_validate_json(text)
            selected = list(dict.fromkeys(selection.clause_ids))
            status = "verified_clause_selection"
        except Exception:
            status = "fallback_provider_unavailable_or_invalid"
        finally:
            if owned_client:
                client.close()
    sentences = [f"Recorded analysis: {result.result_type}.", f"Scientific review status: {result.validation_status}."]
    synthetic = bool(metadata.get("synthetic") or any(identifier.startswith("SYNTHETIC") for identifier in metadata.get("source_scenes", [])))
    if synthetic:
        sentences.append("SYNTHETIC/SCENARIO inputs are present; this is not an independently verified observation of an event.")
    sentences.extend(clauses[identifier] for identifier in selected)
    sentences.extend(result.uncertainty_notes)
    sentences.append("This is not a disaster forecast, flood-depth measurement, crop-yield estimate, three-dimensional motion vector or affected-person count.")
    return {"analysis_id": result.id, "interpretation_status": status, "validation_status": result.validation_status, "synthetic": synthetic,
            "text": " ".join(sentences), "source_clauses": selected,
            "safety_method": "The provider selects enumerated clause IDs only; all published text and measurements are rendered from stored records by the server"}