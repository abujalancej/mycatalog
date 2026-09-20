"""Flask application factory and route definitions for the media catalogue service."""
import json
import logging
import os
import shutil
import sqlite3
import stat
import subprocess
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse

import yaml
from flask import Flask, after_this_request, jsonify, request, send_file, send_from_directory

from src.app_books import BookProviderUnavailable, BooksApp
from src.app_movies import MovieApp
from src.app_music import MusicApp
from src.discogs_client import DiscogsClient
from src.googlebooks_client import GoogleBooksClient
from src.image_downloader import is_valid_image_file
from src.isbn_utils import is_valid_isbn, normalize_isbn
from src.music_inconsistencies import generate_music_inconsistency_report, is_embedded_image
from src.music_metadata import (
    DEFAULT_MUSIC_PACKAGING,
    DEFAULT_MUSIC_RELEASE_FORMAT,
    DEFAULT_MUSIC_RELEASE_TYPE,
    normalize_music_metadata,
)
from src.movie_metadata import (
    DEFAULT_MOVIE_EDITION,
    DEFAULT_MOVIE_FORMAT,
    DEFAULT_MOVIE_PACKAGING,
    normalize_movie_metadata,
)
from src.openlibrary_client import OpenLibraryClient
from src.storage import SQLiteStorage
from src.tmdb_client import TMDbClient


BASE_DIR = Path(__file__).resolve().parent
COVERS_DIR = BASE_DIR / "covers"
CATALOG_IMAGES_DIR = BASE_DIR.parent / "frontend" / "public" / "catalog-images"
REPORTS_DIR = BASE_DIR / "reports"
REMOTE_SCHEMES = {"http", "https"}
DATABASE_UPLOAD_MAX_BYTES = 250 * 1024 * 1024
BACKUP_ARCHIVE_DATABASE_NAME = "catalog.sqlite3"
BACKUP_ARCHIVE_COVERS_DIR = "covers"
BACKUP_ARCHIVE_MAX_BYTES = 1024 * 1024 * 1024


def backup_sqlite_database(source_path: Path, destination_path: Path) -> None:
    """Create a consistent SQLite copy, including any active WAL contents."""
    source = None
    destination = None
    try:
        source = sqlite3.connect(source_path)
        destination = sqlite3.connect(destination_path)
        source.backup(destination)
        destination.commit()
    finally:
        if source is not None:
            source.close()
        if destination is not None:
            destination.close()


def validate_sqlite_database(path: Path) -> None:
    """Reject files that are not a healthy MyCatalog SQLite database."""
    connection = None
    try:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        if not integrity or integrity[0] != "ok":
            raise ValueError("SQLite integrity check failed")

        table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'media_items'"
        ).fetchone()
        if not table:
            raise ValueError("The file does not contain a MyCatalog database")
    except sqlite3.Error as error:
        raise ValueError("The uploaded file is not a valid SQLite database") from error
    finally:
        if connection is not None:
            connection.close()


def local_image_relative_path(value: Any) -> PurePosixPath | None:
    """Return the path below ``covers/`` for a stored local image path."""
    if not isinstance(value, str) or not value.strip():
        return None

    normalized = value.replace("\\", "/")
    parts = PurePosixPath(normalized).parts
    cover_indexes = [index for index, part in enumerate(parts) if part.lower() == BACKUP_ARCHIVE_COVERS_DIR]
    if not cover_indexes or cover_indexes[-1] == len(parts) - 1:
        return None

    relative = PurePosixPath(*parts[cover_indexes[-1] + 1:])
    if relative.is_absolute() or ".." in relative.parts:
        return None
    return relative


def local_cover_path(value: Any) -> Path | None:
    """Return the canonical path for a local image stored under ``covers/``."""
    if is_remote_url(value) or is_catalog_image_path(value) or is_embedded_image(value):
        return None

    relative = local_image_relative_path(value)
    if relative is None:
        return None

    covers_root = COVERS_DIR.resolve()
    candidate = (COVERS_DIR / Path(*relative.parts)).resolve()
    try:
        candidate.relative_to(covers_root)
    except ValueError:
        return None
    return candidate


def normalize_local_image_paths(item: dict[str, Any]) -> dict[str, Any]:
    """Point stored local image fields at this installation's covers folder."""
    normalized = dict(item)
    for field in ("cover_local", "poster_local"):
        path = local_cover_path(normalized.get(field))
        if path is not None and path.is_file() and normalized.get(field) != str(path):
            normalized[field] = str(path)
    return normalized


def referenced_cover_paths(items: list[dict[str, Any]]) -> set[Path]:
    """Return all artwork paths referenced by the supplied catalogue items."""
    references: set[Path] = set()
    for item in items:
        for field in ("cover", "cover_local", "poster_full", "poster_local"):
            path = local_cover_path(item.get(field))
            if path is not None:
                references.add(path)
    return references


def remove_unused_covers(references: set[Path]) -> int:
    """Remove files below ``covers/`` that are no longer referenced by the catalogue."""
    if not COVERS_DIR.is_dir():
        return 0

    removed = 0
    for path in COVERS_DIR.rglob("*"):
        if not (path.is_file() or path.is_symlink()):
            continue
        if path.resolve() in references:
            continue
        try:
            path.unlink()
            removed += 1
        except OSError as error:
            logging.getLogger(__name__).warning("Could not remove unused artwork %s: %s", path, error)

    for directory in sorted((path for path in COVERS_DIR.rglob("*") if path.is_dir()), reverse=True):
        try:
            directory.rmdir()
        except OSError:
            pass

    return removed


def rewrite_local_image_paths(path: Path, destination_root: Path, relative_to_backup: bool = False) -> None:
    """Make local image paths portable or point them at this installation's covers."""
    with sqlite3.connect(path) as connection:
        rows = connection.execute("SELECT rowid, payload FROM media_items").fetchall()
        updates: list[tuple[str, int]] = []
        for rowid, payload in rows:
            try:
                item = json.loads(payload)
            except (TypeError, json.JSONDecodeError):
                continue
            if not isinstance(item, dict):
                continue

            changed = False
            for field in ("cover_local", "poster_local"):
                relative = local_image_relative_path(item.get(field))
                if relative is None:
                    continue
                if relative_to_backup:
                    next_value = PurePosixPath(BACKUP_ARCHIVE_COVERS_DIR, *relative.parts).as_posix()
                else:
                    next_value = str(destination_root.joinpath(*relative.parts))
                if item.get(field) != next_value:
                    item[field] = next_value
                    changed = True

            if changed:
                updates.append((json.dumps(item, ensure_ascii=False, separators=(",", ":")), rowid))

        if updates:
            connection.executemany(
                "UPDATE media_items SET payload = ?, updated_at = CURRENT_TIMESTAMP WHERE rowid = ?",
                updates,
            )


