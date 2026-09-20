import { NextResponse } from "next/server";

import { readSettings } from "@/lib/settings";

type TmdbSearchResult = {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  media_type?: string;
};

function posterUrl(path?: string | null): string | undefined {
  return path ? `https://image.tmdb.org/t/p/w500${path}` : undefined;
}

function normalizeMediaType(value: string | undefined): "movie" | "tv" {
  return value === "tv" ? "tv" : "movie";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const query = String(body?.query ?? "").trim();
  const perPage = Math.min(20, Math.max(1, Number(body?.perPage ?? 12) || 12));

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const settings = await readSettings();
  const apiKey = settings.tmdb.api_key.trim();

  if (!apiKey) {
    return NextResponse.json({ error: "TMDB API key is not configured" }, { status: 400 });
  }

  const baseUrl = settings.tmdb.base_url.replace(/\/+$/, "");
  const params = new URLSearchParams({
    api_key: apiKey,
    query,
    include_adult: "false",
    language: "en-US",
    page: "1"
  });

  const response = await fetch(`${baseUrl}/search/multi?${params.toString()}`, { cache: "no-store" });

  if (!response.ok) {
    return NextResponse.json({ error: `TMDB search failed ${response.status}` }, { status: 502 });
  }

  const payload = (await response.json()) as { results?: TmdbSearchResult[] };
  const items = (payload.results ?? [])
    .filter((item) => item.media_type === "movie" || item.media_type === "tv")
    .slice(0, perPage)
    .map((item) => ({
      id: item.id,
      title: item.title ?? item.name ?? "-",
      year: (item.release_date ?? item.first_air_date ?? "").slice(0, 4),
      media_type: normalizeMediaType(item.media_type),
      overview: item.overview ?? "",
      poster: posterUrl(item.poster_path),
      poster_path: item.poster_path ?? undefined
    }));

  return NextResponse.json({ items });
}
