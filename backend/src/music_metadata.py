"""Shared music release metadata options and backwards-compatible defaults."""

from __future__ import annotations

from typing import Any


MUSIC_RELEASE_FORMATS = (
    "CD",
    "Mini CD",
    "Enhanced CD",
    "SACD",
    "HDCD",
)

MUSIC_RELEASE_TYPES = (
    "Album",
    "Single",
    "Maxi-Single",
    "EP",
    "Compilation",
    "Live",
    "Soundtrack",
    "Promo",
    "Sampler",
    "Demo",
    "Bootleg",
    "Other",
)

MUSIC_PACKAGING = (
    "Jewel Case",
    "Super Jewel Box",
    "Digipak",
    "Card Sleeve",
    "Box Set",
)

DEFAULT_MUSIC_RELEASE_FORMAT = "CD"
DEFAULT_MUSIC_RELEASE_TYPE = "Album"
DEFAULT_MUSIC_PACKAGING = "Jewel Case"


def normalize_music_metadata(item: dict[str, Any]) -> dict[str, Any]:
    """Return a music item with release metadata fields populated.

    Existing catalogues predate these metadata fields, so this helper
    deliberately preserves non-empty legacy values while filling missing ones
    with the catalogue defaults.
    """
    normalized = dict(item)

    release_format = normalized.get("release_format")
    normalized["release_format"] = (
        release_format.strip()
        if isinstance(release_format, str) and release_format.strip()
        else DEFAULT_MUSIC_RELEASE_FORMAT
    )

    release_type = normalized.get("type")
    normalized["type"] = (
        release_type.strip()
        if isinstance(release_type, str) and release_type.strip()
        else DEFAULT_MUSIC_RELEASE_TYPE
    )

    packaging = normalized.get("packaging")
    normalized["packaging"] = (
        packaging.strip()
        if isinstance(packaging, str) and packaging.strip()
        else DEFAULT_MUSIC_PACKAGING
    )

    if "format_details" not in normalized:
        normalized["format_details"] = ""

    return normalized
