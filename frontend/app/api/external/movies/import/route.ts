import { NextResponse } from "next/server";

import { addMovieItem } from "@/lib/catalog";
import { DEFAULT_MOVIE_EDITION, DEFAULT_MOVIE_FORMAT, DEFAULT_MOVIE_PACKAGING } from "@/lib/movie-options";
import { readSettings } from "@/lib/settings";
import type { MovieItem } from "@/lib/types";

type TmdbPerson = {
  name?: string;
};

type TmdbCredit = {
  name?: string;
  job?: string;
};

type TmdbDetails = {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  genres?: Array<{ name?: string }>;
  created_by?: TmdbPerson[];
  credits?: {
    cast?: TmdbPerson[];
    crew?: TmdbCredit[];
  };
};

function posterUrl(path?: string | null): string | undefined {
  return path ? `https://image.tmdb.org/t/p/w500${path}` : undefined;
}

function normalizeMediaType(value: unknown): "movie" | "tv" {
  return value === "tv" ? "tv" : "movie";
}

function yearDate(value?: string): string | undefined {
  const year = (value ?? "").slice(0, 4);
  return /^\d{4}$/.test(year) ? `${year}-01-01` : undefined;
}

async function tmdbJson<T>(path: string, apiKey: string, baseUrl: string): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${baseUrl}${path}${separator}api_key=${encodeURIComponent(apiKey)}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`TMDB request failed ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = Number(body?.id);
  const mediaType = normalizeMediaType(body?.media_type);

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "valid TMDB id is required" }, { status: 400 });
  }

  const settings = await readSettings();
  const apiKey = settings.tmdb.api_key.trim();

  if (!apiKey) {
    return NextResponse.json({ error: "TMDB API key is not configured" }, { status: 400 });
  }

  const baseUrl = settings.tmdb.base_url.replace(/\/+$/, "");
  const details = await tmdbJson<TmdbDetails>(
    `/${mediaType}/${id}?append_to_response=credits&language=en-US`,
    apiKey,
    baseUrl
  );

  const directors = mediaType === "movie"
    ? (details.credits?.crew ?? [])
      .filter((person) => person.job === "Director" && person.name)
      .map((person) => person.name as string)
    : (details.created_by ?? [])
      .filter((person) => person.name)
      .map((person) => person.name as string);

  const cast = (details.credits?.cast ?? [])
    .filter((person) => person.name)
    .slice(0, 8)
    .map((person) => person.name as string);

  const item = await addMovieItem({
    id: details.id,
    title: mediaType === "movie" ? details.title : undefined,
    name: mediaType === "tv" ? details.name : undefined,
    release_date: mediaType === "movie" ? yearDate(details.release_date) : undefined,
    first_air_date: mediaType === "tv" ? yearDate(details.first_air_date) : undefined,
    genres: (details.genres ?? []).map((genre) => genre.name).filter((name): name is string => Boolean(name)),
    directors,
    cast,
    overview: details.overview,
    media_type: mediaType,
    format: DEFAULT_MOVIE_FORMAT,
    edition: DEFAULT_MOVIE_EDITION,
    packaging: DEFAULT_MOVIE_PACKAGING,
    poster_full: posterUrl(details.poster_path),
    poster_path: details.poster_path ?? undefined
  }) as MovieItem;

  return NextResponse.json({ item }, { status: 201 });
}
