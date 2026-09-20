import { NextResponse } from "next/server";

import { getBookMetadataByIsbn } from "@/lib/catalog";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const isbn = searchParams.get("isbn")?.trim() ?? "";

  if (!isbn) {
    return NextResponse.json({ error: "isbn is required" }, { status: 400 });
  }

  const metadata = await getBookMetadataByIsbn(isbn);
  return NextResponse.json(metadata);
}
