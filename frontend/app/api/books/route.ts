import { NextResponse } from "next/server";

import { addBookItem, getBooks } from "@/lib/catalog";
import type { BookItem } from "@/lib/types";

export async function GET() {
  const items = await getBooks();
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<BookItem> & { metadata?: BookItem };
  const metadata = body.metadata ?? body;

  if (!metadata?.title || typeof metadata.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const item = await addBookItem(metadata as BookItem);
  return NextResponse.json(item, { status: 201 });
}
