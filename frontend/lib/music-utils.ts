export function normalizeMusicGenreLabel(value: string): string {
  const label = value.trim().replace(/^&\s+/, "").trim();
  return label.toLowerCase() === "country" ? "Country" : label;
}

export function normalizeMusicGenres(values?: string[]): string[] {
  const normalized = (values ?? []).map(normalizeMusicGenreLabel).filter(Boolean);
  return [...new Set(normalized)];
}
