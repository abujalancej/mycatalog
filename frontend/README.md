# MyCatalog UI

MyCatalog UI is the Next.js frontend for a personal media catalog.
It talks to the backend over HTTP and focuses on a clean browsing and editing flow for music and movies.

## What it does

- Browse music records and movies in a searchable catalog.
- Import music releases from Discogs.
- Open a detail modal for each item.
- Edit items when `Editor mode` is enabled.
- Delete items when `Editor mode` is enabled.
- Update backend settings stored in `config.yaml`.
- Show a splash screen while the app finishes loading.

## Requirements

- Node.js 20+
- npm 10+
- A running MyCatalog backend

## Local setup

Start the backend first. By default the UI expects it at `http://127.0.0.1:5000`.

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Environment variables

The UI only needs the backend URL:

- `CATALOG_BACKEND_URL`: base URL of the backend API.

Example:

```bash
CATALOG_BACKEND_URL=http://127.0.0.1:5000
```

## Editor mode

`Editor mode` is the only editing gate in this UI.

When it is enabled, you can:

- Edit music and movie metadata.
- Change cover/poster images.
- Upload an image file or paste an image URL.
- Edit tracklists for music releases.
- Delete records from the catalog.
- Save `config.yaml`.

The mode is stored locally in the browser, so it persists across reloads on the same device.

## Detail modal

Click a cover or poster to open the detail modal.

The modal has one layout with two modes:

- View mode: artwork, title, metadata, tracks, and overview are arranged for reading.
- Edit mode: artwork source, metadata fields, and track editing are grouped without duplicated preview panels.

For images, you can either:

- Paste a direct image URL.
- Use the file browser to load a local image.

## Discogs import

Music releases can be searched and imported from Discogs from the main catalog view.

The import panel shows:

- Title
- Year
- Country
- Formats
- Genres and styles
- Cover preview

That preview is meant to help you choose the correct release before importing it.

## API routes used by the UI

- `GET /api/music`
- `POST /api/music`
- `GET /api/movies`
- `POST /api/movies`
- `PATCH /api/items/music/:id`
- `PATCH /api/items/movies/:id`
- `DELETE /api/items/music/:id`
- `DELETE /api/items/movies/:id`
- `GET /api/settings`
- `PATCH /api/settings`
- `POST /api/external/music/search`
- `POST /api/external/music/import`

## Notes

- Images selected from the file browser are stored as data URLs in the current implementation.
- The UI uses Next.js `Image`, so remote image hosts must be allowed in `next.config.ts`.
- The splash screen is intentionally minimal and only shows the `MyCatalog` logo while the app boots.

## Development

Run the production build locally:

```bash
npm run build
```

If you hit an odd Next.js cache/runtime issue, clearing `.next` and restarting usually fixes it.
