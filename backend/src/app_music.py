"""Application logic for managing a music collection via Discogs."""

import logging
import json
from pathlib import Path
from src.discogs_client import DiscogsClient
from src.storage import Storage
from src.image_downloader import download_image_as_webp
from src.music_metadata import DEFAULT_MUSIC_PACKAGING, DEFAULT_MUSIC_RELEASE_TYPE, normalize_music_metadata
from src.music_track_positions import normalize_tracklist

BASE_DIR = Path(__file__).resolve().parents[1]
COVERS_DIR = BASE_DIR / "covers" / "music"
REJECTED_FILE = BASE_DIR / "var" / "rejected_music.json"


class MusicApp:
    """
    Application logic for managing a music collection via Discogs.
    """

    def __init__(self, discogs: DiscogsClient, storage: Storage) -> None:
        """Initialize the instance.

        :param discogs: discogs value.
        :param storage: storage value.
        """
        self.discogs = discogs
        self.storage = storage
        self.logger = logging.getLogger(self.__class__.__name__)

    def _log_rejected(
        self,
        album: str,
        artist: str | None = None,
        reason: str = "not found",
    ) -> None:
        """Append a rejected album entry to ``rejected_music.json``.

        :param album: Album title that failed to import.
        :param artist: Optional artist name associated with the album.
        :param reason: Short explanation of why the album was rejected.
        :return: None.
        """
        entry = {"album": album, "artist": artist, "reason": reason}
        try:
            REJECTED_FILE.parent.mkdir(parents=True, exist_ok=True)
            if REJECTED_FILE.exists():
                data = json.loads(REJECTED_FILE.read_text(encoding="utf-8"))
            else:
                data = []
            data.append(entry)
            REJECTED_FILE.write_text(json.dumps(
                data, indent=2, ensure_ascii=False))
            self.logger.warning(
                "Rejected album logged: %s (%s)", album, reason)
        except (OSError, json.JSONDecodeError) as e:
            self.logger.error("Failed to log rejected album %s: %s", album, e)

    def add_album_by_name(
        self,
        album: str,
        artist: str | None = None,
        release_format: str = "CD",
        location: str = "",
        release_type: str = DEFAULT_MUSIC_RELEASE_TYPE,
        packaging: str = DEFAULT_MUSIC_PACKAGING,
    ) -> dict | None:
        """
        Fetch and store an album using Discogs search.

        :param album: Album title to look up.
        :param artist: Optional artist name to narrow the search.
        :param release_format: Preferred release format to filter Discogs results.
        :param release_type: Music release type stored in the catalogue.
        :param location: Physical location/tag for the album within the collection.
        :param packaging: Physical packaging stored in the catalogue.
        :return: Entry persisted in storage, or ``None`` when nothing was added.
        """
        # Check if already stored by title or id
        existing_items = [x for x in self.storage.get_all()
                          if x.get("title", "").lower() == album.lower()]
        if existing_items:
            self.logger.info("Album already exists in storage: %s", album)
            return existing_items[0]

        results = self.discogs.search_release(
            album, artist=artist, release_format=release_format)
        if not results.get("results"):
            self.logger.warning("No results for album '%s'", album)
            self._log_rejected(album, artist)
            return None

        release = results["results"][0]
        details = self.discogs.get_release_details(release["id"])
        if not details:
            self._log_rejected(album, artist, "details fetch failed")
            return None

        entry = self._build_entry(
            details,
            release_format,
            location,
            release_type=release_type,
            packaging=packaging,
        )
        self.storage.add_unique(entry)
        return entry

    def add_album_by_discogs_id(
        self,
        release_id: int,
        release_format: str = "CD",
        location: str = "",
        fallback_cover: str | None = None,
        release_type: str = DEFAULT_MUSIC_RELEASE_TYPE,
        packaging: str = DEFAULT_MUSIC_PACKAGING,
    ) -> dict | None:
        """
        Fetch and store an album directly by Discogs release ID.

        :param release_id: Discogs release identifier.
        :param release_format: Preferred release format hint for the catalogue.
        :param release_type: Music release type stored in the catalogue.
        :param location: Physical location/tag for the album within the collection.
        :param fallback_cover: Cover URL from search results when release details omit images.
        :param packaging: Physical packaging stored in the catalogue.
        :return: Entry persisted in storage, or ``None`` when nothing was added.
        """
        details = self.discogs.get_release_details(release_id)
        if not details:
            self.logger.warning("No release details for Discogs ID %s", release_id)
            self._log_rejected(str(release_id), reason="details fetch failed")
            return None

        entry = self._build_entry(
            details,
            release_format,
            location,
            release_type=release_type,
            packaging=packaging,
            fallback_cover=fallback_cover,
        )
        self.storage.add_unique(entry)
        return entry

    def _build_entry(
        self,
        details: dict,
        release_format: str,
        location: str,
        fallback_cover: str | None = None,
        release_type: str = DEFAULT_MUSIC_RELEASE_TYPE,
        packaging: str = DEFAULT_MUSIC_PACKAGING,
    ) -> dict:
        """Build a storage-ready dictionary from Discogs release details."""
        cover = fallback_cover
        cover_local = None
        if details.get("images"):
            url = (
                details["images"][0].get("uri")
                or details["images"][0].get("resource_url")
                or details["images"][0].get("uri150")
            )
            cover = url
        else:
            url = fallback_cover

        if url:
            local_path = COVERS_DIR / f"album_{details['id']}.webp"
            if not local_path.exists():
                cover_local = download_image_as_webp(url, local_path)
            else:
                cover_local = str(local_path)

        tracklist = [
            {
                "pos": t.get("position"),
                "title": t.get("title"),
                "artists": [a["name"].rsplit(" (", 1)[0] for a in t.get("artists", [])],
            }
            for t in details.get("tracklist", [])
        ]

        return normalize_music_metadata({
            "id": details["id"],
            "title": details.get("title"),
            "artists": [a["name"].rsplit(" (", 1)[0] for a in details.get("artists", [])],
            "year": details.get("year"),
            "genres": details.get("genres", []),
            "styles": details.get("styles", []),
            "cover": cover,
            "cover_local": cover_local,
            "tracklist": normalize_tracklist(tracklist),
            "release_format": release_format or "",
            "type": release_type or "",
            "packaging": packaging or "",
            "format_details": "",
            "location": location or "",
        })

    def ensure_local_cover(
        self,
        entry: dict,
        cover_url: str | None = None,
        overwrite: bool = False,
    ) -> dict:
        """Download a missing local cover for an existing entry when possible."""
        entry.update(normalize_music_metadata(entry))
        url = cover_url or entry.get("cover")
        if not url:
            return entry

        entry["cover"] = url
        local_path = COVERS_DIR / f"album_{entry['id']}.webp"
        if local_path.exists() and not overwrite:
            entry["cover_local"] = str(local_path)
        else:
            entry["cover_local"] = download_image_as_webp(url, local_path, overwrite=overwrite)
        return entry
