export type MusicItem = {
  id: number;
  title: string;
  artists?: string[];
  year?: number;
  genres?: string[];
  styles?: string[];
  cover?: string;
  tracklist?: Array<{
    pos?: string;
    title?: string;
    artists?: string[];
  }>;
  release_format?: string;
  type?: string;
  packaging?: string;
  format_details?: string;
  location?: string;
};

export type MovieItem = {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  genres?: string[];
  director?: string | string[];
  directors?: string[];
  cast?: string | string[];
  actors?: string[];
  overview?: string;
  media_type?: string;
  format?: string;
  edition?: string;
  packaging?: string;
  format_details?: string;
  location?: string;
  poster_local?: string;
  poster_full?: string;
  poster_path?: string;
};

export type BookItem = {
  id: string;
  isbn?: string;
  isbn10?: string;
  isbn13?: string;
  title: string;
  subtitle?: string;
  authors?: string[];
  publishedDate?: string;
  publicationYear?: number;
  publisher?: string;
  location?: string;
  categories?: string[];
  genres?: string[];
  additional_info?: string;
  synopsis?: string;
  back_cover?: string;
  description?: string;
  cover?: string;
  cover_local?: string;
  source?: "openlibrary" | "google-books";
  sourceId?: string;
};

export type BookSearchResult = {
  id: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publicationYear?: number;
  publisher?: string;
  isbn10?: string;
  isbn13?: string;
  coverUrl?: string;
  source: "openlibrary" | "google-books";
  sourceId?: string;
};
