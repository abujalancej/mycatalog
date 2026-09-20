"""Download remote image URLs referenced by the local JSON catalogue database."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from _bootstrap import BASE_DIR
from src.image_downloader import download_image_as_webp, is_valid_image_file


DEFAULT_DB_FOLDER = BASE_DIR / "db"
DEFAULT_COVERS_FOLDER = BASE_DIR / "covers"
REMOTE_SCHEMES = {"http", "https"}


@dataclass(frozen=True)
class ImageFieldRule:
    db_name: str
    remote_field: str
    local_field: str
    cover_folder: str
    filename_prefix: str


IMAGE_FIELD_RULES = (
    ImageFieldRule("music.json", "cover", "cover_local", "music", "album"),
    ImageFieldRule("movies.json", "poster_full", "poster_local", "movies", "movie"),
    ImageFieldRule("books.json", "cover", "cover_local", "books", "book"),
)


@dataclass(frozen=True)
class DownloadPlan:
    db_path: Path
    item_index: int
    item_id: str
    remote_field: str
    local_field: str
    url: str
    target_path: Path


@dataclass(frozen=True)
class DownloadResult:
    plan: DownloadPlan
    downloaded_path: Path


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments.

    :return: Parsed command-line arguments.
    """
    parser = argparse.ArgumentParser(
        description="Download remote cover/poster URLs from db/*.json into covers/.",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_FOLDER,
        help="Folder containing JSON database files. Defaults to ./db.",
    )
    parser.add_argument(
        "--covers",
        type=Path,
        default=DEFAULT_COVERS_FOLDER,
        help="Folder where images are downloaded. Defaults to ./covers.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Download files and update JSON. Without this flag, only prints a plan.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Download again even when the local image path already exists.",
    )
    parser.add_argument(
        "--replace-source-url",
        action="store_true",
        help="Also replace the original URL field with the downloaded local path.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Maximum number of images to process. Defaults to all images.",
    )
    return parser.parse_args()


def is_remote_url(value: Any) -> bool:
    """Return whether the value matches the expected condition.

    :param value: input value.
    :return: True when the condition is met.
    """
    if not isinstance(value, str):
        return False
    return urlparse(value).scheme.lower() in REMOTE_SCHEMES


def local_webp_path_exists(value: Any) -> bool:
    """Handle local webp path exists.

    :param value: input value.
    :return: True when the condition is met.
    """
    if not isinstance(value, str) or not value.strip():
        return False

    path = Path(value)
    if not path.is_absolute():
        path = BASE_DIR / path
    return path.suffix.lower() == ".webp" and is_valid_image_file(path)


def safe_item_id(item: dict[str, Any], fallback: int) -> str:
    """Handle safe item id.

    :param item: item value.
    :param fallback: fallback value.
    :return: Text data.
    """
    raw_id = item.get("id") or item.get("isbn") or fallback
    return "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in str(raw_id))


def target_path_for(rule: ImageFieldRule, covers_folder: Path, item: dict[str, Any], item_index: int) -> Path:
    """Handle target path for.

    :param rule: rule value.
    :param covers_folder: covers folder value.
    :param item: item value.
    :param item_index: item index value.
    :return: Result data.
    """
    item_id = safe_item_id(item, item_index + 1)
    return covers_folder / rule.cover_folder / f"{rule.filename_prefix}_{item_id}.webp"


def load_json_list(db_path: Path) -> list[dict[str, Any]]:
    """Load data from disk.

    :param db_path: db path value.
    :return: Matching values.
    """
    data = json.loads(db_path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"{db_path} must contain a JSON list")
    return [item for item in data if isinstance(item, dict)]


