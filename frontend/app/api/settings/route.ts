import { NextResponse } from "next/server";

import { readSettings, saveSettings } from "@/lib/settings";

export async function GET() {
  const settings = await readSettings();
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const normalized = {
    tmdb: {
      api_key: String(body?.tmdb?.api_key ?? ""),
      base_url: String(body?.tmdb?.base_url ?? "")
    },
    discogs: {
      token: String(body?.discogs?.token ?? ""),
      base_url: String(body?.discogs?.base_url ?? "")
    },
    google_books: {
      api_key: body?.google_books?.api_key ? String(body.google_books.api_key) : undefined,
      base_url: String(body?.google_books?.base_url ?? "")
    },
    rawg: {
      api_key: String(body?.rawg?.api_key ?? ""),
      base_url: String(body?.rawg?.base_url ?? "")
    },
    storage: {
      database_path: String(body?.storage?.database_path ?? "")
    }
  };

  await saveSettings(normalized);
  return NextResponse.json({ status: "saved" });
}
