import "server-only";
import type { BookItem, BookSearchResult, MovieItem, MusicItem } from "@/lib/types";
import { normalizeMovieTitle } from "@/lib/movie-utils";
import { DEFAULT_MOVIE_EDITION, DEFAULT_MOVIE_FORMAT, DEFAULT_MOVIE_PACKAGING, withMovieDefaults } from "@/lib/movie-options";
import { normalizeMusicGenres } from "@/lib/music-utils";
import { DEFAULT_MUSIC_PACKAGING, DEFAULT_MUSIC_RELEASE_FORMAT, DEFAULT_MUSIC_RELEASE_TYPE, withMusicDefaults } from "@/lib/music-options";
import { backendBaseUrl, backendJson } from "@/lib/backend";

export async function getMusic(): Promise<MusicItem[]> {
  const data = await backendJson<MusicItem[]>("/api/music");
  return data
    .map((item) => withMusicDefaults({ ...item, genres: normalizeMusicGenres(item.genres) }))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

export async function getMovies(): Promise<MovieItem[]> {
  const data = await backendJson<MovieItem[]>("/api/movies");
  return data
    .map((item) => withMovieDefaults(item))
    .sort((a, b) => normalizeMovieTitle(a).localeCompare(normalizeMovieTitle(b)));
}

export async function getBooks(): Promise<BookItem[]> {
  const data = await backendJson<BookItem[]>("/api/books");
  return data.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
}

export async function addMusicItem(payload: Omit<MusicItem, "id"> & { id?: number }): Promise<MusicItem> {
  return backendJson<MusicItem>("/api/music", {
    method: "POST",
    body: JSON.stringify({
      id: payload.id,
      title: payload.title,
      artists: payload.artists ?? [],
      year: payload.year,
      genres: normalizeMusicGenres(payload.genres),
      styles: payload.styles ?? [],
      cover: payload.cover,
      tracklist: payload.tracklist ?? [],
      release_format: payload.release_format ?? DEFAULT_MUSIC_RELEASE_FORMAT,
      type: payload.type ?? DEFAULT_MUSIC_RELEASE_TYPE,
      packaging: payload.packaging ?? DEFAULT_MUSIC_PACKAGING,
      format_details: payload.format_details,
      location: payload.location
    })
  });
}

export async function addMovieItem(payload: Omit<MovieItem, "id"> & { id?: number }): Promise<MovieItem> {
  return backendJson<MovieItem>("/api/movies", {
    method: "POST",
    body: JSON.stringify({
      id: payload.id,
      title: payload.title,
      name: payload.name,
      release_date: payload.release_date,
      first_air_date: payload.first_air_date,
      genres: payload.genres ?? [],
      director: payload.director,
      directors: payload.directors,
      cast: payload.cast,
      actors: payload.actors,
      overview: payload.overview,
      media_type: payload.media_type ?? "movie",
      format: payload.format ?? DEFAULT_MOVIE_FORMAT,
      edition: payload.edition ?? DEFAULT_MOVIE_EDITION,
      packaging: payload.packaging ?? DEFAULT_MOVIE_PACKAGING,
      format_details: payload.format_details,
      location: payload.location,
      poster_full: payload.poster_full,
      poster_path: payload.poster_path
    })
  });
}

export async function addBookItem(payload: BookItem): Promise<BookItem> {
  return backendJson<BookItem>("/api/books", {
    method: "POST",
    body: JSON.stringify({ metadata: payload })
  });
}

export async function searchBooks(payload: {
  title: string;
  author?: string;
  limit?: number;
  page?: number;
}): Promise<BookSearchResult[]> {
  const params = new URLSearchParams({
    title: payload.title,
    limit: String(payload.limit ?? 15),
    page: String(payload.page ?? 1)
  });
  if (payload.author) {
    params.set("author", payload.author);
  }

  const data = await backendJson<{ items?: BookSearchResult[] }>(`/api/books/search?${params.toString()}`);
  return data.items ?? [];
}

export async function getBookMetadataByIsbn(isbn: string): Promise<BookItem> {
  const params = new URLSearchParams({ isbn });
  return backendJson<BookItem>(`/api/books/metadata?${params.toString()}`);
}

export async function resolveBookSearchResult(result: BookSearchResult): Promise<BookItem> {
  return backendJson<BookItem>("/api/books/resolve", {
    method: "POST",
    body: JSON.stringify(result)
  });
}

export async function deleteItem(kind: "music" | "movies" | "books", id: number | string): Promise<boolean> {
  const response = await fetch(`${backendBaseUrl}/api/items/${kind}/${encodeURIComponent(String(id))}`, {
    method: "DELETE",
    cache: "no-store"
  });

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Backend delete failed ${response.status}: ${details}`);
  }

  return true;
}
