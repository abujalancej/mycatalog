"""Convert local cover images to WebP and remove originals after success."""

from __future__ import annotations

import argparse
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

from _bootstrap import BASE_DIR

DEFAULT_SOURCE_FOLDER = BASE_DIR / "covers"
DEFAULT_BACKUP_FOLDER = BASE_DIR / "covers_originals"
DEFAULT_DB_FOLDER = BASE_DIR / "db"
DEFAULT_SUFFIXES = {".png", ".jpg", ".jpeg"}


@dataclass(frozen=True)
class ConversionResult:
    source_path: Path
    webp_path: Path
    backup_path: Path | None
    original_size: int
    webp_size: int

    @property
    def reduction_percent(self) -> float:
        """Handle reduction percent.

        :return: Result data.
        """
        if self.original_size <= 0:
            return 0.0
        return ((self.original_size - self.webp_size) / self.original_size) * 100


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments.

    :return: Parsed command-line arguments.
    """
    parser = argparse.ArgumentParser(
        description="Convert cover images under covers/ to WebP and remove originals after success.",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE_FOLDER,
        help="Folder containing cover images. Defaults to ./covers.",
    )
    parser.add_argument(
        "--backup",
        type=Path,
        default=None,
        metavar="FOLDER",
        help="Move original images to this folder instead of deleting them.",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=95,
        help="WebP quality for lossy conversion. Defaults to 95.",
    )
    parser.add_argument(
        "--method",
        type=int,
        choices=range(0, 7),
        default=6,
        help="WebP compression method from 0 to 6. Defaults to 6.",
    )
    parser.add_argument(
        "--lossless",
        action="store_true",
        help="Use lossless WebP compression instead of quality-based lossy compression.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing WebP files.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually convert and move files. Without this flag, only prints a plan.",
    )
    parser.add_argument(
        "--update-db",
        action="store_true",
        help="Update local db/*.json references from old cover paths to new .webp paths.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Maximum number of images to process. Defaults to all images.",
    )
    return parser.parse_args()


def find_cover_images(source_folder: Path) -> list[Path]:
    """Find matching data.

    :param source_folder: source folder value.
    :return: Matching values.
    """
    return sorted(
        path
        for path in source_folder.rglob("*")
        if path.is_file() and path.suffix.lower() in DEFAULT_SUFFIXES
    )


def build_backup_path(source_folder: Path, backup_folder: Path, image_path: Path) -> Path:
    """Build the requested value.

    :param source_folder: source folder value.
    :param backup_folder: backup folder value.
    :param image_path: image path value.
    :return: Result data.
    """
    relative_path = image_path.relative_to(source_folder)
    return backup_folder / relative_path


def prepare_image(image: Image.Image) -> Image.Image:
    """Handle prepare image.

    :param image: image value.
    :return: Result data.
    """
    has_transparency = image.mode in ("RGBA", "LA") or "transparency" in image.info
    if has_transparency:
        return image.convert("RGBA")
    return image.convert("RGB")


def convert_image(
    image_path: Path,
    webp_path: Path,
    quality: int,
    method: int,
    lossless: bool,
) -> tuple[int, int]:
    """Handle convert image.

    :param image_path: image path value.
    :param webp_path: webp path value.
    :param quality: quality value.
    :param method: method value.
    :param lossless: lossless value.
    :return: Result data.
    """
    original_size = image_path.stat().st_size

    with Image.open(image_path) as image:
        image.load()
        prepared = prepare_image(image)

        save_options: dict[str, Any] = {
            "format": "WEBP",
            "method": method,
            "lossless": lossless,
            "exact": True,
        }

        if not lossless:
            save_options["quality"] = quality

        icc_profile = image.info.get("icc_profile")
        if icc_profile:
            save_options["icc_profile"] = icc_profile

        webp_path.parent.mkdir(parents=True, exist_ok=True)
        prepared.save(webp_path, **save_options)

    return original_size, webp_path.stat().st_size


def move_original(image_path: Path, backup_path: Path) -> None:
    """Handle move original.

    :param image_path: image path value.
    :param backup_path: backup path value.
    """
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(image_path), str(backup_path))


def remove_original(image_path: Path) -> None:
    """Handle remove original.

    :param image_path: image path value.
    """
    image_path.unlink()


def convert_and_replace(
    source_folder: Path,
    backup_folder: Path | None,
    image_path: Path,
    quality: int,
    method: int,
    lossless: bool,
    overwrite: bool,
) -> ConversionResult | None:
    """Handle convert and replace.

    :param source_folder: source folder value.
    :param backup_folder: backup folder value.
    :param image_path: image path value.
    :param quality: quality value.
    :param method: method value.
    :param lossless: lossless value.
    :param overwrite: overwrite value.
    :return: Result data.
    """
    webp_path = image_path.with_suffix(".webp")
    backup_path = build_backup_path(source_folder, backup_folder, image_path) if backup_folder else None

    if webp_path.exists() and not overwrite:
        print(f"[SKIPPED] WebP already exists: {webp_path}")
        return None

    if backup_path and backup_path.exists():
        print(f"[SKIPPED] Original backup already exists: {backup_path}")
        return None

    try:
        original_size, webp_size = convert_image(
            image_path=image_path,
            webp_path=webp_path,
            quality=quality,
            method=method,
            lossless=lossless,
        )
        if backup_path:
            move_original(image_path, backup_path)
        else:
            remove_original(image_path)
        return ConversionResult(
            source_path=image_path,
            webp_path=webp_path,
            backup_path=backup_path,
            original_size=original_size,
            webp_size=webp_size,
        )
    except Exception as error:
        if webp_path.exists():
            try:
                webp_path.unlink()
            except OSError:
                pass
        print(f"[ERROR] {image_path}: {error}")
        return None


def replace_path_references(value: Any, replacements: dict[str, str]) -> tuple[Any, int]:
    """Handle replace path references.

    :param value: input value.
    :param replacements: replacements value.
    :return: Result data.
    """
    if isinstance(value, str):
        replacement = replacements.get(value)
        if replacement:
            return replacement, 1
        return value, 0

    if isinstance(value, list):
        changed = 0
        next_items = []
        for item in value:
            next_item, item_changes = replace_path_references(item, replacements)
            changed += item_changes
            next_items.append(next_item)
        return next_items, changed

    if isinstance(value, dict):
        changed = 0
        next_data = {}
        for key, item in value.items():
            next_item, item_changes = replace_path_references(item, replacements)
            changed += item_changes
            next_data[key] = next_item
        return next_data, changed

    return value, 0


def update_database_references(db_folder: Path, results: list[ConversionResult]) -> int:
    """Update stored data.

    :param db_folder: db folder value.
    :param results: results value.
    :return: Integer value.
    """
    replacements = {}
    for result in results:
        replacements[str(result.source_path)] = str(result.webp_path)
        replacements[str(result.source_path.relative_to(BASE_DIR))] = str(
            result.webp_path.relative_to(BASE_DIR)
        )

    updated_files = 0
    for db_path in sorted(db_folder.glob("*.json")):
        try:
            data = json.loads(db_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            print(f"[DB ERROR] {db_path}: {error}")
            continue

        next_data, changes = replace_path_references(data, replacements)
        if changes == 0:
            continue

        db_path.write_text(
            json.dumps(next_data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        updated_files += 1
        print(f"[DB UPDATED] {db_path} ({changes} references)")

    return updated_files


def print_result(result: ConversionResult) -> None:
    """Handle print result.

    :param result: result value.
    """
    print(
        f"[CONVERTED] {result.source_path} -> {result.webp_path} "
        f"({result.original_size / 1024:.1f} KB -> "
        f"{result.webp_size / 1024:.1f} KB, "
        f"{result.reduction_percent:.1f}% reduction)"
    )
    if result.backup_path:
        print(f"[MOVED] {result.source_path} -> {result.backup_path}")
    else:
        print(f"[DELETED] {result.source_path}")


def main() -> None:
    """Run the script.
    """
    args = parse_args()
    source_folder = args.source.resolve()
    backup_folder = args.backup.resolve() if args.backup else None

    if not source_folder.exists():
        print(f"Source folder does not exist: {source_folder}")
        return

    files = find_cover_images(source_folder)
    if args.limit > 0:
        files = files[: args.limit]

    if not files:
        print(f"No convertible cover images found in: {source_folder}")
        return

    print(f"Source folder: {source_folder}")
    print(f"Original handling: {'move to ' + str(backup_folder) if backup_folder else 'delete after conversion'}")
    print(f"Images found: {len(files)}")
    print(f"Lossless: {'yes' if args.lossless else 'no'}")
    if not args.lossless:
        print(f"Quality: {args.quality}")
    print(f"Apply changes: {'yes' if args.apply else 'no'}")
    print("-" * 72)

    if not args.apply:
        for image_path in files:
            action = (
                f"move original to {build_backup_path(source_folder, backup_folder, image_path)}"
                if backup_folder
                else "delete original"
            )
            print(f"[DRY RUN] {image_path} -> {image_path.with_suffix('.webp')} ({action})")
        print("-" * 72)
        print("No files were changed. Run again with --apply to convert covers.")
        return

    converted: list[ConversionResult] = []
    skipped_or_failed = 0

    for image_path in files:
        result = convert_and_replace(
            source_folder=source_folder,
            backup_folder=backup_folder,
            image_path=image_path,
            quality=args.quality,
            method=args.method,
            lossless=args.lossless,
            overwrite=args.overwrite,
        )
        if result:
            converted.append(result)
            print_result(result)
        else:
            skipped_or_failed += 1

    updated_db_files = 0
    if args.update_db and converted:
        updated_db_files = update_database_references(DEFAULT_DB_FOLDER, converted)

    print("-" * 72)
    print(f"Converted: {len(converted)}")
    print(f"Skipped or failed: {skipped_or_failed}")
    print(f"Database files updated: {updated_db_files}")


if __name__ == "__main__":
    main()
