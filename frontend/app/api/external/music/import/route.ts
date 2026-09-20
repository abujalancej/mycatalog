import { NextResponse } from "next/server";

import { backendJson } from "@/lib/backend";
import { DEFAULT_MUSIC_PACKAGING, DEFAULT_MUSIC_RELEASE_FORMAT, DEFAULT_MUSIC_RELEASE_TYPE, withMusicDefaults } from "@/lib/music-options";
import { normalizeMusicGenres } from "@/lib/music-utils";
import type { MusicItem } from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const releaseId = Number(body?.id);

  if (!Number.isFinite(releaseId) || releaseId <= 0) {
    return NextResponse.json({ error: "valid release id is required" }, { status: 400 });
  }

  const payload = await backendJson<{ item: MusicItem; alreadyExists: boolean }>("/api/external/music/import", {
    method: "POST",
    body: JSON.stringify({
      id: releaseId,
      cover: typeof body?.cover === "string" ? body.cover : undefined,
      format: typeof body?.format === "string" ? body.format : DEFAULT_MUSIC_RELEASE_FORMAT,
      type: DEFAULT_MUSIC_RELEASE_TYPE,
      packaging: DEFAULT_MUSIC_PACKAGING
    })
  });

  return NextResponse.json({
    ...payload,
    item: withMusicDefaults({ ...payload.item, genres: normalizeMusicGenres(payload.item.genres) })
  }, { status: payload.alreadyExists ? 200 : 201 });
}