def create_backup_archive(database_path: Path, archive_path: Path, temporary_database_path: Path) -> None:
    """Create a portable ZIP containing the database and all local artwork."""
    backup_sqlite_database(database_path, temporary_database_path)
    rewrite_local_image_paths(temporary_database_path, COVERS_DIR, relative_to_backup=True)

    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(temporary_database_path, arcname=BACKUP_ARCHIVE_DATABASE_NAME)
        if COVERS_DIR.is_dir():
            cover_files = [image_path for image_path in COVERS_DIR.rglob("*") if image_path.is_file()]
            if not cover_files:
                archive.writestr(f"{BACKUP_ARCHIVE_COVERS_DIR}/", "")
            for image_path in sorted(cover_files):
                if image_path.is_file():
                    relative_path = image_path.relative_to(COVERS_DIR)
                    archive.write(
                        image_path,
                        arcname=PurePosixPath(BACKUP_ARCHIVE_COVERS_DIR, *relative_path.parts).as_posix(),
                    )


def extract_backup_archive(archive_path: Path, destination: Path) -> None:
    """Safely extract a MyCatalog backup archive into a staging directory."""
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        if names.count(BACKUP_ARCHIVE_DATABASE_NAME) != 1:
            raise ValueError("The backup archive does not contain exactly one database")

        total_size = 0
        for info in infos:
            name = info.filename.replace("\\", "/")
            path = PurePosixPath(name)
            if path.is_absolute() or not name or ".." in path.parts:
                raise ValueError("The backup archive contains an unsafe path")
            if name != BACKUP_ARCHIVE_DATABASE_NAME and name != BACKUP_ARCHIVE_COVERS_DIR and not name.startswith(f"{BACKUP_ARCHIVE_COVERS_DIR}/"):
                raise ValueError("The backup archive contains an unsupported file")

            mode = (info.external_attr >> 16) & 0o170000
            if mode == stat.S_IFLNK:
                raise ValueError("The backup archive contains a symbolic link")
            total_size += info.file_size
            if total_size > BACKUP_ARCHIVE_MAX_BYTES:
                raise ValueError("The backup archive is too large")

        destination.mkdir(parents=True, exist_ok=True)
        for info in infos:
            target = destination.joinpath(*PurePosixPath(info.filename.replace("\\", "/")).parts)
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)


def restore_database_and_covers(database_path: Path, staged_database: Path, staged_covers: Path) -> None:
    """Atomically replace the database and local artwork from a staged backup."""
    restore_stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    safety_database_path = database_path.with_name(
        f"{database_path.stem}.pre-restore-{restore_stamp}{database_path.suffix}"
    )
    safety_covers_path = COVERS_DIR.with_name(f"covers.pre-restore-{restore_stamp}")
    covers_moved = False
    database_replaced = False

    if database_path.is_file():
        backup_sqlite_database(database_path, safety_database_path)

    try:
        COVERS_DIR.parent.mkdir(parents=True, exist_ok=True)
        staged_covers.mkdir(parents=True, exist_ok=True)
        if COVERS_DIR.exists():
            os.replace(COVERS_DIR, safety_covers_path)
            covers_moved = True
        os.replace(staged_covers, COVERS_DIR)
        os.replace(staged_database, database_path)
        database_replaced = True
        for sidecar_path in (Path(f"{database_path}-wal"), Path(f"{database_path}-shm")):
            sidecar_path.unlink(missing_ok=True)
    except Exception:
        if database_replaced:
            if safety_database_path.is_file():
                os.replace(safety_database_path, database_path)
            else:
                database_path.unlink(missing_ok=True)
        if COVERS_DIR.exists():
            shutil.rmtree(COVERS_DIR)
        if covers_moved and safety_covers_path.exists():
            os.replace(safety_covers_path, COVERS_DIR)
        raise


def clear_database_and_covers(database_path: Path) -> None:
    """Clear all catalogue records and local artwork, retaining safety copies."""
    clear_stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    safety_database_path = database_path.with_name(
        f"{database_path.stem}.pre-delete-{clear_stamp}{database_path.suffix}"
    )
    safety_covers_path = COVERS_DIR.with_name(f"covers.pre-delete-{clear_stamp}")
    covers_moved = False

    backup_sqlite_database(database_path, safety_database_path)
    try:
        if COVERS_DIR.exists():
            os.replace(COVERS_DIR, safety_covers_path)
            covers_moved = True
        COVERS_DIR.mkdir(parents=True, exist_ok=True)

        with sqlite3.connect(database_path) as connection:
            table = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'media_items'"
            ).fetchone()
            if not table:
                raise ValueError("The database does not contain a MyCatalog database")
            connection.execute("DELETE FROM media_items")

        for sidecar_path in (Path(f"{database_path}-wal"), Path(f"{database_path}-shm")):
            sidecar_path.unlink(missing_ok=True)
    except Exception:
        if COVERS_DIR.exists():
            shutil.rmtree(COVERS_DIR)
        if covers_moved and safety_covers_path.exists():
            os.replace(safety_covers_path, COVERS_DIR)
        backup_sqlite_database(safety_database_path, database_path)
        raise


def load_config(path: Path) -> dict[str, Any]:
    """Load YAML configuration from the given path with explicit error handling.

    :param path: Filesystem location of the YAML configuration file.
    :return: Parsed configuration as a dictionary.
    """
    logger = logging.getLogger(__name__)
    try:
        with path.open("r", encoding="utf-8") as config_file:
            return yaml.safe_load(config_file) or {}
    except FileNotFoundError as exc:
        logger.error("Configuration file not found at %s", path)
        raise RuntimeError(f"Configuration file not found at {path}") from exc
    except yaml.YAMLError as exc:
        logger.error("Invalid YAML configuration in %s: %s", path, exc)
        raise RuntimeError(f"Invalid YAML configuration in {path}") from exc
    except OSError as exc:
        logger.error("Unable to read configuration file %s: %s", path, exc)
        raise RuntimeError(f"Unable to read configuration file {path}") from exc