def find_downloads(db_folder: Path, covers_folder: Path, overwrite: bool) -> list[DownloadPlan]:
    """Find matching data.

    :param db_folder: db folder value.
    :param covers_folder: covers folder value.
    :param overwrite: overwrite value.
    :return: Matching values.
    """
    plans: list[DownloadPlan] = []

    for rule in IMAGE_FIELD_RULES:
        db_path = db_folder / rule.db_name
        if not db_path.exists():
            continue

        try:
            items = load_json_list(db_path)
        except (OSError, json.JSONDecodeError, ValueError) as error:
            print(f"[DB ERROR] {db_path}: {error}")
            continue

        for item_index, item in enumerate(items):
            url = item.get(rule.remote_field)
            if not is_remote_url(url):
                continue

            if not overwrite and local_webp_path_exists(item.get(rule.local_field)):
                continue

            target_path = target_path_for(rule, covers_folder, item, item_index)

            plans.append(
                DownloadPlan(
                    db_path=db_path,
                    item_index=item_index,
                    item_id=safe_item_id(item, item_index + 1),
                    remote_field=rule.remote_field,
                    local_field=rule.local_field,
                    url=str(url),
                    target_path=target_path,
                )
            )

    return plans


def apply_downloads(plans: list[DownloadPlan], overwrite: bool) -> list[DownloadResult]:
    """Apply the requested changes.

    :param plans: plans value.
    :param overwrite: overwrite value.
    :return: Matching values.
    """
    results: list[DownloadResult] = []

    for plan in plans:
        already_exists = plan.target_path.exists() and plan.target_path.stat().st_size > 0
        downloaded = download_image_as_webp(plan.url, plan.target_path, overwrite=overwrite)
        if not downloaded:
            print(f"[FAILED] {plan.url}")
            continue

        result = DownloadResult(plan=plan, downloaded_path=Path(downloaded))
        results.append(result)
        action = "EXISTS" if already_exists and not overwrite else "DOWNLOADED"
        print(f"[{action}] {plan.url} -> {result.downloaded_path}")

    return results


def update_database(results: list[DownloadResult], replace_source_url: bool) -> int:
    """Update stored data.

    :param results: results value.
    :param replace_source_url: replace source url value.
    :return: Integer value.
    """
    by_db: dict[Path, list[DownloadResult]] = {}
    for result in results:
        by_db.setdefault(result.plan.db_path, []).append(result)

    updated_files = 0
    for db_path, db_results in by_db.items():
        items = load_json_list(db_path)

        for result in db_results:
            item = items[result.plan.item_index]
            local_path = str(result.downloaded_path)
            item[result.plan.local_field] = local_path
            if replace_source_url:
                item[result.plan.remote_field] = local_path

        db_path.write_text(
            json.dumps(items, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        updated_files += 1
        print(f"[DB UPDATED] {db_path} ({len(db_results)} items)")

    return updated_files


def main() -> None:
    """Run the script.
    """
    args = parse_args()
    db_folder = args.db.resolve()
    covers_folder = args.covers.resolve()

    if not db_folder.exists():
        print(f"Database folder does not exist: {db_folder}")
        return

    plans = find_downloads(db_folder, covers_folder, args.overwrite)
    if args.limit > 0:
        plans = plans[: args.limit]

    print(f"Database folder: {db_folder}")
    print(f"Covers folder: {covers_folder}")
    print(f"Remote images found: {len(plans)}")
    print(f"Apply changes: {'yes' if args.apply else 'no'}")
    print("-" * 72)

    if not plans:
        print("No remote images need downloading.")
        return

    if not args.apply:
        for plan in plans:
            print(
                f"[DRY RUN] {plan.db_path.name} item {plan.item_id} "
                f"{plan.remote_field} -> {plan.target_path}"
            )
        print("-" * 72)
        print("No files were changed. Run again with --apply to download images.")
        return

    results = apply_downloads(plans, overwrite=args.overwrite)
    updated_files = update_database(results, args.replace_source_url) if results else 0

    print("-" * 72)
    print(f"Downloaded: {len(results)}")
    print(f"Skipped or failed: {len(plans) - len(results)}")
    print(f"Database files updated: {updated_files}")


if __name__ == "__main__":
    main()
