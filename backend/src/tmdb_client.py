"""Client helpers for integrating with the TMDb API."""

import logging
from typing import Tuple

import requests


class TMDbClient:
    """Client wrapper for The Movie Database (TMDb) API."""

    def __init__(self, api_key: str, base_url: str = "https://api.themoviedb.org/3") -> None:
        """Initialize the instance.

        :param api_key: api key value.
        :param base_url: base url value.
        """
        self.api_key = api_key
        self.base_url = base_url
        self.logger = logging.getLogger(self.__class__.__name__)

    # --- Movies ---
    def search_movie(self, query: str, year: int | None = None) -> dict:
        """Search for a movie by title and optional release year.

        :param query: Movie title text to search for.
        :param year: Optional release year filter.
        :return: Raw TMDb payload for the movie search.
        """
        url = f"{self.base_url}/search/movie"
        params = {"api_key": self.api_key, "query": query}
        if year:
            params["year"] = year
        self.logger.debug("Searching TMDb (movie) for: %s (year=%s)", query, year)
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        return resp.json()

    def get_movie_details(self, movie_id: int, language: str = "es-ES") -> dict:
        """Retrieve movie details for a TMDb ID.

        :param movie_id: TMDb identifier for the movie.
        :param language: Locale used for localized fields.
        :return: Movie details payload from TMDb.
        """
        url = f"{self.base_url}/movie/{movie_id}"
        params = {"api_key": self.api_key, "language": language}
        self.logger.debug("Fetching TMDb movie details for ID %s in %s", movie_id, language)
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        return resp.json()

    def get_movie_credits(self, movie_id: int, language: str = "es-ES") -> dict:
        """Fetch credits for a movie.

        :param movie_id: TMDb identifier for the movie.
        :param language: Locale used for localized fields.
        :return: Credits payload containing cast and crew.
        """
        url = f"{self.base_url}/movie/{movie_id}/credits"
        params = {"api_key": self.api_key, "language": language}
        self.logger.debug("Fetching TMDb movie credits for ID %s in %s", movie_id, language)
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        return resp.json()

    # --- Series / TV ---
    def search_tv(self, query: str, first_air_date_year: int | None = None) -> dict:
        """Search for a TV show by name and optional first air year.

        :param query: Series title text to search for.
        :param first_air_date_year: Optional first-air year filter.
        :return: Raw TMDb payload for the TV search.
        """
        url = f"{self.base_url}/search/tv"
        params = {"api_key": self.api_key, "query": query}
        if first_air_date_year:
            params["first_air_date_year"] = first_air_date_year
        self.logger.debug("Searching TMDb (tv) for: %s (year=%s)", query, first_air_date_year)
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        return resp.json()

    def get_tv_details(self, tv_id: int, language: str = "es-ES") -> dict:
        """Retrieve TV show details for a TMDb ID.

        :param tv_id: TMDb identifier for the TV show.
        :param language: Locale used for localized fields.
        :return: TV show details payload from TMDb.
        """
        url = f"{self.base_url}/tv/{tv_id}"
        params = {"api_key": self.api_key, "language": language}
        self.logger.debug("Fetching TMDb tv details for ID %s in %s", tv_id, language)
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        return resp.json()

    def get_tv_credits(self, tv_id: int, language: str = "es-ES") -> dict:
        """Fetch credits for a TV show.

        :param tv_id: TMDb identifier for the TV show.
        :param language: Locale used for localized fields.
        :return: Credits payload containing cast and crew.
        """
        url = f"{self.base_url}/tv/{tv_id}/credits"
        params = {"api_key": self.api_key, "language": language}
        self.logger.debug("Fetching TMDb tv credits for ID %s in %s", tv_id, language)
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        return resp.json()

    # --- Keywords ---
    def get_keywords_any(self, media_type: str, media_id: int) -> dict:
        """Return keywords metadata for movies or TV shows.

        :param media_type: ``"movie"`` or ``"tv"`` indicating the entity type.
        :param media_id: TMDb identifier for the entity.
        :return: Keywords payload from TMDb, or an empty dict for unsupported types.
        """
        if media_type == "movie":
            url = f"{self.base_url}/movie/{media_id}/keywords"
        elif media_type == "tv":
            url = f"{self.base_url}/tv/{media_id}/keywords"
        else:
            return {}

        params = {"api_key": self.api_key}
        self.logger.debug("Fetching TMDb %s keywords for ID %s", media_type, media_id)
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        return resp.json()

    # --- Unified methods ---
    def search_any(self, query: str, year: int | None = None) -> Tuple[str, dict]:
        """Search movies first and then TV shows using the same query.

        :param query: Text to search for.
        :param year: Optional year filter applied to both searches.
        :return: Tuple with the resolved media type and the corresponding TMDb payload.
        """
        data = self.search_movie(query, year=year)
        if data.get("results"):
            return "movie", data
        data = self.search_tv(query, first_air_date_year=year)
        if data.get("results"):
            return "tv", data
        return "none", {}

    def get_details_any(self, media_type: str, media_id: int, language: str = "es-ES") -> dict:
        """Fetch details for a media item by type and TMDb ID.

        :param media_type: Expected media type, usually ``"movie"`` or ``"tv"``.
        :param media_id: TMDb identifier for the item.
        :param language: Locale used for localized fields.
        :return: Details payload for the requested media item, or an empty dict when unsupported.
        """
        if media_type == "movie":
            return self.get_movie_details(media_id, language=language)
        if media_type == "tv":
            return self.get_tv_details(media_id, language=language)
        return {}

    def get_by_id_any(self, media_type: str, media_id: int, language: str = "es-ES") -> dict:
        """Fetch details for a media item by type and TMDb ID.

        :param media_type: Expected media type, usually ``"movie"`` or ``"tv"``.
        :param media_id: TMDb identifier for the item.
        :param language: Locale used for localized fields.
        :return: Details payload for the requested media item, or an empty dict when unsupported.
        """
        return self.get_details_any(media_type, media_id, language=language)
