export const MOVIE_FORMATS = [
  "DVD",
  "Blu-ray",
  "4K UHD Blu-ray",
  "VHS",
  "Video CD"
] as const;

export const MOVIE_EDITIONS = [
  "Standard",
  "Special Edition",
  "Collector’s Edition",
  "Limited Edition",
  "Extended Edition",
  "Director’s Cut",
  "Anniversary Edition",
  "Remastered Edition"
] as const;

export const MOVIE_PACKAGING = [
  "Amaray",
  "Digipak",
  "Steelbook",
  "Box Set",
  "Slipcover",
  "Keep Case"
] as const;

export const DEFAULT_MOVIE_FORMAT = "DVD";
export const DEFAULT_MOVIE_EDITION = "Standard";
export const DEFAULT_MOVIE_PACKAGING = "Amaray";

export function withMovieDefaults<T extends {
  format?: string;
  edition?: string;
  packaging?: string;
}>(item: T): T & {
  format: string;
  edition: string;
  packaging: string;
} {
  return {
    ...item,
    format: item.format?.trim() || DEFAULT_MOVIE_FORMAT,
    edition: item.edition?.trim() || DEFAULT_MOVIE_EDITION,
    packaging: item.packaging?.trim() || DEFAULT_MOVIE_PACKAGING
  };
}
