"""Shared movie physical-media options and backwards-compatible defaults."""

from __future__ import annotations

from typing import Any


MOVIE_FORMATS = (
    "DVD",
    "Blu-ray",
    "4K UHD Blu-ray",
    "VHS",
    "Video CD",
)

MOVIE_EDITIONS = (
    "Standard",
    "Special Edition",
    "Collector’s Edition",
    "Limited Edition",
    "Extended Edition",
    "Director’s Cut",
    "Anniversary Edition",
    "Remastered Edition",
)

MOVIE_PACKAGING = (
    "Amaray",
    "Digipak",
    "Steelbook",
    "Box Set",
    "Slipcover",
    "Keep Case",
)

DEFAULT_MOVIE_FORMAT = "DVD"
DEFAULT_MOVIE_EDITION = "Standard"
DEFAULT_MOVIE_PACKAGING = "Amaray"


def normalize_movie_metadata(item: dict[str, Any]) -> dict[str, Any]:
    """Return a movie item with physical-media fields populated."""
    normalized = dict(item)

    movie_format = normalized.get("format")
    normalized["format"] = (
        movie_format.strip()
        if isinstance(movie_format, str) and movie_format.strip()
        else DEFAULT_MOVIE_FORMAT
    )

    edition = normalized.get("edition")
    normalized["edition"] = (
        edition.strip()
        if isinstance(edition, str) and edition.strip()
        else DEFAULT_MOVIE_EDITION
    )

    packaging = normalized.get("packaging")
    normalized["packaging"] = (
        packaging.strip()
        if isinstance(packaging, str) and packaging.strip()
        else DEFAULT_MOVIE_PACKAGING
    )

    return normalized
