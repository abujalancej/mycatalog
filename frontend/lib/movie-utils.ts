import type { MovieItem } from "@/lib/types";

export function normalizeMoviePoster(item: MovieItem): string | undefined {
  if (item.poster_local) {
    return item.poster_local;
  }

  if (item.poster_full) {
    return item.poster_full;
  }

  if (item.poster_path) {
    return `https://image.tmdb.org/t/p/w500${item.poster_path}`;
  }

  return undefined;
}

export function normalizeMovieTitle(item: MovieItem): string {
  return item.title ?? item.name ?? `Movie #${item.id}`;
}

export function normalizeMovieYear(item: MovieItem): string {
  const rawDate = item.release_date ?? item.first_air_date;
  return rawDate?.slice(0, 4) ?? "-";
}
