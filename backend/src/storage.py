"""Local storage backends for media entries."""

import json
import sqlite3
from pathlib import Path
import logging
from typing import Any, Protocol


class Storage(Protocol):
    """Small interface shared by the catalogue storage implementations."""

    path: Path

    def load(self) -> list[dict[str, Any]]:
        """Load all stored entries."""

    def save(self, data: list[dict[str, Any]]) -> None:
        """Replace all entries in this collection."""

    def add_unique(self, entry: dict[str, Any]) -> bool:
        """Add an entry when its identifier is not already present."""

    def get_all(self) -> list[dict[str, Any]]:
        """Return all stored entries."""


class JSONStorage:
    """
    Simple JSON file-based storage for media entries.
    Each entry is a dictionary, and the entire dataset is a list of such dictionaries.
    """
    def __init__(self, path: str | Path, unique_key: str = "id") -> None:
        """Initialize the instance.

        :param path: path value.
        :param unique_key: unique key value.
        """
        self.path = Path(path)
        self.logger = logging.getLogger(self.__class__.__name__)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.unique_key = unique_key

    def load(self) -> list[dict[str, Any]]:
        """
        Load the entire dataset from disk.
        :return: List of stored entries.
        """
        if not self.path.exists() or self.path.stat().st_size == 0:
            self.logger.info("No DB or empty DB at %s, starting fresh.", self.path)
            return []
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            self.logger.warning("Corrupt DB file at %s, starting fresh.", self.path)
            return []

    def save(self, data: list[dict[str, Any]]) -> None:
        """
        Persist the entire dataset to disk, overwriting any existing content.
        :param data: List of dictionaries to persist.
        """
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        self.logger.info("Saved %d items to %s", len(data), self.path)

    def add_unique(self, entry: dict[str, Any]) -> bool:
        """Insert an item only when it is not already stored.

        :param entry: Dictionary representing the item to persist.
        :return: ``True`` when the item was added, ``False`` if it already existed.
        """
        db = self.load()
        key = entry.get(self.unique_key) or entry.get("id")
        existing_ids = {item.get(self.unique_key) or item.get("id") for item in db}

        if key in existing_ids:
            self.logger.info("Item with %s=%s already exists. Skipping.", self.unique_key, key)
            return False

        db.append(entry)
        self.save(db)
        return True

    def get_all(self) -> list[dict[str, Any]]:
        """Return every item currently stored.

        :return: List of stored entries.
        """
        return self.load()


class SQLiteStorage:
    """SQLite-backed storage that keeps each media item as a JSON payload.

    Keeping the payload as JSON preserves the existing flexible catalogue
    shape, while SQLite provides transactions, atomic updates, and indexes for
    the shared local database.
    """

    def __init__(self, path: str | Path, collection: str, unique_key: str = "id") -> None:
        """Initialize a collection inside a SQLite database."""
        self.path = Path(path)
        self.collection = collection
        self.unique_key = unique_key
        self.logger = logging.getLogger(self.__class__.__name__)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA synchronous = NORMAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS media_items (
                    collection TEXT NOT NULL,
                    item_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (collection, item_id)
                );
                CREATE INDEX IF NOT EXISTS idx_media_items_collection_position
                    ON media_items (collection, position);
                """
            )

    def _item_id(self, entry: dict[str, Any]) -> str:
        key = entry.get(self.unique_key) or entry.get("id")
        return str(key)

    def load(self) -> list[dict[str, Any]]:
        """Load the complete collection in its original insertion order."""
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT payload
                FROM media_items
                WHERE collection = ?
                ORDER BY position, rowid
                """,
                (self.collection,),
            ).fetchall()

        try:
            return [json.loads(row["payload"]) for row in rows]
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Invalid JSON payload in SQLite database {self.path}") from exc

    def save(self, data: list[dict[str, Any]]) -> None:
        """Replace this collection atomically."""
        if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
            raise ValueError("SQLiteStorage.save expects a list of dictionaries")

        rows = [
            (
                self.collection,
                self._item_id(item),
                position,
                json.dumps(item, ensure_ascii=False, separators=(",", ":")),
            )
            for position, item in enumerate(data)
        ]

        with self._connect() as connection:
            connection.execute(
                "DELETE FROM media_items WHERE collection = ?",
                (self.collection,),
            )
            connection.executemany(
                """
                INSERT INTO media_items (collection, item_id, position, payload)
                VALUES (?, ?, ?, ?)
                """,
                rows,
            )

        self.logger.info("Saved %d items to %s (%s)", len(data), self.path, self.collection)

    def add_unique(self, entry: dict[str, Any]) -> bool:
        """Insert an entry only when its identifier is not already stored."""
        item_id = self._item_id(entry)
        payload = json.dumps(entry, ensure_ascii=False, separators=(",", ":"))

        with self._connect() as connection:
            next_position = connection.execute(
                """
                SELECT COALESCE(MAX(position), -1) + 1
                FROM media_items
                WHERE collection = ?
                """,
                (self.collection,),
            ).fetchone()[0]
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO media_items (collection, item_id, position, payload)
                VALUES (?, ?, ?, ?)
                """,
                (self.collection, item_id, next_position, payload),
            )

        added = cursor.rowcount == 1
        if added:
            self.logger.info("Added item %s to %s (%s)", item_id, self.path, self.collection)
        else:
            self.logger.info("Item %s already exists in %s", item_id, self.collection)
        return added

    def get_all(self) -> list[dict[str, Any]]:
        """Return every item currently stored."""
        return self.load()
