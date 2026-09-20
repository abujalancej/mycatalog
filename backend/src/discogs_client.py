"""Client helpers for integrating with the Discogs API."""

import logging
import time
from threading import Lock
from typing import Any

import requests


class DiscogsClient:
    """
    Client for the Discogs API with rate limiting and retries.
    """

    def __init__(
        self,
        token: str,
        base_url: str = "https://api.discogs.com",
        rate_limit_per_minute: int = 60,
        user_agent: str | None = None,
    ) -> None:
        """Initialize the instance.

        :param token: token value.
        :param base_url: base url value.
        :param rate_limit_per_minute: rate limit per minute value.
        :param user_agent: user agent value.
        """
        self.token = token
        self.base_url = base_url
        self.logger = logging.getLogger(self.__class__.__name__)
        self.rate_limit_interval = 60.0 / rate_limit_per_minute
        self._last_request = 0.0
        self._lock = Lock()
        self.user_agent = user_agent or "myCatalogue/1.0 (+https://example.com)"

    def _respect_rate_limit(self) -> None:
        """Ensure the client does not exceed the configured rate limit.

        :return: None.
        """
        with self._lock:
            now = time.time()
            elapsed = now - self._last_request
            if elapsed < self.rate_limit_interval:
                sleep_time = self.rate_limit_interval - elapsed
                self.logger.debug("Rate limit: sleeping %.2fs", sleep_time)
                time.sleep(sleep_time)
            self._last_request = time.time()

    def _get(
        self,
        url: str,
        params: dict[str, Any],
        retries: int = 3,
        delay: int = 2,
    ) -> dict[str, Any]:
        """Issue a GET request with retries and rate limiting.

        :param url: Full request URL.
        :param params: Query parameters to attach to the request.
        :param retries: Maximum number of attempts before giving up.
        :param delay: Delay in seconds between retries.
        :return: Parsed JSON payload on success, otherwise an empty dict.
        """
        for attempt in range(1, retries + 1):
            self._respect_rate_limit()
            try:
                headers = {
                    "User-Agent": self.user_agent,
                    "Accept": "application/json",
                }
                resp = requests.get(url, params=params, headers=headers, timeout=10)
                resp.raise_for_status()
                return resp.json()
            except requests.exceptions.HTTPError as e:
                if resp.status_code >= 500 and attempt < retries:
                    self.logger.warning("Discogs error %s, retrying in %ss...",
                                        resp.status_code, delay)
                    time.sleep(delay)
                    continue
                self.logger.error("HTTP error: %s", e)
                return {}
            except requests.exceptions.RequestException as e:
                self.logger.error("Request error: %s", e)
                return {}
        return {}

    def search_release(
        self,
        query: str,
        artist: str | None = None,
        release_format: str | None = "CD",
        per_page: int | None = None,
        retries: int = 3,
        delay: int = 2,
    ) -> dict:
        """Search for a release on Discogs using textual filters.

        :param query: Free-text query (typically the album title).
        :param artist: Optional artist filter to refine the search.
        :param release_format: Desired media format (default ``"CD"``).
        :param per_page: Optional maximum number of results returned by Discogs.
        :param retries: Maximum number of attempts before giving up.
        :param delay: Delay in seconds between retries.
        :return: Search payload returned by Discogs.
        """
        url = f"{self.base_url}/database/search"
        params = {
            "q": query,
            "type": "release",
            "token": self.token,
        }
        if release_format:
            params["format"] = release_format
        if per_page:
            params["per_page"] = per_page
        if artist:
            params["artist"] = artist
        return self._get(url, params, retries=retries, delay=delay)

    def get_release_details(self, release_id: int, retries: int = 3, delay: int = 2) -> dict:
        """Retrieve release details by ID with rate limiting and retries.

        :param release_id: Discogs release identifier.
        :param retries: Maximum number of attempts before giving up.
        :param delay: Delay in seconds between retries.
        :return: Release details payload returned by Discogs.
        """
        url = f"{self.base_url}/releases/{release_id}"
        params = {"token": self.token}
        return self._get(url, params, retries=retries, delay=delay)
