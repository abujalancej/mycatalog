"""Application logic for managing book entries in the media catalogue."""

from __future__ import annotations

import logging
import re
import unicodedata
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from requests import RequestException

from src.googlebooks_client import GoogleBooksClient
from src.image_downloader import download_image_as_webp
from src.isbn_utils import isbn13_to_isbn10, is_valid_isbn, normalize_isbn, split_isbns
from src.openlibrary_client import OpenLibraryClient
from src.storage import Storage

BASE_DIR = Path(__file__).resolve().parents[1]
COVERS_DIR = BASE_DIR / "covers" / "books"
REMOTE_SCHEMES = {"http", "https"}


class BookProviderUnavailable(RuntimeError):
    """Raised when no book metadata provider can be reached."""


def _clean_text(value: Any) -> str:
    """Return cleaned data.

    :param value: input value.
    :return: Text data.
    """
    return re.sub(r"\s+", " ", str(value or "").strip())


def _clean_list(values: Any) -> list[str]:
    """Return cleaned data.

    :param values: input values.
    :return: Matching values.
    """
    if not values:
        return []
    if isinstance(values, str):
        return [_clean_text(values)] if _clean_text(values) else []
    return [_clean_text(value) for value in values if _clean_text(value)]


def _publication_year(value: Any) -> int | None:
    """Handle publication year.

    :param value: input value.
    :return: Result data.
    """
    if isinstance(value, int):
        return value
    match = re.search(r"\b(1[5-9]\d{2}|20\d{2})\b", str(value or ""))
    return int(match.group(1)) if match else None


def _first_value(value: Any) -> str | None:
    """Handle first value.

    :param value: input value.
    :return: Result data.
    """
    if isinstance(value, list) and value:
        return _clean_text(value[0]) or None
    if isinstance(value, str):
        return _clean_text(value) or None
    return None


def _normalize_key(value: str) -> str:
    """Return normalized data.

    :param value: input value.
    :return: Text data.
    """
    normalized = unicodedata.normalize("NFD", value)
    without_marks = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", without_marks.lower()).strip()


def _is_remote_url(value: Any) -> bool:
    """Return whether the value matches the expected condition.

    :param value: input value.
    :return: True when the condition is met.
    """
    if not isinstance(value, str):
        return False
    return urlparse(value).scheme.lower() in REMOTE_SCHEMES


def _google_isbns(info: dict[str, Any]) -> tuple[str | None, str | None]:
    """Handle google isbns.

    :param info: info value.
    :return: Result data.
    """
    values = [
        item.get("identifier")
        for item in info.get("industryIdentifiers", [])
        if isinstance(item, dict)
    ]
    return split_isbns(values)


def _is_provider_not_found(error: RequestException) -> bool:
    """Return whether the value matches the expected condition.

    :param error: error value.
    :return: True when the condition is met.
    """
    response = getattr(error, "response", None)
    return getattr(response, "status_code", None) == 404


def _is_provider_rate_limited(error: RequestException) -> bool:
    """Return whether the value matches the expected condition.

    :param error: error value.
    :return: True when the condition is met.
    """
    response = getattr(error, "response", None)
    return getattr(response, "status_code", None) == 429


