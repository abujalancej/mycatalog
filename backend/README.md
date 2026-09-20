<div align="center">

# MyCatalogue

**A local-first media catalogue backend for a desktop app.**

`Python` · `Flask` · `JSON storage` · `Next.js UI` · `Electron desktop`

<br>

```text
Music     Movies     TV Shows     Books     Games TODO
```

</div>

---

MyCatalogue is a Python backend for a personal media catalogue covering music,
movies, TV shows, and books.

Video games are intentionally parked as a future TODO. Some game-related code
may still exist in the repository, but it should be treated as experimental
legacy scaffolding until the metadata API and data model are chosen again.

The service stores catalogue data in local JSON files and uses external APIs to
enrich each entry with metadata and cover images.

The frontend lives in a separate repository: `mycatalogue.ui`. The intended
final product is a desktop application built with Electron, where the Next.js UI
talks to this local Python backend.

## Current Structure

```text
.
|-- server.py              # Flask HTTP API
|-- config.example.yaml    # Safe configuration template
|-- config.yaml            # Local configuration with API credentials; not for Git
|-- requirements.txt       # Python runtime dependencies
|-- src/                   # API clients, catalogue services, image helpers, storage
|-- scripts/               # Batch importers and maintenance tools
|-- db/                    # Local JSON database files
|-- covers/                # Downloaded cover images
|-- reports/               # Generated maintenance reports
`-- var/                   # Local request files, rejected imports, scratch data
```

## Requirements

- Python 3.11 or newer
- API credentials for the services you want to use:
  - TMDb for movies and TV shows
  - Discogs for music
  - Google Books for books; optional, but recommended

Game catalogue support is a future TODO, so no video game API credential is
required for the active workflow.

## Dependency Management

This backend currently uses `requirements.txt`.

That is the right choice for this repo in its current shape because it is a
small Python service that will be bundled behind an Electron application, not a
published Python library. Installation is simple and explicit:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

The desktop application should keep its own Node/Electron dependencies in the UI
repository through `package.json`.

Use `pyproject.toml` later if this backend becomes an installable package, needs
formal project metadata, or starts managing tooling such as Ruff, pytest, mypy,
PyInstaller configuration helpers, or build configuration from one place.

## Configuration

Create a local configuration file from the example:

```bash
cp config.example.yaml config.yaml
```

Then fill in the API credentials you need.

The backend expects these top-level sections:

- `tmdb`
- `discogs`
- `google_books`
- `storage`

`rawg` may still appear in local or example configuration as legacy game
scaffolding. Treat it as TODO/future work, not as part of the current supported
setup.

Default storage paths:

```text
db/movies.json
db/music.json
db/books.json
db/games.json  # TODO/future game catalogue data
```

`config.yaml` may contain real API tokens and should stay local. Keep
`config.example.yaml` in Git instead.

## Running the Backend

Install dependencies first:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Start the Flask API:

```bash
python server.py
```

The server runs at:

```text
http://127.0.0.1:5000
```

Useful URLs:

```text
http://127.0.0.1:5000/         # service information
http://127.0.0.1:5000/health   # health check
```

Quick check:

```bash
curl http://127.0.0.1:5000/health
```

Expected response:

```json
{"status":"ok"}
```

## API Overview

### Health

```http
GET /health
```

### List Items

```http
GET /list/movie
GET /list/album
GET /list/book
```

Frontend-compatible endpoints:

```http
GET /api/music
GET /api/movies
GET /api/settings
```

### Add Items

Add a movie or TV show:

```bash
curl -X POST http://127.0.0.1:5000/add/movie \
  -H "Content-Type: application/json" \
  -d '{"query":"Blade Runner","year":1982}'
```

Import directly by TMDb ID:

```bash
curl -X POST http://127.0.0.1:5000/add/movie \
  -H "Content-Type: application/json" \
  -d '{"id":78,"media_type":"movie"}'
```

Add an album:

```bash
curl -X POST http://127.0.0.1:5000/add/album \
  -H "Content-Type: application/json" \
  -d '{"query":"Kind of Blue","artist":"Miles Davis"}'
