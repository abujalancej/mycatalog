import { NextResponse } from "next/server";

import { deleteItem } from "@/lib/catalog";
import { backendJson } from "@/lib/backend";
import type { BookItem, MovieItem, MusicItem } from "@/lib/types";

type Params = {
  params: Promise<{
    kind: string;
    id: string;
  }>;
};

export async function DELETE(request: Request, { params }: Params) {
  const { kind, id } = await params;

  if (kind !== "music" && kind !== "movies" && kind !== "books") {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }

  const itemId = kind === "books" ? id : Number(id);
  if ((kind === "music" || kind === "movies") && !Number.isInteger(itemId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const deleted = await deleteItem(kind, itemId);

  if (!deleted) {
    return NextResponse.json({ status: "missing", id: itemId, kind });
  }

  return NextResponse.json({ status: "deleted", id: itemId, kind });
}

export async function PATCH(request: Request, { params }: Params) {
  const { kind, id } = await params;

  if (kind !== "music" && kind !== "movies" && kind !== "books") {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }

  const itemId = kind === "books" ? id : Number(id);
  if ((kind === "music" || kind === "movies") && !Number.isInteger(itemId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const item = await backendJson<MusicItem | MovieItem | BookItem>(`/api/items/${kind}/${encodeURIComponent(String(itemId))}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });

  return NextResponse.json(item);
}
