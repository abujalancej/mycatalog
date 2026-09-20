"""Repair missing local music covers using Discogs release metadata."""

import argparse
import logging
from pathlib import Path
from typing import Any

import yaml

from _bootstrap import BASE_DIR
from src.app_music import MusicApp
from src.discogs_client import DiscogsClient
from src.storage import SQLiteStorage


def load_config() -> dict[str, Any]:
    """Load data from disk.

    :return: Requested data.
    """
    with (BASE_DIR / "config.yaml").open("r", encoding="utf-8") as config_file:
        return yaml.safe_load(config_file) or {}


def main() -> None:
    """Run the script.
    """
    parser = argparse.ArgumentParser(description="Repair missing album covers in db/music.json.")
    parser.add_argument("--apply", action="store_true", help="Write repaired cover fields to db/music.json.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum number of missing covers to process.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    config = load_config()
    discogs = DiscogsClient(
        token=config["discogs"]["token"],
        base_url=config["discogs"].get("base_url", "https://api.discogs.com"),
    )
    storage = SQLiteStorage(config["storage"]["database_path"], "album")
    music_app = MusicApp(discogs, storage)

    items = storage.get_all()
    missing = [item for item in items if not item.get("cover_local")]
    if args.limit > 0:
        missing = missing[: args.limit]

    logging.info("Found %d music entries without local cover.", len(missing))

    repaired = 0
    unresolved = 0

    for item in missing:
        release_id = item.get("id")
        title = item.get("title") or f"release {release_id}"
        logging.info("Checking %s - %s", release_id, title)

        details = discogs.get_release_details(release_id)
        images = details.get("images") if details else None
        image = images[0] if images else {}
        cover_url = image.get("uri") or image.get("resource_url") or image.get("uri150") or item.get("cover")

        if not cover_url:
            logging.warning("No cover URL found for %s - %s", release_id, title)
            unresolved += 1
            continue

        if not args.apply:
            logging.info("Would repair %s with %s", release_id, cover_url)
            repaired += 1
            continue

        before = item.get("cover_local")
        music_app.ensure_local_cover(item, cover_url)
        if item.get("cover_local") and item.get("cover_local") != before:
            logging.info("Repaired %s -> %s", release_id, item["cover_local"])
            repaired += 1
        else:
            logging.warning("Could not download cover for %s", release_id)
            unresolved += 1

    if args.apply and repaired:
        storage.save(items)

    logging.info("Done. repaired=%d unresolved=%d apply=%s", repaired, unresolved, args.apply)


if __name__ == "__main__":
    main()
