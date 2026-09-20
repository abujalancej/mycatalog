"""Client helpers for integrating with the Google Books API."""

import logging
import time
import requests


class GoogleBooksClient:
    """
    Client for the Google Books API.
    """
    def __init__(
        self,
        base_url: str = "https://www.googleapis.com/books/v1",
        api_key: str | None = None,
    ) -> None:
        """Initialize the instance.

        :param base_url: base url value.
        :param api_key: api key value.
        """
        self.base_url = base_url
        self.api_key = api_key
        self.logger = logging.getLogger(self.__class__.__name__)
        self._cache: dict[tuple[str, tuple[tuple[str, str], ...]], tuple[float, dict]] = {}
        self._cache_ttl_seconds = 600
        self._rate_limited_until = 0.0

    def _request_json(self, url: str, params: dict) -> dict:
        """Handle request json.

        :param url: url value.
        :param params: params value.
        :return: Requested data.
        """
        now = time.monotonic()
        if now < self._rate_limited_until:
            response = requests.Response()
            response.status_code = 429
            response.url = url
            raise requests.HTTPError("Google Books rate limit cooling down", response=response)

        cache_key = (
            url,
            tuple(sorted((key, str(value)) for key, value in params.items())),
        )
        cached = self._cache.get(cache_key)
        if cached and now - cached[0] < self._cache_ttl_seconds:
            return cached[1]

        resp = requests.get(url, params=params, timeout=10)
        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After")
            try:
                wait_seconds = int(retry_after) if retry_after else 60
            except ValueError:
                wait_seconds = 60
            self._rate_limited_until = time.monotonic() + max(15, min(300, wait_seconds))
        resp.raise_for_status()

        payload = resp.json()
        self._cache[cache_key] = (time.monotonic(), payload)
        return payload

    def search_book(self, query: str) -> dict:
        """Search for books using free-form text.

        :param query: Search string (title, author, keywords, etc.).
        :return: Google Books API payload for the search results.
        """
        url = f"{self.base_url}/volumes"
        params = {"q": query}
        if self.api_key:
            params["key"] = self.api_key
        self.logger.debug("Searching Google Books: %s", query)
        return self._request_json(url, params)

    def search_by_title_author(
        self,
        title: str,
        author: str | None = None,
        start_index: int = 0,
        max_results: int = 20,
    ) -> dict:
        """Search for books by title and optional author."""
        url = f"{self.base_url}/volumes"
        query_parts = [f"intitle:{title}"]
        if author:
            query_parts.append(f"inauthor:{author}")

        params = {
            "q": " ".join(query_parts),
            "startIndex": max(0, start_index),
            "maxResults": max(1, min(40, max_results)),
        }
        if self.api_key:
            params["key"] = self.api_key

        self.logger.debug("Searching Google Books by title/author: %s", params["q"])
        return self._request_json(url, params)

    def search_by_isbn(self, isbn: str) -> dict:
        """Search for books by ISBN.

        :param isbn: ISBN identifier to query.
        :return: Google Books API payload for the search results.
        """
        url = f"{self.base_url}/volumes"
        params = {"q": f"isbn:{isbn}"}
        if self.api_key:
            params["key"] = self.api_key
        self.logger.debug("Searching Google Books by ISBN: %s", isbn)
        return self._request_json(url, params)

    def get_book_details(self, book_id: str) -> dict:
        """Retrieve book details by volume identifier.

        :param book_id: Google Books volume identifier.
        :return: Details payload for the selected book.
        """
        url = f"{self.base_url}/volumes/{book_id}"
        params = {}
        if self.api_key:
            params["key"] = self.api_key

        self.logger.debug("Fetching Google Book details for %s", book_id)
        return self._request_json(url, params)
