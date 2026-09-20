"""Populate movie physical-media defaults in the JSON catalogue."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from _bootstrap import BASE_DIR
from src.movie_metadata import (
    DEFAULT_MOVIE_EDITION,
    DEFAULT_MOVIE_FORMAT,
    DEFAULT_MOVIE_PACKAGING,
    normalize_movie_metadata,
)


DEFAULT_DB_PATH = BASE_DIR / "db" / "movies.json"


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Populate missing movie format, edition, and packaging fields.",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help="Movie JSON database path. Defaults to ./db/movies.json.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the defaults back to the database.",
    )
    return parser.parse_args()


def load_items(path: Path) -> list[dict[str, Any]]:
    """Load and validate the movie JSON list."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
        raise ValueError(f"{path} must contain a JSON list of objects")
    return data


def main() -> None:
    """Report or apply missing movie metadata defaults."""
    args = parse_args()
    items = load_items(args.db)
    normalized_items = [normalize_movie_metadata(item) for item in items]

    format_changes = sum(
        item.get("format") != normalized.get("format")
        for item, normalized in zip(items, normalized_items)
    )
    edition_changes = sum(
        item.get("edition") != normalized.get("edition")
        for item, normalized in zip(items, normalized_items)
    )
    packaging_changes = sum(
        item.get("packaging") != normalized.get("packaging")
        for item, normalized in zip(items, normalized_items)
    )

    if args.apply:
        args.db.write_text(
            json.dumps(normalized_items, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    print(f"Movies scanned: {len(items)}")
    print(f"Formats defaulted to {DEFAULT_MOVIE_FORMAT}: {format_changes}")
    print(f"Editions defaulted to {DEFAULT_MOVIE_EDITION}: {edition_changes}")
    print(f"Packaging defaulted to {DEFAULT_MOVIE_PACKAGING}: {packaging_changes}")
    print(f"Database updated: {'yes' if args.apply else 'no'}")


if __name__ == "__main__":
    main()
