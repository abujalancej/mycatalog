import { NextResponse } from "next/server";

import { resolveBookSearchResult } from "@/lib/catalog";
import type { BookSearchResult } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as BookSearchResult;

  if (!body?.source || !body?.sourceId) {
    return NextResponse.json({ error: "source and sourceId are required" }, { status: 400 });
  }

  const metadata = await resolveBookSearchResult(body);
  return NextResponse.json(metadata);
}