def save_config(path: Path, config: dict[str, Any]) -> None:
    """Persist YAML configuration to disk."""
    try:
        with path.open("w", encoding="utf-8") as config_file:
            yaml.safe_dump(config, config_file, sort_keys=False, allow_unicode=True)
    except OSError as exc:
        logging.getLogger(__name__).error("Unable to write configuration file %s: %s", path, exc)
        raise RuntimeError(f"Unable to write configuration file {path}") from exc


def normalize_config(config: dict[str, Any]) -> dict[str, Any]:
    """Return a config payload with all UI-editable keys present."""
    return {
        "tmdb": {
            "api_key": config.get("tmdb", {}).get("api_key", ""),
            "base_url": config.get("tmdb", {}).get("base_url", "https://api.themoviedb.org/3"),
        },
        "discogs": {
            "token": config.get("discogs", {}).get("token", ""),
            "base_url": config.get("discogs", {}).get("base_url", "https://api.discogs.com"),
        },
        "google_books": {
            "api_key": config.get("google_books", {}).get("api_key", ""),
            "base_url": config.get("google_books", {}).get(
                "base_url",
                "https://www.googleapis.com/books/v1",
            ),
        },
        "open_library": {
            "base_url": config.get("open_library", {}).get(
                "base_url",
                "https://openlibrary.org",
            ),
        },
        "storage": {
            "database_path": config.get("storage", {}).get("database_path", "./db/catalog.sqlite3"),
        },
    }


def find_item_index(items: list[dict[str, Any]], item_id: str) -> int | None:
    """Return the index of an item by id, accepting numeric and string ids."""
    for index, item in enumerate(items):
        if str(item.get("id")) == item_id:
            return index
    return None


def resolve_backend_path(path_value: str | Path) -> Path:
    """Return an absolute path rooted at the backend folder when relative."""
    path = Path(path_value)
    if path.is_absolute():
        return path
    return BASE_DIR / path


def is_allowed_backend_path(path: Path, media_apps: dict[str, Any], config_location: Path) -> bool:
    """Return whether a path is safe to reveal from the local backend."""
    resolved = path.resolve()
    allowed_roots = [BASE_DIR.resolve(), COVERS_DIR.resolve(), REPORTS_DIR.resolve(), config_location.resolve()]
    for app in media_apps.values():
        allowed_roots.append(resolve_backend_path(app.storage.path).resolve())

    return any(resolved == root or root in resolved.parents for root in allowed_roots)


def is_remote_url(value: Any) -> bool:
    """Return whether a value is an HTTP(S) URL."""
    if not isinstance(value, str):
        return False
    return urlparse(value).scheme.lower() in REMOTE_SCHEMES


def is_catalog_image_path(value: Any) -> bool:
    """Return whether a value points to an image already served by the app."""
    return isinstance(value, str) and value.strip().startswith("/catalog-images/")


def catalog_image_file_path(value: Any) -> Path | None:
    """Resolve a legacy ``/catalog-images/`` URL to its public file."""
    if not is_catalog_image_path(value):
        return None

    relative = PurePosixPath(str(value).strip().removeprefix("/catalog-images/"))
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        return None

    candidate = (CATALOG_IMAGES_DIR / Path(*relative.parts)).resolve()
    try:
        candidate.relative_to(CATALOG_IMAGES_DIR.resolve())
    except ValueError:
        return None
    return candidate


def migrate_catalog_image_path(value: Any) -> Path | None:
    """Copy a legacy public image into the canonical backend covers folder."""
    source = catalog_image_file_path(value)
    if source is None or not source.is_file():
        return None

    relative = source.relative_to(CATALOG_IMAGES_DIR.resolve())
    destination = (COVERS_DIR / Path(*relative.parts)).resolve()
    try:
        destination.relative_to(COVERS_DIR.resolve())
    except ValueError:
        return None

    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        shutil.copy2(source, destination)
    return destination if destination.is_file() else None


def remove_unused_catalog_images(items: list[dict[str, Any]]) -> int:
    """Remove the legacy public image tree once no catalogue item references it."""
    if not CATALOG_IMAGES_DIR.is_dir():
        return 0

    fields = ("cover", "cover_local", "poster_full", "poster_local")
    if any(is_catalog_image_path(item.get(field)) for item in items for field in fields):
        return 0

    removed = 0
    for path in CATALOG_IMAGES_DIR.rglob("*"):
        if not (path.is_file() or path.is_symlink()):
            continue
        try:
            path.unlink()
            removed += 1
        except OSError as error:
            logging.getLogger(__name__).warning("Could not remove legacy artwork %s: %s", path, error)

    for directory in sorted((path for path in CATALOG_IMAGES_DIR.rglob("*") if path.is_dir()), reverse=True):
        try:
            directory.rmdir()
        except OSError:
            pass

    try:
        CATALOG_IMAGES_DIR.rmdir()
    except OSError:
        pass

    return removed


def stored_local_image_status(path_value: Any) -> tuple[str, str | None]:
    """Return status and resolved path for a stored local image field."""
    if not isinstance(path_value, str) or not path_value.strip():
        return "missing", None
    if is_catalog_image_path(path_value):
        return "ok", path_value.strip()

    path = resolve_backend_path(path_value)
    if not path.exists():
        return "file_missing", str(path)
    if path.suffix.lower() != ".webp":
        return "not_webp", str(path)
    if not is_valid_image_file(path):
        return "invalid_image", str(path)
    return "ok", str(path)


