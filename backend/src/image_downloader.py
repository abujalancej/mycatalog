"""Utility to download and persist images from remote URLs."""

import logging
from pathlib import Path

from PIL import Image
import requests

MIN_COVER_WIDTH = 16
MIN_COVER_HEIGHT = 16


def is_valid_image_file(path: Path) -> bool:
    """Return whether a file is a usable cover image."""
    logger = logging.getLogger("ImageDownloader")
    try:
        if not path.exists() or path.stat().st_size <= 0:
            return False
        with Image.open(path) as image:
            image.load()
            width, height = image.size
        if width < MIN_COVER_WIDTH or height < MIN_COVER_HEIGHT:
            logger.warning("Rejected tiny image %s: %sx%s", path, width, height)
            return False
        return True
    except (OSError, ValueError) as error:
        logger.warning("Rejected invalid image %s: %s", path, error)
        return False


def download_image(url: str, path: Path) -> str | None:
    """Download an image from the given URL and persist it to disk.

    :param url: Remote image URL.
    :param path: Target path (extension will be adjusted to match the content type).
    :return: Local filesystem path as a string, or ``None`` when the download fails.
    """
    logger = logging.getLogger("ImageDownloader")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)

        headers = {
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36"
            ),
        }

        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()

        # Match the on-disk extension with the reported content type.
        content_type = resp.headers.get("Content-Type", "").lower()
        ext = ".jpg"
        if "png" in content_type:
            ext = ".png"
        elif "webp" in content_type:
            ext = ".webp"
        elif "jpeg" in content_type:
            ext = ".jpg"

        if path.suffix.lower() != ext:
            path = path.with_suffix(ext)

        with open(path, "wb") as f:
            f.write(resp.content)

        logger.info("Downloaded image: %s", path)
        return str(path)
    except requests.RequestException as e:
        logger.warning("Failed to download %s: %s", url, e)
        return None
    except OSError as e:
        logger.warning("Failed to persist %s to %s: %s", url, path, e)
        return None


def convert_image_to_webp(source_path: Path, webp_path: Path, quality: int = 95) -> str | None:
    """Convert a local image file to WebP.

    :param source_path: Existing local image file to convert.
    :param webp_path: Target WebP path.
    :param quality: WebP quality for lossy conversion.
    :return: Local WebP path as a string, or ``None`` when conversion fails.
    """
    logger = logging.getLogger("ImageDownloader")
    try:
        webp_path.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(source_path) as image:
            image.load()
            has_transparency = image.mode in ("RGBA", "LA") or "transparency" in image.info
            prepared = image.convert("RGBA" if has_transparency else "RGB")

            save_options = {
                "format": "WEBP",
                "quality": quality,
                "method": 6,
                "lossless": False,
                "exact": True,
            }
            icc_profile = image.info.get("icc_profile")
            if icc_profile:
                save_options["icc_profile"] = icc_profile

            prepared.save(webp_path, **save_options)

        logger.info("Converted image: %s", webp_path)
        return str(webp_path)
    except (OSError, ValueError) as e:
        logger.warning("Failed to convert %s to %s: %s", source_path, webp_path, e)
        return None


def download_image_as_webp(
    url: str,
    path: Path,
    quality: int = 95,
    overwrite: bool = False,
) -> str | None:
    """Download a remote image and persist the final local copy as WebP.

    :param url: Remote image URL.
    :param path: Target path. The final suffix is forced to ``.webp``.
    :param quality: WebP quality for lossy conversion.
    :param overwrite: Download and replace an existing WebP file.
    :return: Local WebP path as a string, or ``None`` when download/conversion fails.
    """
    logger = logging.getLogger("ImageDownloader")
    webp_path = path.with_suffix(".webp")
    if webp_path.exists() and not overwrite and is_valid_image_file(webp_path):
        logger.info("Using existing WebP image: %s", webp_path)
        return str(webp_path)
    if webp_path.exists() and not is_valid_image_file(webp_path):
        try:
            webp_path.unlink()
        except OSError:
            logger.warning("Failed to remove invalid WebP image: %s", webp_path)

    downloaded = download_image(url, webp_path)
    if not downloaded:
        return None

    downloaded_path = Path(downloaded)
    if downloaded_path.suffix.lower() == ".webp":
        if is_valid_image_file(downloaded_path):
            return str(downloaded_path)
        try:
            downloaded_path.unlink()
        except OSError:
            logger.warning("Failed to remove invalid downloaded WebP: %s", downloaded_path)
        return None

    converted = convert_image_to_webp(downloaded_path, webp_path, quality=quality)
    if converted:
        if not is_valid_image_file(Path(converted)):
            try:
                Path(converted).unlink()
            except OSError:
                logger.warning("Failed to remove invalid converted WebP: %s", converted)
            converted = None
    if converted:
        try:
            downloaded_path.unlink()
        except OSError:
            logging.getLogger("ImageDownloader").warning(
                "Failed to remove intermediate image: %s",
                downloaded_path,
            )
    return converted
