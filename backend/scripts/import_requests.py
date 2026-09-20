"""Import media catalogue items from a local JSON request file."""

import argparse
import json
import logging
from pathlib import Path

import yaml
from colorlog import ColoredFormatter

from _bootstrap import BASE_DIR
from src.app_books import BooksApp
from src.app_movies import MovieApp
from src.app_music import MusicApp
from src.discogs_client import DiscogsClient
from src.googlebooks_client import GoogleBooksClient
from src.music_metadata import DEFAULT_MUSIC_RELEASE_TYPE
from src.openlibrary_client import OpenLibraryClient
from src.storage import SQLiteStorage
from src.tmdb_client import TMDbClient


def repository_path(path: str | Path) -> Path:
    """Resolve relative paths from the repository root."""
    next_path = Path(path)
    return next_path if next_path.is_absolute() else BASE_DIR / next_path


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments.

    :return: Parsed command-line arguments.
    """
    parser = argparse.ArgumentParser(
        description="Import catalogue items from a local request JSON file.",
    )
    parser.add_argument(
        "request_file",
        nargs="?",
        type=Path,
        default=BASE_DIR / "var" / "request.json",
        help="Request JSON file. Defaults to ./var/request.json.",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=BASE_DIR / "config.yaml",
        help="YAML configuration file. Defaults to ./config.yaml.",
    )
    return parser.parse_args()


def setup_logger() -> logging.Logger:
    """Configure logging with colorlog formatting.

    :return: The configured root logger instance.
    """
    handler = logging.StreamHandler()
    formatter = ColoredFormatter(
        "%(log_color)s%(levelname)-8s%(reset)s %(white)s%(message)s",
        log_colors={
            "DEBUG": "cyan",
            "INFO": "green",
            "WARNING": "yellow",
            "ERROR": "red",
            "CRITICAL": "bold_red",
        },
    )
    handler.setFormatter(formatter)
    logger = logging.getLogger()
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger


def main() -> None:
    """
    Main execution function to process media requests and manage the collection.
    """
    logger = setup_logger()
    args = parse_args()
    config_path = repository_path(args.config)
    request_path = repository_path(args.request_file)

    with config_path.open("r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    tmdb = TMDbClient(
        api_key=config["tmdb"]["api_key"], base_url=config["tmdb"]["base_url"])
    discogs = DiscogsClient(
        token=config["discogs"]["token"], base_url=config["discogs"]["base_url"])
    google_books = GoogleBooksClient(
        base_url=config["google_books"]["base_url"], api_key=config["google_books"].get("api_key"))
    open_library_cfg = config.get("open_library", {})
    open_library = OpenLibraryClient(
        base_url=open_library_cfg.get("base_url", "https://openlibrary.org"))
    database_path = repository_path(config["storage"]["database_path"])
    apps = {
        "movie": MovieApp(tmdb, SQLiteStorage(database_path, "movie")),
        "album": MusicApp(discogs, SQLiteStorage(database_path, "album")),
        "book": BooksApp(
            google_books,
            SQLiteStorage(database_path, "book"),
            open_library,
        ),
    }

    with request_path.open("r", encoding="utf-8") as f:
        requests_list = json.load(f)

    for req in requests_list:
        t = req.get("type")
        if t == "movie":
            apps["movie"].add_movie(
                query=req.get("query"),
                year=req.get("year"),
                media_id=req.get("id"),
                media_type=req.get("media_type")
            )
        elif t == "album":
            release_format = req.get("release_format", "CD")
            release_type = req.get("release_type", DEFAULT_MUSIC_RELEASE_TYPE)
            location = req.get("location", "")
            if req.get("discogs_id"):
                apps["album"].add_album_by_discogs_id(
                    release_id=req["discogs_id"],
                    release_format=release_format,
                    release_type=release_type,
                    location=location,
                )
            else:
                apps["album"].add_album_by_name(
                    req["query"],
                    artist=req.get("artist"),
                    release_format=release_format,
                    release_type=release_type,
                    location=location,
                )
        elif t == "book":
            if req.get("isbn"):
                apps["book"].add_book_by_isbn(req["isbn"])
            else:
                apps["book"].add_book_by_name(req["query"])
        elif t == "game":
            logger.warning("Skipping game request because video game support is TODO: %s", req)

    # Final summary
    logger.info("=== Storage summary ===")
    for key, app in apps.items():
        count = len(app.storage.get_all())
        logger.info(
            "%s storage: %s (%d items)", key.title(), app.storage.path, count)


if __name__ == "__main__":
    main()
