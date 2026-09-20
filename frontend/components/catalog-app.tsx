"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";

import GlitchText from "./GlitchText";
import {
  DEFAULT_MOVIE_EDITION,
  DEFAULT_MOVIE_FORMAT,
  DEFAULT_MOVIE_PACKAGING,
  MOVIE_EDITIONS,
  MOVIE_FORMATS,
  MOVIE_PACKAGING,
  withMovieDefaults
} from "@/lib/movie-options";
import { normalizeMoviePoster, normalizeMovieTitle, normalizeMovieYear } from "@/lib/movie-utils";
import {
  DEFAULT_MUSIC_RELEASE_FORMAT,
  DEFAULT_MUSIC_RELEASE_TYPE,
  DEFAULT_MUSIC_PACKAGING,
  MUSIC_PACKAGING,
  MUSIC_RELEASE_FORMATS,
  MUSIC_RELEASE_TYPES,
  withMusicDefaults
} from "@/lib/music-options";
import { normalizeMusicGenres } from "@/lib/music-utils";
import type { BookItem, BookSearchResult, MovieItem, MusicItem } from "@/lib/types";

type Props = {
  initialMusic: MusicItem[];
  initialMovies: MovieItem[];
  initialBooks: BookItem[];
};

type Area = "catalog" | "settings";
type Tab = "music" | "movies" | "books";
type Lang = "cat" | "es" | "eng";
type SortMode = "title" | "year" | "creator";
type SectionVisibility = Record<Tab, boolean>;
type EditableKind = "music" | "movies" | "books";
type SelectedItem = { kind: "music"; item: MusicItem } | { kind: "movies"; item: MovieItem } | { kind: "books"; item: BookItem } | null;
type PendingDelete = { kind: "music"; id: number; title: string } | { kind: "movies"; id: number; title: string } | { kind: "books"; id: string; title: string } | null;
type ActionNoticeStat = { value: string; label: string };
type ActionNotice = { title: string; message: string; details?: string[]; stats?: ActionNoticeStat[] } | null;
type PendingDatabaseAction = { kind: "restore"; file: File } | { kind: "delete" } | null;
type DatabaseOperation = "download" | "restore" | "delete" | null;
type InconsistencyKindFilter = "all" | "music" | "books";
type InconsistencySeverityFilter = "all" | "error" | "warning" | "info";
type InconsistencyIssue = {
  severity: "error" | "warning" | "info";
  message: string;
  kind?: string;
  itemId?: string;
  itemLabel?: string;
  file?: string;
};
type InconsistencyReport = {
  scanned: number;
  issueCount: number;
  issues: InconsistencyIssue[];
  files: Array<{ label: string; path: string; url?: string }>;
};
type MusicEditForm = {
  title: string;
  artists: string;
  year: string;
  genres: string;
  styles: string;
  cover: string;
  release_format: string;
  type: string;
  packaging: string;
  format_details: string;
  location: string;
  tracklist: TrackEditForm[];
};
type TrackEditForm = {
  pos: string;
  title: string;
  artists: string;
};
type MovieEditForm = {
  title: string;
  year: string;
  genres: string;
  directors: string;
  cast: string;
  media_type: string;
  poster_full: string;
  format: string;
  edition: string;
  packaging: string;
  format_details: string;
  location: string;
  overview: string;
};
type BookEditForm = {
  title: string;
  subtitle: string;
  authors: string;
  publicationYear: string;
  publisher: string;
  location: string;
  isbn: string;
  cover: string;
  additional_info: string;
  synopsis: string;
  back_cover: string;
  description: string;
};
type DiscogsSearchItem = {
  id: number;
  title: string;
  year?: number;
  genres: string[];
  styles: string[];
  cover?: string;
  format?: string;
  country?: string;
};
type LocalizeImagesResponse = {
  scanned: number;
  localized: number;
  skipped: number;
  failed: number;
  migrated: number;
  removed: number;
  failures?: Array<{ kind: string; id: string; label: string }>;
  music?: MusicItem[];
  movies?: MovieItem[];
  books?: BookItem[];
};
type TmdbSearchItem = {
  id: number;
  title: string;
  year?: string;
  media_type: "movie" | "tv";
  overview?: string;
  poster?: string;
  poster_path?: string;
};
type BookLookupMode = "isbn" | "title";

type SettingsState = {
  tmdbApiKey: string;
  tmdbBaseUrl: string;
  discogsToken: string;
  discogsBaseUrl: string;
  googleBooksApiKey: string;
  googleBooksBaseUrl: string;
  rawgApiKey: string;
  rawgBaseUrl: string;
  databasePath: string;
};

const DEFAULT_SETTINGS: SettingsState = {
  tmdbApiKey: "",
  tmdbBaseUrl: "https://api.themoviedb.org/3",
  discogsToken: "",
  discogsBaseUrl: "https://api.discogs.com",
  googleBooksApiKey: "",
  googleBooksBaseUrl: "https://www.googleapis.com/books/v1",
  rawgApiKey: "",
  rawgBaseUrl: "https://api.rawg.io/api",
  databasePath: "./db/catalog.sqlite3"
};
const AVAILABLE_TABS: Tab[] = ["music", "movies", "books"];
const DEFAULT_TAB_ORDER: Tab[] = ["music", "movies", "books"];
const DEFAULT_SECTION_VISIBILITY: SectionVisibility = {
  music: true,
  movies: true,
  books: true
};
const TAB_LOADER_MIN_DURATION_MS = 400;
const INITIAL_CATALOG_BATCH_SIZE = 36;
const CATALOG_BATCH_SIZE = 24;
const INITIAL_VISIBLE_ITEMS: Record<Tab, number> = {
  music: INITIAL_CATALOG_BATCH_SIZE,
  movies: INITIAL_CATALOG_BATCH_SIZE,
  books: INITIAL_CATALOG_BATCH_SIZE
};

function preloadCatalogImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new window.Image();
    let settled = false;
    let timeoutId = 0;

    const finish = async () => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      if (image.naturalWidth > 0) {
        await image.decode().catch(() => undefined);
      }
      resolve();
    };

    image.decoding = "async";
    image.onload = () => void finish();
    image.onerror = () => void finish();
    timeoutId = window.setTimeout(() => void finish(), 6_000);
    image.src = src;

    if (image.complete) {
      void finish();
    }
  });
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function csv(values?: string[]): string {
  return (values ?? []).join(", ");
}

function splitCsv(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function splitMusicGenres(value: string): string[] {
  return normalizeMusicGenres(splitCsv(value));
}

function musicSelectOptions(options: readonly string[], currentValue: string): string[] {
  return currentValue && !options.some((option) => option === currentValue)
    ? [currentValue, ...options]
    : [...options];
}

function formatTrackPos(value: string | undefined, fallback: number): string {
  const pos = value?.trim() || String(fallback);
  return /^\d$/.test(pos) ? `0${pos}` : pos;
}

function formatPeople(value?: string | string[]): string {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }

  return value?.trim() ?? "";
}

function movieDirectorLine(item: MovieItem): string {
  return formatPeople(item.directors) || formatPeople(item.director) || "-";
}

function movieCastLine(item: MovieItem): string {
  return formatPeople(item.cast) || formatPeople(item.actors) || "-";
}

function movieFormatLine(value?: string): string {
  const format = value?.trim();

  if (!format) {
    return "-";
  }

  const normalized = format.toLowerCase().replace(/[\s_-]+/g, "");

  if (normalized === "dvd") {
    return "DVD";
  }

  if (normalized === "bluray" || normalized === "blu") {
    return "Blu-ray";
  }

  return format;
}

function isTab(value: string | null): value is Tab {
  return value === "music" || value === "movies" || value === "books";
}

function parseSectionVisibility(value: string | null): SectionVisibility {
  if (!value) {
    return DEFAULT_SECTION_VISIBILITY;
  }

  try {
    const parsed = JSON.parse(value) as Partial<SectionVisibility>;
    const visibility = {
      music: parsed.music !== false,
      movies: parsed.movies !== false,
      books: parsed.books !== false
    };
    return AVAILABLE_TABS.some((entry) => visibility[entry]) ? visibility : DEFAULT_SECTION_VISIBILITY;
  } catch {
    return DEFAULT_SECTION_VISIBILITY;
  }
}

function parseTabOrder(value: string | null): Tab[] {
  if (!value) {
    return DEFAULT_TAB_ORDER;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return DEFAULT_TAB_ORDER;
    }

    const orderedTabs = parsed.filter((entry): entry is Tab => isTab(String(entry)));
    const missingTabs = DEFAULT_TAB_ORDER.filter((entry) => !orderedTabs.includes(entry));
    const nextOrder = [...orderedTabs, ...missingTabs];
    return nextOrder.length === DEFAULT_TAB_ORDER.length ? nextOrder : DEFAULT_TAB_ORDER;
  } catch {
    return DEFAULT_TAB_ORDER;
  }
}

function musicToEditForm(item: MusicItem): MusicEditForm {
  const music = withMusicDefaults(item);

  return {
    title: music.title ?? "",
    artists: csv(music.artists),
    year: music.year ? String(music.year) : "",
    genres: csv(normalizeMusicGenres(music.genres)),
    styles: csv(music.styles),
    cover: music.cover ?? "",
    release_format: music.release_format,
    type: music.type,
    packaging: music.packaging,
    format_details: music.format_details ?? "",
    location: music.location ?? "",
    tracklist: (music.tracklist ?? []).map((track) => ({
      pos: track.pos ?? "",
      title: track.title ?? "",
      artists: csv(track.artists)
    }))
  };
}

function newTrackEditForm(): TrackEditForm {
  return { pos: "", title: "", artists: "" };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("No se pudo leer el archivo de imagen."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el archivo de imagen."));
    reader.readAsDataURL(file);
  });
}

function canPreviewImage(value: string | undefined): value is string {
  const source = value?.trim();
  return Boolean(source && (/^(https?:\/\/|data:image\/|blob:)/i.test(source) || source.startsWith("/")));
}

function movieToEditForm(item: MovieItem): MovieEditForm {
  const movie = withMovieDefaults(item);

  return {
    title: normalizeMovieTitle(movie),
    year: normalizeMovieYear(movie) === "-" ? "" : normalizeMovieYear(movie),
    genres: csv(movie.genres),
    directors: movieDirectorLine(movie) === "-" ? "" : movieDirectorLine(movie),
    cast: movieCastLine(movie) === "-" ? "" : movieCastLine(movie),
    media_type: movie.media_type ?? "movie",
    poster_full: normalizeMoviePoster(movie) ?? "",
    format: movie.format,
    edition: movie.edition,
    packaging: movie.packaging,
    format_details: movie.format_details ?? "",
    location: movie.location ?? "",
    overview: movie.overview ?? ""
  };
}

function selectOptionsWithCurrent(options: readonly string[], currentValue: string): string[] {
  return currentValue && !options.includes(currentValue) ? [currentValue, ...options] : [...options];
}

function bookCover(item: BookItem | BookSearchResult): string | undefined {
  return ("cover_local" in item ? item.cover_local : undefined)
    || ("cover" in item ? item.cover : undefined)
    || ("coverUrl" in item ? item.coverUrl : undefined);
}

function selectedItemImageSource(selection: Exclude<SelectedItem, null>): string | undefined {
  if (selection.kind === "music") {
    return selection.item.cover;
  }

  if (selection.kind === "movies") {
    return normalizeMoviePoster(selection.item);
  }

  return bookCover(selection.item);
}

function bookYear(item: BookItem | BookSearchResult): string {
  return item.publicationYear ? String(item.publicationYear) : "-";
}

function bookIsbn(item: BookItem | BookSearchResult): string {
  return item.isbn13 || item.isbn10 || ("isbn" in item ? item.isbn : undefined) || "";
}

function bookLocationLine(item: BookItem): string {
  const location = normalizeLocation(item.location);
  const isbn = bookIsbn(item).trim();
  return location && location !== isbn ? location : "-";
}

function bookAuthorLine(item: BookItem | BookSearchResult): string {
  return item.authors?.join(", ") || "-";
}

function bookGenreLine(item: BookItem): string {
  return (item.genres?.length ? item.genres : item.categories)?.join(", ") || "-";
}

function hasText(value?: string): value is string {
  return Boolean(value?.trim());
}

function normalizeLocation(value?: string): string {
  const location = value?.trim() ?? "";
  const acronyms = new Map([
    ["cd", "CD"],
    ["dvd", "DVD"],
    ["vhs", "VHS"],
    ["lp", "LP"],
    ["bd", "BD"],
    ["uhd", "UHD"],
    ["4k", "4K"]
  ]);

  return location.toLowerCase().replace(/[\p{L}\p{N}]+/gu, (word) => {
    const acronym = acronyms.get(word);
    return acronym ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
  });
}

function locationFilterKey(value?: string): string {
  return normalizeLocation(value).toLowerCase();
}

function itemLocationForFilter(item: { location?: string; isbn?: string; isbn10?: string; isbn13?: string }): string {
  const location = normalizeLocation(item.location);
  const isbn = ("isbn" in item || "isbn10" in item || "isbn13" in item) ? bookIsbn(item as BookItem).trim() : "";
  return location && location !== isbn ? location : "";
}

function uniqueLocations<T extends { location?: string; isbn?: string; isbn10?: string; isbn13?: string }>(items: T[]): string[] {
  const locations = new Map<string, string>();
  items.forEach((item) => {
    const location = itemLocationForFilter(item);
    if (location) {
      locations.set(location.toLowerCase(), location);
    }
  });
  return [...locations.values()].sort((a, b) => a.localeCompare(b));
}

function firstSortValue(value: string): string {
  return normalizeForSort(value.split(",")[0] ?? value);
}

