"""Music catalogue inconsistency reporting helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from src.image_downloader import is_valid_image_file
from src.music_track_positions import TrackIssue, analyze_positions, clean_position

REMOTE_SCHEMES = {"http", "https"}


@dataclass(frozen=True)
class AlbumAnalysis:
    """Analysis result for one album tracklist."""

    item: dict[str, Any]
    positions: list[str]
    normalized_positions: list[str]
    issues: list[TrackIssue]
    changed: bool

    @property
    def is_anomalous(self) -> bool:
        """Return whether this album has track numbering issues.

        :return: True when issues exist.
        """
        return bool(self.issues)


def analyze_album(item: dict[str, Any]) -> AlbumAnalysis:
    """Analyze one album tracklist.

    :param item: Stored album item.
    :return: Track position analysis for the album.
    """
    tracklist = item.get("tracklist") or []
    positions = [
        clean_position(track.get("pos"))
        for track in tracklist
        if isinstance(track, dict)
    ]

    position_analysis = analyze_positions(positions)
    return AlbumAnalysis(
        item=item,
        positions=positions,
        normalized_positions=position_analysis.normalized_positions,
        issues=position_analysis.issues,
        changed=position_analysis.changed,
    )


def album_title(item: dict[str, Any]) -> str:
    """Return a readable album title.

    :param item: Stored album item.
    :return: Readable album title.
    """
    artists = item.get("artists") or []
    artist = ", ".join(artists) if isinstance(artists, list) else str(artists)
    title = item.get("title") or "Untitled"
    year = item.get("year")
    suffix = f" ({year})" if year else ""
    return f"{artist} - {title}{suffix}" if artist else f"{title}{suffix}"


def write_report(path: Path, analyses: list[AlbumAnalysis]) -> None:
    """Write the music anomaly report to disk.

    :param path: Report file path.
    :param analyses: Album analyses to include.
    """
    anomalous = [analysis for analysis in analyses if analysis.is_anomalous]
    path.parent.mkdir(parents=True, exist_ok=True)

    lines = [
        "# Music Track Numbering Anomalies",
        "",
        f"- Total albums scanned: `{len(analyses)}`",
        f"- Anomalous albums: `{len(anomalous)}`",
        "",
    ]

    for count, analysis in enumerate(anomalous, start=1):
        item = analysis.item
        issues = "; ".join(
            f"{issue.index}: expected {issue.expected}, got {issue.actual}"
            for issue in analysis.issues[:8]
        )
        lines.extend([
            f"## {count}. {album_title(item)}",
            "",
            f"- ID: `{item.get('id')}`",
            f"- Tracks: `{len(analysis.positions)}`",
            f"- Positions: `{', '.join(analysis.positions)}`",
            f"- First mismatches: `{issues}`",
            "",
        ])

    path.write_text("\n".join(lines), encoding="utf-8")


def apply_normalizations(db_path: Path, data: list[dict[str, Any]], analyses: list[AlbumAnalysis]) -> int:
    """Apply valid track position normalizations.

    :param db_path: Music database path.
    :param data: Music database data.
    :param analyses: Album analyses to apply.
    :return: Number of albums changed.
    """
    changed_albums = 0
    analysis_by_id = {
        id(analysis.item): analysis
        for analysis in analyses
        if analysis.changed and not analysis.is_anomalous
    }

    for item in data:
        analysis = analysis_by_id.get(id(item))
        if not analysis:
            continue

        tracklist = item.get("tracklist") or []
        for track, position in zip(tracklist, analysis.normalized_positions):
            if isinstance(track, dict):
                track["pos"] = position
        changed_albums += 1

    if changed_albums:
        if db_path.suffix.lower() in {".sqlite", ".sqlite3"}:
            from src.storage import SQLiteStorage

            SQLiteStorage(db_path, "album").save(data)
        else:
            db_path.write_text(
                json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )

    return changed_albums


def resolve_local_path(path_value: Any, base_dir: Path) -> Path | None:
    """Return a local path from a stored path value.

    :param path_value: Stored path value.
    :param base_dir: Repository base directory.
    :return: Resolved local path, or None when empty.
    """
    if not isinstance(path_value, str) or not path_value.strip():
        return None
    if is_embedded_image(path_value) or is_remote_url(path_value):
        return None

    path = Path(path_value)
    if path.is_absolute():
        return path
    return base_dir / path


def is_remote_url(value: Any) -> bool:
    """Return whether a value is an HTTP(S) URL.

    :param value: Value to inspect.
    :return: True when the value is a remote URL.
    """
    if not isinstance(value, str):
        return False
    return urlparse(value).scheme.lower() in REMOTE_SCHEMES


def is_embedded_image(value: Any) -> bool:
    """Return whether a value contains an image as a data URI.

    Data URIs are valid image sources, but they are not filesystem paths and
    must never be passed to ``Path.exists()``.
    """
    return isinstance(value, str) and value.strip().lower().startswith("data:image/")


def local_webp_status(path_value: Any, base_dir: Path) -> tuple[str, str | None]:
    """Return local WebP status for a stored cover path.

    :param path_value: Stored cover path value.
    :param base_dir: Repository base directory.
    :return: Status key and resolved path.
    """
    path = resolve_local_path(path_value, base_dir)
    if not path:
        return "missing", None
    if not path.exists():
        return "file_missing", str(path)
    if path.suffix.lower() != ".webp":
        return "not_webp", str(path)
    if not is_valid_image_file(path):
        return "invalid_image", str(path)
    return "ok", str(path)


def issue(
    item: dict[str, Any],
    db_path: Path,
    severity: str,
    message: str,
    file_path: str | None = None,
) -> dict[str, Any]:
    """Build one API issue payload.

    :param item: Stored album item.
    :param db_path: Music database path.
    :param severity: Issue severity.
    :param message: Issue message.
    :param file_path: Optional related file path.
    :return: API issue payload.
    """
    return {
        "severity": severity,
        "kind": "music",
        "itemId": str(item.get("id") or ""),
        "itemLabel": album_title(item),
        "message": message,
        "file": file_path or str(db_path.resolve()),
    }


def inspect_music_items(
    db_path: Path,
    items: list[dict[str, Any]],
    base_dir: Path,
) -> list[dict[str, Any]]:
    """Return non-track inconsistencies for music items.

    :param db_path: Music database path.
    :param items: Stored music items.
    :param base_dir: Repository base directory.
    :return: API issue payloads.
    """
    issues: list[dict[str, Any]] = []
    seen_ids: dict[str, int] = {}
    seen_titles: dict[tuple[str, str], int] = {}

    for index, item in enumerate(items):
        item_id = str(item.get("id") or "").strip()
        title = clean_position(item.get("title"))
        artists = item.get("artists") or []
        artist_text = ", ".join(artists) if isinstance(artists, list) else str(artists or "")
        duplicate_key = (title.casefold(), artist_text.casefold())

        if not item_id:
            issues.append(issue(item, db_path, "error", "Missing item id"))
        elif item_id in seen_ids:
            issues.append(issue(
                item,
                db_path,
                "error",
                f"Duplicate item id also found at index {seen_ids[item_id]}",
            ))
        else:
            seen_ids[item_id] = index

        if title and artist_text and duplicate_key in seen_titles:
            issues.append(issue(
                item,
                db_path,
                "warning",
                f"Possible duplicate title/artist also found at index {seen_titles[duplicate_key]}",
            ))
        elif title and artist_text:
            seen_titles[duplicate_key] = index

        if not title:
            issues.append(issue(item, db_path, "error", "Missing title"))
        if not artists:
            issues.append(issue(item, db_path, "warning", "Missing artists"))
        if not item.get("year"):
            issues.append(issue(item, db_path, "info", "Missing year"))
        if not item.get("tracklist"):
            issues.append(issue(item, db_path, "warning", "Missing tracklist"))

        cover = item.get("cover")
        local_status, local_path = local_webp_status(item.get("cover_local"), base_dir)
        if is_remote_url(cover) and local_status == "missing":
            issues.append(issue(item, db_path, "warning", "Remote cover has no local WebP"))
        elif local_status == "file_missing":
            issues.append(issue(item, db_path, "error", "Local cover file is missing", local_path))
        elif local_status == "not_webp":
            issues.append(issue(item, db_path, "warning", "Local cover is not WebP", local_path))
        elif local_status == "invalid_image":
            issues.append(issue(item, db_path, "error", "Local cover is not a valid image", local_path))

        if cover and not is_embedded_image(cover) and not is_remote_url(cover):
            cover_path = resolve_local_path(cover, base_dir)
            if cover_path and cover_path.exists() and cover_path.suffix.lower() != ".webp":
                issues.append(issue(item, db_path, "warning", "Cover field points to a non-WebP local file", str(cover_path)))

    return issues


def analyze_music_database(db_path: Path) -> tuple[list[dict[str, Any]], list[AlbumAnalysis]]:
    """Analyze every album in the music database.

    :param db_path: Music database path.
    :return: Database data and album analyses.
    """
    if db_path.suffix.lower() in {".sqlite", ".sqlite3"}:
        from src.storage import SQLiteStorage

        data = SQLiteStorage(db_path, "album").get_all()
    else:
        data = json.loads(db_path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"{db_path} must contain a JSON list")

    items = [item for item in data if isinstance(item, dict)]
    return items, [analyze_album(item) for item in items]


def build_api_report(
    db_path: Path,
    report_path: Path,
    items: list[dict[str, Any]],
    analyses: list[AlbumAnalysis],
    changed_albums: int = 0,
    base_dir: Path | None = None,
) -> dict[str, Any]:
    """Build the API payload for the generated music report.

    :param db_path: Music database path.
    :param report_path: Generated report path.
    :param items: Stored music items.
    :param analyses: Album analyses to summarize.
    :param changed_albums: Number of normalized albums.
    :param base_dir: Repository base directory.
    :return: API response payload.
    """
    resolved_base_dir = base_dir or db_path.resolve().parents[1]
    anomalous = [analysis for analysis in analyses if analysis.is_anomalous]
    normalizable = [
        analysis
        for analysis in analyses
        if analysis.changed and not analysis.is_anomalous
    ]
    track_issues = []

    for analysis in anomalous:
        item = analysis.item
        first_issue = analysis.issues[0] if analysis.issues else None
        if first_issue:
            message = f"Track numbering anomaly: expected {first_issue.expected}, got {first_issue.actual}"
        else:
            message = "Track numbering anomaly"
        track_issues.append({
            "severity": "warning",
            "kind": "music",
            "itemId": str(item.get("id") or ""),
            "itemLabel": album_title(item),
            "message": message,
            "file": str(report_path.resolve()),
        })

    data_issues = inspect_music_items(db_path, items, resolved_base_dir)
    issues = track_issues + data_issues

    return {
        "scanned": len(analyses),
        "issueCount": len(issues),
        "trackIssueCount": len(track_issues),
        "dataIssueCount": len(data_issues),
        "normalizableCount": len(normalizable),
        "changedCount": changed_albums,
        "issues": issues,
        "files": [
            {"label": "Music anomaly report", "path": str(report_path.resolve())},
            {"label": "Music database", "path": str(db_path.resolve())},
        ],
    }


def generate_music_inconsistency_report(
    db_path: Path,
    report_path: Path,
    apply: bool = False,
    base_dir: Path | None = None,
) -> dict[str, Any]:
    """Generate the music inconsistency report.

    :param db_path: Music database path.
    :param report_path: Markdown report path.
    :param apply: Whether to apply valid normalizations.
    :param base_dir: Repository base directory.
    :return: API response payload.
    """
    data, analyses = analyze_music_database(db_path)
    write_report(report_path, analyses)
    changed_albums = apply_normalizations(db_path, data, analyses) if apply else 0
    return build_api_report(db_path, report_path, data, analyses, changed_albums, base_dir)
