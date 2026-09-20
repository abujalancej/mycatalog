import { NextResponse } from "next/server";

import { backendBaseUrl } from "@/lib/backend";

export async function POST() {
  const response = await fetch(`${backendBaseUrl}/api/images/localize`, {
    method: "POST",
    cache: "no-store"
  });

  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