class BooksApp:
    """Application logic for searching, resolving, and storing books."""

    def __init__(
        self,
        google_books: GoogleBooksClient,
        storage: Storage,
        open_library: OpenLibraryClient | None = None,
    ) -> None:
        """Initialize the instance.

        :param google_books: google books value.
        :param storage: storage value.
        :param open_library: open library value.
        """
        self.google_books = google_books
        self.open_library = open_library or OpenLibraryClient()
        self.storage = storage
        self.logger = logging.getLogger(self.__class__.__name__)

    def search_books(
        self,
        title: str,
        author: str | None = None,
        page: int = 1,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Return normalized search candidates by title and optional author."""
        clean_title = _clean_text(title)
        clean_author = _clean_text(author)
        if not clean_title:
            return []

        max_results = max(1, min(20, limit))
        candidates: list[dict[str, Any]] = []
        provider_errors = []

        try:
            payload = self.open_library.search_books(
                clean_title,
                author=clean_author or None,
                page=page,
                limit=max_results,
            )
            candidates.extend(self._normalize_openlibrary_search(payload))
        except RequestException as error:
            provider_errors.append(error)
            self.logger.warning("Open Library search failed: %s", error)

        remaining = max_results * 2 - len(candidates)
        if remaining > 0:
            try:
                start_index = max(0, (max(1, page) - 1) * max_results)
                payload = self.google_books.search_by_title_author(
                    clean_title,
                    author=clean_author or None,
                    start_index=start_index,
                    max_results=min(20, remaining),
                )
                candidates.extend(self._normalize_google_search(payload))
            except RequestException as error:
                provider_errors.append(error)
                self.logger.warning("Google Books search failed: %s", error)

        if provider_errors and not candidates:
            raise BookProviderUnavailable("book metadata providers are unavailable")

        return self._deduplicate(candidates)[:max_results]

    def metadata_by_isbn(self, isbn: str) -> dict[str, Any] | None:
        """Return complete normalized metadata for a valid ISBN."""
        clean_isbn = normalize_isbn(isbn)
        if not is_valid_isbn(clean_isbn):
            return None

        lookup_isbns = [clean_isbn]
        converted_isbn10 = isbn13_to_isbn10(clean_isbn)
        if converted_isbn10 and converted_isbn10 not in lookup_isbns:
            lookup_isbns.append(converted_isbn10)

        provider_available = False
        provider_errors = []

        for lookup_isbn in lookup_isbns:
            try:
                payload = self.open_library.get_by_isbn(lookup_isbn)
                provider_available = True
                metadata = self._normalize_openlibrary_metadata(payload, lookup_isbn)
                if metadata.get("title"):
                    return metadata
            except RequestException as error:
                if _is_provider_not_found(error):
                    provider_available = True
                    self.logger.info("Open Library has no ISBN record for %s", lookup_isbn)
                else:
                    provider_errors.append(error)
                    self.logger.warning("Open Library ISBN lookup failed for %s: %s", lookup_isbn, error)

        for lookup_isbn in lookup_isbns:
            try:
                payload = self.google_books.search_by_isbn(lookup_isbn)
                provider_available = True
                items = payload.get("items") or []
                if items:
                    return self._normalize_google_metadata(items[0])
            except RequestException as error:
                provider_errors.append(error)
                self.logger.warning("Google Books ISBN lookup failed for %s: %s", lookup_isbn, error)
                if _is_provider_rate_limited(error):
                    break

        if provider_errors:
            raise BookProviderUnavailable("book metadata providers are unavailable")

        return None

    def resolve_book(self, selection: dict[str, Any]) -> dict[str, Any] | None:
        """Resolve a selected search candidate into complete metadata."""
        isbn = (
            selection.get("isbn13")
            or selection.get("isbn10")
            or selection.get("isbn")
        )
        if isbn:
            metadata = self.metadata_by_isbn(str(isbn))
            if metadata:
                return metadata

        source = _clean_text(selection.get("source"))
        source_id = _clean_text(selection.get("sourceId") or selection.get("id"))
        if not source or not source_id:
            return None

        try:
            if source == "google-books":
                return self._normalize_google_metadata(self.google_books.get_book_details(source_id))
            if source == "openlibrary":
                return self._normalize_openlibrary_metadata(self.open_library.get_edition(source_id), None)
        except RequestException as error:
            self.logger.warning("Book resolve failed for %s:%s: %s", source, source_id, error)

        return None

    def add_book_from_metadata(self, metadata: dict[str, Any]) -> dict[str, Any]:
        """Persist an already resolved book metadata payload."""
        entry = self._build_entry(metadata)
        self.storage.add_unique(entry)
        return entry

    def add_book_by_name(self, title: str) -> dict[str, Any] | None:
        """Fetch and store the first title result for legacy CLI/API callers."""
        results = self.search_books(title, limit=1)
        if not results:
            self.logger.warning("No results for book '%s'", title)
            return None

        metadata = self.resolve_book(results[0]) or results[0]
        entry = self._build_entry(metadata)
        self.storage.add_unique(entry)
        return entry

    def add_book_by_isbn(self, isbn: str) -> dict[str, Any] | None:
        """Fetch and store a book using its ISBN."""
        metadata = self.metadata_by_isbn(isbn)
        if not metadata:
            self.logger.warning("No results for ISBN '%s'", isbn)
            return None

        entry = self._build_entry(metadata)
        self.storage.add_unique(entry)
        return entry

    def ensure_local_cover(
        self,
        entry: dict[str, Any],
        previous_cover: str | None = None,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """Ensure a remote book cover URL is stored as a local WebP file."""
        cover = entry.get("cover") or entry.get("coverUrl")
        if not _is_remote_url(cover):
            return entry

        cover_id = (
            normalize_isbn(entry.get("isbn13"))
            or normalize_isbn(entry.get("isbn10"))
            or normalize_isbn(entry.get("isbn"))
            or _clean_text(entry.get("id"))
            or _normalize_key(entry.get("title") or "").replace(" ", "_")
            or "unknown"
        )
        safe_id = re.sub(r"[^A-Za-z0-9_-]+", "_", cover_id)
        local_path = COVERS_DIR / f"book_{safe_id}.webp"
        overwrite = overwrite or bool(previous_cover and previous_cover != cover)
        cover_local = download_image_as_webp(str(cover), local_path, overwrite=overwrite)
        if cover_local:
            entry["cover_local"] = cover_local
        else:
            entry["cover_local"] = None
        return entry

    def _build_entry(self, metadata: dict[str, Any]) -> dict[str, Any]:
        """Handle build entry.

        :param metadata: metadata value.
        :return: Requested data.
        """
        isbn13 = normalize_isbn(metadata.get("isbn13"))
        isbn10 = normalize_isbn(metadata.get("isbn10"))
        isbn = isbn13 or isbn10 or normalize_isbn(metadata.get("isbn")) or _clean_text(metadata.get("id"))
        cover = metadata.get("coverUrl") or metadata.get("cover")
        fallback_id = "book_" + "_".join(filter(None, [
            _normalize_key(metadata.get("title") or "").replace(" ", "_"),
            _normalize_key(" ".join(metadata.get("authors") or [])).replace(" ", "_"),
            str(metadata.get("publicationYear") or ""),
        ]))

        book_text = self._text_field(
            metadata.get("back_cover_text")
            or metadata.get("synopsis")
            or metadata.get("description")
        )

        entry = {
            "id": metadata.get("id") or isbn or metadata.get("sourceId") or fallback_id,
            "isbn": metadata.get("location"),
            "isbn10": isbn10 or None,
            "isbn13": isbn13 or None,
            "title": metadata.get("title"),
            "subtitle": metadata.get("subtitle"),
            "authors": metadata.get("authors") or [],
            "publishedDate": metadata.get("publishedDate"),
            "publicationYear": metadata.get("publicationYear"),
            "publisher": metadata.get("publisher"),
            "location": isbn,
            "categories": metadata.get("categories") or [],
            "genres": metadata.get("genres") or metadata.get("categories") or [],
            "additional_info": metadata.get("additional_info") or "",
            "synopsis": book_text,
            "back_cover_text": book_text,
            "cover": cover,
            "cover_local": None,
            "source": metadata.get("source"),
            "sourceId": metadata.get("sourceId"),
        }
        return self.ensure_local_cover(entry)

    def _normalize_openlibrary_search(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        """Return normalized data.

        :param payload: payload value.
        :return: Matching values.
        """
        results = []
        for doc in payload.get("docs", []):
            isbn10, isbn13 = split_isbns(doc.get("isbn"))
            source_id = _first_value(doc.get("edition_key"))
            cover_url = None
            if doc.get("cover_i"):
                cover_url = f"https://covers.openlibrary.org/b/id/{doc['cover_i']}-M.jpg"
            elif isbn13 or isbn10:
                cover_url = f"https://covers.openlibrary.org/b/isbn/{isbn13 or isbn10}-M.jpg"

            publishers = _clean_list(doc.get("publisher"))
            years = [year for year in doc.get("publish_year", []) if isinstance(year, int)]
            year = min(years) if years else _publication_year(doc.get("first_publish_year"))

            results.append({
                "id": f"openlibrary:{source_id or doc.get('key')}",
                "title": _clean_text(doc.get("title")),
                "subtitle": _clean_text(doc.get("subtitle")) or None,
                "authors": _clean_list(doc.get("author_name")),
                "publicationYear": year,
                "publisher": publishers[0] if publishers else None,
                "isbn10": isbn10,
                "isbn13": isbn13,
                "coverUrl": cover_url,
                "source": "openlibrary",
                "sourceId": source_id or _clean_text(doc.get("key")).removeprefix("/books/"),
            })
        return results

    def _normalize_google_search(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        """Return normalized data.

        :param payload: payload value.
        :return: Matching values.
        """
        return [self._normalize_google_result(item) for item in payload.get("items", [])]

    def _normalize_google_result(self, item: dict[str, Any]) -> dict[str, Any]:
        """Return normalized data.

        :param item: item value.
        :return: Requested data.
        """
        info = item.get("volumeInfo", {})
        isbn10, isbn13 = _google_isbns(info)
        links = info.get("imageLinks") or {}
        published_date = _clean_text(info.get("publishedDate")) or None
        return {
            "id": f"google-books:{item.get('id')}",
            "title": _clean_text(info.get("title")),
            "subtitle": _clean_text(info.get("subtitle")) or None,
            "authors": _clean_list(info.get("authors")),
            "publicationYear": _publication_year(published_date),
            "publisher": _clean_text(info.get("publisher")) or None,
            "isbn10": isbn10,
            "isbn13": isbn13,
            "coverUrl": links.get("thumbnail") or links.get("smallThumbnail"),
            "source": "google-books",
            "sourceId": item.get("id"),
        }

    def _normalize_google_metadata(self, item: dict[str, Any]) -> dict[str, Any]:
        """Return normalized data.

        :param item: item value.
        :return: Requested data.
        """
        result = self._normalize_google_result(item)
        info = item.get("volumeInfo", {})
        result.update({
            "publishedDate": _clean_text(info.get("publishedDate")) or None,
            "categories": _clean_list(info.get("categories")),
            "genres": _clean_list(info.get("categories")),
            "synopsis": info.get("description") or "",
            "back_cover_text": info.get("description") or "",
        })
        return result

    def _normalize_openlibrary_metadata(self, payload: dict[str, Any], lookup_isbn: str | None) -> dict[str, Any]:
        """Return normalized data.

        :param payload: payload value.
        :param lookup_isbn: lookup isbn value.
        :return: Requested data.
        """
        identifiers = payload.get("identifiers") or {}
        raw_isbns = []
        for key in ("isbn_10", "isbn_13", "isbn"):
            raw_isbns.extend(identifiers.get(key) or [])
        if lookup_isbn:
            raw_isbns.append(lookup_isbn)
        isbn10, isbn13 = split_isbns(raw_isbns)

        covers = payload.get("covers") or []
        cover_url = None
        if covers:
            cover_url = f"https://covers.openlibrary.org/b/id/{covers[0]}-L.jpg"
        elif isbn13 or isbn10:
            cover_url = f"https://covers.openlibrary.org/b/isbn/{isbn13 or isbn10}-L.jpg"

        publishers = _clean_list(payload.get("publishers"))
        source_id = _clean_text(payload.get("key")).removeprefix("/books/")
        return {
            "id": f"openlibrary:{source_id or lookup_isbn}",
            "title": _clean_text(payload.get("title")),
            "subtitle": _clean_text(payload.get("subtitle")) or None,
            "authors": _clean_list(payload.get("by_statement")),
            "publishedDate": _clean_text(payload.get("publish_date")) or None,
            "publicationYear": _publication_year(payload.get("publish_date")),
            "publisher": publishers[0] if publishers else None,
            "isbn10": isbn10,
            "isbn13": isbn13,
            "categories": _clean_list(payload.get("subjects")),
            "genres": _clean_list(payload.get("subjects")),
            "synopsis": self._text_field(payload.get("description")),
            "back_cover_text": self._text_field(payload.get("description")),
            "coverUrl": cover_url,
            "source": "openlibrary",
            "sourceId": source_id,
        }

    def _deduplicate(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Handle deduplicate.

        :param candidates: candidates value.
        :return: Matching values.
        """
        seen = set()
        unique = []

        for item in candidates:
            if item.get("isbn13"):
                key = ("isbn13", item["isbn13"])
            elif item.get("isbn10"):
                key = ("isbn10", item["isbn10"])
            else:
                key = (
                    "meta",
                    _normalize_key(item.get("title") or ""),
                    _normalize_key(" ".join(item.get("authors") or [])),
                    item.get("publicationYear"),
                )

            if key in seen:
                continue
            seen.add(key)
            unique.append(item)

        return unique

    def _text_field(self, value: Any) -> str:
        """Return provider text as a clean string.

        :param value: input value.
        :return: Text data.
        """
        if isinstance(value, dict):
            return _clean_text(value.get("value"))
        return _clean_text(value)
