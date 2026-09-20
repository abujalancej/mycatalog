import { NextResponse } from "next/server";

import { backendBaseUrl } from "@/lib/backend";

export async function GET() {
  const response = await fetch(`${backendBaseUrl}/api/database/backup`, {
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Could not create database backup." }));
    return NextResponse.json(payload, { status: response.status });
  }

  const headers = new Headers();
  headers.set("Content-Type", response.headers.get("Content-Type") ?? "application/octet-stream");
  const contentDisposition = response.headers.get("Content-Disposition");
  if (contentDisposition) {
    headers.set("Content-Disposition", contentDisposition);
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers
  });
}

export async function POST(request: Request) {
  const incoming = await request.formData();
  const file = incoming.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Database file is required." }, { status: 400 });
  }

  const formData = new FormData();
  formData.append("file", file, file.name || "mycatalog-backup.zip");

  const response = await fetch(`${backendBaseUrl}/api/database/backup`, {
    method: "POST",
    body: formData,
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));

  return NextResponse.json(payload, { status: response.status });
}

export async function DELETE() {
  const response = await fetch(`${backendBaseUrl}/api/database/backup`, {
    method: "DELETE",
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));

  return NextResponse.json(payload, { status: response.status });
}
