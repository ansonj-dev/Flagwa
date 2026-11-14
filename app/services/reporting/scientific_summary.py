def scientific_summary(metadata, statistics):
    return {
        "title": "FLAGWA potential-inundation candidates",
        "analysis_id": metadata["analysis_id"],
        "statement": "Threshold-based radar surface-response candidates, not a confirmed flood extent or flood-depth estimate.",
        "source_scenes": metadata["source_scenes"],
        "acquisition_dates": metadata["acquisition_dates"],
        "statistics": statistics,
        "validation_status": "pending_validation",
        "uncertainty_notes": metadata["uncertainty_notes"],
        "historical_context": "NISAR launched in 2025 and did not observe the Kerala 2018 floods.",
    }