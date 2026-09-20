"""Helpers for validating and normalizing music track positions."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


DISC_TRACK_PATTERN = re.compile(r"^(\d+)-(\d+)$")
NUMBER_PATTERN = re.compile(r"^\d+$")


@dataclass(frozen=True)
class TrackIssue:
    index: int
    expected: str
    actual: str


@dataclass(frozen=True)
class TrackPositionAnalysis:
    positions: list[str]
    normalized_positions: list[str]
    issues: list[TrackIssue]
    changed: bool

    @property
    def is_anomalous(self) -> bool:
        """Return whether the value matches the expected condition.

        :return: True when the condition is met.
        """
        return bool(self.issues)


def clean_position(value: Any) -> str:
    """Return cleaned data.

    :param value: input value.
    :return: Text data.
    """
    return str(value or "").strip()


def normalize_plain_positions(positions: list[str]) -> tuple[list[str], list[TrackIssue]]:
    """Return normalized data.

    :param positions: positions value.
    :return: Result data.
    """
    normalized = []
    issues = []

    for index, position in enumerate(positions, start=1):
        if not NUMBER_PATTERN.match(position):
            issues.append(TrackIssue(index, str(index), position or "<empty>"))
            normalized.append(position)
            continue

        number = int(position)
        if number != index:
            issues.append(TrackIssue(index, str(index), position))
        normalized.append(f"{number:02d}")

    return normalized, issues


def normalize_disc_track_positions(positions: list[str]) -> tuple[list[str], list[TrackIssue]]:
    """Return normalized data.

    :param positions: positions value.
    :return: Result data.
    """
    normalized = []
    issues = []
    expected_by_disc: dict[int, int] = {}

    for index, position in enumerate(positions, start=1):
        match = DISC_TRACK_PATTERN.match(position)
        if not match:
            issues.append(TrackIssue(index, "XX-XX", position or "<empty>"))
            normalized.append(position)
            continue

        disc = int(match.group(1))
        track = int(match.group(2))
        if disc <= 0 or track <= 0:
            issues.append(TrackIssue(index, "XX-XX greater than 00", position))
            normalized.append(position)
            continue

        expected_track = expected_by_disc.get(disc, 1)
        if track != expected_track:
            issues.append(TrackIssue(index, f"{disc:02d}-{expected_track:02d}", position))

        expected_by_disc[disc] = max(expected_track, track) + 1
        normalized.append(f"{disc:02d}-{track:02d}")

    return normalized, issues


def analyze_positions(positions: list[str]) -> TrackPositionAnalysis:
    """Handle analyze positions.

    :param positions: positions value.
    :return: Result data.
    """
    if not positions:
        return TrackPositionAnalysis(positions, positions, [], False)

    non_empty = [position for position in positions if position]
    if non_empty and all(DISC_TRACK_PATTERN.match(position) for position in non_empty):
        normalized, issues = normalize_disc_track_positions(positions)
    else:
        normalized, issues = normalize_plain_positions(positions)

    return TrackPositionAnalysis(
        positions=positions,
        normalized_positions=normalized,
        issues=issues,
        changed=positions != normalized,
    )


def normalize_tracklist(tracklist: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return a tracklist with non-anomalous positions normalized."""
    positions = [clean_position(track.get("pos")) for track in tracklist if isinstance(track, dict)]
    analysis = analyze_positions(positions)
    if analysis.is_anomalous or not analysis.changed:
        return tracklist

    next_tracklist = []
    normalized_index = 0
    for track in tracklist:
        if not isinstance(track, dict):
            next_tracklist.append(track)
            continue
        next_track = dict(track)
        next_track["pos"] = analysis.normalized_positions[normalized_index]
        normalized_index += 1
        next_tracklist.append(next_track)

    return next_tracklist
