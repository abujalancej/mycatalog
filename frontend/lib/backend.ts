import "server-only";

export const backendBaseUrl = (process.env.CATALOG_BACKEND_URL ?? "http://127.0.0.1:5000").replace(/\/+$/, "");

export async function backendJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${backendBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Backend request failed ${response.status}: ${details}`);
  }

  return response.json() as Promise<T>;
}
