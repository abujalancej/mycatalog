import "server-only";

import { backendJson } from "@/lib/backend";

export type AppConfig = {
  tmdb: {
    api_key: string;
    base_url: string;
  };
  discogs: {
    token: string;
    base_url: string;
  };
  google_books: {
    api_key?: string;
    base_url: string;
  };
  rawg: {
    api_key: string;
    base_url: string;
  };
  storage: {
    database_path: string;
  };
};

function normalizeConfig(raw: unknown): AppConfig {
  const source = (raw ?? {}) as Partial<AppConfig>;

  return {
    tmdb: {
      api_key: source.tmdb?.api_key ?? "",
      base_url: source.tmdb?.base_url ?? "https://api.themoviedb.org/3"
    },
    discogs: {
      token: source.discogs?.token ?? "",
      base_url: source.discogs?.base_url ?? "https://api.discogs.com"
    },
    google_books: {
      api_key: source.google_books?.api_key,
      base_url: source.google_books?.base_url ?? "https://www.googleapis.com/books/v1"
    },
    rawg: {
      api_key: source.rawg?.api_key ?? "",
      base_url: source.rawg?.base_url ?? "https://api.rawg.io/api"
    },
    storage: {
      database_path: source.storage?.database_path ?? "./db/catalog.sqlite3"
    }
  };
}

export async function readSettings(): Promise<AppConfig> {
  return normalizeConfig(await backendJson<AppConfig>("/api/settings"));
}

export async function saveSettings(next: AppConfig): Promise<void> {
  await backendJson<{ status: string }>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(next)
  });
}