def detect_storage_inconsistencies(
    media_apps: dict[str, Any],
    config_location: Path,
    included_kinds: tuple[str, ...] = ("music", "movies", "books"),
) -> dict[str, Any]:
    """Return a report of likely catalogue data inconsistencies."""
    rules = {
        "music": {
            "media_type": "album",
            "title_field": "title",
            "creator_field": "artists",
            "year_field": "year",
            "remote_field": "cover",
            "local_field": "cover_local",
        },
        "movies": {
            "media_type": "movie",
            "title_field": "title",
            "creator_field": "directors",
            "year_field": "release_date",
            "remote_field": "poster_full",
            "local_field": "poster_local",
        },
        "books": {
            "media_type": "book",
            "title_field": "title",
            "creator_field": "authors",
            "year_field": "publicationYear",
            "remote_field": "cover",
            "local_field": "cover_local",
        },
    }
    issues = []
    files = [{"label": "config.yaml", "path": str(config_location.resolve())}]
    scanned = 0

    for kind, rule in rules.items():
        if kind not in included_kinds:
            continue

        media_app = media_apps[rule["media_type"]]
        storage_path = resolve_backend_path(media_app.storage.path)
        items = media_app.storage.get_all()
        if not items:
            continue
        files.append({"label": f"{kind} DB", "path": str(storage_path.resolve())})
        scanned += len(items)
        seen_ids: dict[str, int] = {}
        seen_titles: dict[tuple[str, str], int] = {}

        for index, item in enumerate(items):
            item_id = str(item.get("id") or "")
            label = item.get(rule["title_field"]) or item.get("title") or item.get("name") or f"{kind} item #{index + 1}"
            base_issue = {
                "kind": kind,
                "itemId": item_id,
                "itemLabel": label,
                "file": str(storage_path.resolve()),
            }

            if not item_id:
                issues.append({**base_issue, "severity": "error", "message": "Missing item id"})
            elif item_id in seen_ids:
                issues.append({**base_issue, "severity": "error", "message": f"Duplicate item id also found at index {seen_ids[item_id]}"})
            else:
                seen_ids[item_id] = index

            title = str(item.get(rule["title_field"]) or item.get("title") or item.get("name") or "").strip()
            creators = item.get(rule["creator_field"]) or []
            creator_text = ", ".join(str(value).strip() for value in creators if str(value).strip()) if isinstance(creators, list) else str(creators).strip()

            if not title:
                issues.append({**base_issue, "severity": "warning", "message": "Missing title/name"})

            creator_field = rule["creator_field"]
            if creator_field and not item.get(creator_field):
                issues.append({**base_issue, "severity": "warning", "message": f"Missing {creator_field}"})

            duplicate_key = (title.casefold(), creator_text.casefold())
            if title and creator_text and duplicate_key in seen_titles:
                issues.append({
                    **base_issue,
                    "severity": "warning",
                    "message": f"Possible duplicate title/creator also found at index {seen_titles[duplicate_key]}",
                })
            elif title and creator_text:
                seen_titles[duplicate_key] = index

            if not item.get(rule["year_field"]):
                issues.append({**base_issue, "severity": "info", "message": f"Missing {rule['year_field']}"})

            remote_value = item.get(rule["remote_field"])
            local_status, local_path = stored_local_image_status(item.get(rule["local_field"]))
            if is_remote_url(remote_value) and local_status == "missing":
                issues.append({**base_issue, "severity": "warning", "message": f"Remote image has no local WebP in {rule['local_field']}"})
            elif local_status not in {"ok", "missing"}:
                issues.append({**base_issue, "severity": "error", "message": f"Local image {local_status}", "file": local_path or base_issue["file"]})

    return {
        "scanned": scanned,
        "issueCount": len(issues),
        "issues": issues,
        "files": files,
    }


def local_cover_url(path_value: Any) -> str | None:
    """Return an HTTP URL for a local file under covers/."""
    if not isinstance(path_value, str) or not path_value.strip():
        return None

    path = Path(path_value)
    if not path.is_absolute():
        path = BASE_DIR / path

    try:
        relative_path = path.resolve().relative_to(COVERS_DIR.resolve())
    except ValueError:
        return None

    if not is_valid_image_file(path):
        return None

    return f"{request.host_url.rstrip('/')}/covers/{relative_path.as_posix()}"


def serialize_media_item(item: dict[str, Any]) -> dict[str, Any]:
    """Return an API item with local image paths exposed as HTTP URLs."""
    serialized = dict(item)
    if "release_format" in serialized or "tracklist" in serialized:
        serialized = normalize_music_metadata(serialized)
    elif "poster_full" in serialized or "media_type" in serialized:
        serialized = normalize_movie_metadata(serialized)
    if "categories" in serialized and "genres" not in serialized:
        serialized["genres"] = serialized.get("categories") or []
    if "release_format" in serialized and "format_details" not in serialized:
        serialized["format_details"] = ""
    if "format" in serialized and "format_details" not in serialized:
        serialized["format_details"] = ""
    if "authors" in serialized and "additional_info" not in serialized:
        serialized["additional_info"] = ""
    if "authors" in serialized:
        book_text = serialized.get("back_cover_text") or serialized.get("synopsis") or serialized.get("description") or ""
        serialized["synopsis"] = serialized.get("synopsis") or book_text
        serialized["back_cover_text"] = serialized.get("back_cover_text") or book_text
        serialized.pop("description", None)
    if "overview" in serialized and "synopsis" not in serialized:
        serialized["synopsis"] = serialized.get("overview") or ""
    for source_field, local_field in (("cover", "cover_local"), ("poster_full", "poster_local")):
        url = local_cover_url(serialized.get(local_field))
        if url:
            serialized[local_field] = url
            if source_field in serialized:
                serialized[source_field] = url
        elif serialized.get(local_field):
            serialized[local_field] = None
    return serialized