function normalizeForSort(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function compareText(a: string, b: string): number {
  return normalizeForSort(a).localeCompare(normalizeForSort(b));
}

function compareYearDesc(a?: number | string, b?: number | string): number {
  const yearA = Number(a) || 0;
  const yearB = Number(b) || 0;
  return yearB - yearA;
}

function toggleFilterValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function hasSelectedValue(values: string[], value: string): boolean {
  return values.length === 0 || values.includes(value);
}

function hasSelectedLocation(values: string[], value?: string): boolean {
  const key = locationFilterKey(value);
  return values.length === 0 || values.some((entry) => locationFilterKey(entry) === key);
}

function MultiFilterDropdown({
  allLabel,
  options,
  values,
  onChange
}: {
  allLabel: string;
  options: Array<string | { value: string; label: string }>;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const normalizedOptions = options.map((option) => typeof option === "string" ? { value: option, label: option } : option);
  const selectedLabels = values.map((value) => normalizedOptions.find((option) => option.value === value)?.label ?? value);
  const summary = selectedLabels.length === 0 ? allLabel : selectedLabels.length === 1 ? selectedLabels[0] : `${allLabel} (${selectedLabels.length})`;

  return (
    <details className="multi-filter">
      <summary>{summary}</summary>
      <div className="multi-filter-menu">
        <button type="button" className={values.length === 0 ? "multi-filter-clear active" : "multi-filter-clear"} onClick={() => onChange([])}>
          {allLabel}
        </button>
        {normalizedOptions.map((option) => (
          <label key={option.value} className="multi-filter-option">
            <input type="checkbox" checked={values.includes(option.value)} onChange={() => onChange(toggleFilterValue(values, option.value))} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="filter-group">
      <h4>{title}</h4>
      <div className="filter-group-controls">{children}</div>
    </section>
  );
}

function bookToEditForm(item: BookItem): BookEditForm {
  return {
    title: item.title ?? "",
    subtitle: item.subtitle ?? "",
    authors: csv(item.authors),
    publicationYear: item.publicationYear ? String(item.publicationYear) : "",
    publisher: item.publisher ?? "",
    location: item.location ?? "",
    isbn: item.isbn13 || item.isbn10 || item.isbn || "",
    cover: item.cover ?? item.cover_local ?? "",
    additional_info: item.additional_info ?? "",
    synopsis: item.synopsis ?? "",
    back_cover: item.back_cover ?? "",
    description: item.description ?? ""
  };
}

const TEXT = {
  es: {
    appSubtitle: "Todos tus favoritos, en un solo catálogo.",
    menuCatalog: "Catálogo",
    menuSettings: "Configuración",
    editorMode: "Modo editor",
    editorOn: "Activo",
    editorOff: "Inactivo",
    close: "Cerrar",
    loading: "Cargando...",
    songs: "Canciones",
    addTrack: "Añadir pista",
    noTracks: "Sin pistas",
    tabs: { music: "Discos", movies: "Películas", books: "Libros" },
    search: {
      music: "Buscar música...",
      movies: "Buscar películas...",
      books: "Buscar libros..."
    },
    external: {
      title: "Importar desde Discogs",
      queryPlaceholder: "Artista, álbum o canción",
      search: "Buscar",
      searching: "Buscando...",
      clear: "Limpiar",
      import: "Importar",
      importing: "Importando...",
      noResults: "Sin resultados",
      imported: "Disco importado",
      exists: "Ya existía en el catálogo",
      genericError: "Error al conectar con Discogs"
    },
    movieExternal: {
      title: "Buscar en TMDB",
      queryPlaceholder: "Título, director o reparto",
      imported: "Título importado",
      genericError: "Error al conectar con TMDB"
    },
    bookExternal: {
      title: "Buscar libro",
      titlePlaceholder: "Título",
      authorPlaceholder: "Autor",
      isbnPlaceholder: "ISBN",
      imported: "Libro importado",
      genericError: "Error al buscar libros"
    },
    addTitle: {
      music: "Añadir música",
      movies: "Añadir película",
      books: "Añadir libro"
    },
    importSource: {
      externalDb: "Desde base de datos",
      manual: "Manual"
    },
    filters: {
      open: "Filtros",
      musicPublication: "Publicación",
      musicContent: "Contenido",
      moviePhysical: "Edición física",
      movieContent: "Contenido",
      collection: "Colección",
      allGenres: "Todos los géneros",
      allYears: "Todos los años",
      allStyles: "Todos los estilos",
      allFormats: "Todos los formatos",
      allReleaseTypes: "Todos los tipos",
      allPackaging: "Todos los embalajes",
      allEditions: "Todas las ediciones",
      allLocations: "Todas las ubicaciones",
      allTypes: "Todos",
      moviesOnly: "Películas",
      seriesOnly: "Series",
      sortTitle: "Ordenar por título",
      sortYear: "Ordenar por año",
      sortArtist: "Ordenar por artista",
      sortAuthor: "Ordenar por autor",
      sortDirector: "Ordenar por director",
      clear: "Limpiar",
      results: "resultados"
    },
    addAlbum: "Añadir disco",
    addMovie: "Añadir película/serie",
    addBook: "Añadir libro",
    title: "Título",
    author: "Autor",
    artists: "Artistas",
    year: "Año",
    genres: "Géneros",
    styles: "Estilos",
    location: "Ubicación",
    format: "Formato",
    edition: "Edición",
    packaging: "Embalaje",
    releaseType: "Tipo de publicación",
    formatDetails: "Detalles del formato",
    subtitle: "Subtítulo",
    publisher: "Editorial",
    isbn: "ISBN",
    additionalInfo: "Información adicional",
    synopsis: "Sinopsis",
    backCover: "Contraportada",
    description: "Descripción",
    director: "Director",
    cast: "Reparto",
    type: "Tipo",
    titleAuthor: "Título / Autor",
    coverUrl: "URL de portada",
    posterUrl: "URL de póster",
    imageBrowse: "Buscar archivo",
    imageUrl: "URL de imagen",
    imagePreview: "Vista previa",
    imageSource: "Rutinas de mantenimiento",
    clearImage: "Quitar imagen",
    saveAlbum: "Guardar disco",
    saveMovie: "Guardar título",
    saveBook: "Guardar libro",
    noArtist: "Sin artista",
    noGenre: "Sin género",
    noCover: "Sin portada",
    noPoster: "Sin póster",
    noPublisher: "Sin editorial",
    movie: "Película",
    series: "Serie",
    delete: "Eliminar",
    cancel: "Cancelar",
    confirmDelete: "Confirmar eliminación",
    deletePrompt: "Esta acción borrará el elemento de la base de datos.",
    deleteMissing: "El elemento no existía en la base de datos. Se ha quitado de la vista.",
    actionConfirmed: "Acción confirmada",
    settingsTitle: "Configuración",
    settingsSubtitle: "Modo editor y configuración",
    language: "Language (UI)",
    visibleSections: "Secciones visibles",
    tabOrder: "Orden de pestañas",
    showSection: "Mostrar",
    hideSection: "No mostrar",
    yamlTitle: "Configuración",
    saveYaml: "Guardar configuración",
    yamlSaved: "Configuración guardada correctamente.",
    yamlSaveError: "No se pudo guardar la configuración.",
    yamlLoadError: "No se pudo cargar la configuración.",
    editorRequired: "Necesitas modo editor para esta acción.",
    localizeImages: "Guardar imágenes localmente",
    localizingImages: "Guardando imágenes...",
    localizeImagesNew: "Imágenes nuevas guardadas",
    localizeImagesChecked: "Imágenes revisadas",
    localizeImagesExisting: "Imágenes ya existentes",
    localizeImagesMigrated: "Rutas reorganizadas",
    localizeImagesRemoved: "Imágenes no utilizadas eliminadas",
    localizeImagesFailed: "fallidas",
    localizeImagesFailedItems: "Imágenes que no se pudieron guardar:",
    localizeImagesError: "No se pudieron guardar las imágenes.",
    databaseBackupDescription: "Bases de datos",
    downloadDatabase: "Descargar copia",
    downloadingDatabase: "Preparando copia...",
    databaseDownloadSuccess: "Copia descargada correctamente.",
    uploadDatabase: "Restaurar copia",
    uploadingDatabase: "Restaurando copia...",
    deleteDatabase: "Borrar base de datos",
    deletingDatabase: "Borrando base de datos...",
    databaseDownloadError: "No se pudo crear la copia de seguridad.",
    databaseUploadError: "No se pudo restaurar la copia de seguridad.",
    databaseDeleteError: "No se pudo borrar la base de datos.",
    databaseUploadSuccess: "Base de datos restaurada correctamente.",
    databaseDeleteSuccess: "Base de datos y portadas locales borradas correctamente.",
    databaseConfirmTitle: "Confirmar operación de base de datos",
    databaseRestoreWarning: "Esta acción sobrescribirá toda la base de datos y reemplazará las imágenes locales actuales.",
    databaseDeleteWarning: "Esta acción vaciará toda la base de datos y borrará las imágenes locales actuales.",
    databaseConfirmInstruction: "Escribe {keyword} para confirmar.",
    databaseConfirmInputLabel: "Confirmación",
    databaseConfirmPlaceholder: "Escribe la palabra de confirmación",
    databaseConfirmButton: "Confirmar operación",
    databaseCancelButton: "Cancelar",
    databaseRestoreKeyword: "RESTORE",
    databaseDeleteKeyword: "DELETE",
    detectInconsistencies: "Detectar inconsistencias",
    detectingInconsistencies: "Analizando...",
  inconsistenciesTitle: "Inconsistencias",
    inconsistencyFilterKind: "Colección",
    inconsistencyFilterAllKinds: "Todas",
    inconsistencyFilterMusic: "Discos",
    inconsistencyFilterBooks: "Libros",
    inconsistencyFilterSeverity: "Severidad",
    inconsistencyFilterAllSeverities: "Todas",
    inconsistencyFilterError: "Errores",
    inconsistencyFilterWarning: "Avisos",
    inconsistencyFilterInfo: "Información",
    inconsistencyFilterSearch: "Buscar en incidencias...",
    inconsistencyFilterClear: "Limpiar filtros",
    inconsistencyDownload: "Descargar listado",
    inconsistencyFilterNoResults: "Ninguna incidencia coincide con los filtros.",
    inconsistenciesClean: "No se encontraron inconsistencias.",
    inconsistenciesError: "No se pudieron detectar inconsistencias.",
    openFile: "Ir al archivo",
    fileOpened: "Archivo abierto.",
    fileOpenError: "No se pudo abrir el archivo.",
    saveChanges: "Guardar cambios",
    changesSaved: "Cambios guardados.",
    changesError: "No se pudieron guardar los cambios."
  },
  cat: {
    appSubtitle: "Tots els teus preferits, en un sol catàleg.",
    menuCatalog: "Catàleg",
    menuSettings: "Configuració",
    editorMode: "Mode editor",
    editorOn: "Actiu",
    editorOff: "Inactiu",
    close: "Tancar",
    loading: "Carregant...",
    songs: "Cançons",
    addTrack: "Afegir pista",
    noTracks: "Sense pistes",
    tabs: { music: "Discos", movies: "Pel·lícules", books: "Llibres" },
    search: {
      music: "Cercar música...",
      movies: "Cercar pel·lícules...",
      books: "Cercar llibres..."
    },
    external: {
      title: "Importar des de Discogs",
      queryPlaceholder: "Artista, àlbum o cançó",
      search: "Cercar",
      searching: "Cercant...",
      clear: "Netejar",
      import: "Importar",
      importing: "Important...",
      noResults: "Sense resultats",
      imported: "Disc importat",
      exists: "Ja existia al catàleg",
      genericError: "Error en connectar amb Discogs"
    },
    movieExternal: {
      title: "Cercar a TMDB",
      queryPlaceholder: "Títol, director o repartiment",
      imported: "Títol importat",
      genericError: "Error en connectar amb TMDB"
    },
    bookExternal: {
      title: "Cercar llibre",
      titlePlaceholder: "Títol",
      authorPlaceholder: "Autor",
      isbnPlaceholder: "ISBN",
      imported: "Llibre importat",
      genericError: "Error en cercar llibres"
    },
    addTitle: {
      music: "Afegir música",
      movies: "Afegir pel·lícula",
      books: "Afegir llibre"
    },
    importSource: {
      externalDb: "Des de la base de dades",
      manual: "Manual"
    },
    filters: {
      open: "Filtres",
      musicPublication: "Publicació",
      musicContent: "Contingut",
      moviePhysical: "Edició física",
      movieContent: "Contingut",
      collection: "Col·lecció",
      allGenres: "Tots els gèneres",
      allYears: "Tots els anys",
      allStyles: "Tots els estils",
      allFormats: "Tots els formats",
      allReleaseTypes: "Tots els tipus",
      allPackaging: "Tots els embalatges",
      allEditions: "Totes les edicions",
      allLocations: "Totes les ubicacions",
      allTypes: "Tots",
      moviesOnly: "Pel·lícules",
      seriesOnly: "Sèries",
      sortTitle: "Ordenar per títol",
      sortYear: "Ordenar per any",
      sortArtist: "Ordenar per artista",
      sortAuthor: "Ordenar per autor",
      sortDirector: "Ordenar per director",
      clear: "Netejar",
      results: "resultats"
    },
    addAlbum: "Afegir disc",
    addMovie: "Afegir pel·lícula/sèrie",
    addBook: "Afegir llibre",
    title: "Títol",
    author: "Autor",
    artists: "Artistes",
    year: "Any",
    genres: "Gèneres",
    styles: "Estils",
    location: "Ubicació",
    format: "Format",
    edition: "Edició",
    packaging: "Embalatge",
    releaseType: "Tipus de publicació",
    formatDetails: "Detalls del format",
    subtitle: "Subtítol",
    publisher: "Editorial",
    isbn: "ISBN",
    additionalInfo: "Informació addicional",
    synopsis: "Sinopsi",
    backCover: "Contraportada",
    description: "Descripció",
    director: "Director",
    cast: "Repartiment",
    type: "Tipus",
    titleAuthor: "Títol / Autor",
    coverUrl: "URL de portada",
    posterUrl: "URL de pòster",
    imageBrowse: "Cercar fitxer",
    imageUrl: "URL d'imatge",
    imagePreview: "Vista prèvia",
    imageSource: "Rutines de manteniment",
    clearImage: "Treure la imatge",
    saveAlbum: "Desar disc",
    saveMovie: "Desar títol",
    saveBook: "Desar llibre",
    noArtist: "Sense artista",
    noGenre: "Sense gènere",
    noCover: "Sense portada",
    noPoster: "Sense pòster",
    noPublisher: "Sense editorial",
    movie: "Pel·lícula",
    series: "Sèrie",
    delete: "Eliminar",
    cancel: "Cancel·lar",
    confirmDelete: "Confirmar eliminació",
    deletePrompt: "Aquesta acció esborrarà l'element de la base de dades.",
    deleteMissing: "L'element no existia a la base de dades. S'ha tret de la vista.",
    actionConfirmed: "Acció confirmada",
    settingsTitle: "Configuració",
    settingsSubtitle: "Mode editor i configuració",
    language: "Language (UI)",
    visibleSections: "Seccions visibles",
    tabOrder: "Ordre de pestanyes",
    showSection: "Mostrar",
    hideSection: "No mostrar",
    yamlTitle: "Configuració",
    saveYaml: "Desar configuració",
    yamlSaved: "Configuració desada correctament.",
    yamlSaveError: "No s'ha pogut desar la configuració.",
    yamlLoadError: "No s'ha pogut carregar la configuració.",
    editorRequired: "Necessites mode editor per a aquesta acció.",
    localizeImages: "Desar imatges en local",
    localizingImages: "Desant imatges...",
    localizeImagesNew: "Imatges noves desades",
    localizeImagesChecked: "Imatges revisades",
    localizeImagesExisting: "Imatges ja existents",
    localizeImagesMigrated: "Rutes reorganitzades",
    localizeImagesRemoved: "Imatges no utilitzades eliminades",
    localizeImagesFailed: "fallides",
    localizeImagesFailedItems: "Imatges que no s'han pogut desar:",
    localizeImagesError: "No s'han pogut desar les imatges.",
    databaseBackupDescription: "Base de dades",
    downloadDatabase: "Descarregar còpia",
    downloadingDatabase: "Preparant còpia...",
    databaseDownloadSuccess: "Còpia descarregada correctament.",
    uploadDatabase: "Restaurar còpia",
    uploadingDatabase: "Restaurant còpia...",
    deleteDatabase: "Esborrar base de dades",
    deletingDatabase: "Esborrant base de dades...",
    databaseDownloadError: "No s'ha pogut crear la còpia de seguretat.",
    databaseUploadError: "No s'ha pogut restaurar la còpia de seguretat.",
    databaseDeleteError: "No s'ha pogut esborrar la base de dades.",
    databaseUploadSuccess: "Base de dades restaurada correctament.",
    databaseDeleteSuccess: "Base de dades i portades locals esborrades correctament.",
    databaseConfirmTitle: "Confirmar operació de base de dades",
    databaseRestoreWarning: "Aquesta acció sobreescriurà tota la base de dades i reemplaçarà les imatges locals actuals.",
    databaseDeleteWarning: "Aquesta acció buidarà tota la base de dades i esborrarà les imatges locals actuals.",
    databaseConfirmInstruction: "Escriu {keyword} per confirmar.",
    databaseConfirmInputLabel: "Confirmació",
    databaseConfirmPlaceholder: "Escriu la paraula de confirmació",
    databaseConfirmButton: "Confirmar operació",
    databaseCancelButton: "Cancel·lar",
    databaseRestoreKeyword: "RESTORE",
    databaseDeleteKeyword: "DELETE",
    detectInconsistencies: "Detectar inconsistències",
    detectingInconsistencies: "Analitzant...",
  inconsistenciesTitle: "Inconsistències",
    inconsistencyFilterKind: "Col·lecció",
    inconsistencyFilterAllKinds: "Totes",
    inconsistencyFilterMusic: "Discos",
    inconsistencyFilterBooks: "Llibres",
    inconsistencyFilterSeverity: "Severitat",
    inconsistencyFilterAllSeverities: "Totes",
    inconsistencyFilterError: "Errors",
    inconsistencyFilterWarning: "Avisos",
    inconsistencyFilterInfo: "Informació",
    inconsistencyFilterSearch: "Cercar en incidències...",
    inconsistencyFilterClear: "Netejar filtres",
    inconsistencyDownload: "Descarregar llistat",
    inconsistencyFilterNoResults: "Cap incidència coincideix amb els filtres.",
    inconsistenciesClean: "No s'han trobat inconsistències.",
    inconsistenciesError: "No s'han pogut detectar inconsistències.",
    openFile: "Anar al fitxer",
    fileOpened: "Fitxer obert.",
    fileOpenError: "No s'ha pogut obrir el fitxer.",
    saveChanges: "Desar canvis",
    changesSaved: "Canvis desats.",
    changesError: "No s'han pogut desar els canvis."
  },
  eng: {
    appSubtitle: "All your favorites, one catalog.",
    menuCatalog: "Catalog",
    menuSettings: "Settings",
    editorMode: "Editor Mode",
    editorOn: "Enabled",
    editorOff: "Disabled",
    close: "Close",
    loading: "Loading...",
    songs: "Tracks",
    addTrack: "Add track",
    noTracks: "No tracks",
    tabs: { music: "Music", movies: "Movies", books: "Books" },
    search: {
      music: "Search music...",
      movies: "Search movies...",
      books: "Search books..."
    },
    external: {
      title: "Import from Discogs",
      queryPlaceholder: "Artist, album, or track",
      search: "Search",
      searching: "Searching...",
      clear: "Clear",
      import: "Import",
      importing: "Importing...",
      noResults: "No results",
      imported: "Record imported",
      exists: "Already in catalog",
      genericError: "Error connecting to Discogs"
    },
    movieExternal: {
      title: "Search TMDB",
      queryPlaceholder: "Title, director, or cast",
      imported: "Title imported",
      genericError: "Error connecting to TMDB"
    },
    bookExternal: {
      title: "Search book",
      titlePlaceholder: "Title",
      authorPlaceholder: "Author",
      isbnPlaceholder: "ISBN",
      imported: "Book imported",
      genericError: "Error searching books"
    },
    addTitle: {
      music: "Add Music",
      movies: "Add Movie",
      books: "Add Book"
    },
    importSource: {
      externalDb: "From DB",
      manual: "Manual"
    },
    filters: {
      open: "Filters",
      musicPublication: "Release",
      musicContent: "Content",
      moviePhysical: "Physical edition",
      movieContent: "Content",
      collection: "Collection",
      allGenres: "All genres",
      allYears: "All years",
      allStyles: "All styles",
      allFormats: "All formats",
      allReleaseTypes: "All release types",
      allPackaging: "All packaging",
      allEditions: "All editions",
      allLocations: "All locations",
      allTypes: "All types",
      moviesOnly: "Movies",
      seriesOnly: "Series",
      sortTitle: "Sort by title",
      sortYear: "Sort by year",
      sortArtist: "Sort by artist",
      sortAuthor: "Sort by author",
      sortDirector: "Sort by director",
      clear: "Clear",
      results: "results"
    },
    addAlbum: "Add record",
    addMovie: "Add movie/series",
    addBook: "Add book",
    title: "Title",
    author: "Author",
    artists: "Artists",
    year: "Year",
    genres: "Genres",
    styles: "Styles",
    location: "Location",
    format: "Format",
    edition: "Edition",
    packaging: "Packaging",
    releaseType: "Release type",
    formatDetails: "Format details",
    subtitle: "Subtitle",
    publisher: "Publisher",
    isbn: "ISBN",
    additionalInfo: "Additional info",
    synopsis: "Synopsis",
    backCover: "Back cover",
    description: "Description",
    director: "Director",
    cast: "Cast",
    type: "Type",
    titleAuthor: "Title / Author",
    coverUrl: "Cover URL",
    posterUrl: "Poster URL",
    imageBrowse: "Browse file",
    imageUrl: "Image URL",
    imagePreview: "Preview",
    imageSource: "Maintenance routines",
    clearImage: "Clear image",
    saveAlbum: "Save record",
    saveMovie: "Save title",
    saveBook: "Save book",
    noArtist: "No artist",
    noGenre: "No genre",
    noCover: "No cover",
    noPoster: "No poster",
    noPublisher: "No publisher",
    movie: "Movie",
    series: "Series",
    delete: "Delete",
    cancel: "Cancel",
    confirmDelete: "Confirm delete",
    deletePrompt: "This action will delete the item from the database.",
    deleteMissing: "Item was not found in the database. Removed from the view.",
    actionConfirmed: "Action confirmed",
    settingsTitle: "Settings",
    settingsSubtitle: "Editor mode and configuration",
    language: "Language (UI)",
    visibleSections: "Visible sections",
    tabOrder: "Tab order",
    showSection: "Show",
    hideSection: "Hide",
    yamlTitle: "Configuration",
    saveYaml: "Save configuration",
    yamlSaved: "Configuration saved successfully.",
    yamlSaveError: "Could not save configuration.",
    yamlLoadError: "Could not load configuration.",
    editorRequired: "Editor mode required for this action.",
    localizeImages: "Save images locally",
    localizingImages: "Saving images...",
    localizeImagesNew: "New images saved",
    localizeImagesChecked: "Images checked",
    localizeImagesExisting: "Images already present",
    localizeImagesMigrated: "Paths reorganized",
    localizeImagesRemoved: "Unused images removed",
    localizeImagesFailed: "failed",
    localizeImagesFailedItems: "Images that could not be saved:",
    localizeImagesError: "Could not save images.",
    databaseBackupDescription: "Databases",
    downloadDatabase: "Download backup",
    downloadingDatabase: "Preparing backup...",
    databaseDownloadSuccess: "Backup downloaded successfully.",
    uploadDatabase: "Restore backup",
    uploadingDatabase: "Restoring backup...",
    deleteDatabase: "Delete database",
    deletingDatabase: "Deleting database...",
    databaseDownloadError: "Could not create the database backup.",
    databaseUploadError: "Could not restore the database backup.",
    databaseDeleteError: "Could not delete the database.",
    databaseUploadSuccess: "Database restored successfully.",
    databaseDeleteSuccess: "Database and local artwork deleted successfully.",
    databaseConfirmTitle: "Confirm database operation",
    databaseRestoreWarning: "This will overwrite the entire database and replace the current local artwork.",
    databaseDeleteWarning: "This will clear the entire database and delete the current local artwork.",
    databaseConfirmInstruction: "Type {keyword} to confirm.",
    databaseConfirmInputLabel: "Confirmation",
    databaseConfirmPlaceholder: "Type the confirmation word",
    databaseConfirmButton: "Confirm operation",
    databaseCancelButton: "Cancel",
    databaseRestoreKeyword: "RESTORE",
    databaseDeleteKeyword: "DELETE",
    detectInconsistencies: "Detect inconsistencies",
    detectingInconsistencies: "Analyzing...",
  inconsistenciesTitle: "Inconsistencies",
    inconsistencyFilterKind: "Collection",
    inconsistencyFilterAllKinds: "All",
    inconsistencyFilterMusic: "Music",
    inconsistencyFilterBooks: "Books",
    inconsistencyFilterSeverity: "Severity",
    inconsistencyFilterAllSeverities: "All",
    inconsistencyFilterError: "Errors",
    inconsistencyFilterWarning: "Warnings",
    inconsistencyFilterInfo: "Info",
    inconsistencyFilterSearch: "Search issues...",
    inconsistencyFilterClear: "Clear filters",
    inconsistencyDownload: "Download list",
    inconsistencyFilterNoResults: "No issues match the selected filters.",
    inconsistenciesClean: "No inconsistencies found.",
    inconsistenciesError: "Could not detect inconsistencies.",
    openFile: "Go to file",
    fileOpened: "File opened.",
    fileOpenError: "Could not open file.",
    saveChanges: "Save changes",
    changesSaved: "Changes saved.",
    changesError: "Could not save changes."
  }
} as const;

export function CatalogApp({ initialMusic, initialMovies, initialBooks }: Props) {
  const [isBooting, setIsBooting] = useState(true);
  const [initialTabImagesReady, setInitialTabImagesReady] = useState(false);
  const [tabImagesLoading, setTabImagesLoading] = useState(false);
  const [bootDelayElapsed, setBootDelayElapsed] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [area, setArea] = useState<Area>("catalog");
  const [tab, setTab] = useState<Tab>("music");
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [sectionVisibilityReady, setSectionVisibilityReady] = useState(false);
  const [sectionVisibility, setSectionVisibility] = useState<SectionVisibility>(DEFAULT_SECTION_VISIBILITY);
  const [tabOrder, setTabOrder] = useState<Tab[]>(DEFAULT_TAB_ORDER);
  const [lang, setLang] = useState<Lang>("eng");
  const [query, setQuery] = useState("");
  const [genreFilter, setGenreFilter] = useState<string[]>([]);
  const [yearFilter, setYearFilter] = useState<string[]>([]);
  const [styleFilter, setStyleFilter] = useState<string[]>([]);
  const [musicFormatFilter, setMusicFormatFilter] = useState<string[]>([]);
  const [musicTypeFilter, setMusicTypeFilter] = useState<string[]>([]);
  const [musicPackagingFilter, setMusicPackagingFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [movieFormatFilter, setMovieFormatFilter] = useState<string[]>([]);
  const [movieEditionFilter, setMovieEditionFilter] = useState<string[]>([]);
  const [moviePackagingFilter, setMoviePackagingFilter] = useState<string[]>([]);
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("year");
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [detailsImageLoading, setDetailsImageLoading] = useState(false);
  const [manualCreateKind, setManualCreateKind] = useState<EditableKind | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [actionNotice, setActionNotice] = useState<ActionNotice>(null);
  const [musicEditForm, setMusicEditForm] = useState<MusicEditForm | null>(null);
  const [movieEditForm, setMovieEditForm] = useState<MovieEditForm | null>(null);
  const [bookEditForm, setBookEditForm] = useState<BookEditForm | null>(null);
  const [itemStatus, setItemStatus] = useState<string | null>(null);

  const [editorMode, setEditorMode] = useState(false);

  const [music, setMusic] = useState<MusicItem[]>(initialMusic);
  const [movies, setMovies] = useState<MovieItem[]>(initialMovies);
  const [books, setBooks] = useState<BookItem[]>(initialBooks);

  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [, setSettingsStatus] = useState<string | null>(null);
  const [imageLocalizing, setImageLocalizing] = useState(false);
  const [databaseLoading, setDatabaseLoading] = useState(false);
  const [databaseOperation, setDatabaseOperation] = useState<DatabaseOperation>(null);
  const [pendingDatabaseAction, setPendingDatabaseAction] = useState<PendingDatabaseAction>(null);
  const [databaseConfirmation, setDatabaseConfirmation] = useState("");
  const [inconsistencyLoading, setInconsistencyLoading] = useState(false);
  const [inconsistencyReport, setInconsistencyReport] = useState<InconsistencyReport | null>(null);
  const [inconsistencyKindFilter, setInconsistencyKindFilter] = useState<InconsistencyKindFilter>("all");
  const [inconsistencySeverityFilter, setInconsistencySeverityFilter] = useState<InconsistencySeverityFilter>("all");
  const [inconsistencySearch, setInconsistencySearch] = useState("");

  const [externalQuery, setExternalQuery] = useState("");
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalImportingId, setExternalImportingId] = useState<number | null>(null);
  const [externalResults, setExternalResults] = useState<DiscogsSearchItem[]>([]);
  const [externalMessage, setExternalMessage] = useState<string | null>(null);
  const [movieExternalQuery, setMovieExternalQuery] = useState("");
  const [movieExternalLoading, setMovieExternalLoading] = useState(false);
  const [movieExternalImportingId, setMovieExternalImportingId] = useState<number | null>(null);
  const [movieExternalResults, setMovieExternalResults] = useState<TmdbSearchItem[]>([]);
  const [movieExternalMessage, setMovieExternalMessage] = useState<string | null>(null);

  const [bookLookupMode, setBookLookupMode] = useState<BookLookupMode>("title");
  const [bookTitleQuery, setBookTitleQuery] = useState("");
  const [bookAuthorQuery, setBookAuthorQuery] = useState("");
  const [bookIsbnQuery, setBookIsbnQuery] = useState("");
  const [bookLookupLoading, setBookLookupLoading] = useState(false);
  const [bookImportingId, setBookImportingId] = useState<string | null>(null);
  const [bookSearchResults, setBookSearchResults] = useState<BookSearchResult[]>([]);
  const [bookLookupMessage, setBookLookupMessage] = useState<string | null>(null);
  const [visibleItems, setVisibleItems] = useState<Record<Tab, number>>(INITIAL_VISIBLE_ITEMS);
  const [scrollBatchLoading, setScrollBatchLoading] = useState(false);
  const catalogPanelRef = useRef<HTMLElement | null>(null);
  const catalogScrollSentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollBatchRequestRef = useRef(0);
  const scrollBatchLoadingRef = useRef(false);
  const detailsLoadRequestRef = useRef(0);
  const tabLoadingStartedAt = useRef(0);

  const t = TEXT[lang];
  const canEdit = editorMode;
  const filteredInconsistencyIssues = useMemo(() => {
    if (!inconsistencyReport) {
      return [];
    }

    const search = inconsistencySearch.trim().toLocaleLowerCase();
    return inconsistencyReport.issues.filter((issue) => {
      const matchesKind = inconsistencyKindFilter === "all" || issue.kind === inconsistencyKindFilter;
      const matchesSeverity = inconsistencySeverityFilter === "all" || issue.severity === inconsistencySeverityFilter;
      const haystack = [issue.kind, issue.itemId, issue.itemLabel, issue.message, issue.file]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return matchesKind && matchesSeverity && (!search || haystack.includes(search));
    });
  }, [inconsistencyKindFilter, inconsistencyReport, inconsistencySearch, inconsistencySeverityFilter]);
  const databaseConfirmationKeyword = pendingDatabaseAction?.kind === "delete" ? t.databaseDeleteKeyword : t.databaseRestoreKeyword;
  const databaseConfirmationMatches = databaseConfirmation.trim().toUpperCase() === databaseConfirmationKeyword;
  const isLoadingModalOpen = !isBooting && Boolean(
    tabImagesLoading
    || detailsImageLoading
    || externalLoading
    || externalImportingId !== null
    || movieExternalLoading
    || movieExternalImportingId !== null
    || bookLookupLoading
    || bookImportingId !== null
    || imageLocalizing
    || databaseLoading
    || inconsistencyLoading
  );
  const visibleTabs = useMemo(() => tabOrder.filter((entry) => sectionVisibility[entry]), [sectionVisibility, tabOrder]);

  function showActionNotice(message: string, details?: string[], stats?: ActionNoticeStat[]) {
    setActionNotice({ title: t.actionConfirmed, message, details, stats });
  }

  function changeTab(nextTab: Tab) {
    if (nextTab === tab) {
      return;
    }

    scrollBatchRequestRef.current += 1;
    scrollBatchLoadingRef.current = false;
    setScrollBatchLoading(false);
    tabLoadingStartedAt.current = Date.now();
    setTabImagesLoading(true);
    setTab(nextTab);
  }

  function openCatalogArea() {
    if (area === "catalog") {
      return;
    }

    tabLoadingStartedAt.current = Date.now();
    setTabImagesLoading(true);
    setArea("catalog");
  }

  function openSettingsArea() {
    setTabImagesLoading(false);
    setArea("settings");
  }

  async function openCatalogDetails(selection: Exclude<SelectedItem, null>) {
    const imageSource = selectedItemImageSource(selection);
    if (!imageSource) {
      setSelectedItem(selection);
      return;
    }

    const requestId = ++detailsLoadRequestRef.current;
    setDetailsImageLoading(true);
    await preloadCatalogImage(imageSource);

    if (detailsLoadRequestRef.current !== requestId) {
      return;
    }

    setSelectedItem(selection);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (detailsLoadRequestRef.current === requestId) {
          setDetailsImageLoading(false);
        }
      });
    });
  }

  function toggleSectionVisibility(targetTab: Tab) {
    setSectionVisibility((current) => {
      const enabledCount = AVAILABLE_TABS.filter((entry) => current[entry]).length;
      if (current[targetTab] && enabledCount === 1) {
        return current;
      }

      return { ...current, [targetTab]: !current[targetTab] };
    });
  }

  function moveTabOrder(targetTab: Tab, direction: -1 | 1) {
    setTabOrder((current) => {
      const currentIndex = current.indexOf(targetTab);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const nextOrder = [...current];
      [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
      return nextOrder;
    });
  }

  function normalizeForSearch(value: string): string {
    return value
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  useEffect(() => {
    const savedLang = window.localStorage.getItem("catalog_lang") as Lang | null;
    const savedEditorMode = window.localStorage.getItem("catalog_editor") === "1";
    const savedSectionVisibility = parseSectionVisibility(window.localStorage.getItem("catalog_visible_sections"));
    const savedTabOrder = parseTabOrder(window.localStorage.getItem("catalog_tab_order"));
    const urlTab = new URLSearchParams(window.location.search).get("tab");

    if (savedLang && (savedLang === "cat" || savedLang === "es" || savedLang === "eng")) {
      setLang(savedLang);
    }

    setSectionVisibility(savedSectionVisibility);
    setTabOrder(savedTabOrder);

    if (isTab(urlTab) && savedSectionVisibility[urlTab]) {
      setTab(urlTab);
    } else {
      setTab(savedTabOrder.find((entry) => savedSectionVisibility[entry]) ?? "music");
    }

    setEditorMode(savedEditorMode);
    setSectionVisibilityReady(true);
    setUrlStateReady(true);
  }, []);

  useEffect(() => {
    if (!urlStateReady) {
      return;
    }

    if (!sectionVisibility[tab]) {
      const nextTab = visibleTabs[0];
      if (nextTab) {
        setTab(nextTab);
      }
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [sectionVisibility, tab, urlStateReady, visibleTabs]);

  useEffect(() => {
    window.localStorage.setItem("catalog_lang", lang);
  }, [lang]);

  useEffect(() => {
    window.localStorage.setItem("catalog_editor", editorMode ? "1" : "0");
  }, [editorMode]);

  useEffect(() => {
    if (!sectionVisibilityReady) {
      return;
    }

    window.localStorage.setItem("catalog_visible_sections", JSON.stringify(sectionVisibility));
  }, [sectionVisibility, sectionVisibilityReady]);

  useEffect(() => {
    if (!sectionVisibilityReady) {
      return;
    }

    window.localStorage.setItem("catalog_tab_order", JSON.stringify(tabOrder));
  }, [sectionVisibilityReady, tabOrder]);

  useEffect(() => {
    if (!selectedItem) {
      setMusicEditForm(null);
      setMovieEditForm(null);
      setBookEditForm(null);
      setItemStatus(null);
      return;
    }

    setItemStatus(null);
    if (selectedItem.kind === "music") {
      setMusicEditForm(musicToEditForm(selectedItem.item));
      setMovieEditForm(null);
      setBookEditForm(null);
    } else if (selectedItem.kind === "movies") {
      setMovieEditForm(movieToEditForm(selectedItem.item));
      setMusicEditForm(null);
      setBookEditForm(null);
    } else {
      setMusicEditForm(null);
      setMovieEditForm(null);
      setBookEditForm(bookToEditForm(selectedItem.item));
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDetails();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedItem]);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/settings");
      if (!response.ok) {
        setSettingsStatus(t.yamlLoadError);
        return;
      }

      const payload = await response.json();
      setSettings({
        tmdbApiKey: payload.tmdb?.api_key ?? "",
        tmdbBaseUrl: payload.tmdb?.base_url ?? "",
        discogsToken: payload.discogs?.token ?? "",
        discogsBaseUrl: payload.discogs?.base_url ?? "",
        googleBooksApiKey: payload.google_books?.api_key ?? "",
        googleBooksBaseUrl: payload.google_books?.base_url ?? "",
        rawgApiKey: payload.rawg?.api_key ?? "",
        rawgBaseUrl: payload.rawg?.base_url ?? "",
        databasePath: payload.storage?.database_path ?? ""
      });
      setSettingsStatus(null);
    } catch {
      setSettingsStatus(t.yamlLoadError);
    }
  }, [t.yamlLoadError]);

  useEffect(() => {
    void fetchSettings().finally(() => {
      setSettingsLoaded(true);
    });
  }, [fetchSettings]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBootDelayElapsed(true);
    }, 700);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (bootDelayElapsed && settingsLoaded && initialTabImagesReady) {
      setIsBooting(false);
    }
  }, [bootDelayElapsed, initialTabImagesReady, settingsLoaded]);

  useEffect(() => {
    if (area !== "catalog" || !urlStateReady) {
      return;
    }

    const trackingInitialTab = isBooting;
    if (!trackingInitialTab && !tabImagesLoading) {
      return;
    }

    let cancelled = false;
    let finished = false;
    let paintScheduled = false;
    let frameId = 0;
    let paintFrameId = 0;
    let finishTimerId = 0;
    const imageListeners = new Map<HTMLImageElement, { load: () => void; error: () => void }>();

    const finishImageTracking = () => {
      if (cancelled || finished) {
        return;
      }

      finished = true;
      if (trackingInitialTab) {
        setInitialTabImagesReady(true);
        return;
      }

      const elapsed = Date.now() - tabLoadingStartedAt.current;
      const remaining = Math.max(0, TAB_LOADER_MIN_DURATION_MS - elapsed);
      finishTimerId = window.setTimeout(() => {
        if (!cancelled) {
          setTabImagesLoading(false);
        }
      }, remaining);
    };

    const finishAfterPaint = () => {
      if (cancelled || paintScheduled) {
        return;
      }

      paintScheduled = true;
      frameId = window.requestAnimationFrame(() => {
        paintFrameId = window.requestAnimationFrame(finishImageTracking);
      });
    };

    const waitForTabImages = () => {
      if (cancelled) {
        return;
      }

      const images = Array.from(catalogPanelRef.current?.querySelectorAll("img") ?? []);
      if (!images.length) {
        finishAfterPaint();
        return;
      }

      const pendingImages = new Set(images);

      const settleImage = async (image: HTMLImageElement) => {
        if (image.naturalWidth > 0) {
          await image.decode().catch(() => undefined);
        }

        pendingImages.delete(image);
        if (!pendingImages.size && !cancelled) {
          finishAfterPaint();
        }
      };

      images.forEach((image) => {
        image.loading = "eager";
        if (image.complete) {
          void settleImage(image);
        } else {
          const load = () => void settleImage(image);
          const error = () => void settleImage(image);
          imageListeners.set(image, { load, error });
          image.addEventListener("load", load, { once: true });
          image.addEventListener("error", error, { once: true });
          if (image.complete) {
            void settleImage(image);
          }
        }
      });
    };

    frameId = window.requestAnimationFrame(waitForTabImages);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(paintFrameId);
      window.clearTimeout(finishTimerId);
      imageListeners.forEach(({ load, error }, image) => {
        image.removeEventListener("load", load);
        image.removeEventListener("error", error);
      });
    };
  }, [area, isBooting, tab, tabImagesLoading, urlStateReady]);

  const musicGenres = useMemo(
    () => [...new Set(music.flatMap((item) => item.genres ?? []))].filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [music]
  );
  const musicStyles = useMemo(
    () => [...new Set(music.flatMap((item) => item.styles ?? []))].filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [music]
  );
  const musicFormats = useMemo(
    () => [...new Set([
      ...MUSIC_RELEASE_FORMATS,
      ...music.map((item) => item.release_format || DEFAULT_MUSIC_RELEASE_FORMAT)
    ])].filter(Boolean),
    [music]
  );
  const musicTypes = useMemo(
    () => [...new Set([
      ...MUSIC_RELEASE_TYPES,
      ...music.map((item) => item.type || DEFAULT_MUSIC_RELEASE_TYPE)
    ])].filter(Boolean),
    [music]
  );
  const musicPackagings = useMemo(
    () => [...new Set([
      ...MUSIC_PACKAGING,
      ...music.map((item) => item.packaging || DEFAULT_MUSIC_PACKAGING)
    ])].filter(Boolean),
    [music]
  );
  const musicYears = useMemo(
    () => [...new Set(music.map((item) => String(item.year ?? "")).filter(Boolean))].sort((a, b) => Number(b) - Number(a)),
    [music]
  );
  const musicLocations = useMemo(
    () => uniqueLocations(music),
    [music]
  );

  const movieGenres = useMemo(
    () => [...new Set(movies.flatMap((item) => item.genres ?? []))].filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [movies]
  );
  const movieFormats = useMemo(
    () => [...new Set([
      ...MOVIE_FORMATS,
      ...movies.map((item) => item.format || DEFAULT_MOVIE_FORMAT)
    ])].filter(Boolean),
    [movies]
  );
  const movieEditions = useMemo(
    () => [...new Set([
      ...MOVIE_EDITIONS,
      ...movies.map((item) => item.edition || DEFAULT_MOVIE_EDITION)
    ])].filter(Boolean),
    [movies]
  );
  const moviePackagings = useMemo(
    () => [...new Set([
      ...MOVIE_PACKAGING,
      ...movies.map((item) => item.packaging || DEFAULT_MOVIE_PACKAGING)
    ])].filter(Boolean),
    [movies]
  );
  const movieYears = useMemo(
    () => [...new Set(movies.map((item) => normalizeMovieYear(item)).filter((value) => /^\d{4}$/.test(value)))].sort((a, b) => Number(b) - Number(a)),
    [movies]
  );
  const movieLocations = useMemo(
    () => uniqueLocations(movies),
    [movies]
  );
  const bookYears = useMemo(
    () => [...new Set(books.map((item) => String(item.publicationYear ?? "")).filter(Boolean))].sort((a, b) => Number(b) - Number(a)),
    [books]
  );
  const bookLocations = useMemo(
    () => uniqueLocations(books),
    [books]
  );
  const filteredMusic = useMemo(() => {
    const lowered = normalizeForSearch(query);

    const items = music.filter((item) => {
      const haystack = normalizeForSearch([
        item.title,
        item.location,
        ...(item.artists ?? []),
        ...(item.genres ?? []),
        ...(item.styles ?? []),
        item.release_format,
        item.type,
        item.packaging,
        ...((item.tracklist ?? []).map((track) => track.title ?? "")),
        ...((item.tracklist ?? []).flatMap((track) => track.artists ?? []))
      ]
        .join(" "));
      const matchesText = !lowered || haystack.includes(lowered);
      const matchesGenre = genreFilter.length === 0 || (item.genres ?? []).some((genre) => genreFilter.includes(genre));
      const matchesStyle = styleFilter.length === 0 || (item.styles ?? []).some((style) => styleFilter.includes(style));
      const matchesFormat = hasSelectedValue(musicFormatFilter, item.release_format || DEFAULT_MUSIC_RELEASE_FORMAT);
      const matchesType = hasSelectedValue(musicTypeFilter, item.type || DEFAULT_MUSIC_RELEASE_TYPE);
      const matchesPackaging = hasSelectedValue(musicPackagingFilter, item.packaging || DEFAULT_MUSIC_PACKAGING);
      const matchesYear = hasSelectedValue(yearFilter, String(item.year ?? ""));
      const matchesLocation = hasSelectedLocation(locationFilter, itemLocationForFilter(item));
      return matchesText && matchesGenre && matchesStyle && matchesFormat && matchesType && matchesPackaging && matchesYear && matchesLocation;
    });

    return items.toSorted((a, b) => {
      if (sortMode === "year") {
        return compareYearDesc(a.year, b.year) || compareText(a.title, b.title);
      }

      if (sortMode === "creator") {
        return compareText(firstSortValue(a.artists?.join(", ") || ""), firstSortValue(b.artists?.join(", ") || "")) || compareText(a.title, b.title);
      }

      return compareText(a.title, b.title);
    });
  }, [music, query, genreFilter, styleFilter, musicFormatFilter, musicTypeFilter, musicPackagingFilter, yearFilter, locationFilter, sortMode]);

  const filteredMovies = useMemo(() => {
    const lowered = normalizeForSearch(query);

    const items = movies.filter((item) => {
      const haystack = normalizeForSearch([
        normalizeMovieTitle(item),
        item.location,
        movieDirectorLine(item),
        movieCastLine(item),
        movieFormatLine(item.format),
        item.edition,
        item.packaging,
        item.overview,
        item.media_type,
        ...(item.genres ?? [])
      ].join(" "));
      const matchesText = !lowered || haystack.includes(lowered);
      const matchesGenre = genreFilter.length === 0 || (item.genres ?? []).some((genre) => genreFilter.includes(genre));
      const matchesType = hasSelectedValue(typeFilter, item.media_type ?? "movie");
      const matchesFormat = hasSelectedValue(movieFormatFilter, item.format || DEFAULT_MOVIE_FORMAT);
      const matchesEdition = hasSelectedValue(movieEditionFilter, item.edition || DEFAULT_MOVIE_EDITION);
      const matchesPackaging = hasSelectedValue(moviePackagingFilter, item.packaging || DEFAULT_MOVIE_PACKAGING);
      const matchesYear = hasSelectedValue(yearFilter, normalizeMovieYear(item));
      const matchesLocation = hasSelectedLocation(locationFilter, item.location);
      return matchesText && matchesGenre && matchesType && matchesFormat && matchesEdition && matchesPackaging && matchesYear && matchesLocation;
    });

    return items.toSorted((a, b) => {
      if (sortMode === "year") {
        return compareYearDesc(normalizeMovieYear(a), normalizeMovieYear(b)) || compareText(normalizeMovieTitle(a), normalizeMovieTitle(b));
      }

      if (sortMode === "creator") {
        return compareText(firstSortValue(movieDirectorLine(a)), firstSortValue(movieDirectorLine(b))) || compareText(normalizeMovieTitle(a), normalizeMovieTitle(b));
      }

      return compareText(normalizeMovieTitle(a), normalizeMovieTitle(b));
    });
  }, [movies, query, genreFilter, typeFilter, movieFormatFilter, movieEditionFilter, moviePackagingFilter, yearFilter, locationFilter, sortMode]);

  const filteredBooks = useMemo(() => {
    const lowered = normalizeForSearch(query);

    const items = books.filter((item) => {
      const haystack = normalizeForSearch([
        item.title,
        item.subtitle,
        ...(item.authors ?? []),
        item.publisher,
        item.location,
        item.isbn,
        item.isbn10,
        item.isbn13,
        item.description
      ].join(" "));
      const matchesText = !lowered || haystack.includes(lowered);
      const matchesYear = hasSelectedValue(yearFilter, String(item.publicationYear ?? ""));
      const matchesLocation = hasSelectedLocation(locationFilter, itemLocationForFilter(item));
      return matchesText && matchesYear && matchesLocation;
    });

    return items.toSorted((a, b) => {
      if (sortMode === "year") {
        return compareYearDesc(a.publicationYear, b.publicationYear) || compareText(a.title, b.title);
      }

      if (sortMode === "creator") {
        return compareText(firstSortValue(bookAuthorLine(a)), firstSortValue(bookAuthorLine(b))) || compareText(a.title, b.title);
      }

      return compareText(a.title, b.title);
    });
  }, [books, query, yearFilter, locationFilter, sortMode]);

  const renderedMusic = useMemo(
    () => filteredMusic.slice(0, visibleItems.music),
    [filteredMusic, visibleItems.music]
  );
  const renderedMovies = useMemo(
    () => filteredMovies.slice(0, visibleItems.movies),
    [filteredMovies, visibleItems.movies]
  );
  const renderedBooks = useMemo(
    () => filteredBooks.slice(0, visibleItems.books),
    [filteredBooks, visibleItems.books]
  );
  const renderedItemCount = tab === "music"
    ? renderedMusic.length
    : tab === "movies"
      ? renderedMovies.length
      : renderedBooks.length;
  const totalFilteredItems = tab === "music"
    ? filteredMusic.length
    : tab === "movies"
      ? filteredMovies.length
      : filteredBooks.length;
  const hasMoreCatalogItems = renderedItemCount < totalFilteredItems;

  useEffect(() => {
    scrollBatchRequestRef.current += 1;
    scrollBatchLoadingRef.current = false;
    setScrollBatchLoading(false);
    setVisibleItems({ ...INITIAL_VISIBLE_ITEMS });
  }, [filteredBooks, filteredMovies, filteredMusic]);

  const loadNextCatalogBatch = useCallback(async () => {
    if (scrollBatchLoadingRef.current) {
      return;
    }

    const currentLimit = visibleItems[tab];
    const nextLimit = Math.min(totalFilteredItems, currentLimit + CATALOG_BATCH_SIZE);
    if (nextLimit <= currentLimit) {
      return;
    }

    const imageSources = tab === "music"
      ? filteredMusic.slice(currentLimit, nextLimit).map((item) => item.cover)
      : tab === "movies"
        ? filteredMovies.slice(currentLimit, nextLimit).map((item) => normalizeMoviePoster(item))
        : filteredBooks.slice(currentLimit, nextLimit).map((item) => bookCover(item));
    const uniqueImageSources = [...new Set(imageSources.filter((src): src is string => Boolean(src)))];
    const requestId = ++scrollBatchRequestRef.current;

    scrollBatchLoadingRef.current = true;
    setScrollBatchLoading(true);
    await Promise.all(uniqueImageSources.map((src) => preloadCatalogImage(src)));

    if (scrollBatchRequestRef.current !== requestId) {
      return;
    }

    setVisibleItems((current) => ({
      ...current,
      [tab]: Math.max(current[tab], nextLimit)
    }));
    scrollBatchLoadingRef.current = false;
    setScrollBatchLoading(false);
  }, [filteredBooks, filteredMovies, filteredMusic, tab, totalFilteredItems, visibleItems]);

  useEffect(() => {
    const sentinel = catalogScrollSentinelRef.current;
    if (!sentinel || !hasMoreCatalogItems) {
      return;
    }

    let frameId = 0;
    const checkDistanceToEnd = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const currentSentinel = catalogScrollSentinelRef.current;
        if (currentSentinel && currentSentinel.getBoundingClientRect().top <= window.innerHeight + 900) {
          void loadNextCatalogBatch();
        }
      });
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadNextCatalogBatch();
      }
    }, { rootMargin: "900px 0px" });

    observer.observe(sentinel);
    window.addEventListener("scroll", checkDistanceToEnd, { passive: true });
    window.addEventListener("resize", checkDistanceToEnd);
    checkDistanceToEnd();

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", checkDistanceToEnd);
      window.removeEventListener("resize", checkDistanceToEnd);
      window.cancelAnimationFrame(frameId);
    };
  }, [hasMoreCatalogItems, loadNextCatalogBatch]);

  const visibleCount = tab === "music" ? filteredMusic.length : tab === "movies" ? filteredMovies.length : tab === "books" ? filteredBooks.length : 0;
  const activeFilterCount = tab === "music"
    ? genreFilter.length + styleFilter.length + musicFormatFilter.length + musicTypeFilter.length + musicPackagingFilter.length + yearFilter.length + locationFilter.length
    : tab === "movies"
      ? genreFilter.length + typeFilter.length + movieFormatFilter.length + movieEditionFilter.length + moviePackagingFilter.length + yearFilter.length + locationFilter.length
      : yearFilter.length + locationFilter.length;

  function clearCatalogFilters() {
    setQuery("");
    setGenreFilter([]);
    setYearFilter([]);
    setStyleFilter([]);
    setMusicFormatFilter([]);
    setMusicTypeFilter([]);
    setMusicPackagingFilter([]);
    setTypeFilter([]);
    setMovieFormatFilter([]);
    setMovieEditionFilter([]);
    setMoviePackagingFilter([]);
    setLocationFilter([]);
  }

  function clearExternalSearch() {
    setExternalQuery("");
    setExternalResults([]);
    setExternalMessage(null);
    setExternalLoading(false);
    setExternalImportingId(null);
  }

  function updateMusicTrack(index: number, field: keyof TrackEditForm, value: string) {
    setMusicEditForm((prev) => {
      if (!prev) {
        return prev;
      }

      const nextTracklist = prev.tracklist.map((track, trackIndex) => (
        trackIndex === index ? { ...track, [field]: value } : track
      ));

      return { ...prev, tracklist: nextTracklist };
    });
  }

  async function updateMusicCoverFromFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const dataUrl = await fileToDataUrl(file);
    setMusicEditForm((prev) => (prev ? { ...prev, cover: dataUrl } : prev));
  }

  function addMusicTrack() {
    setMusicEditForm((prev) => {
      if (!prev) {
        return prev;
      }

      return { ...prev, tracklist: [...prev.tracklist, newTrackEditForm()] };
    });
  }

  function removeMusicTrack(index: number) {
    setMusicEditForm((prev) => {
      if (!prev) {
        return prev;
      }

      return { ...prev, tracklist: prev.tracklist.filter((_, trackIndex) => trackIndex !== index) };
    });
  }

  async function updateMoviePosterFromFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const dataUrl = await fileToDataUrl(file);
    setMovieEditForm((prev) => (prev ? { ...prev, poster_full: dataUrl } : prev));
  }

  async function updateBookCoverFromFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const dataUrl = await fileToDataUrl(file);
    setBookEditForm((prev) => (prev ? { ...prev, cover: dataUrl } : prev));
  }

  async function searchExternalMusic() {
    const value = externalQuery.trim();
    if (!value) {
      return;
    }

    setExternalLoading(true);
    setExternalMessage(null);

    try {
      const response = await fetch("/api/external/music/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: value, perPage: 12 })
      });

      const payload = (await response.json().catch(() => ({}))) as { items?: DiscogsSearchItem[]; error?: string };
      if (!response.ok) {
        setExternalResults([]);
        setExternalMessage(payload.error || t.external.genericError);
        return;
      }

      setExternalResults((payload.items ?? []).map((item) => ({ ...item, genres: normalizeMusicGenres(item.genres) })));
      if (!(payload.items ?? []).length) {
        setExternalMessage(t.external.noResults);
      }
    } catch {
      setExternalResults([]);
      setExternalMessage(t.external.genericError);
    } finally {
      setExternalLoading(false);
    }
  }

  async function importExternalMusic(item: DiscogsSearchItem) {
    setExternalImportingId(item.id);
    setExternalMessage(null);

    try {
      const response = await fetch("/api/external/music/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          cover: item.cover,
          format: item.format || DEFAULT_MUSIC_RELEASE_FORMAT,
          type: DEFAULT_MUSIC_RELEASE_TYPE
        })
      });

      const payload = (await response.json().catch(() => ({}))) as {
        item?: MusicItem;
        alreadyExists?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.item) {
        setExternalMessage(payload.error || t.external.genericError);
        return;
      }

      setMusic((current) => {
        const importedItem = withMusicDefaults({ ...payload.item!, genres: normalizeMusicGenres(payload.item!.genres) });
        if (current.some((item) => item.id === importedItem.id)) {
          return current;
        }
        return [importedItem, ...current];
      });
      const message = payload.alreadyExists ? t.external.exists : t.external.imported;
      setExternalMessage(message);
      showActionNotice(message);
    } catch {
      setExternalMessage(t.external.genericError);
    } finally {
      setExternalImportingId(null);
    }
  }

  function clearMovieExternalSearch() {
    setMovieExternalQuery("");
    setMovieExternalResults([]);
    setMovieExternalMessage(null);
  }

  function clearBookLookup() {
    setBookTitleQuery("");
    setBookAuthorQuery("");
    setBookIsbnQuery("");
    setBookSearchResults([]);
    setBookLookupMessage(null);
    setBookLookupLoading(false);
    setBookImportingId(null);
  }

  async function searchExternalMovies() {
    const value = movieExternalQuery.trim();
    if (!value) {
      return;
    }

    setMovieExternalLoading(true);
    setMovieExternalMessage(null);

    try {
      const response = await fetch("/api/external/movies/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: value, perPage: 12 })
      });

      const payload = (await response.json().catch(() => ({}))) as { items?: TmdbSearchItem[]; error?: string };
      if (!response.ok) {
        setMovieExternalResults([]);
        setMovieExternalMessage(payload.error || t.movieExternal.genericError);
        return;
      }

      setMovieExternalResults(payload.items ?? []);
      if (!(payload.items ?? []).length) {
        setMovieExternalMessage(t.external.noResults);
      }
    } catch {
      setMovieExternalResults([]);
      setMovieExternalMessage(t.movieExternal.genericError);
    } finally {
      setMovieExternalLoading(false);
    }
  }

  async function importExternalMovie(item: TmdbSearchItem) {
    setMovieExternalImportingId(item.id);
    setMovieExternalMessage(null);

    try {
      const response = await fetch("/api/external/movies/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, media_type: item.media_type })
      });

      const payload = (await response.json().catch(() => ({}))) as {
        item?: MovieItem;
        error?: string;
      };

      if (!response.ok || !payload.item) {
        setMovieExternalMessage(payload.error || t.movieExternal.genericError);
        return;
      }

      setMovies((current) => [payload.item!, ...current]);
      setMovieExternalMessage(t.movieExternal.imported);
      showActionNotice(t.movieExternal.imported);
    } catch {
      setMovieExternalMessage(t.movieExternal.genericError);
    } finally {
      setMovieExternalImportingId(null);
    }
  }

  async function searchExternalBooks() {
    setBookLookupMessage(null);
    setBookLookupLoading(true);

    try {
      if (bookLookupMode === "isbn") {
        const isbn = bookIsbnQuery.trim();
        if (!isbn) {
          return;
        }

        const response = await fetch(`/api/books/metadata?${new URLSearchParams({ isbn }).toString()}`);
        const payload = (await response.json().catch(() => ({}))) as BookItem & { error?: string };
        if (!response.ok || !payload.title) {
          setBookSearchResults([]);
          setBookLookupMessage(payload.error || t.bookExternal.genericError);
          return;
        }

        setBookSearchResults([{
          id: payload.id,
          title: payload.title,
          subtitle: payload.subtitle,
          authors: payload.authors ?? [],
          publicationYear: payload.publicationYear,
          publisher: payload.publisher,
          isbn10: payload.isbn10,
          isbn13: payload.isbn13,
          coverUrl: bookCover(payload),
          source: payload.source ?? "google-books",
          sourceId: payload.sourceId ?? payload.id
        }]);
        return;
      }

      const title = bookTitleQuery.trim();
      const author = bookAuthorQuery.trim();
      if (!title) {
        return;
      }

      const params = new URLSearchParams({ title, limit: "15" });
      if (author) {
        params.set("author", author);
      }

      const response = await fetch(`/api/books/search?${params.toString()}`);
      const payload = (await response.json().catch(() => ({}))) as { items?: BookSearchResult[]; error?: string };
      if (!response.ok) {
        setBookSearchResults([]);
        setBookLookupMessage(payload.error || t.bookExternal.genericError);
        return;
      }

      setBookSearchResults(payload.items ?? []);
      if (!(payload.items ?? []).length) {
        setBookLookupMessage(t.external.noResults);
      }
    } catch {
      setBookSearchResults([]);
      setBookLookupMessage(t.bookExternal.genericError);
    } finally {
      setBookLookupLoading(false);
    }
  }

  async function importExternalBook(result: BookSearchResult) {
    setBookImportingId(result.id);
    setBookLookupMessage(null);

    try {
      const resolveUrl = result.isbn13 || result.isbn10
        ? `/api/books/metadata?${new URLSearchParams({ isbn: result.isbn13 || result.isbn10 || "" }).toString()}`
        : "/api/books/resolve";
      const response = result.isbn13 || result.isbn10
        ? await fetch(resolveUrl)
        : await fetch(resolveUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result)
        });

      const metadata = (await response.json().catch(() => ({}))) as BookItem & { error?: string };
      if (!response.ok || !metadata.title) {
        setBookLookupMessage(metadata.error || t.bookExternal.genericError);
        return;
      }

      const saveResponse = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata })
      });
      const saved = (await saveResponse.json().catch(() => ({}))) as BookItem & { error?: string };
      if (!saveResponse.ok || !saved.title) {
        setBookLookupMessage(saved.error || t.bookExternal.genericError);
        return;
      }

      setBooks((current) => {
        if (current.some((item) => String(item.id) === String(saved.id))) {
          return current;
        }
        return [saved, ...current];
      });
      setBookLookupMessage(t.bookExternal.imported);
      showActionNotice(t.bookExternal.imported);
    } catch {
      setBookLookupMessage(t.bookExternal.genericError);
    } finally {
      setBookImportingId(null);
    }
  }

  function toggleEditorMode() {
    setEditorMode((current) => !current);
  }

  function openManualItem(kind: EditableKind) {
    if (!canEdit) {
      setSettingsStatus(t.editorRequired);
      return;
    }

    setManualCreateKind(kind);
    if (kind === "music") {
      setSelectedItem({
        kind,
        item: {
          id: -Date.now(),
          title: "",
          artists: [],
          genres: [],
          styles: [],
          tracklist: [],
          release_format: DEFAULT_MUSIC_RELEASE_FORMAT,
          type: DEFAULT_MUSIC_RELEASE_TYPE,
          packaging: DEFAULT_MUSIC_PACKAGING
        }
      });
      return;
    }

    if (kind === "movies") {
      setSelectedItem({
        kind,
        item: {
          id: -Date.now(),
          title: "",
          genres: [],
          media_type: "movie",
          format: DEFAULT_MOVIE_FORMAT,
          edition: DEFAULT_MOVIE_EDITION,
          packaging: DEFAULT_MOVIE_PACKAGING
        }
      });
      return;
    }

    setSelectedItem({
      kind,
      item: {
        id: `manual-${Date.now()}`,
        title: "",
        authors: []
      }
    });
  }

  function requestDelete(kind: "music" | "movies" | "books", item: MusicItem | MovieItem | BookItem) {
    if (!canEdit) {
      setSettingsStatus(t.editorRequired);
      return;
    }

    const rawTitle = kind === "music"
      ? (item as MusicItem).title
      : kind === "movies"
        ? normalizeMovieTitle(item as MovieItem)
        : (item as BookItem).title;
    const title = rawTitle.trim() && !/^\d+$/.test(rawTitle.trim())
      ? rawTitle.trim()
      : `${kind === "music" ? t.tabs.music : kind === "movies" ? t.movie : t.tabs.books} #${item.id}`;

    if (kind === "music") {
      setPendingDelete({ kind, id: (item as MusicItem).id, title });
      return;
    }

    if (kind === "movies") {
      setPendingDelete({ kind, id: (item as MovieItem).id, title });
      return;
    }

    setPendingDelete({ kind, id: (item as BookItem).id, title });
  }

  function removeDeletedItem(kind: "music" | "movies" | "books", id: number | string) {
    if (kind === "music") {
      setMusic((current) => current.filter((item) => item.id !== id));
    } else if (kind === "movies") {
      setMovies((current) => current.filter((item) => item.id !== id));
    } else {
      setBooks((current) => current.filter((item) => String(item.id) !== String(id)));
    }

    if (selectedItem?.kind === kind && String(selectedItem.item.id) === String(id)) {
      setSelectedItem(null);
    }
  }

  async function confirmDeleteItem() {
    if (!pendingDelete) {
      return;
    }

    if (!canEdit) {
      setSettingsStatus(t.editorRequired);
      return;
    }

    const { kind, id } = pendingDelete;
    const response = await fetch(`/api/items/${kind}/${id}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      if (response.status === 404) {
        removeDeletedItem(kind, id);
        setPendingDelete(null);
        setSettingsStatus(t.deleteMissing);
        return;
      }
      setSettingsStatus(t.yamlSaveError);
      return;
    }

    removeDeletedItem(kind, id);
    setPendingDelete(null);
    showActionNotice(t.confirmDelete);
  }

  async function saveMusicChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !selectedItem || selectedItem.kind !== "music" || !musicEditForm) {
      setItemStatus(t.editorRequired);
      return;
    }

    const payload = {
      title: musicEditForm.title.trim(),
      artists: splitCsv(musicEditForm.artists),
      year: musicEditForm.year.trim() ? Number(musicEditForm.year.trim()) : undefined,
      genres: splitMusicGenres(musicEditForm.genres),
      styles: splitCsv(musicEditForm.styles),
      cover: musicEditForm.cover.trim() || undefined,
      release_format: musicEditForm.release_format.trim(),
      type: musicEditForm.type.trim() || DEFAULT_MUSIC_RELEASE_TYPE,
      packaging: musicEditForm.packaging.trim() || DEFAULT_MUSIC_PACKAGING,
      format_details: musicEditForm.format_details.trim(),
      location: normalizeLocation(musicEditForm.location),
      tracklist: musicEditForm.tracklist
        .map((track) => ({
          pos: track.pos.trim(),
          title: track.title.trim(),
          artists: splitCsv(track.artists)
        }))
        .filter((track) => track.pos || track.title || track.artists.length)
    };

    if (!payload.title) {
      setItemStatus(t.changesError);
      return;
    }

    const response = await fetch(manualCreateKind === "music" ? "/api/music" : `/api/items/music/${selectedItem.item.id}`, {
      method: manualCreateKind === "music" ? "POST" : "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      setItemStatus(t.changesError);
      return;
    }

    const item = (await response.json()) as MusicItem;
    setMusic((current) => manualCreateKind === "music" ? [item, ...current] : current.map((entry) => (entry.id === item.id ? item : entry)));
    setSelectedItem({ kind: "music", item });
    setManualCreateKind(null);
    setItemStatus(t.changesSaved);
    showActionNotice(t.changesSaved);
  }

  async function saveMovieChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !selectedItem || selectedItem.kind !== "movies" || !movieEditForm) {
      setItemStatus(t.editorRequired);
      return;
    }

    const year = movieEditForm.year.trim();
    const mediaType = movieEditForm.media_type || "movie";
    const payload = {
      title: mediaType === "movie" ? movieEditForm.title.trim() : undefined,
      name: mediaType === "tv" ? movieEditForm.title.trim() : undefined,
      release_date: mediaType === "movie" && year ? `${year}-01-01` : undefined,
      first_air_date: mediaType === "tv" && year ? `${year}-01-01` : undefined,
      genres: splitCsv(movieEditForm.genres),
      directors: splitCsv(movieEditForm.directors),
      cast: splitCsv(movieEditForm.cast),
      media_type: mediaType,
      poster_full: movieEditForm.poster_full.trim() || undefined,
      poster_path: undefined,
      format: movieEditForm.format.trim(),
      edition: movieEditForm.edition.trim(),
      packaging: movieEditForm.packaging.trim(),
      format_details: movieEditForm.format_details.trim(),
      location: normalizeLocation(movieEditForm.location),
      overview: movieEditForm.overview.trim()
    };

    if (!movieEditForm.title.trim()) {
      setItemStatus(t.changesError);
      return;
    }

    const response = await fetch(manualCreateKind === "movies" ? "/api/movies" : `/api/items/movies/${selectedItem.item.id}`, {
      method: manualCreateKind === "movies" ? "POST" : "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      setItemStatus(t.changesError);
      return;
    }

      const item = withMovieDefaults((await response.json()) as MovieItem);
      setMovies((current) => manualCreateKind === "movies" ? [item, ...current] : current.map((entry) => (entry.id === item.id ? item : entry)));
      setSelectedItem({ kind: "movies", item });
    setManualCreateKind(null);
    setItemStatus(t.changesSaved);
    showActionNotice(t.changesSaved);
  }

  async function saveBookChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !selectedItem || selectedItem.kind !== "books" || !bookEditForm) {
      setItemStatus(t.editorRequired);
      return;
    }

    const payload = {
      title: bookEditForm.title.trim(),
      subtitle: bookEditForm.subtitle.trim(),
      authors: splitCsv(bookEditForm.authors),
      publicationYear: bookEditForm.publicationYear.trim() ? Number(bookEditForm.publicationYear.trim()) : undefined,
      publisher: bookEditForm.publisher.trim(),
      location: normalizeLocation(bookEditForm.location),
      isbn: bookEditForm.isbn.trim(),
      cover: bookEditForm.cover.trim() || undefined,
      additional_info: bookEditForm.additional_info.trim(),
      synopsis: bookEditForm.synopsis.trim(),
      back_cover: bookEditForm.back_cover.trim(),
      description: bookEditForm.description.trim()
    };

    if (!payload.title) {
      setItemStatus(t.changesError);
      return;
    }

    const response = await fetch(manualCreateKind === "books" ? "/api/books" : `/api/items/books/${selectedItem.item.id}`, {
      method: manualCreateKind === "books" ? "POST" : "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      setItemStatus(t.changesError);
      return;
    }

    const item = (await response.json()) as BookItem;
    setBooks((current) => manualCreateKind === "books" ? [item, ...current] : current.map((entry) => (String(entry.id) === String(item.id) ? item : entry)));
    setSelectedItem({ kind: "books", item });
    setManualCreateKind(null);
    setItemStatus(t.changesSaved);
    showActionNotice(t.changesSaved);
  }

  async function saveYamlConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canEdit) {
      setSettingsStatus(t.editorRequired);
      return;
    }

    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tmdb: { api_key: settings.tmdbApiKey, base_url: settings.tmdbBaseUrl },
        discogs: { token: settings.discogsToken, base_url: settings.discogsBaseUrl },
        google_books: { api_key: settings.googleBooksApiKey, base_url: settings.googleBooksBaseUrl },
        rawg: { api_key: settings.rawgApiKey, base_url: settings.rawgBaseUrl },
        storage: {
          database_path: settings.databasePath
        }
      })
    });

    setSettingsStatus(response.ok ? t.yamlSaved : t.yamlSaveError);
    if (response.ok) {
      showActionNotice(t.yamlSaved);
    }
  }

  async function downloadDatabaseBackup() {
    if (!canEdit) {
      setSettingsStatus(t.editorRequired);
      return;
    }

    setDatabaseLoading(true);
    setDatabaseOperation("download");
    setSettingsStatus(t.downloadingDatabase);

    try {
      const response = await fetch("/api/database/backup", { cache: "no-store" });
      if (!response.ok) {
        setSettingsStatus(t.databaseDownloadError);
        return;
      }

      const backup = await response.blob();
      const downloadUrl = window.URL.createObjectURL(backup);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `mycatalog-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      setSettingsStatus(t.databaseDownloadSuccess);
    } catch {
      setSettingsStatus(t.databaseDownloadError);
    } finally {
      setDatabaseLoading(false);
      setDatabaseOperation(null);
    }
  }

  function cancelDatabaseAction() {
    if (databaseLoading) {
      return;
    }
    setPendingDatabaseAction(null);
    setDatabaseConfirmation("");
  }

  function requestDeleteDatabase() {
    if (!canEdit) {
      setSettingsStatus(t.editorRequired);
      return;
    }
    setDatabaseConfirmation("");
    setPendingDatabaseAction({ kind: "delete" });
  }

  function restoreDatabaseBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!canEdit) {
      setSettingsStatus(t.editorRequired);
      return;
    }

    setDatabaseConfirmation("");
    setPendingDatabaseAction({ kind: "restore", file });
  }

  async function refreshCatalogAfterDatabaseChange() {
    const responses = await Promise.all([
      fetch("/api/music", { cache: "no-store" }),
      fetch("/api/movies", { cache: "no-store" }),
      fetch("/api/books", { cache: "no-store" })
    ]);
    if (responses.some((catalogResponse) => !catalogResponse.ok)) {
      throw new Error("Could not reload catalogue");
    }

    const [nextMusic, nextMovies, nextBooks] = await Promise.all(
      responses.map((catalogResponse) => catalogResponse.json())
    ) as [MusicItem[], MovieItem[], BookItem[]];
    setMusic(nextMusic.map((item) => withMusicDefaults(item)));
    setMovies(nextMovies);
    setBooks(nextBooks);
  }

  async function confirmDatabaseAction() {
    if (!pendingDatabaseAction || !databaseConfirmationMatches) {
      return;
    }

    const action = pendingDatabaseAction;
    setPendingDatabaseAction(null);
    setDatabaseConfirmation("");

    setDatabaseLoading(true);
    setDatabaseOperation(action.kind);
    setSettingsStatus(action.kind === "delete" ? t.deletingDatabase : t.uploadingDatabase);

    try {
      let response: Response;
      if (action.kind === "delete") {
        response = await fetch("/api/database/backup", { method: "DELETE" });
      } else {
        const formData = new FormData();
        formData.append("file", action.file);
        response = await fetch("/api/database/backup", {
          method: "POST",
          body: formData
        });
      }

      if (!response.ok) {
        setSettingsStatus(action.kind === "delete" ? t.databaseDeleteError : t.databaseUploadError);
        return;
      }

      if (action.kind === "delete") {
        setMusic([]);
        setMovies([]);
        setBooks([]);
        setSelectedItem(null);
        setInconsistencyReport(null);
        setSettingsStatus(t.databaseDeleteSuccess);
        showActionNotice(t.databaseDeleteSuccess);
      } else {
        await refreshCatalogAfterDatabaseChange();
        setSettingsStatus(t.databaseUploadSuccess);
        showActionNotice(t.databaseUploadSuccess);
      }
    } catch {
      setSettingsStatus(action.kind === "delete" ? t.databaseDeleteError : t.databaseUploadError);
    } finally {
      setDatabaseLoading(false);
      setDatabaseOperation(null);
    }
  }

  async function localizeRemoteImages() {
    if (!canEdit) {
      setSettingsStatus(t.editorRequired);
      return;
    }

    setImageLocalizing(true);
    setSettingsStatus(t.localizingImages);

    try {
      const response = await fetch("/api/images/localize", { method: "POST" });

      if (!response.ok) {
        setSettingsStatus(t.localizeImagesError);
        return;
      }

      const payload = (await response.json()) as LocalizeImagesResponse;
      if (payload.music) {
        setMusic(payload.music.map((item) => withMusicDefaults(item)));
      }
      if (payload.movies) {
        setMovies(payload.movies);
      }
      if (payload.books) {
        setBooks(payload.books);
      }

      const stats: ActionNoticeStat[] = [
        { value: String(payload.localized), label: t.localizeImagesNew },
        { value: String(payload.scanned), label: t.localizeImagesChecked },
        { value: String(payload.skipped), label: t.localizeImagesExisting },
        { value: String(payload.migrated), label: t.localizeImagesMigrated },
        { value: String(payload.removed), label: t.localizeImagesRemoved },
      ];
      const failedItems = (payload.failures ?? []).map((failure) => `${failure.label} · ${failure.kind} #${failure.id}`);
      setSettingsStatus(null);
      showActionNotice("", failedItems.length ? failedItems : undefined, stats);
    } catch {
      setSettingsStatus(t.localizeImagesError);
    } finally {
      setImageLocalizing(false);
    }
  }

  async function detectInconsistencies() {
    if (!canEdit) {
      setSettingsStatus(t.editorRequired);
      return;
    }

    setInconsistencyLoading(true);
    setSettingsStatus(t.detectingInconsistencies);

    try {
      const response = await fetch("/api/inconsistencies");
      const payload = (await response.json().catch(() => null)) as InconsistencyReport | null;

      if (!response.ok || !payload) {
        setSettingsStatus(t.inconsistenciesError);
        return;
      }

      setInconsistencyReport(payload);
      setSettingsStatus(payload.issueCount ? `${payload.issueCount} ${t.inconsistenciesTitle.toLowerCase()}` : t.inconsistenciesClean);
    } catch {
      setSettingsStatus(t.inconsistenciesError);
    } finally {
      setInconsistencyLoading(false);
    }
  }

  function downloadInconsistencyList() {
    if (!filteredInconsistencyIssues.length) {
      return;
    }

    const header = ["collection", "severity", "item_id", "item", "message", "file"];
    const rows = filteredInconsistencyIssues.map((issue) => [
      issue.kind,
      issue.severity,
      issue.itemId,
      issue.itemLabel,
      issue.message,
      issue.file
    ]);
    const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}`;
    const blobUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `mycatalog-inconsistencies-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
  }

  function closeDetails() {
    detailsLoadRequestRef.current += 1;
    setDetailsImageLoading(false);
    setManualCreateKind(null);
    setSelectedItem(null);
  }

  function detailsFormId(): string | undefined {
    if (!canEdit || !selectedItem) {
      return undefined;
    }

    if (selectedItem.kind === "music" && musicEditForm) {
      return "music-details-form";
    }

    if (selectedItem.kind === "movies" && movieEditForm) {
      return "movie-details-form";
    }

    if (selectedItem.kind === "books" && bookEditForm) {
      return "book-details-form";
    }

    return undefined;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="topbar-brand-lockup">
            <Image
              className="topbar-brand-icon"
              src="/mycatalog-loading-logo.png"
              alt=""
              width={1254}
              height={1254}
              priority
              unoptimized
            />
            <GlitchText className="topbar-brand" speed={2.4} enableShadows enableOnHover={false}>
              MyCatalog
            </GlitchText>
          </div>
          <p>{t.appSubtitle}</p>
        </div>

        <div className="topbar-actions">
          {area === "catalog" && editorMode ? (
            <span className="editor-mode-badge" role="status">
              {t.editorMode}
            </span>
          ) : null}
          <nav className="menu">
            <button type="button" className={area === "catalog" ? "menu-item active" : "menu-item"} onClick={openCatalogArea}>{t.menuCatalog}</button>
            <button type="button" className={area === "settings" ? "menu-item active" : "menu-item"} onClick={openSettingsArea}>{t.menuSettings}</button>
          </nav>
        </div>
      </header>

      {area === "catalog" ? (
        <section className="panel" ref={catalogPanelRef}>
          <div className="panel-head">
            <div className="library-toolbar">
              <div className="toolbar-row">
                <div className="tab-strip" role="tablist" aria-label="media tabs">
                  {visibleTabs.map((entry) => (
                    <button key={entry} type="button" className={tab === entry ? "mini active" : "mini"} onClick={() => changeTab(entry)}>
                      {t.tabs[entry]}
                    </button>
                  ))}
                </div>

                <span className="result-count">{visibleCount} {t.filters.results}</span>
              </div>

              <div className="toolbar-controls">
                <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search[tab]} />
                <select className="filter-select sort-select" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Sort">
                  <option value="title">{t.filters.sortTitle}</option>
                  <option value="year">{t.filters.sortYear}</option>
                  <option value="creator">{tab === "music" ? t.filters.sortArtist : tab === "books" ? t.filters.sortAuthor : t.filters.sortDirector}</option>
                </select>

                <details className={activeFilterCount ? "filter-drawer has-active" : "filter-drawer"}>
                  <summary className="filter-drawer-toggle">
                    <i className="fa-solid fa-sliders" aria-hidden="true" />
                    <span>{t.filters.open}</span>
                    {activeFilterCount ? <b>{activeFilterCount}</b> : null}
                  </summary>
                  <div className="filter-drawer-menu">
                    {tab === "music" ? (
                      <div className="filter-groups">
                        <FilterGroup title={t.filters.musicPublication}>
                          <MultiFilterDropdown allLabel={t.filters.allFormats} options={musicFormats} values={musicFormatFilter} onChange={setMusicFormatFilter} />
                          <MultiFilterDropdown allLabel={t.filters.allReleaseTypes} options={musicTypes} values={musicTypeFilter} onChange={setMusicTypeFilter} />
                          <MultiFilterDropdown allLabel={t.filters.allPackaging} options={musicPackagings} values={musicPackagingFilter} onChange={setMusicPackagingFilter} />
                        </FilterGroup>
                        <FilterGroup title={t.filters.musicContent}>
                          <MultiFilterDropdown allLabel={t.filters.allGenres} options={musicGenres} values={genreFilter} onChange={setGenreFilter} />
                          <MultiFilterDropdown allLabel={t.filters.allStyles} options={musicStyles} values={styleFilter} onChange={setStyleFilter} />
                        </FilterGroup>
                        <FilterGroup title={t.filters.collection}>
                          <MultiFilterDropdown allLabel={t.filters.allYears} options={musicYears} values={yearFilter} onChange={setYearFilter} />
                          <MultiFilterDropdown allLabel={t.filters.allLocations} options={musicLocations} values={locationFilter} onChange={setLocationFilter} />
                        </FilterGroup>
                      </div>
                    ) : null}

                    {tab === "movies" ? (
                      <div className="filter-groups">
                        <FilterGroup title={t.filters.movieContent}>
                          <MultiFilterDropdown allLabel={t.filters.allGenres} options={movieGenres} values={genreFilter} onChange={setGenreFilter} />
                          <MultiFilterDropdown allLabel={t.filters.allTypes} options={[{ value: "movie", label: t.filters.moviesOnly }, { value: "tv", label: t.filters.seriesOnly }]} values={typeFilter} onChange={setTypeFilter} />
                        </FilterGroup>
                        <FilterGroup title={t.filters.moviePhysical}>
                          <MultiFilterDropdown allLabel={t.filters.allFormats} options={movieFormats} values={movieFormatFilter} onChange={setMovieFormatFilter} />
                          <MultiFilterDropdown allLabel={t.filters.allEditions} options={movieEditions} values={movieEditionFilter} onChange={setMovieEditionFilter} />
                          <MultiFilterDropdown allLabel={t.filters.allPackaging} options={moviePackagings} values={moviePackagingFilter} onChange={setMoviePackagingFilter} />
                        </FilterGroup>
                        <FilterGroup title={t.filters.collection}>
                          <MultiFilterDropdown allLabel={t.filters.allYears} options={movieYears} values={yearFilter} onChange={setYearFilter} />
                          <MultiFilterDropdown allLabel={t.filters.allLocations} options={movieLocations} values={locationFilter} onChange={setLocationFilter} />
                        </FilterGroup>
                      </div>
                    ) : null}

                    {tab === "books" ? (
                      <div className="filter-groups filter-groups-books">
                        <FilterGroup title={t.filters.collection}>
                          <MultiFilterDropdown allLabel={t.filters.allYears} options={bookYears} values={yearFilter} onChange={setYearFilter} />
                          <MultiFilterDropdown allLabel={t.filters.allLocations} options={bookLocations} values={locationFilter} onChange={setLocationFilter} />
                        </FilterGroup>
                      </div>
                    ) : null}

                    <div className="filter-drawer-footer">
                      <span>{visibleCount} {t.filters.results}</span>
                      <button type="button" className="filter-drawer-clear" onClick={clearCatalogFilters} disabled={activeFilterCount === 0 && !query}>
                        <i className="fa-solid fa-filter-circle-xmark" aria-hidden="true" />
                        {t.filters.clear}
                      </button>
                    </div>
                  </div>
                </details>

                <button type="button" className="mini clear-filters icon-button" onClick={clearCatalogFilters} aria-label={t.filters.clear} title={t.filters.clear}>
                  <i className="fa-solid fa-filter-circle-xmark" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {tab === "music" ? (
            <>
              <section className="external-panel">
                <div className="external-head">
                  <h3>{t.addTitle.music}</h3>
                  {canEdit ? (
                    <div className="import-source-actions">
                      <button type="button" className="mini active">{t.importSource.externalDb}</button>
                      <button type="button" className="mini" onClick={() => openManualItem("music")}>{t.importSource.manual}</button>
                    </div>
                  ) : null}
                </div>
                <div className="external-controls">
                  <input
                    className="search"
                    placeholder={t.external.queryPlaceholder}
                    value={externalQuery}
                    onChange={(event) => setExternalQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void searchExternalMusic();
                      }
                    }}
                  />
                  <div className="external-actions">
                    <button type="button" className="primary icon-button" onClick={() => void searchExternalMusic()} disabled={externalLoading} aria-label={externalLoading ? t.external.searching : t.external.search} title={externalLoading ? t.external.searching : t.external.search}>
                      <i className={externalLoading ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-magnifying-glass"} aria-hidden="true" />
                    </button>
                    <button type="button" className="mini clear-external icon-button" onClick={clearExternalSearch} aria-label={t.external.clear} title={t.external.clear}>
                      <i className="fa-solid fa-eraser" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {externalMessage ? <p className="external-message">{externalMessage}</p> : null}

                {externalResults.length ? (
                  <div className="external-results">
                    {externalResults.map((item, index) => (
                      <article className="external-result" key={`discogs-${item.id}-${index}`}>
                        <div className="external-thumb-wrap">
                          {item.cover ? (
                            <Image src={item.cover} alt={item.title} fill sizes="120px" className="external-thumb" loading="eager" unoptimized />
                          ) : (
                            <div className="fallback">{t.noCover}</div>
                          )}
                        </div>
                        <div className="external-meta">
                          <h4>{item.title}</h4>
                          <p className="external-summary">
                            {[item.year, item.country, item.format].filter(Boolean).join(" · ") || "-"}
                          </p>
                          <div className="external-tags">
                            {(item.genres ?? []).slice(0, 3).map((genre) => (
                              <span className="external-tag" key={`${item.id}-genre-${genre}`}>
                                {genre}
                              </span>
                            ))}
                            {(item.styles ?? []).slice(0, 3).map((style) => (
                              <span className="external-tag" key={`${item.id}-style-${style}`}>
                                {style}
                              </span>
                            ))}
                            {!((item.genres ?? []).length || (item.styles ?? []).length) ? (
                              <span className="external-tag external-tag-muted">{t.noGenre}</span>
                            ) : null}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="primary icon-button"
                          onClick={() => void importExternalMusic(item)}
                          disabled={externalImportingId === item.id}
                          aria-label={externalImportingId === item.id ? t.external.importing : t.external.import}
                          title={externalImportingId === item.id ? t.external.importing : t.external.import}
                        >
                          <i className={externalImportingId === item.id ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-file-import"} aria-hidden="true" />
                        </button>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>
              <section className="albums-grid">
                {renderedMusic.map((item, index) => (
                  <article className="album-card" key={`music-${item.id}-${index}`}>
                    <div className="album-cover-wrap">
                      <button type="button" className="cover-trigger" onClick={() => void openCatalogDetails({ kind: "music", item })}>
                        {item.cover ? (
                          <Image src={item.cover} alt={item.title} fill sizes="320px" className="album-cover" loading="eager" unoptimized />
                        ) : (
                          <div className="fallback">{t.noCover}</div>
                        )}
                      </button>
                    </div>
                    <div className="album-meta">
                      <h3 className="album-title" title={item.title}>{item.title}</h3>
                      <p className="card-line" title={item.artists?.join(", ") || t.noArtist}>{item.artists?.join(", ") || t.noArtist}</p>
                      <p className="card-line" title={String(item.year ?? "-")}>{item.year ?? "-"}</p>
                      {canEdit ? (
                        <button type="button" className="danger icon-button" onClick={() => requestDelete("music", item)} aria-label={t.delete} title={t.delete}>
                          <i className="fa-solid fa-trash" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </section>
            </>
          ) : null}

          {tab === "movies" ? (
            <>
              <section className="external-panel">
                <div className="external-head">
                  <h3>{t.addTitle.movies}</h3>
                  {canEdit ? (
                    <div className="import-source-actions">
                      <button type="button" className="mini active">{t.importSource.externalDb}</button>
                      <button type="button" className="mini" onClick={() => openManualItem("movies")}>{t.importSource.manual}</button>
                    </div>
                  ) : null}
                </div>
                <div className="external-controls">
                  <input
                    className="search"
                    placeholder={t.movieExternal.queryPlaceholder}
                    value={movieExternalQuery}
                    onChange={(event) => setMovieExternalQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void searchExternalMovies();
                      }
                    }}
                  />
                  <div className="external-actions">
                    <button type="button" className="primary icon-button" onClick={() => void searchExternalMovies()} disabled={movieExternalLoading} aria-label={movieExternalLoading ? t.external.searching : t.external.search} title={movieExternalLoading ? t.external.searching : t.external.search}>
                      <i className={movieExternalLoading ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-magnifying-glass"} aria-hidden="true" />
                    </button>
                    <button type="button" className="mini clear-external icon-button" onClick={clearMovieExternalSearch} aria-label={t.external.clear} title={t.external.clear}>
                      <i className="fa-solid fa-eraser" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {movieExternalMessage ? <p className="external-message">{movieExternalMessage}</p> : null}

                {movieExternalResults.length ? (
                  <div className="external-results">
                    {movieExternalResults.map((item) => (
                      <article className="external-result" key={`${item.media_type}-${item.id}`}>
                        <div className="external-thumb-wrap poster">
                          {item.poster ? (
                            <Image src={item.poster} alt={item.title} fill sizes="120px" className="external-thumb" loading="eager" unoptimized />
                          ) : (
                            <div className="fallback">{t.noPoster}</div>
                          )}
                        </div>
                        <div className="external-meta">
                          <h4>{item.title}</h4>
                          <p className="external-summary">
                            {[item.year, item.media_type === "tv" ? t.series : t.movie].filter(Boolean).join(" · ") || "-"}
                          </p>
                          {item.overview ? <p className="external-overview">{item.overview}</p> : null}
                        </div>
                        <button
                          type="button"
                          className="primary icon-button"
                          onClick={() => void importExternalMovie(item)}
                          disabled={movieExternalImportingId === item.id}
                          aria-label={movieExternalImportingId === item.id ? t.external.importing : t.external.import}
                          title={movieExternalImportingId === item.id ? t.external.importing : t.external.import}
                        >
                          <i className={movieExternalImportingId === item.id ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-file-import"} aria-hidden="true" />
                        </button>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>
              <section className="movies-grid">
                {renderedMovies.map((item, index) => {
                  const title = normalizeMovieTitle(item);
                  const poster = normalizeMoviePoster(item);
                  return (
                    <article className="movie-card" key={`movie-${item.id}-${index}`}>
                      <div className="movie-poster-wrap">
                        {poster ? (
                          <button type="button" className="cover-trigger" onClick={() => void openCatalogDetails({ kind: "movies", item })}>
                            <Image src={poster} alt={title} fill sizes="260px" className="movie-poster" loading="eager" unoptimized />
                          </button>
                        ) : (
                          <div className="fallback">{t.noPoster}</div>
                        )}
                      </div>

                      <div className="movie-meta">
                        <h3 className="card-line" title={title}>{title}</h3>
                        <p className="card-line" title={movieDirectorLine(item)}>{movieDirectorLine(item)}</p>
                        <p className="card-line" title={normalizeMovieYear(item)}>{normalizeMovieYear(item)}</p>
                        {canEdit ? (
                          <button type="button" className="danger icon-button" onClick={() => requestDelete("movies", item)} aria-label={t.delete} title={t.delete}>
                            <i className="fa-solid fa-trash" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </section>
            </>
          ) : null}

          {tab === "books" ? (
            <>
              <section className="external-panel">
                <div className="external-head">
                  <h3>{t.addTitle.books}</h3>
                  {canEdit ? (
                    <div className="import-source-actions">
                      <button type="button" className="mini active">{t.importSource.externalDb}</button>
                      <button type="button" className="mini" onClick={() => openManualItem("books")}>{t.importSource.manual}</button>
                    </div>
                  ) : null}
                </div>
                <div className={bookLookupMode === "isbn" ? "external-controls book-controls book-controls-isbn" : "external-controls book-controls"}>
                  <div className="book-mode-switch" role="tablist" aria-label="book lookup modes">
                    <button type="button" className={bookLookupMode === "title" ? "mini active" : "mini"} onClick={() => setBookLookupMode("title")}>{t.titleAuthor}</button>
                    <button type="button" className={bookLookupMode === "isbn" ? "mini active" : "mini"} onClick={() => setBookLookupMode("isbn")}>{t.isbn}</button>
                  </div>
                  {bookLookupMode === "title" ? (
                    <>
                      <input
                        className="search"
                        placeholder={t.bookExternal.titlePlaceholder}
                        value={bookTitleQuery}
                        onChange={(event) => setBookTitleQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void searchExternalBooks();
                          }
                        }}
                      />
                      <input
                        className="search"
                        placeholder={t.bookExternal.authorPlaceholder}
                        value={bookAuthorQuery}
                        onChange={(event) => setBookAuthorQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void searchExternalBooks();
                          }
                        }}
                      />
                    </>
                  ) : (
                    <input
                      className="search"
                      placeholder={t.bookExternal.isbnPlaceholder}
                      value={bookIsbnQuery}
                      onChange={(event) => setBookIsbnQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void searchExternalBooks();
                        }
                      }}
                    />
                  )}
                  <div className="external-actions">
                    <button type="button" className="primary icon-button" onClick={() => void searchExternalBooks()} disabled={bookLookupLoading} aria-label={bookLookupLoading ? t.external.searching : t.external.search} title={bookLookupLoading ? t.external.searching : t.external.search}>
                      <i className={bookLookupLoading ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-magnifying-glass"} aria-hidden="true" />
                    </button>
                    <button type="button" className="mini clear-external icon-button" onClick={clearBookLookup} aria-label={t.external.clear} title={t.external.clear}>
                      <i className="fa-solid fa-eraser" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {bookLookupMessage ? <p className="external-message">{bookLookupMessage}</p> : null}

                {bookSearchResults.length ? (
                  <div className="external-results">
                    {bookSearchResults.map((item, index) => {
                      const cover = bookCover(item);
                      const isbn = bookIsbn(item);
                      return (
                        <article className="external-result book-result" key={`book-search-${item.id}-${index}`}>
                          <div className="external-thumb-wrap book-thumb">
                            {cover ? (
                              <Image src={cover} alt={item.title} fill sizes="100px" className="external-thumb" loading="eager" unoptimized />
                            ) : (
                              <div className="fallback">{t.noCover}</div>
                            )}
                          </div>
                          <div className="external-meta">
                            <h4>{item.title}</h4>
                            <p className="external-summary">{bookAuthorLine(item)}</p>
                            <p className="external-summary">{[item.publisher, bookYear(item)].filter((value) => value && value !== "-").join(" · ") || "-"}</p>
                            {isbn ? <p className="external-summary">ISBN {isbn}</p> : null}
                          </div>
                          <button
                            type="button"
                            className="primary icon-button"
                            onClick={() => void importExternalBook(item)}
                            disabled={bookImportingId === item.id}
                            aria-label={bookImportingId === item.id ? t.external.importing : t.external.import}
                            title={bookImportingId === item.id ? t.external.importing : t.external.import}
                          >
                            <i className={bookImportingId === item.id ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-file-import"} aria-hidden="true" />
                          </button>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </section>
              <section className="books-grid">
                {renderedBooks.map((item, index) => {
                  const cover = bookCover(item);
                  return (
                    <article className="book-card" key={`book-${item.id}-${index}`}>
                      <div className="book-cover-wrap">
                        {cover ? (
                          <button type="button" className="cover-trigger" onClick={() => void openCatalogDetails({ kind: "books", item })}>
                            <Image src={cover} alt={item.title} fill sizes="220px" className="book-cover" loading="eager" unoptimized />
                          </button>
                        ) : (
                          <button type="button" className="cover-trigger" onClick={() => void openCatalogDetails({ kind: "books", item })}>
                            <div className="fallback">{t.noCover}</div>
                          </button>
                        )}
                      </div>
                      <div className="book-meta">
                        <h3 className="card-line" title={item.title}>{item.title}</h3>
                        <p className="card-line" title={bookAuthorLine(item)}>{bookAuthorLine(item)}</p>
                        <p className="card-line" title={bookYear(item)}>{bookYear(item)}</p>
                        {canEdit ? (
                          <button type="button" className="danger icon-button" onClick={() => requestDelete("books", item)} aria-label={t.delete} title={t.delete}>
                            <i className="fa-solid fa-trash" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </section>
            </>
          ) : null}

          {hasMoreCatalogItems ? (
            <div
              ref={catalogScrollSentinelRef}
              className={scrollBatchLoading ? "catalog-scroll-sentinel is-loading" : "catalog-scroll-sentinel"}
              role="status"
              aria-live="polite"
            >
              {scrollBatchLoading ? t.loading : null}
            </div>
          ) : null}

        </section>
      ) : null}

      {area === "settings" ? (
        <section className="panel settings-panel">
          <h2>{t.settingsTitle}</h2>
          <p>{t.settingsSubtitle}</p>

          <div className="prefs-grid">
            <div className="pref-card">
              <h3>{t.editorMode}</h3>
              <label className="switch-control">
                <input type="checkbox" checked={editorMode} onChange={toggleEditorMode} />
                <span className="switch-track">
                  <span className="switch-label">{editorMode ? t.editorOn : t.editorOff}</span>
                  <span className="switch-thumb" />
                </span>
              </label>
            </div>

            <div className="pref-card">
              <h3>{t.language}</h3>
              <div className="segmented-control" role="tablist" aria-label="language tabs">
                <button type="button" className={lang === "eng" ? "active" : ""} onClick={() => setLang("eng")} disabled={!editorMode}>EN-US</button>
                <button type="button" className={lang === "es" ? "active" : ""} onClick={() => setLang("es")} disabled={!editorMode}>ES</button>
                <button type="button" className={lang === "cat" ? "active" : ""} onClick={() => setLang("cat")} disabled={!editorMode}>CAT</button>
              </div>
            </div>

            <div className="pref-card pref-card-wide">
              <h3>{t.visibleSections}</h3>
              <div className="visibility-grid">
                {tabOrder.map((entry) => (
                  <div key={entry} className="visibility-toggle">
                    <span>{t.tabs[entry]}</span>
                    <label className="switch-control visibility-switch">
                      <input type="checkbox" checked={sectionVisibility[entry]} onChange={() => toggleSectionVisibility(entry)} disabled={!editorMode} />
                      <span className="switch-track">
                        <span className="switch-label">{sectionVisibility[entry] ? t.showSection : t.hideSection}</span>
                        <span className="switch-thumb" />
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="pref-card pref-card-wide">
              <h3>{t.tabOrder}</h3>
              <div className="tab-order-list">
                {tabOrder.map((entry, index) => (
                  <div key={entry} className="tab-order-row">
                    <span>{t.tabs[entry]}</span>
                    <div className="tab-order-actions">
                      <button type="button" className="mini icon-button" onClick={() => moveTabOrder(entry, -1)} disabled={!editorMode || index === 0} aria-label={`Move ${t.tabs[entry]} up`} title={`Move ${t.tabs[entry]} up`}>
                        <i className="fa-solid fa-arrow-up" aria-hidden="true" />
                      </button>
                      <button type="button" className="mini icon-button" onClick={() => moveTabOrder(entry, 1)} disabled={!editorMode || index === tabOrder.length - 1} aria-label={`Move ${t.tabs[entry]} down`} title={`Move ${t.tabs[entry]} down`}>
                        <i className="fa-solid fa-arrow-down" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pref-card pref-card-wide">
              <h3>{t.imageSource}</h3>
              <div className="settings-action-row">
                <button type="button" className="primary settings-save-button" onClick={() => void localizeRemoteImages()} disabled={!editorMode || imageLocalizing}>
                  {imageLocalizing ? t.localizingImages : t.localizeImages}
                </button>
                <button type="button" className="primary settings-save-button" onClick={() => void detectInconsistencies()} disabled={!editorMode || inconsistencyLoading}>
                  {inconsistencyLoading ? t.detectingInconsistencies : t.detectInconsistencies}
                </button>
              </div>

              {inconsistencyReport ? (
                <div className="inconsistency-panel">
                  {inconsistencyReport.issues.length ? (
                    <div className="inconsistency-filters" aria-label={t.inconsistenciesTitle}>
                      <label className="inconsistency-filter-control">
                        <span>{t.inconsistencyFilterKind}</span>
                        <select
                          className="filter-select"
                          value={inconsistencyKindFilter}
                          onChange={(event) => setInconsistencyKindFilter(event.target.value as InconsistencyKindFilter)}
                        >
                          <option value="all">{t.inconsistencyFilterAllKinds}</option>
                          <option value="music">{t.inconsistencyFilterMusic}</option>
                          <option value="books">{t.inconsistencyFilterBooks}</option>
                        </select>
                      </label>
                      <label className="inconsistency-filter-control">
                        <span>{t.inconsistencyFilterSeverity}</span>
                        <select
                          className="filter-select"
                          value={inconsistencySeverityFilter}
                          onChange={(event) => setInconsistencySeverityFilter(event.target.value as InconsistencySeverityFilter)}
                        >
                          <option value="all">{t.inconsistencyFilterAllSeverities}</option>
                          <option value="error">{t.inconsistencyFilterError}</option>
                          <option value="warning">{t.inconsistencyFilterWarning}</option>
                          <option value="info">{t.inconsistencyFilterInfo}</option>
                        </select>
                      </label>
                      <label className="inconsistency-filter-control inconsistency-search-control">
                        <span>{t.inconsistencyFilterSearch}</span>
                        <input
                          className="search"
                          type="search"
                          value={inconsistencySearch}
                          onChange={(event) => setInconsistencySearch(event.target.value)}
                          placeholder={t.inconsistencyFilterSearch}
                        />
                      </label>
                      <div className="inconsistency-filter-actions">
                        <button
                          type="button"
                          className="clear-external"
                          onClick={() => {
                            setInconsistencyKindFilter("all");
                            setInconsistencySeverityFilter("all");
                            setInconsistencySearch("");
                          }}
                          disabled={inconsistencyKindFilter === "all" && inconsistencySeverityFilter === "all" && !inconsistencySearch}
                        >
                          {t.inconsistencyFilterClear}
                        </button>
                        <button
                          type="button"
                          className="primary"
                          onClick={downloadInconsistencyList}
                          disabled={!filteredInconsistencyIssues.length}
                        >
                          {t.inconsistencyDownload}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="inconsistency-summary">
                    <span>{inconsistencyReport.scanned} scanned</span>
                    <span>{filteredInconsistencyIssues.length} / {inconsistencyReport.issueCount} issues</span>
                    <span>{filteredInconsistencyIssues.filter((issue) => issue.severity === "error").length} errors</span>
                    <span>{filteredInconsistencyIssues.filter((issue) => issue.severity === "warning").length} warnings</span>
                  </div>

                  {filteredInconsistencyIssues.length ? (
                    <div className="issue-list">
                      {filteredInconsistencyIssues.map((issue, index) => (
                        <article key={`${issue.kind}-${issue.itemId}-${issue.message}-${index}`} className={`issue-row ${issue.severity}`}>
                          <div className="issue-severity">{issue.severity}</div>
                          <div className="issue-body">
                            <div className="issue-title">{issue.itemLabel || issue.itemId || issue.kind || "-"}</div>
                            <div className="issue-message">{issue.message}</div>
                            <div className="issue-meta">{[issue.kind, issue.itemId ? `ID ${issue.itemId}` : null].filter(Boolean).join(" · ")}</div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : inconsistencyReport.issues.length ? (
                    <p className="inconsistency-clean">{t.inconsistencyFilterNoResults}</p>
                  ) : (
                    <p className="inconsistency-clean">{t.inconsistenciesClean}</p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="pref-card pref-card-wide">
              <h3>{t.databaseBackupDescription}</h3>
              <div className="settings-action-row database-action-row">
                <button
                  type="button"
                  className="primary settings-save-button"
                  onClick={() => void downloadDatabaseBackup()}
                  disabled={!editorMode || databaseLoading}
                >
                  {databaseOperation === "download" ? t.downloadingDatabase : t.downloadDatabase}
                </button>
                <label className={`primary settings-save-button file-button ${!editorMode || databaseLoading ? "is-disabled" : ""}`}>
                  <input
                    type="file"
                    accept=".zip,.sqlite,.sqlite3,application/zip,application/x-zip-compressed,application/x-sqlite3,application/vnd.sqlite3"
                    onChange={(event) => void restoreDatabaseBackup(event)}
                    disabled={!editorMode || databaseLoading}
                  />
                  {databaseOperation === "restore" ? t.uploadingDatabase : t.uploadDatabase}
                </label>
                <button
                  type="button"
                  className="danger settings-save-button database-delete-button"
                  onClick={requestDeleteDatabase}
                  disabled={!editorMode || databaseLoading}
                >
                  {databaseOperation === "delete" ? t.deletingDatabase : t.deleteDatabase}
                </button>
              </div>
            </div>

          </div>

          <form className="yaml-form" onSubmit={saveYamlConfig}>
            <h3>{t.yamlTitle}</h3>

            <div className="yaml-form-row yaml-form-row-single">
              <label>SQLite Database<input value={settings.databasePath} onChange={(event) => setSettings((prev) => ({ ...prev, databasePath: event.target.value }))} disabled={!editorMode} /></label>
            </div>

            <div className="yaml-form-row">
              <label>TMDB API Key<input value={settings.tmdbApiKey} onChange={(event) => setSettings((prev) => ({ ...prev, tmdbApiKey: event.target.value }))} disabled={!editorMode} /></label>
              <label>TMDB Base URL<input value={settings.tmdbBaseUrl} onChange={(event) => setSettings((prev) => ({ ...prev, tmdbBaseUrl: event.target.value }))} disabled={!editorMode} /></label>
            </div>

            <div className="yaml-form-row">
              <label>Discogs Token<input value={settings.discogsToken} onChange={(event) => setSettings((prev) => ({ ...prev, discogsToken: event.target.value }))} disabled={!editorMode} /></label>
              <label>Discogs Base URL<input value={settings.discogsBaseUrl} onChange={(event) => setSettings((prev) => ({ ...prev, discogsBaseUrl: event.target.value }))} disabled={!editorMode} /></label>
            </div>

            <div className="yaml-form-row">
              <label>Google Books API Key<input value={settings.googleBooksApiKey} onChange={(event) => setSettings((prev) => ({ ...prev, googleBooksApiKey: event.target.value }))} disabled={!editorMode} /></label>
              <label>Google Books Base URL<input value={settings.googleBooksBaseUrl} onChange={(event) => setSettings((prev) => ({ ...prev, googleBooksBaseUrl: event.target.value }))} disabled={!editorMode} /></label>
            </div>

            <button type="submit" className="primary settings-save-button" disabled={!editorMode}>
              {t.saveChanges}
            </button>
          </form>

        </section>
      ) : null}

      {pendingDatabaseAction ? (
        <div className="confirm-modal-overlay" onClick={cancelDatabaseAction}>
          <section className="confirm-modal database-confirm-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="database-confirm-title">
            <h2 id="database-confirm-title">{t.databaseConfirmTitle}</h2>
            <div className="database-warning-box">
              <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
              <p>{pendingDatabaseAction.kind === "delete" ? t.databaseDeleteWarning : t.databaseRestoreWarning}</p>
            </div>
            <p>{t.databaseConfirmInstruction.replace("{keyword}", databaseConfirmationKeyword)}</p>
            <label className="database-confirm-label">
              <span>{t.databaseConfirmInputLabel}</span>
              <input
                type="text"
                value={databaseConfirmation}
                onChange={(event) => setDatabaseConfirmation(event.target.value)}
                placeholder={t.databaseConfirmPlaceholder}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="confirm-actions">
              <button type="button" className="mini clear-external" onClick={cancelDatabaseAction} disabled={databaseLoading}>
                {t.databaseCancelButton}
              </button>
              <button
                type="button"
                className={pendingDatabaseAction.kind === "delete" ? "danger settings-save-button database-confirm-button" : "primary settings-save-button database-confirm-button"}
                onClick={() => void confirmDatabaseAction()}
                disabled={!databaseConfirmationMatches || databaseLoading}
              >
                {t.databaseConfirmButton}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {actionNotice ? (
        <div className="confirm-modal-overlay" onClick={() => setActionNotice(null)}>
          <section className="confirm-modal action-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="action-notice-title">
            <div className="action-notice-header">
              <h2 id="action-notice-title">{actionNotice.title}</h2>
            </div>
            {actionNotice.stats?.length ? (
              <div className="action-notice-stats">
                {actionNotice.stats.map((stat) => (
                  <div className="action-notice-stat" key={`${stat.label}-${stat.value}`}>
                    <span className="action-notice-stat-icon" aria-hidden="true">
                      <i className="fa-solid fa-check" />
                    </span>
                    <span className="action-notice-stat-label">{stat.label}</span>
                    <strong className="action-notice-stat-value">{stat.value}</strong>
                  </div>
                ))}
              </div>
            ) : actionNotice.message ? (
              <div className="action-notice-message">
                <p>{actionNotice.message}</p>
              </div>
            ) : null}
            {actionNotice.details?.length ? (
              <div className="action-notice-details">
                <strong>{t.localizeImagesFailedItems}</strong>
                <ul>
                  {actionNotice.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}
                </ul>
              </div>
            ) : null}
            <div className="confirm-actions">
              <button type="button" className="primary action-notice-close" onClick={() => setActionNotice(null)}>
                {t.close}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="confirm-modal-overlay" onClick={() => setPendingDelete(null)}>
          <section className="confirm-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="confirm-delete-title">
            <h2 id="confirm-delete-title">{t.confirmDelete}</h2>
            <p>{t.deletePrompt}</p>
            <strong className="confirm-target">{pendingDelete.title}</strong>
            <div className="confirm-actions">
              <button type="button" className="mini clear-external icon-button" onClick={() => setPendingDelete(null)} aria-label={t.cancel} title={t.cancel}>
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
              <button type="button" className="danger icon-button" onClick={() => void confirmDeleteItem()} aria-label={t.confirmDelete} title={t.confirmDelete}>
                <i className="fa-solid fa-trash" aria-hidden="true" />
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {selectedItem ? (
        <div className="details-modal-overlay" onClick={closeDetails}>
          <section className="details-modal" onClick={(event) => event.stopPropagation()}>
            <div className="details-modal-actions">
              {detailsFormId() ? (
                <button type="submit" form={detailsFormId()} className="primary icon-button save-button" aria-label={t.saveChanges} title={t.saveChanges}>
                  <i className="fa-solid fa-floppy-disk" aria-hidden="true" />
                </button>
              ) : null}
              <button type="button" className="details-close" onClick={closeDetails} aria-label={t.close} title={t.close}>
                <svg viewBox="0 0 320 512" aria-hidden="true" focusable="false">
                  <path d="M310.6 361.4a12 12 0 0 1 0 17l-34.1 34.1a12 12 0 0 1-17 0L160 313.9l-99.5 98.6a12 12 0 0 1-17 0L9.4 378.4a12 12 0 0 1 0-17L107.9 263 9.4 164.5a12 12 0 0 1 0-17l34.1-34.1a12 12 0 0 1 17 0L160 211.1l99.5-98.6a12 12 0 0 1 17 0l34.1 34.1a12 12 0 0 1 0 17L212.1 263l98.5 98.4z" />
                </svg>
              </button>
            </div>

            {selectedItem.kind === "music" ? (
              canEdit && musicEditForm ? (
                <form id="music-details-form" className="details-edit-layout" onSubmit={saveMusicChanges}>
                  <aside className="details-media-panel">
                    <div className="details-cover-wrap">
                      {canPreviewImage(musicEditForm.cover) ? (
                        <Image src={musicEditForm.cover} alt={musicEditForm.title || selectedItem.item.title} fill sizes="360px" className="details-cover" loading="eager" unoptimized />
                      ) : (
                        <div className="fallback">{t.noCover}</div>
                      )}
                    </div>
                    <div className="image-url-row">
                      <label>{t.imageUrl}<input value={musicEditForm.cover} onChange={(event) => setMusicEditForm((prev) => prev ? ({ ...prev, cover: event.target.value }) : prev)} /></label>
                      <div className="image-editor-actions">
                        <label className="file-button icon-button" aria-label={t.imageBrowse} title={t.imageBrowse}>
                          <input type="file" accept="image/*" onChange={(event) => void updateMusicCoverFromFile(event)} />
                          <i className="fa-solid fa-upload" aria-hidden="true" />
                        </label>
                        <button type="button" className="mini clear-external icon-button" onClick={() => setMusicEditForm((prev) => prev ? ({ ...prev, cover: "" }) : prev)} aria-label={t.clearImage} title={t.clearImage}>
                          <i className="fa-solid fa-eraser" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </aside>

                  <div className="details-edit-main">
                    <div className="details-edit-title">
                      <label>{t.title}<input value={musicEditForm.title} onChange={(event) => setMusicEditForm((prev) => prev ? ({ ...prev, title: event.target.value }) : prev)} /></label>
                      <label>{t.artists}<input value={musicEditForm.artists} onChange={(event) => setMusicEditForm((prev) => prev ? ({ ...prev, artists: event.target.value }) : prev)} /></label>
                    </div>

                    <div className="edit-grid music-edit-grid">
                      <label>{t.year}<input value={musicEditForm.year} onChange={(event) => setMusicEditForm((prev) => prev ? ({ ...prev, year: event.target.value }) : prev)} /></label>
                      <label>{t.genres}<input value={musicEditForm.genres} onChange={(event) => setMusicEditForm((prev) => prev ? ({ ...prev, genres: event.target.value }) : prev)} /></label>
                      <label>{t.format}<select value={musicEditForm.release_format} onChange={(event) => setMusicEditForm((prev) => prev ? ({ ...prev, release_format: event.target.value }) : prev)}>
                        {musicSelectOptions(MUSIC_RELEASE_FORMATS, musicEditForm.release_format).map((format) => (
                          <option value={format} key={format}>{format}</option>
                        ))}
                      </select></label>
                      <label>{t.releaseType}<select value={musicEditForm.type} onChange={(event) => setMusicEditForm((prev) => prev ? ({ ...prev, type: event.target.value }) : prev)}>
                        {musicSelectOptions(MUSIC_RELEASE_TYPES, musicEditForm.type).map((type) => (
                          <option value={type} key={type}>{type}</option>
                        ))}
                      </select></label>
                      <label>{t.packaging}<select value={musicEditForm.packaging} onChange={(event) => setMusicEditForm((prev) => prev ? ({ ...prev, packaging: event.target.value }) : prev)}>
                        {musicSelectOptions(MUSIC_PACKAGING, musicEditForm.packaging).map((packaging) => (
                          <option value={packaging} key={packaging}>{packaging}</option>
                        ))}
                      </select></label>
                      <label>{t.formatDetails}<input value={musicEditForm.format_details} onChange={(event) => setMusicEditForm((prev) => prev ? ({ ...prev, format_details: event.target.value }) : prev)} /></label>
                    </div>

                    <section className="edit-section tracklist-editor">
                      <div className="tracklist-editor-head">
                        <h4>{t.songs}</h4>
                        <button type="button" className="mini clear-external icon-button" onClick={addMusicTrack} aria-label={t.addTrack} title={t.addTrack}>
                          <i className="fa-solid fa-plus" aria-hidden="true" />
                        </button>
                      </div>
                      <div className="tracklist-editor-list">
                        {musicEditForm.tracklist.map((track, index) => (
                          <div className="track-edit-row" key={index}>
                            <input className="track-edit-pos" placeholder="#" value={track.pos} onChange={(event) => updateMusicTrack(index, "pos", event.target.value)} />
                            <input className="track-edit-title" placeholder={t.title} value={track.title} onChange={(event) => updateMusicTrack(index, "title", event.target.value)} />
                            <input className="track-edit-artists" placeholder={t.artists} value={track.artists} onChange={(event) => updateMusicTrack(index, "artists", event.target.value)} />
                            <button type="button" className="mini clear-external icon-button" onClick={() => removeMusicTrack(index)} aria-label={t.delete} title={t.delete}>
                              <i className="fa-solid fa-trash" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                        {!musicEditForm.tracklist.length ? <p className="tracklist-editor-empty">{t.noTracks}</p> : null}
                      </div>
                    </section>

                    <div className="edit-grid">
                      <label className="edit-field-wide">{t.styles}<input value={musicEditForm.styles} onChange={(event) => setMusicEditForm((prev) => prev ? ({ ...prev, styles: event.target.value }) : prev)} /></label>
                      <label className="edit-field-wide">{t.location}<input value={musicEditForm.location} onChange={(event) => setMusicEditForm((prev) => prev ? ({ ...prev, location: event.target.value }) : prev)} /></label>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="details-view-layout">
                  <aside className="details-media-panel">
                    <div className="details-cover-wrap">
                      {selectedItem.item.cover ? (
                        <Image src={selectedItem.item.cover} alt={selectedItem.item.title} fill sizes="360px" className="details-cover" loading="eager" unoptimized />
                      ) : (
                        <div className="fallback">{t.noCover}</div>
                      )}
                    </div>
                  </aside>

                  <div className="details-content-panel">
                    <header className="details-title-block">
                      <h2>{selectedItem.item.title}</h2>
                      <p>{selectedItem.item.artists?.join(", ") || t.noArtist}</p>
                    </header>

                    <div className="details-facts details-facts-music">
                      <p><strong>{t.year}</strong><span>{selectedItem.item.year ?? "-"}</span></p>
                      <p><strong>{t.genres}</strong><span>{selectedItem.item.genres?.join(", ") || t.noGenre}</span></p>
                      <p><strong>{t.format}</strong><span>{selectedItem.item.release_format || "-"}</span></p>
                      <p><strong>{t.releaseType}</strong><span>{selectedItem.item.type || DEFAULT_MUSIC_RELEASE_TYPE}</span></p>
                      <p><strong>{t.packaging}</strong><span>{selectedItem.item.packaging || DEFAULT_MUSIC_PACKAGING}</span></p>
                      <p><strong>{t.formatDetails}</strong><span>{selectedItem.item.format_details || "-"}</span></p>
                    </div>

                    <section className="tracklist-block">
                      <h3>{t.songs}</h3>
                      <ul>
                        {selectedItem.item.tracklist?.map((track, index) => (
                          <li key={`${track.pos ?? "track"}-${track.title ?? "untitled"}-${index}`}>
                            <div className="track-main">
                              <span className="track-pos">{formatTrackPos(track.pos, index + 1)}</span>
                              <div className="track-copy">
                                <span className="track-title">{track.title || "-"}</span>
                                <span className="track-credits">
                                  {(track.artists?.length ? track.artists : selectedItem.item.artists || []).join(", ") || "-"}
                                </span>
                              </div>
                            </div>
                          </li>
                        ))}
                        {!selectedItem.item.tracklist?.length ? <li className="track-empty">{t.noTracks}</li> : null}
                      </ul>
                    </section>

                    <div className="details-facts">
                      <p className="fact-wide"><strong>{t.styles}</strong><span>{selectedItem.item.styles?.join(", ") || "-"}</span></p>
                      <p className="fact-wide"><strong>{t.location}</strong><span>{normalizeLocation(selectedItem.item.location) || "-"}</span></p>
                    </div>
                  </div>
                </div>
              )
            ) : selectedItem.kind === "books" ? (
              canEdit && bookEditForm ? (
                <form id="book-details-form" className="details-edit-layout details-edit-layout-book" onSubmit={saveBookChanges}>
                  <aside className="details-media-panel">
                    <div className="details-cover-wrap book">
                      {canPreviewImage(bookEditForm.cover) ? (
                        <Image src={bookEditForm.cover} alt={bookEditForm.title || selectedItem.item.title} fill sizes="320px" className="details-cover book-cover" loading="eager" unoptimized />
                      ) : (
                        <div className="fallback">{t.noCover}</div>
                      )}
                    </div>
                    <div className="image-url-row">
                      <label>{t.imageUrl}<input value={bookEditForm.cover} onChange={(event) => setBookEditForm((prev) => prev ? ({ ...prev, cover: event.target.value }) : prev)} /></label>
                      <div className="image-editor-actions">
                        <label className="file-button icon-button" aria-label={t.imageBrowse} title={t.imageBrowse}>
                          <input type="file" accept="image/*" onChange={(event) => void updateBookCoverFromFile(event)} />
                          <i className="fa-solid fa-folder-open" aria-hidden="true" />
                        </label>
                        <button type="button" className="mini clear-external icon-button" onClick={() => setBookEditForm((prev) => prev ? ({ ...prev, cover: "" }) : prev)} aria-label={t.clearImage} title={t.clearImage}>
                          <i className="fa-solid fa-xmark" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </aside>

                  <div className="details-edit-main">
                    <div className="details-edit-title">
                      <label>{t.title}<input value={bookEditForm.title} onChange={(event) => setBookEditForm((prev) => prev ? ({ ...prev, title: event.target.value }) : prev)} /></label>
                      <label>{t.subtitle}<input value={bookEditForm.subtitle} onChange={(event) => setBookEditForm((prev) => prev ? ({ ...prev, subtitle: event.target.value }) : prev)} /></label>
                    </div>

                    <div className="edit-grid">
                      <label>{t.author}<input value={bookEditForm.authors} onChange={(event) => setBookEditForm((prev) => prev ? ({ ...prev, authors: event.target.value }) : prev)} /></label>
                      <label>{t.year}<input value={bookEditForm.publicationYear} onChange={(event) => setBookEditForm((prev) => prev ? ({ ...prev, publicationYear: event.target.value }) : prev)} /></label>
                      <label>{t.publisher}<input value={bookEditForm.publisher} onChange={(event) => setBookEditForm((prev) => prev ? ({ ...prev, publisher: event.target.value }) : prev)} /></label>
                      <label>{t.isbn}<input value={bookEditForm.isbn} onChange={(event) => setBookEditForm((prev) => prev ? ({ ...prev, isbn: event.target.value }) : prev)} /></label>
                      <label className="edit-field-wide">{t.location}<input value={bookEditForm.location} onChange={(event) => setBookEditForm((prev) => prev ? ({ ...prev, location: event.target.value }) : prev)} /></label>
                      <label className="edit-field-wide">{t.additionalInfo}<textarea value={bookEditForm.additional_info} onChange={(event) => setBookEditForm((prev) => prev ? ({ ...prev, additional_info: event.target.value }) : prev)} /></label>
                      <label className="edit-field-wide">{t.synopsis}<textarea value={bookEditForm.synopsis} onChange={(event) => setBookEditForm((prev) => prev ? ({ ...prev, synopsis: event.target.value }) : prev)} /></label>
                      <label className="edit-field-wide">{t.backCover}<textarea value={bookEditForm.back_cover} onChange={(event) => setBookEditForm((prev) => prev ? ({ ...prev, back_cover: event.target.value }) : prev)} /></label>
                      <label className="edit-field-wide">{t.description}<textarea value={bookEditForm.description} onChange={(event) => setBookEditForm((prev) => prev ? ({ ...prev, description: event.target.value }) : prev)} /></label>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="details-view-layout details-view-layout-book">
                  <aside className="details-media-panel">
                    <div className="details-cover-wrap book">
                      {bookCover(selectedItem.item) ? (
                        <Image src={bookCover(selectedItem.item) as string} alt={selectedItem.item.title} fill sizes="320px" className="details-cover book-cover" loading="eager" unoptimized />
                      ) : (
                        <div className="fallback">{t.noCover}</div>
                      )}
                    </div>
                  </aside>

                  <div className="details-content-panel">
                    <header className="details-title-block">
                      <h2>{selectedItem.item.title}</h2>
                      <p>{bookAuthorLine(selectedItem.item)}</p>
                    </header>

                    <div className="details-facts">
                      <p><strong>{t.year}</strong><span>{bookYear(selectedItem.item)}</span></p>
                      <p><strong>{t.genres}</strong><span>{bookGenreLine(selectedItem.item)}</span></p>
                      <p><strong>{t.publisher}</strong><span>{selectedItem.item.publisher || t.noPublisher}</span></p>
                      <p><strong>{t.isbn}</strong><span>{bookIsbn(selectedItem.item) || "-"}</span></p>
                      {hasText(selectedItem.item.synopsis) ? (
                        <p className="fact-wide"><strong>{t.synopsis}</strong><span>{selectedItem.item.synopsis}</span></p>
                      ) : null}
                      <p className="fact-wide"><strong>{t.additionalInfo}</strong><span>{selectedItem.item.additional_info || "-"}</span></p>
                      <p className="fact-wide"><strong>{t.location}</strong><span>{bookLocationLine(selectedItem.item)}</span></p>
                    </div>
                  </div>
                </div>
              )
            ) : canEdit && movieEditForm ? (
              <form id="movie-details-form" className="details-edit-layout details-edit-layout-poster" onSubmit={saveMovieChanges}>
                <aside className="details-media-panel">
                  <div className="details-cover-wrap poster">
                    {canPreviewImage(movieEditForm.poster_full) ? (
                      <Image src={movieEditForm.poster_full} alt={movieEditForm.title || normalizeMovieTitle(selectedItem.item)} fill sizes="320px" className="details-cover" loading="eager" unoptimized />
                    ) : (
                      <div className="fallback">{t.noPoster}</div>
                    )}
                  </div>
                  <div className="image-url-row">
                    <label>{t.imageUrl}<input value={movieEditForm.poster_full} onChange={(event) => setMovieEditForm((prev) => prev ? ({ ...prev, poster_full: event.target.value }) : prev)} /></label>
                    <div className="image-editor-actions">
                      <label className="file-button icon-button" aria-label={t.imageBrowse} title={t.imageBrowse}>
                        <input type="file" accept="image/*" onChange={(event) => void updateMoviePosterFromFile(event)} />
                        <i className="fa-solid fa-upload" aria-hidden="true" />
                      </label>
                      <button type="button" className="mini clear-external icon-button" onClick={() => setMovieEditForm((prev) => prev ? ({ ...prev, poster_full: "" }) : prev)} aria-label={t.clearImage} title={t.clearImage}>
                        <i className="fa-solid fa-eraser" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </aside>

                  <div className="details-edit-main">
                    <div className="details-edit-title">
                      <label>{t.title}<input value={movieEditForm.title} onChange={(event) => setMovieEditForm((prev) => prev ? ({ ...prev, title: event.target.value }) : prev)} /></label>
                    </div>

                  <div className="edit-grid movie-edit-grid">
                    <label className="edit-field-wide">{t.director}<input value={movieEditForm.directors} onChange={(event) => setMovieEditForm((prev) => prev ? ({ ...prev, directors: event.target.value }) : prev)} /></label>
                    <label className="edit-field-half">{t.year}<input value={movieEditForm.year} onChange={(event) => setMovieEditForm((prev) => prev ? ({ ...prev, year: event.target.value }) : prev)} /></label>
                    <label className="edit-field-half">{t.genres}<input value={movieEditForm.genres} onChange={(event) => setMovieEditForm((prev) => prev ? ({ ...prev, genres: event.target.value }) : prev)} /></label>
                    <label className="edit-field-half">{t.format}<select value={movieEditForm.format} onChange={(event) => setMovieEditForm((prev) => prev ? ({ ...prev, format: event.target.value }) : prev)}>
                      {selectOptionsWithCurrent(MOVIE_FORMATS, movieEditForm.format).map((format) => (
                        <option value={format} key={format}>{format}</option>
                      ))}
                    </select></label>
                    <label className="edit-field-half">{t.edition}<select value={movieEditForm.edition} onChange={(event) => setMovieEditForm((prev) => prev ? ({ ...prev, edition: event.target.value }) : prev)}>
                      {selectOptionsWithCurrent(MOVIE_EDITIONS, movieEditForm.edition).map((edition) => (
                        <option value={edition} key={edition}>{edition}</option>
                      ))}
                    </select></label>
                    <label className="edit-field-half">{t.packaging}<select value={movieEditForm.packaging} onChange={(event) => setMovieEditForm((prev) => prev ? ({ ...prev, packaging: event.target.value }) : prev)}>
                      {selectOptionsWithCurrent(MOVIE_PACKAGING, movieEditForm.packaging).map((packaging) => (
                        <option value={packaging} key={packaging}>{packaging}</option>
                      ))}
                    </select></label>
                    <label className="edit-field-half">{t.formatDetails}<input value={movieEditForm.format_details} onChange={(event) => setMovieEditForm((prev) => prev ? ({ ...prev, format_details: event.target.value }) : prev)} /></label>
                    <label className="edit-field-wide">{t.synopsis}<textarea value={movieEditForm.overview} onChange={(event) => setMovieEditForm((prev) => prev ? ({ ...prev, overview: event.target.value }) : prev)} /></label>
                    <label className="edit-field-wide">{t.cast}<input value={movieEditForm.cast} onChange={(event) => setMovieEditForm((prev) => prev ? ({ ...prev, cast: event.target.value }) : prev)} /></label>
                    <label className="edit-field-half">{t.type}<select value={movieEditForm.media_type} onChange={(event) => setMovieEditForm((prev) => prev ? ({ ...prev, media_type: event.target.value }) : prev)}>
                      <option value="movie">{t.movie}</option>
                      <option value="tv">{t.series}</option>
                    </select></label>
                    <label className="edit-field-half">{t.location}<input value={movieEditForm.location} onChange={(event) => setMovieEditForm((prev) => prev ? ({ ...prev, location: event.target.value }) : prev)} /></label>
                  </div>
                </div>
              </form>
            ) : (
              <div className="details-view-layout details-view-layout-poster">
                <aside className="details-media-panel">
                  <div className="details-cover-wrap poster">
                    {normalizeMoviePoster(selectedItem.item) ? (
                      <Image src={normalizeMoviePoster(selectedItem.item) as string} alt={normalizeMovieTitle(selectedItem.item)} fill sizes="320px" className="details-cover" loading="eager" unoptimized />
                    ) : (
                      <div className="fallback">{t.noPoster}</div>
                    )}
                  </div>
                </aside>

                <div className="details-content-panel">
                  <header className="details-title-block">
                    <h2>{normalizeMovieTitle(selectedItem.item)}</h2>
                    <p>{movieDirectorLine(selectedItem.item)}</p>
                  </header>

                  <div className="details-facts details-facts-movie">
                    <p className="fact-half"><strong>{t.year}</strong><span>{normalizeMovieYear(selectedItem.item)}</span></p>
                    <p className="fact-half"><strong>{t.genres}</strong><span>{selectedItem.item.genres?.join(", ") || t.noGenre}</span></p>
                    <p className="fact-half"><strong>{t.format}</strong><span>{movieFormatLine(selectedItem.item.format)}</span></p>
                    <p className="fact-half"><strong>{t.edition}</strong><span>{selectedItem.item.edition || DEFAULT_MOVIE_EDITION}</span></p>
                    <p className="fact-half"><strong>{t.packaging}</strong><span>{selectedItem.item.packaging || DEFAULT_MOVIE_PACKAGING}</span></p>
                    <p className="fact-half"><strong>{t.formatDetails}</strong><span>{selectedItem.item.format_details || "-"}</span></p>
                    {hasText(selectedItem.item.overview) ? (
                      <p className="fact-wide"><strong>{t.synopsis}</strong><span>{selectedItem.item.overview}</span></p>
                    ) : null}
                    {movieCastLine(selectedItem.item) !== "-" ? (
                      <p className="fact-wide"><strong>{t.cast}</strong><span>{movieCastLine(selectedItem.item)}</span></p>
                    ) : null}
                    <p className="fact-half"><strong>{t.type}</strong><span>{(selectedItem.item.media_type ?? "movie") === "tv" ? t.series : t.movie}</span></p>
                    <p className="fact-half"><strong>{t.location}</strong><span>{normalizeLocation(selectedItem.item.location) || "-"}</span></p>
                  </div>
                </div>
              </div>
            )}
            {itemStatus ? <p className="status-line">{itemStatus}</p> : null}
          </section>
        </div>
      ) : null}

      {isLoadingModalOpen ? (
        <div className="loading-overlay" role="status" aria-live="polite" aria-busy="true" aria-label={t.loading}>
          <div className="loading-spinner" aria-hidden="true" />
        </div>
      ) : null}

      {isBooting ? (
        <div className="splash-screen" role="status" aria-live="polite" aria-busy="true">
          <div className="topbar-brand-lockup splash-brand-lockup">
            <Image
              className="topbar-brand-icon"
              src="/mycatalog-loading-logo.png"
              alt=""
              width={1254}
              height={1254}
              priority
              unoptimized
            />
            <GlitchText className="splash-logo" speed={1.8} enableShadows enableOnHover={false}>
              MyCatalog
            </GlitchText>
          </div>
        </div>
      ) : null}
    </main>
  );
}
