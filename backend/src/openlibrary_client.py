"""Client helpers for integrating with the Open Library API."""

from __future__ import annotations

import logging

import requests


class OpenLibraryClient:
    """Client for the Open Library Search and Books APIs."""

    def __init__(self, base_url: str = "https://openlibrary.org") -> None:
        """Initialize the instance.

        :param base_url: base url value.
        """
        self.base_url = base_url.rstrip("/")
        self.logger = logging.getLogger(self.__class__.__name__)

    def search_books(
        self,
        title: str,
        author: str | None = None,
        page: int = 1,
        limit: int = 20,
    ) -> dict:
        """Search for book editions by title and optional author."""
        url = f"{self.base_url}/search.json"
        params = {
            "title": title,
            "page": max(1, page),
            "limit": max(1, min(50, limit)),
            "fields": ",".join([
                "key",
                "title",
                "subtitle",
                "author_name",
                "first_publish_year",
                "publish_year",
                "publisher",
                "isbn",
                "cover_i",
                "edition_key",
                "language",
                "edition_count",
            ]),
        }
        if author:
            params["author"] = author

        self.logger.debug("Searching Open Library: title=%s author=%s", title, author)
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json()

    def get_by_isbn(self, isbn: str) -> dict:
        """Fetch an Open Library edition by ISBN."""
        url = f"{self.base_url}/isbn/{isbn}.json"
        self.logger.debug("Fetching Open Library ISBN %s", isbn)
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()

    def get_edition(self, edition_key: str) -> dict:
        """Fetch an Open Library edition by edition key."""
        clean_key = str(edition_key).strip().strip("/")
        if clean_key.startswith("books/"):
            clean_key = clean_key.split("/", 1)[1]

        url = f"{self.base_url}/books/{clean_key}.json"
        self.logger.debug("Fetching Open Library edition %s", clean_key)
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
