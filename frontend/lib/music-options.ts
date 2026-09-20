export const MUSIC_RELEASE_FORMATS = [
  "CD",
  "Mini CD",
  "Enhanced CD",
  "SACD",
  "HDCD"
] as const;

export const MUSIC_RELEASE_TYPES = [
  "Album",
  "Single",
  "Maxi-Single",
  "EP",
  "Compilation",
  "Live",
  "Soundtrack",
  "Promo",
  "Sampler",
  "Demo",
  "Bootleg",
  "Other"
] as const;

export const MUSIC_PACKAGING = [
  "Jewel Case",
  "Super Jewel Box",
  "Digipak",
  "Card Sleeve",
  "Box Set"
] as const;

export const DEFAULT_MUSIC_RELEASE_FORMAT = "CD";
export const DEFAULT_MUSIC_RELEASE_TYPE = "Album";
export const DEFAULT_MUSIC_PACKAGING = "Jewel Case";

export function withMusicDefaults<T extends {
  release_format?: string;
  type?: string;
  packaging?: string;
}>(item: T): T & {
  release_format: string;
  type: string;
  packaging: string;
} {
  return {
    ...item,
    release_format: item.release_format?.trim() || DEFAULT_MUSIC_RELEASE_FORMAT,
    type: item.type?.trim() || DEFAULT_MUSIC_RELEASE_TYPE,
    packaging: item.packaging?.trim() || DEFAULT_MUSIC_PACKAGING
  };
}
