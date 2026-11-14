from types import SimpleNamespace

import httpx

from app.core.config import Settings
from app.services.reporting.interpreter import interpret_result


def synthetic_result():
    return SimpleNamespace(id="SYNTHETIC_RESULT", result_type="potential_inundation", validation_status="pending_validation",
        statistics={"candidate_area_m2": 100}, uncertainty_notes=["SYNTHETIC fixture, not genuine observed flooding"],
        metadata_json={"source_scenes": ["SYNTHETIC_SCENE"], "acquisition_dates": ["SYNTHETIC_DATE"]})


def test_optional_ai_is_not_required():
    result = interpret_result(synthetic_result(), Settings(_env_file=None))
    assert result["interpretation_status"] == "disabled"
    assert "pending_validation" in result["text"]
    assert "not a disaster forecast" in result["text"]
    assert result["synthetic"] is True
    assert "SYNTHETIC/SCENARIO" in result["text"]


def test_provider_can_only_select_existing_verified_clauses():
    settings = Settings(_env_file=None, ai_enabled=True, ai_provider="openai", ai_model="synthetic-test-model", ai_api_key="synthetic-secret")
    response = {"status": "completed", "output": [{"content": [{"type": "output_text", "text": '{"clause_ids":["statistics","sources"]}'}]}]}
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=response)))
    result = interpret_result(synthetic_result(), settings, client)
    assert result["interpretation_status"] == "verified_clause_selection"
    assert result["source_clauses"] == ["statistics", "sources"]
    assert "synthetic-secret" not in str(result)


def test_invented_claims_are_rejected_and_fall_back():
    settings = Settings(_env_file=None, ai_enabled=True, ai_provider="openai", ai_model="synthetic-test-model", ai_api_key="synthetic-secret")
    invented = {"output": [{"content": [{"type": "output_text", "text": '{"clause_ids":["confirmed_disaster"],"text":"invented claim"}'}]}]}
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=invented)))
    result = interpret_result(synthetic_result(), settings, client)
    assert result["interpretation_status"] == "fallback_provider_unavailable_or_invalid"
    assert "invented claim" not in result["text"]
    assert "pending_validation" in result["text"]