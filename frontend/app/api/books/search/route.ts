import { NextResponse } from "next/server";

import { searchBooks } from "@/lib/catalog";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title")?.trim() ?? "";
  const author = searchParams.get("author")?.trim() ?? "";
  const limit = Number(searchParams.get("limit") ?? 15) || 15;
  const page = Number(searchParams.get("page") ?? 1) || 1;

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const items = await searchBooks({ title, author: author || undefined, limit, page });
  return NextResponse.json({ items });
}
