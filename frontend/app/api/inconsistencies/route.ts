import { NextResponse } from "next/server";

import { backendBaseUrl } from "@/lib/backend";

export async function GET() {
  const response = await fetch(`${backendBaseUrl}/api/inconsistencies`, {
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));

  return NextResponse.json(payload, { status: response.status });
}
