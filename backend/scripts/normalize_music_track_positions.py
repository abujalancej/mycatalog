"""Report and normalize numeric music track positions."""

from __future__ import annotations

import argparse
from pathlib import Path

from _bootstrap import BASE_DIR
from src.music_inconsistencies import (
    analyze_music_database,
    apply_normalizations,
    write_report,
)

DEFAULT_DB_PATH = BASE_DIR / "db" / "catalog.sqlite3"
DEFAULT_REPORT_PATH = BASE_DIR / "reports" / "music_track_numbering_anomalies.md"


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments.

    :return: Parsed command-line arguments.
    """
    parser = argparse.ArgumentParser(
        description="Normalize music track positions and report anomalies.",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help="Music SQLite database path. Defaults to ./db/catalog.sqlite3.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=DEFAULT_REPORT_PATH,
        help="Markdown anomaly report path.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write normalized positions back to the database.",
    )
    return parser.parse_args()



def main() -> None:
    """Run the script.
    """
    args = parse_args()
    data, analyses = analyze_music_database(args.db)
    write_report(args.report, analyses)

    changed_albums = apply_normalizations(args.db, data, analyses) if args.apply else 0
    normalizable = sum(1 for analysis in analyses if analysis.changed and not analysis.is_anomalous)

    print(f"Albums scanned: {len(analyses)}")
    print(f"Anomalous albums: {sum(1 for analysis in analyses if analysis.is_anomalous)}")
    print(f"Normalizable albums: {normalizable}")
    print(f"Database updated: {'yes' if args.apply else 'no'}")
    print(f"Albums changed: {changed_albums}")
    print(f"Report: {args.report}")


if __name__ == "__main__":
    main()