```

Music records use `release_format` for the physical format and `type` for the
release type. The available CD formats are `CD`, `Mini CD`, `Enhanced CD`,
`SACD`, and `HDCD`. Release types are `Album`, `Single`, `Maxi-Single`, `EP`,
`Compilation`, `Live`, `Soundtrack`, `Promo`, `Sampler`, `Demo`, `Bootleg`,
and `Other`. Missing music metadata defaults to `CD` and `Album`.

Music packaging options are `Jewel Case`, `Super Jewel Box`, `Digipak`, `Card
Sleeve`, and `Box Set`. Missing music packaging defaults to `Jewel Case`.

Movie records use `format`, `edition`, and `packaging`. The available formats
are `DVD`, `Blu-ray`, `4K UHD Blu-ray`, `VHS`, and `Video CD`; editions are
`Standard`, `Special Edition`, `Collector’s Edition`, `Limited Edition`,
`Extended Edition`, `Director’s Cut`, `Anniversary Edition`, and
`Remastered Edition`; packaging options are `Amaray`, `Digipak`, `Steelbook`,
`Box Set`, `Slipcover`, and `Keep Case`. Missing movie metadata defaults to
`DVD`, `Standard`, and `Amaray` for format, edition, and packaging.

Add a book:

```bash
curl -X POST http://127.0.0.1:5000/add/book \
  -H "Content-Type: application/json" \
  -d '{"isbn":"9780141187761"}'