def serialize_media_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return API-ready versions of many media items.

    :param items: Raw stored media items.
    :return: Serialized media items.
    """
    return [serialize_media_item(item) for item in items]


def create_app(config_path: str | Path | None = None) -> Flask:
    """Application factory that defers client and route initialization until requested.

    :param config_path: Optional path to override the default configuration file.
    :return: Configured Flask application instance.
    """
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO)

    config_location = Path(config_path) if config_path else BASE_DIR / "config.yaml"
    config = load_config(config_location)

    try:
        tmdb_cfg = config["tmdb"]
        discogs_cfg = config["discogs"]
        google_cfg = config["google_books"]
        open_library_cfg = config.get("open_library", {})
        storage_cfg = config["storage"]
    except KeyError as exc:
        raise RuntimeError(f"Missing configuration section: {exc}") from exc

    tmdb = TMDbClient(
        api_key=tmdb_cfg["api_key"],
        base_url=tmdb_cfg.get("base_url", "https://api.themoviedb.org/3"),
    )
    discogs = DiscogsClient(
        token=discogs_cfg["token"],
        base_url=discogs_cfg.get("base_url", "https://api.discogs.com"),
    )
    google_books = GoogleBooksClient(
        base_url=google_cfg.get("base_url", "https://www.googleapis.com/books/v1"),
        api_key=google_cfg.get("api_key"),
    )
    open_library = OpenLibraryClient(
        base_url=open_library_cfg.get("base_url", "https://openlibrary.org"),
    )

    media_apps = {
        "movie": MovieApp(tmdb, SQLiteStorage(storage_cfg["database_path"], "movie")),
        "album": MusicApp(discogs, SQLiteStorage(storage_cfg["database_path"], "album")),
        "book": BooksApp(google_books, SQLiteStorage(storage_cfg["database_path"], "book"), open_library),
    }

    app = Flask(__name__)
    app.config["MEDIA_APPS"] = media_apps
    app.config["CONFIG_PATH"] = str(config_location)

    @app.route("/", methods=["GET"])
    def index() -> Any:
        """Handle the service request.

        :return: Result data.
        """
        return jsonify({
            "service": "myCatalogue backend",
            "health": "/health",
            "api": {
                "music": "/api/music",
                "movies": "/api/movies",
                "books": "/api/books",
                "settings": "/api/settings",
            },
        })

    @app.route("/covers/<path:filename>", methods=["GET"])
    def serve_cover(filename: str) -> Any:
        """Serve the requested file.

        :param filename: file name.
        :return: Result data.
        """
        return send_from_directory(COVERS_DIR, filename)

    @app.route("/reports/<path:filename>", methods=["GET"])
    def serve_report(filename: str) -> Any:
        """Serve a generated maintenance report.

        :param filename: Report file name.
        :return: Result data.
        """
        return send_from_directory(REPORTS_DIR, filename)

    @app.route("/add/<media_type>", methods=["POST"])
    def add_item(media_type: str) -> Any:
        """Add the requested item.

        :param media_type: media type.
        :return: Result data.
        """
        data = request.json or {}
        if media_type == "movie":
            result = media_apps["movie"].add_movie(
                query=data.get("query"),
                year=data.get("year"),
                media_id=data.get("id"),
                media_type=data.get("media_type"),
            )
        elif media_type == "album":
            result = media_apps["album"].add_album_by_name(
                data.get("query"),
                artist=data.get("artist"),
                release_format=data.get("release_format") or DEFAULT_MUSIC_RELEASE_FORMAT,
                release_type=(
                    data.get("release_type")
                    or data.get("music_type")
                    or DEFAULT_MUSIC_RELEASE_TYPE
                ),
                location=data.get("location") or "",
                packaging=data.get("packaging") or DEFAULT_MUSIC_PACKAGING,
            )
        elif media_type == "book":
            if data.get("isbn"):
                result = media_apps["book"].add_book_by_isbn(data["isbn"])
            else:
                result = media_apps["book"].add_book_by_name(data.get("query"))
        elif media_type == "game":
            return jsonify({"error": "video game catalogue support is TODO"}), 501
        else:
            return jsonify({"error": "invalid media type"}), 400

        return jsonify(serialize_media_item(result) if result else {"error": "not found"})

    @app.route("/list/<media_type>", methods=["GET"])
    def list_items(media_type: str) -> Any:
        """Handle list items.

        :param media_type: media type.
        :return: Result data.
        """
        if media_type == "game":
            return jsonify({"error": "video game catalogue support is TODO"}), 501
        media_app = media_apps.get(media_type)
        if not media_app:
            return jsonify({"error": "invalid media type"}), 400
        return jsonify(serialize_media_items(media_app.storage.get_all()))

    @app.route("/delete/<media_type>/<item_id>", methods=["DELETE"])
    def delete_item(media_type: str, item_id: str) -> Any:
        """Handle delete item.

        :param media_type: media type.
        :param item_id: item identifier.
        :return: Result data.
        """
        media_app = media_apps.get(media_type)
        if not media_app:
            return jsonify({"error": "invalid media type"}), 400
        items = media_app.storage.get_all()
        new_items = [x for x in items if str(x.get("id")) != item_id]
        media_app.storage.save(new_items)
        return jsonify({"status": "deleted", "remaining": len(new_items)})

    @app.route("/api/music", methods=["GET"])
    def api_get_music() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        return jsonify(serialize_media_items(media_apps["album"].storage.get_all()))

    @app.route("/api/music", methods=["POST"])
    def api_add_music() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        data = request.json or {}
        storage = media_apps["album"].storage
        items = storage.get_all()
        existing_ids = [item.get("id") for item in items if isinstance(item.get("id"), int)]
        next_id = data.get("id") or (max(existing_ids, default=0) + 1)
        item = {
            "id": next_id,
            "title": data.get("title"),
            "artists": data.get("artists") or [],
            "year": data.get("year"),
            "genres": data.get("genres") or [],
            "styles": data.get("styles") or [],
            "cover": data.get("cover"),
            "tracklist": data.get("tracklist") or [],
            "release_format": data.get("release_format") or DEFAULT_MUSIC_RELEASE_FORMAT,
            "type": data.get("type") or data.get("release_type") or DEFAULT_MUSIC_RELEASE_TYPE,
            "packaging": data.get("packaging") or DEFAULT_MUSIC_PACKAGING,
            "format_details": data.get("format_details") or "",
            "location": data.get("location"),
        }
        item = normalize_music_metadata(item)
        storage.add_unique(item)
        return jsonify(serialize_media_item(item)), 201

    @app.route("/api/movies", methods=["GET"])
    def api_get_movies() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        return jsonify(serialize_media_items(media_apps["movie"].storage.get_all()))

    @app.route("/api/movies", methods=["POST"])
    def api_add_movie() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        data = request.json or {}
        storage = media_apps["movie"].storage
        items = storage.get_all()
        existing_ids = [item.get("id") for item in items if isinstance(item.get("id"), int)]
        next_id = data.get("id") or (max(existing_ids, default=0) + 1)
        item = {
            "id": next_id,
            "title": data.get("title"),
            "name": data.get("name"),
            "release_date": data.get("release_date"),
            "first_air_date": data.get("first_air_date"),
            "genres": data.get("genres") or [],
            "overview": data.get("overview"),
            "media_type": data.get("media_type") or "movie",
            "format": data.get("format") or DEFAULT_MOVIE_FORMAT,
            "edition": data.get("edition") or DEFAULT_MOVIE_EDITION,
            "packaging": data.get("packaging") or DEFAULT_MOVIE_PACKAGING,
            "format_details": data.get("format_details") or "",
            "location": data.get("location"),
            "poster_full": data.get("poster_full"),
            "poster_local": data.get("poster_local"),
            "poster_path": data.get("poster_path"),
        }
        item = normalize_movie_metadata(item)
        storage.add_unique(item)
        return jsonify(serialize_media_item(item)), 201

    @app.route("/api/books", methods=["GET"])
    def api_get_books() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        return jsonify(serialize_media_items(media_apps["book"].storage.get_all()))

    @app.route("/api/books", methods=["POST"])
    def api_add_book() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        data = request.json or {}
        book_app = media_apps["book"]

        try:
            if data.get("isbn"):
                item = book_app.add_book_by_isbn(data["isbn"])
            elif data.get("metadata"):
                item = book_app.add_book_from_metadata(data["metadata"])
            else:
                item = book_app.add_book_from_metadata(data)
        except BookProviderUnavailable:
            return jsonify({"error": "book metadata providers are unavailable"}), 502

        if not item:
            return jsonify({"error": "not found"}), 404

        return jsonify(serialize_media_item(item)), 201

    @app.route("/api/books/search", methods=["GET"])
    def api_search_books() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        title = str(request.args.get("title") or "").strip()
        author = str(request.args.get("author") or "").strip()
        try:
            page = int(request.args.get("page") or 1)
            limit = int(request.args.get("limit") or 15)
        except ValueError:
            return jsonify({"error": "page and limit must be numeric"}), 400

        if not title:
            return jsonify({"error": "title is required"}), 400

        try:
            items = media_apps["book"].search_books(
                title=title,
                author=author or None,
                page=max(1, page),
                limit=max(1, min(20, limit)),
            )
        except BookProviderUnavailable:
            return jsonify({"error": "book metadata providers are unavailable"}), 502
        return jsonify({"items": items, "page": max(1, page), "limit": max(1, min(20, limit))})

    @app.route("/api/books/metadata", methods=["GET"])
    def api_get_book_metadata() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        isbn = str(request.args.get("isbn") or "").strip()
        if not isbn:
            return jsonify({"error": "isbn is required"}), 400
        if not is_valid_isbn(normalize_isbn(isbn)):
            return jsonify({"error": "valid isbn is required"}), 400

        try:
            metadata = media_apps["book"].metadata_by_isbn(isbn)
        except BookProviderUnavailable:
            return jsonify({"error": "book metadata providers are unavailable"}), 502
        if not metadata:
            return jsonify({"error": "not found"}), 404

        return jsonify(metadata)

    @app.route("/api/books/resolve", methods=["POST"])
    def api_resolve_book() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        selection = request.json or {}
        metadata = media_apps["book"].resolve_book(selection)
        if not metadata:
            return jsonify({"error": "not found"}), 404

        return jsonify(metadata)

    @app.route("/api/games", methods=["GET"])
    def api_get_games() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        return jsonify({"error": "video game catalogue support is TODO"}), 501

    @app.route("/api/games", methods=["POST"])
    def api_add_game() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        return jsonify({"error": "video game catalogue support is TODO"}), 501

    @app.route("/api/items/<kind>/<item_id>", methods=["DELETE"])
    def api_delete_item(kind: str, item_id: str) -> Any:
        """Handle the API request.

        :param kind: catalogue kind.
        :param item_id: item identifier.
        :return: Result data.
        """
        media_type_by_kind = {"music": "album", "movies": "movie", "books": "book"}
        media_type = media_type_by_kind.get(kind)
        if kind == "games":
            return jsonify({"error": "video game catalogue support is TODO"}), 501
        if not media_type:
            return jsonify({"error": "invalid kind"}), 400

        storage = media_apps[media_type].storage
        items = storage.get_all()
        remaining = [item for item in items if str(item.get("id")) != item_id]
        if len(remaining) == len(items):
            return jsonify({"error": "item not found"}), 404

        storage.save(remaining)
        return jsonify({"status": "deleted", "id": item_id, "kind": kind})

    @app.route("/api/items/<kind>/<item_id>", methods=["PATCH"])
    def api_update_item(kind: str, item_id: str) -> Any:
        """Handle the API request.

        :param kind: catalogue kind.
        :param item_id: item identifier.
        :return: Result data.
        """
        media_type_by_kind = {"music": "album", "movies": "movie", "books": "book"}
        media_type = media_type_by_kind.get(kind)
        if kind == "games":
            return jsonify({"error": "video game catalogue support is TODO"}), 501
        if not media_type:
            return jsonify({"error": "invalid kind"}), 400

        updates = request.json or {}
        storage = media_apps[media_type].storage
        items = storage.get_all()
        index = find_item_index(items, item_id)
        if index is None:
            return jsonify({"error": "item not found"}), 404

        current = items[index]
        next_item = {**current, **updates, "id": current.get("id")}
        if media_type == "album":
            next_item = normalize_music_metadata(next_item)
            next_item = media_apps["album"].ensure_local_cover(
                next_item,
                cover_url=updates.get("cover"),
                overwrite=bool(updates.get("cover") and updates.get("cover") != current.get("cover")),
            )
        elif media_type == "movie":
            next_item = normalize_movie_metadata(next_item)
            next_item = media_apps["movie"].ensure_local_poster(
                next_item,
                poster_url=updates.get("poster_full"),
                overwrite=bool(updates.get("poster_full") and updates.get("poster_full") != current.get("poster_full")),
            )
        elif media_type == "book":
            next_item = media_apps["book"].ensure_local_cover(
                next_item,
                previous_cover=current.get("cover"),
            )
        items[index] = next_item
        storage.save(items)
        return jsonify(serialize_media_item(next_item))

    @app.route("/api/images/localize", methods=["POST"])
    def api_localize_images() -> Any:
        """Download remote item images into backend covers/ as WebP files."""
        result: dict[str, Any] = {
            "scanned": 0,
            "localized": 0,
            "skipped": 0,
            "failed": 0,
            "migrated": 0,
            "removed": 0,
            "failures": [],
            "music": [],
            "movies": [],
            "books": [],
        }

        jobs = [
            ("music", "album", "cover", "cover_local", lambda item: media_apps["album"].ensure_local_cover(item)),
            ("movies", "movie", "poster_full", "poster_local", lambda item: media_apps["movie"].ensure_local_poster(item)),
            ("books", "book", "cover", "cover_local", lambda item: media_apps["book"].ensure_local_cover(item)),
        ]

        for output_key, media_type, source_field, local_field, localize in jobs:
            storage = media_apps[media_type].storage
            items = storage.get_all()
            next_items = []

            for item in items:
                result["scanned"] += 1
                next_item = dict(item)
                before = item.get(local_field)
                source = item.get(source_field)
                had_legacy_path = any(is_catalog_image_path(next_item.get(field)) for field in (source_field, local_field))
                existing_local_path = local_cover_path(next_item.get(local_field))
                canonical_path = existing_local_path if existing_local_path is not None and existing_local_path.is_file() else None
                if canonical_path is None:
                    canonical_path = migrate_catalog_image_path(next_item.get(source_field))
                if canonical_path is None:
                    canonical_path = migrate_catalog_image_path(next_item.get(local_field))
                if canonical_path is not None:
                    next_item[local_field] = str(canonical_path)
                    if is_catalog_image_path(next_item.get(source_field)):
                        next_item[source_field] = str(canonical_path)
                if had_legacy_path and not any(is_catalog_image_path(next_item.get(field)) for field in (source_field, local_field)):
                    result["migrated"] += 1

                source = next_item.get(source_field)
                source_local_path = local_cover_path(source)
                source_is_local = (
                    is_catalog_image_path(source)
                    or is_embedded_image(source)
                    or (source_local_path is not None and source_local_path.is_file())
                )
                next_item = next_item if source_is_local else localize(next_item)
                if source_local_path is not None and source_local_path.is_file() and not next_item.get(local_field):
                    next_item[local_field] = str(source_local_path)
                next_item = normalize_local_image_paths(next_item)
                after = next_item.get(local_field)
                if before or source_is_local:
                    result["skipped"] += 1
                elif after:
                    result["localized"] += 1
                elif item.get(source_field):
                    result["failed"] += 1
                    creators = item.get("artists") or item.get("authors") or item.get("directors") or []
                    if isinstance(creators, list):
                        creator_text = ", ".join(str(value) for value in creators if value)
                    else:
                        creator_text = str(creators or "")
                    title = str(item.get("title") or item.get("name") or item.get("id") or "Untitled")
                    label = f"{creator_text} - {title}" if creator_text else title
                    result["failures"].append({
                        "kind": output_key,
                        "id": str(item.get("id") or ""),
                        "label": label,
                    })
                else:
                    result["skipped"] += 1
                next_items.append(next_item)

            storage.save(next_items)
            result[output_key] = serialize_media_items(next_items)

        all_items = []
        for _, media_type, _, _, _ in jobs:
            all_items.extend(media_apps[media_type].storage.get_all())
        result["removed"] = remove_unused_covers(referenced_cover_paths(all_items))
        result["removed"] += remove_unused_catalog_images(all_items)

        return jsonify(result)

    @app.route("/api/settings", methods=["GET"])
    def api_get_settings() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        return jsonify(normalize_config(load_config(config_location)))

    @app.route("/api/settings", methods=["PATCH"])
    def api_save_settings() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        next_config = normalize_config(request.json or {})
        save_config(config_location, next_config)
        return jsonify({"status": "saved"})

    @app.route("/api/database/backup", methods=["GET"])
    def api_download_database_backup() -> Any:
        """Download a portable backup of the database and local artwork."""
        database_path = resolve_backend_path(media_apps["album"].storage.path)
        if not database_path.is_file():
            return jsonify({"error": "database not found"}), 404

        backup_directory = BASE_DIR / "var"
        backup_directory.mkdir(parents=True, exist_ok=True)
        temporary_database_file = tempfile.NamedTemporaryFile(
            dir=backup_directory,
            prefix=".mycatalog-backup-db-",
            suffix=".sqlite3",
            delete=False,
        )
        temporary_database_path = Path(temporary_database_file.name)
        temporary_database_file.close()
        archive_file = tempfile.NamedTemporaryFile(
            dir=backup_directory,
            prefix="mycatalog-backup-",
            suffix=".zip",
            delete=False,
        )
        archive_path = Path(archive_file.name)
        archive_file.close()

        try:
            create_backup_archive(database_path, archive_path, temporary_database_path)
        except (OSError, sqlite3.Error, zipfile.BadZipFile) as error:
            temporary_database_path.unlink(missing_ok=True)
            archive_path.unlink(missing_ok=True)
            return jsonify({"error": f"could not create database backup: {error}"}), 500

        @after_this_request
        def remove_temporary_backup(response: Any) -> Any:
            temporary_database_path.unlink(missing_ok=True)
            archive_path.unlink(missing_ok=True)
            return response

        return send_file(
            archive_path,
            as_attachment=True,
            download_name=f"mycatalog-backup-{datetime.now().strftime('%Y-%m-%d')}.zip",
            mimetype="application/zip",
        )

    @app.route("/api/database/backup", methods=["POST"])
    def api_restore_database_backup() -> Any:
        """Validate and atomically restore an uploaded ZIP or legacy SQLite backup."""
        uploaded = request.files.get("file")
        if uploaded is None or not uploaded.filename:
            return jsonify({"error": "database file is required"}), 400

        database_path = resolve_backend_path(media_apps["album"].storage.path)
        database_path.parent.mkdir(parents=True, exist_ok=True)
        backup_directory = BASE_DIR / "var"
        backup_directory.mkdir(parents=True, exist_ok=True)
        temporary_file = tempfile.NamedTemporaryFile(
            dir=backup_directory,
            prefix=".mycatalog-restore-upload-",
            suffix=".backup",
            delete=False,
        )
        temporary_path = Path(temporary_file.name)
        temporary_file.close()

        try:
            uploaded.save(temporary_path)
            if temporary_path.stat().st_size > BACKUP_ARCHIVE_MAX_BYTES:
                return jsonify({"error": "database backup is too large"}), 413

            if zipfile.is_zipfile(temporary_path):
                with tempfile.TemporaryDirectory(dir=backup_directory, prefix=".mycatalog-restore-") as staging_directory:
                    staging_path = Path(staging_directory)
                    extract_backup_archive(temporary_path, staging_path)
                    staged_database_path = staging_path / BACKUP_ARCHIVE_DATABASE_NAME
                    staged_covers_path = staging_path / BACKUP_ARCHIVE_COVERS_DIR
                    validate_sqlite_database(staged_database_path)
                    rewrite_local_image_paths(staged_database_path, COVERS_DIR)
                    validate_sqlite_database(staged_database_path)
                    restore_database_and_covers(database_path, staged_database_path, staged_covers_path)
            else:
                if temporary_path.stat().st_size > DATABASE_UPLOAD_MAX_BYTES:
                    return jsonify({"error": "database backup is too large"}), 413
                validate_sqlite_database(temporary_path)

                if database_path.is_file():
                    safety_path = database_path.with_name(
                        f"{database_path.stem}.pre-restore-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}{database_path.suffix}"
                    )
                    backup_sqlite_database(database_path, safety_path)

                os.replace(temporary_path, database_path)
                for sidecar_path in (Path(f"{database_path}-wal"), Path(f"{database_path}-shm")):
                    sidecar_path.unlink(missing_ok=True)

            return jsonify({"status": "restored"})
        except (ValueError, zipfile.BadZipFile) as error:
            return jsonify({"error": str(error)}), 400
        except (OSError, sqlite3.Error) as error:
            return jsonify({"error": f"could not restore database backup: {error}"}), 500
        finally:
            temporary_path.unlink(missing_ok=True)

    @app.route("/api/database/backup", methods=["DELETE"])
    def api_delete_database() -> Any:
        """Clear the catalogue database and local artwork after explicit confirmation."""
        database_path = resolve_backend_path(media_apps["album"].storage.path)
        if not database_path.is_file():
            return jsonify({"error": "database not found"}), 404

        try:
            clear_database_and_covers(database_path)
            return jsonify({"status": "deleted"})
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        except (OSError, sqlite3.Error) as error:
            return jsonify({"error": f"could not delete database: {error}"}), 500

    @app.route("/api/inconsistencies", methods=["GET"])
    def api_detect_inconsistencies() -> Any:
        """Generate music and book metadata inconsistency reports."""
        storage_path = resolve_backend_path(media_apps["album"].storage.path)
        report_path = REPORTS_DIR / "music_track_numbering_anomalies.md"
        payload = generate_music_inconsistency_report(
            db_path=storage_path,
            report_path=report_path,
            apply=False,
            base_dir=BASE_DIR,
        )
        book_payload = detect_storage_inconsistencies(
            media_apps,
            config_location,
            included_kinds=("books",),
        )
        payload["scanned"] += book_payload["scanned"]
        payload["issueCount"] += book_payload["issueCount"]
        payload["dataIssueCount"] += book_payload["issueCount"]
        payload["issues"].extend(book_payload["issues"])
        payload["files"].extend(book_payload["files"][1:])
        report_url = f"{request.host_url.rstrip('/')}/reports/{report_path.name}"
        payload["reportUrl"] = report_url
        if payload.get("files"):
            payload["files"][0]["url"] = report_url
        return jsonify(payload)

    @app.route("/api/files/reveal", methods=["POST"])
    def api_reveal_file() -> Any:
        """Reveal a permitted backend file in the local file browser."""
        data = request.json or {}
        raw_path = str(data.get("path") or "").strip()
        if not raw_path:
            return jsonify({"error": "path is required"}), 400

        path = resolve_backend_path(raw_path)
        if not is_allowed_backend_path(path, media_apps, config_location):
            return jsonify({"error": "path is not allowed"}), 403

        target = path if path.exists() else path.parent
        try:
            if subprocess.run(["open", "-R", str(target)], check=False).returncode != 0:
                subprocess.run(["open", str(target.parent if target.is_file() else target)], check=False)
        except OSError as error:
            return jsonify({"error": str(error)}), 500

        return jsonify({"status": "opened", "path": str(path.resolve())})

    @app.route("/api/external/music/search", methods=["POST"])
    def api_search_external_music() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        data = request.json or {}
        query = str(data.get("query") or "").strip()
        per_page = min(25, max(1, int(data.get("perPage") or 12)))
        if not query:
            return jsonify({"error": "query is required"}), 400

        results = discogs.search_release(query, release_format=None, per_page=per_page)
        items = [
            {
                "id": item.get("id"),
                "title": item.get("title") or "Untitled",
                "year": item.get("year"),
                "genres": item.get("genre") or [],
                "styles": item.get("style") or [],
                "cover": item.get("cover_image"),
                "format": (item.get("format") or [None])[0],
                "country": item.get("country"),
            }
            for item in results.get("results", [])
        ]
        return jsonify({"items": items})

    @app.route("/api/external/music/import", methods=["POST"])
    def api_import_external_music() -> Any:
        """Handle the API request.

        :return: Result data.
        """
        data = request.json or {}
        release_id = data.get("id")
        try:
            release_id = int(release_id)
        except (TypeError, ValueError):
            return jsonify({"error": "valid release id is required"}), 400

        existing = [
            item
            for item in media_apps["album"].storage.get_all()
            if item.get("id") == release_id
        ]
        if existing:
            storage = media_apps["album"].storage
            items = storage.get_all()
            existing_item = next(item for item in items if item.get("id") == release_id)
            media_apps["album"].ensure_local_cover(existing_item, data.get("cover"))
            storage.save(items)
            return jsonify({"item": serialize_media_item(existing_item), "alreadyExists": True})

        item = media_apps["album"].add_album_by_discogs_id(
            release_id,
            release_format=data.get("format") or DEFAULT_MUSIC_RELEASE_FORMAT,
            release_type=data.get("type") or data.get("release_type") or DEFAULT_MUSIC_RELEASE_TYPE,
            fallback_cover=data.get("cover"),
            packaging=data.get("packaging") or DEFAULT_MUSIC_PACKAGING,
        )
        if not item:
            return jsonify({"error": "not found"}), 404

        return jsonify({"item": serialize_media_item(item), "alreadyExists": False}), 201

    @app.route("/health", methods=["GET"])
    def healthcheck() -> Any:
        """Handle the service request.

        :return: Result data.
        """
        return jsonify({"status": "ok"})

    return app


if __name__ == "__main__":
    debug = os.environ.get("MYCATALOG_DEBUG", "0") == "1"
    port = int(os.environ.get("MYCATALOG_PORT", "5000"))
    create_app().run(debug=debug, use_reloader=False, host="127.0.0.1", port=port)
