import { NextResponse } from "next/server";

import { addMusicItem, getMusic } from "@/lib/catalog";
import { normalizeMusicGenres } from "@/lib/music-utils";
import { DEFAULT_MUSIC_PACKAGING, DEFAULT_MUSIC_RELEASE_FORMAT, DEFAULT_MUSIC_RELEASE_TYPE } from "@/lib/music-options";

export async function GET() {
  const items = await getMusic();
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const body = await request.json();

  if (!body?.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const item = await addMusicItem({
    title: body.title.trim(),
    artists: Array.isArray(body.artists)
      ? body.artists.filter((value: unknown) => typeof value === "string")
      : typeof body.artists === "string"
        ? body.artists.split(",").map((value: string) => value.trim()).filter(Boolean)
        : [],
    year: typeof body.year === "number" ? body.year : undefined,
    genres: normalizeMusicGenres(Array.isArray(body.genres)
      ? body.genres.filter((value: unknown): value is string => typeof value === "string")
      : typeof body.genres === "string"
        ? body.genres.split(",").map((value: string) => value.trim()).filter(Boolean)
        : []),
    styles: Array.isArray(body.styles)
      ? body.styles.filter((value: unknown) => typeof value === "string")
      : typeof body.styles === "string"
        ? body.styles.split(",").map((value: string) => value.trim()).filter(Boolean)
        : [],
    cover: typeof body.cover === "string" ? body.cover : undefined,
    tracklist: Array.isArray(body.tracklist)
      ? body.tracklist
          .filter((track: unknown) => Boolean(track) && typeof track === "object")
          .map((track: { pos?: unknown; title?: unknown; artists?: unknown }) => ({
            pos: typeof track.pos === "string" ? track.pos : undefined,
            title: typeof track.title === "string" ? track.title : undefined,
            artists: Array.isArray(track.artists)
              ? track.artists.filter((value: unknown) => typeof value === "string")
              : []
          }))
      : undefined,
    release_format: typeof body.release_format === "string" && body.release_format.trim()
      ? body.release_format.trim()
      : DEFAULT_MUSIC_RELEASE_FORMAT,
    type: typeof body.type === "string" && body.type.trim()
      ? body.type.trim()
      : DEFAULT_MUSIC_RELEASE_TYPE,
    packaging: typeof body.packaging === "string" && body.packaging.trim()
      ? body.packaging.trim()
      : DEFAULT_MUSIC_PACKAGING,
    format_details: typeof body.format_details === "string" ? body.format_details : undefined,
    location: typeof body.location === "string" ? body.location : undefined
  });

  return NextResponse.json(item, { status: 201 });
}
