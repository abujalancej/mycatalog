"""Migrate the local JSON catalogues into one SQLite database."""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from _bootstrap import BASE_DIR
from src.storage import SQLiteStorage


DEFAULT_DATABASE_PATH = BASE_DIR / "db" / "catalog.sqlite3"
SOURCES = {
    "movie": BASE_DIR / "db" / "movies.json",
    "album": BASE_DIR / "db" / "music.json",
    "book": BASE_DIR / "db" / "books.json",
}


def parse_args() -> argparse.Namespace:
    """Parse migration options."""
    parser = argparse.ArgumentParser(
        description="Migrate the local JSON catalogues to SQLite.",
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=DEFAULT_DATABASE_PATH,
        help="Destination SQLite database path.",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Replace an existing SQLite database after creating a backup copy.",
    )
    return parser.parse_args()


def load_items(path: Path) -> list[dict[str, Any]]:
    """Load and validate one JSON catalogue."""
    with path.open("r", encoding="utf-8") as source:
        data = json.load(source)
    if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
        raise ValueError(f"{path} must contain a JSON list of objects")
    return data


def backup_json_sources(backup_dir: Path) -> None:
    """Copy the source JSON files to a timestamped migration backup."""
    backup_dir.mkdir(parents=True, exist_ok=False)
    for source in SOURCES.values():
        shutil.copy2(source, backup_dir / source.name)


def main() -> None:
    """Run the JSON to SQLite migration."""
    args = parse_args()
    database_path = args.database if args.database.is_absolute() else BASE_DIR / args.database
    database_path = database_path.resolve()

    if database_path.exists() and not args.replace:
        raise SystemExit(
            f"Destination already exists: {database_path}. Use --replace only when intentional."
        )

    for source in SOURCES.values():
        if not source.exists():
            raise SystemExit(f"Source catalogue not found: {source}")

    loaded = {collection: load_items(source) for collection, source in SOURCES.items()}
    backup_stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = database_path.parent / "backups" / f"json-before-sqlite-{backup_stamp}"
    backup_json_sources(backup_dir)

    if database_path.exists():
        database_path.unlink()
        for suffix in ("-wal", "-shm"):
            sidecar = Path(f"{database_path}{suffix}")
            if sidecar.exists():
                sidecar.unlink()

    for collection, items in loaded.items():
        SQLiteStorage(database_path, collection).save(items)

    print(f"SQLite database: {database_path}")
    print(f"JSON backup: {backup_dir}")
    for collection, items in loaded.items():
        print(f"{collection}: {len(items)} items")


if __name__ == "__main__":
    main()