```

### Video Games TODO

Video game catalogue support is not part of the current supported API surface.
Existing game endpoints or RAWG-related code should be considered temporary
scaffolding until the future API/provider is selected.

### Delete Items

```http
DELETE /delete/<media_type>/<item_id>
DELETE /api/items/<music|movies>/<item_id>
```

Example:

```bash
curl -X DELETE http://127.0.0.1:5000/delete/movie/78
```

### External Music Import

These endpoints are used by `mycatalogue.ui` to search Discogs and import
selected releases:

```http
POST /api/external/music/search
POST /api/external/music/import
```

## Scripts

`server.py` starts the HTTP API. The files under `scripts/` are command-line
maintenance tools for importing data, fixing covers, and checking music track
metadata.

Run scripts from the repository root with the virtual environment activated:

```bash
source .venv/bin/activate
```

Most maintenance scripts are safe to run first because they only print a plan or
report by default. Scripts that modify files require `--apply`.

### `scripts/normalize_music_metadata.py`

Populates missing music `release_format`, `type`, and `packaging` fields with
`CD`, `Album`, and `Jewel Case`. Preview the changes first, then apply them
with:

```bash
python scripts/normalize_music_metadata.py
python scripts/normalize_music_metadata.py --apply
```

### `scripts/normalize_movie_metadata.py`

Populates missing movie `format`, `edition`, and `packaging` fields. Preview
the changes first, then apply them with:

```bash
python scripts/normalize_movie_metadata.py
python scripts/normalize_movie_metadata.py --apply
```

### `scripts/import_requests.py`

Imports several catalogue items from a local JSON request file and writes the
results into the configured JSON databases under `db/`.

Default input file:

```bash
python scripts/import_requests.py
```

Explicit input file:

```bash
python scripts/import_requests.py var/request.json
```

Custom config file:

```bash
python scripts/import_requests.py var/request_music_7.json --config config.yaml
```

Request files must contain a JSON list. Supported item shapes:

```json
[
  {"type": "movie", "query": "Blade Runner", "year": 1982},
  {"type": "movie", "id": 78, "media_type": "movie"},
  {"type": "album", "query": "Kind of Blue", "artist": "Miles Davis"},
  {"type": "album", "discogs_id": 249504, "release_format": "CD", "location": "shelf"},
  {"type": "book", "isbn": "9780141187761"},
  {"type": "book", "query": "Neuromancer"}
]
```

Notes:

- `movie` uses TMDb.
- `album` uses Discogs.
- `book` uses Google Books and Open Library.
- `release_format` defaults to `CD`.
- `location` defaults to an empty string.

Game imports are a future TODO. Do not add new `{"type": "game"}` request
entries until the game provider and schema are redesigned.

### `scripts/download_remote_covers.py`

Scans `db/*.json` for remote image URLs and downloads missing local WebP images
into `covers/`.

Dry run:

```bash
python scripts/download_remote_covers.py
```

Apply downloads and update local image fields such as `cover_local` and
`poster_local`:

```bash
python scripts/download_remote_covers.py --apply
```

Useful options:

```bash
python scripts/download_remote_covers.py --limit 10
python scripts/download_remote_covers.py --overwrite --apply
python scripts/download_remote_covers.py --replace-source-url --apply
python scripts/download_remote_covers.py --db db --covers covers --apply
```

By default, the original remote URL fields stay unchanged. Use
`--replace-source-url` only if you also want to replace fields such as `cover`
or `poster_full` with the local WebP path.

### `scripts/repair_music_covers.py`

Finds albums in `db/music.json` without `cover_local`, asks Discogs for the
release image, and can download the missing local cover.

Dry run:

```bash
python scripts/repair_music_covers.py
```

Apply repairs:

```bash
python scripts/repair_music_covers.py --apply
```

Limit how many missing covers are checked:

```bash
python scripts/repair_music_covers.py --limit 20
```

### `scripts/convert_covers_to_webp.py`

Converts existing local `.png`, `.jpg`, and `.jpeg` files under `covers/` to
`.webp`.

Dry run:

```bash
python scripts/convert_covers_to_webp.py
```

Apply conversion and update references inside `db/*.json`:

```bash
python scripts/convert_covers_to_webp.py --apply --update-db
```

Important: without `--backup`, successful conversions delete the original
`.png`, `.jpg`, or `.jpeg` file after creating the `.webp`.

Safer conversion with originals moved aside:

```bash
python scripts/convert_covers_to_webp.py --backup covers_originals --apply --update-db
```

Useful options:

```bash
python scripts/convert_covers_to_webp.py --limit 10
python scripts/convert_covers_to_webp.py --quality 90 --apply --update-db
python scripts/convert_covers_to_webp.py --lossless --apply --update-db
python scripts/convert_covers_to_webp.py --overwrite --apply --update-db
```

### `scripts/normalize_music_track_positions.py`

Analyzes track numbering in `db/music.json`, writes a Markdown report, and can
normalize track position values when the album is not anomalous.

Dry run and report generation:

```bash
python scripts/normalize_music_track_positions.py
```

Apply normalizations:

```bash
python scripts/normalize_music_track_positions.py --apply
```

Custom paths:

```bash
python scripts/normalize_music_track_positions.py \
  --db db/music.json \
  --report reports/music_track_numbering_anomalies.md
```

The default report path is `reports/music_track_numbering_anomalies.md`.

### `scripts/_bootstrap.py`

Internal helper used by the other scripts so they can import modules from
`src/` when run from the repository root. You do not run this file directly.

## Frontend Integration

The Next.js frontend lives in `../mycatalogue.ui`.

Start this backend first, then configure the frontend with:

```bash
CATALOG_BACKEND_URL=http://127.0.0.1:5000
```

## Desktop Packaging Direction

The expected desktop architecture is:

```text
Electron app
|-- Next.js frontend
`-- bundled Python backend
    |-- Flask API on localhost
    |-- local JSON database
    `-- downloaded cover images
```

Recommended packaging flow:

1. Build the Next.js UI in `mycatalogue.ui`.
2. Bundle this backend into a standalone executable with PyInstaller.
3. Include that backend executable as an Electron extra resource.
4. Start the backend from Electron on app launch.
5. Point the UI to the local backend URL, for example
   `http://127.0.0.1:<port>`.
6. Store user data outside the application install directory.

For the Python backend executable, use `requirements.txt` during the build:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install pyinstaller
pyinstaller --onefile server.py --name mycatalogue-backend
```

For a production desktop app, avoid hardcoding writable paths inside the app
bundle. Configure `storage` paths so `db/*.json`, `covers/`, and local settings
live in a user-writable application data directory.

Keep these concerns separate:

- Python backend dependencies: `requirements.txt`
- Electron and Next.js dependencies: `package.json` in `mycatalogue.ui`
- User data: app data directory, not the Git repo and not the installed app
- API credentials: local configuration or encrypted app settings

## Local Data and Generated Files

These files are local runtime data and should normally not be committed:

- `config.yaml`
- `db/*.json`, if they contain your real catalogue
- `covers/`
- `reports/*.md`
- `var/`
- `*.log`
- `.DS_Store`
- `.idea/`
- `.vscode/`, unless intentionally shared

If one of these files was already committed, adding it to `.gitignore` is not
enough. Remove it from Git tracking while keeping the local file:

```bash
git rm --cached config.yaml
```

Apply the same pattern to other local-only files as needed.

## Maintenance Notes

- Keep `config.example.yaml` up to date whenever configuration keys change.
- Keep `requirements.txt` as the source of truth for backend runtime
  dependencies while the project remains an application bundled behind Electron.
- Move to `pyproject.toml` only when you want package metadata, build settings,
  or centralized tool configuration.
- Consider moving `src/` to a real package namespace such as
  `src/mycatalogue/` before the project grows further.
- Consider splitting `server.py` into separate route modules once more endpoints
  are added.
