"""ISBN normalization and validation helpers."""

from __future__ import annotations


def normalize_isbn(value: str | None) -> str:
    """Return an ISBN containing only digits and a possible ISBN-10 X suffix."""
    if not value:
        return ""

    cleaned = []
    for char in str(value).upper():
        if char.isdigit() or char == "X":
            cleaned.append(char)
    return "".join(cleaned)


def is_valid_isbn10(value: str | None) -> bool:
    """Return whether the value is a valid ISBN-10."""
    isbn = normalize_isbn(value)
    if len(isbn) != 10:
        return False

    total = 0
    for index, char in enumerate(isbn):
        if char == "X":
            if index != 9:
                return False
            digit = 10
        elif char.isdigit():
            digit = int(char)
        else:
            return False
        total += digit * (10 - index)

    return total % 11 == 0


def is_valid_isbn13(value: str | None) -> bool:
    """Return whether the value is a valid ISBN-13."""
    isbn = normalize_isbn(value)
    if len(isbn) != 13 or not isbn.isdigit():
        return False

    total = 0
    for index, char in enumerate(isbn):
        total += int(char) * (1 if index % 2 == 0 else 3)

    return total % 10 == 0


def is_valid_isbn(value: str | None) -> bool:
    """Return whether the value is a valid ISBN-10 or ISBN-13."""
    return is_valid_isbn10(value) or is_valid_isbn13(value)


def split_isbns(values: list[str] | None) -> tuple[str | None, str | None]:
    """Return the first valid ISBN-10 and ISBN-13 found in a provider list."""
    isbn10 = None
    isbn13 = None

    for value in values or []:
        isbn = normalize_isbn(value)
        if not isbn10 and is_valid_isbn10(isbn):
            isbn10 = isbn
        elif not isbn13 and is_valid_isbn13(isbn):
            isbn13 = isbn

    return isbn10, isbn13


def isbn13_to_isbn10(value: str | None) -> str | None:
    """Convert a 978-prefixed ISBN-13 into ISBN-10 when possible."""
    isbn = normalize_isbn(value)
    if not is_valid_isbn13(isbn) or not isbn.startswith("978"):
        return None

    stem = isbn[3:12]
    total = sum(int(char) * (10 - index) for index, char in enumerate(stem))
    check_value = (11 - (total % 11)) % 11
    check_digit = "X" if check_value == 10 else str(check_value)
    converted = f"{stem}{check_digit}"
    return converted if is_valid_isbn10(converted) else None
