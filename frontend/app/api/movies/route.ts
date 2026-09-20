import { NextResponse } from "next/server";

import { addMovieItem, getMovies } from "@/lib/catalog";
import { DEFAULT_MOVIE_EDITION, DEFAULT_MOVIE_FORMAT, DEFAULT_MOVIE_PACKAGING } from "@/lib/movie-options";

export async function GET() {
  const items = await getMovies();
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const body = await request.json();

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!title && !name) {
    return NextResponse.json({ error: "title or name is required" }, { status: 400 });
  }

  const item = await addMovieItem({
    title: title || undefined,
    name: name || undefined,
    release_date: typeof body.release_date === "string" ? body.release_date : undefined,
    first_air_date: typeof body.first_air_date === "string" ? body.first_air_date : undefined,
    genres: Array.isArray(body.genres)
      ? body.genres.filter((value: unknown) => typeof value === "string")
      : typeof body.genres === "string"
        ? body.genres.split(",").map((value: string) => value.trim()).filter(Boolean)
        : [],
    director: typeof body.director === "string"
      ? body.director
      : Array.isArray(body.director)
        ? body.director.filter((value: unknown) => typeof value === "string")
        : undefined,
    directors: Array.isArray(body.directors) ? body.directors.filter((value: unknown) => typeof value === "string") : undefined,
    cast: typeof body.cast === "string"
      ? body.cast
      : Array.isArray(body.cast)
        ? body.cast.filter((value: unknown) => typeof value === "string")
        : undefined,
    actors: Array.isArray(body.actors) ? body.actors.filter((value: unknown) => typeof value === "string") : undefined,
    overview: typeof body.overview === "string" ? body.overview : undefined,
    media_type: typeof body.media_type === "string" ? body.media_type : "movie",
    format: typeof body.format === "string" && body.format.trim() ? body.format.trim() : DEFAULT_MOVIE_FORMAT,
    edition: typeof body.edition === "string" ? body.edition.trim() : DEFAULT_MOVIE_EDITION,
    packaging: typeof body.packaging === "string" && body.packaging.trim() ? body.packaging.trim() : DEFAULT_MOVIE_PACKAGING,
    format_details: typeof body.format_details === "string" ? body.format_details : undefined,
    location: typeof body.location === "string" ? body.location : undefined,
    poster_full: typeof body.poster_full === "string" ? body.poster_full : undefined,
    poster_path: typeof body.poster_path === "string" ? body.poster_path : undefined
  });

  return NextResponse.json(item, { status: 201 });
}
