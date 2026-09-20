"""Application logic for managing a movie and TV show collection via TMDb."""

import logging
import json
from pathlib import Path
from typing import Any
from src.tmdb_client import TMDbClient
from src.storage import Storage
from src.image_downloader import download_image_as_webp
from src.movie_metadata import (
    DEFAULT_MOVIE_EDITION,
    DEFAULT_MOVIE_FORMAT,
    DEFAULT_MOVIE_PACKAGING,
    normalize_movie_metadata,
)

BASE_DIR = Path(__file__).resolve().parents[1]
COVERS_DIR = BASE_DIR / "covers" / "movies"
REJECTED_PATH = BASE_DIR / "var" / "rejected_movies.json"


class MovieApp:
    """
    Application logic for managing a movie and TV show collection via TMDb.
    """
    def __init__(self, tmdb: TMDbClient, storage: Storage) -> None:
        """Initialize the instance.

        :param tmdb: tmdb value.
        :param storage: storage value.
        """
        self.tmdb = tmdb
        self.storage = storage
        self.logger = logging.getLogger(self.__class__.__name__)

    def ensure_local_poster(
        self,
        entry: dict[str, Any],
        poster_url: str | None = None,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """Ensure a remote movie poster URL is stored as a local WebP file."""
        entry.update(normalize_movie_metadata(entry))
        url = poster_url or entry.get("poster_full")
        if not url:
            return entry

        entry["poster_full"] = url
        media_type = entry.get("media_type") or "movie"
        local_path = COVERS_DIR / f"{media_type}_{entry['id']}.webp"
        if local_path.exists() and not overwrite:
            entry["poster_local"] = str(local_path)
        else:
            entry["poster_local"] = download_image_as_webp(url, local_path, overwrite=overwrite)
        return entry

    def _save_rejected(self, entry: dict[str, Any]) -> None:
        """
        Append a failed request entry to the rejected list.
        :param entry: Metadata describing the rejected movie request.
        :return: None.
        """
        rejected = []
        REJECTED_PATH.parent.mkdir(parents=True, exist_ok=True)
        if REJECTED_PATH.exists():
            try:
                with open(REJECTED_PATH, "r", encoding="utf-8") as f:
                    rejected = json.load(f)
            except (OSError, json.JSONDecodeError) as err:
                self.logger.warning("Failed to read rejected list (%s): %s", REJECTED_PATH, err)
                rejected = []

        rejected.append(entry)

        with open(REJECTED_PATH, "w", encoding="utf-8") as f:
            json.dump(rejected, f, ensure_ascii=False, indent=2)

        self.logger.info("Added to rejected list: %s", entry)

    def add_movie(
        self,
        query: str | None = None,
        year: int | None = None,
        media_id: int | None = None,
        media_type: str | None = None,
    ) -> dict[str, Any] | None:
        """Ingest a movie or TV show into storage using TMDb data.

        - When ``media_id`` and ``media_type`` are provided, fetch details directly.
        - Otherwise perform a search using the provided query (filtered by year when available).

        :param query: Free-text query to search on TMDb.
        :param year: Optional release year filter.
        :param media_id: Explicit TMDb identifier that skips the search.
        :param media_type: Explicit media type when ``media_id`` is supplied.
        :return: Stored entry, or ``None`` if nothing was added.
        """
        if media_id and media_type:
            details_en = self.tmdb.get_details_any(media_type, media_id, language="en-US")
            details_es = self.tmdb.get_details_any(media_type, media_id, language="es-ES")
            item = details_en
        else:
            media_type, search_results = self.tmdb.search_any(query, year=year)
            if media_type == "none" or not search_results.get("results"):
                self.logger.warning("No results found for '%s' (%s)", query, year)
                self._save_rejected({
                    "type": "movie",
                    "query": query,
                    "year": year,
                    "id": media_id,
                    "media_type": media_type
                })
                return None
            item = search_results["results"][0]
            details_en = self.tmdb.get_details_any(media_type, item["id"], language="en-US")
            details_es = self.tmdb.get_details_any(media_type, item["id"], language="es-ES")

        merged = details_en.copy()
        merged["media_type"] = media_type
        merged["overview_es"] = details_es.get("overview", "")

        if media_type == "movie":
            merged["title_es"] = details_es.get("title", "")
            merged["title_en"] = details_en.get("title", "")
        elif media_type == "tv":
            merged["title_es"] = details_es.get("name", "")
            merged["title_en"] = details_en.get("name", "")

        poster_path = details_en.get("poster_path")
        if poster_path:
            url = f"https://image.tmdb.org/t/p/original{poster_path}"
            merged["poster_full"] = url
            merged["poster_local"] = download_image_as_webp(
                url,
                COVERS_DIR / f"{media_type}_{merged['id']}.webp"
            )
        else:
            merged["poster_full"] = None
            merged["poster_local"] = None

        credits_data = None
        if media_type == "movie":
            credits_data = self.tmdb.get_movie_credits(item["id"], language="es-ES")
        elif media_type == "tv":
            credits_data = self.tmdb.get_tv_credits(item["id"], language="es-ES")

        if credits_data:
            merged["cast"] = [c["name"] for c in credits_data.get("cast", [])[:5]]
            merged["directors"] = [c["name"] for c in credits_data.get("crew", [])
                                   if c.get("job") == "Director"]

        merged["runtime"] = details_en.get("runtime") if media_type == "movie" else None
        merged["tagline"] = details_en.get("tagline")
        merged["collection"] = (
            details_en.get("belongs_to_collection", {}).get("name")
            if details_en.get("belongs_to_collection")
            else None
        )
        merged["production_companies"] = [c["name"]
                                          for c in details_en.get("production_companies", [])]
        merged["genres"] = [g["name"] for g in details_en.get("genres", [])]

        if media_type == "tv":
            merged["seasons"] = details_en.get("number_of_seasons")
            merged["episodes"] = details_en.get("number_of_episodes")
        else:
            merged["seasons"] = None
            merged["episodes"] = None

        keywords_data = self.tmdb.get_keywords_any(media_type, merged["id"])
        if media_type == "movie":
            merged["keywords"] = [k["name"] for k in keywords_data.get("keywords", [])]
        elif media_type == "tv":
            merged["keywords"] = [k["name"] for k in keywords_data.get("results", [])]
        else:
            merged["keywords"] = []

        merged["format"] = DEFAULT_MOVIE_FORMAT
        merged["edition"] = DEFAULT_MOVIE_EDITION
        merged["packaging"] = DEFAULT_MOVIE_PACKAGING
        merged["format_details"] = None
        merged["purchased"] = None
        merged["location"] = None

        merged = normalize_movie_metadata(merged)
        self.storage.add_unique(merged)
        return merged
