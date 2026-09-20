import { NextResponse } from "next/server";

import { backendJson } from "@/lib/backend";

type DiscogsSearchResponse = {
  items?: unknown[];
  error?: string;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const query = String(body?.query ?? "").trim();
  const perPage = Math.min(25, Math.max(1, Number(body?.perPage ?? 12) || 12));

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const payload = await backendJson<DiscogsSearchResponse>("/api/external/music/search", {
      method: "POST",
      body: JSON.stringify({ query, perPage })
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Discogs search failed" },
      { status: 502 }
    );
  }
}
