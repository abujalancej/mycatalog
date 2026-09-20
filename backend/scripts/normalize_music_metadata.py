"""Populate music release metadata defaults in the JSON catalogue."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from _bootstrap import BASE_DIR
from src.music_metadata import (
    DEFAULT_MUSIC_RELEASE_FORMAT,
    DEFAULT_MUSIC_RELEASE_TYPE,
    DEFAULT_MUSIC_PACKAGING,
    normalize_music_metadata,
)


DEFAULT_DB_PATH = BASE_DIR / "db" / "music.json"


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Populate missing music format, type, and packaging fields.",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help="Music JSON database path. Defaults to ./db/music.json.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the defaults back to the database.",
    )
    return parser.parse_args()


def load_items(path: Path) -> list[dict[str, Any]]:
    """Load and validate the music JSON list."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
        raise ValueError(f"{path} must contain a JSON list of objects")
    return data


def main() -> None:
    """Report or apply missing music metadata defaults."""
    args = parse_args()
    items = load_items(args.db)
    normalized_items = [normalize_music_metadata(item) for item in items]

    format_changes = sum(
        item.get("release_format") != normalized.get("release_format")
        for item, normalized in zip(items, normalized_items)
    )
    type_changes = sum(
        item.get("type") != normalized.get("type")
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

    print(f"Albums scanned: {len(items)}")
    print(f"Release formats defaulted to {DEFAULT_MUSIC_RELEASE_FORMAT}: {format_changes}")
    print(f"Release types defaulted to {DEFAULT_MUSIC_RELEASE_TYPE}: {type_changes}")
    print(f"Packaging defaulted to {DEFAULT_MUSIC_PACKAGING}: {packaging_changes}")
    print(f"Database updated: {'yes' if args.apply else 'no'}")


if __name__ == "__main__":
    main()
