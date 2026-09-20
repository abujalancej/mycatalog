# MyCatalog

[English](README.md) · **Español** · [Català](README.ca.md)

**Catálogo personal de medios, local y privado**

<p align="center">
  <img src="electron/assets/mycatalog-icon.png" alt="Logotipo de MyCatalog" width="220">
</p>

MyCatalog es una aplicación de escritorio local para gestionar una colección
personal de música, películas, series y libros.

El catálogo permanece en el ordenador local. SQLite almacena la colección, las
carátulas descargadas se guardan en carpetas locales y las API externas solo se
utilizan para buscar y completar las fichas del catálogo.

## Funcionalidades

- Catálogo musical con búsqueda e importación de publicaciones desde Discogs.
- Catálogo de películas y series con búsqueda y enriquecimiento desde TMDb.
- Catálogo de libros con consultas a ISBN, Open Library y Google Books.
- Descarga local de carátulas y pósteres en formato WebP.
- Vistas de catálogo con búsqueda, detalle y edición.
- Creación, edición y eliminación manual de elementos.
- Configuración de formato físico, edición, embalaje, ubicación y listas de pistas.
- Interfaz disponible en inglés, castellano y catalán.
- Persistencia local en SQLite, con importación y migración desde JSON.
- Informes de mantenimiento para carátulas ausentes e inconsistencias de datos.
- Shell de Electron con backend local en Flask y frontend en Next.js.

La compatibilidad con videojuegos queda aparcada como tarea futura. La
aplicación actual no necesita ningún proveedor de metadatos de videojuegos.

## Áreas de la aplicación

| Área | Función |
| --- | --- |
| `Music` | Consultar, buscar, importar, editar y mantener discos. |
| `Movies` | Consultar, buscar, importar, editar y mantener películas y series. |
| `Books` | Buscar libros por título o ISBN y gestionar sus fichas. |
| `Settings` | Configurar proveedores de metadatos y la ruta de SQLite. |
| `Maintenance` | Localizar carátulas, revisar archivos y detectar inconsistencias. |

## Tecnologías

- Electron para iniciar y detener los servicios locales.
- Flask y Python para la API local e integraciones de metadatos.
- SQLite para la base de datos local del catálogo.
- Datos JSON dentro de SQLite para conservar los campos flexibles de cada proveedor.
- Next.js, React y TypeScript para la interfaz.
- Imágenes WebP almacenadas fuera de la base de datos.

## Requisitos

- Node.js 20 o superior y npm.
- Python 3.11 o superior.
- Un sistema de archivos local con permisos de escritura para la base de datos y las imágenes.
- Credenciales de las API que quieras utilizar:
  - TMDb para películas y series.
  - Discogs para música.
  - Google Books para consultas opcionales de libros.

Open Library no requiere clave de API. Una vez que los datos y las imágenes ya
están descargados, consultar el catálogo local no requiere conexión de red.

## Instalación

Instala las dependencias de escritorio desde la raíz del repositorio:

```bash
npm install
npm --prefix frontend install
```

Crea y prepara el entorno del backend:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
```

Crea la configuración local a partir del ejemplo seguro:

```bash
cp backend/config.example.yaml backend/config.yaml
```

Completa las credenciales de los proveedores en `backend/config.yaml`. Este
archivo es exclusivamente local y nunca debe incluirse en Git.

## Desarrollo

Inicia el entorno completo de desarrollo:

```bash
npm run dev
```

Electron inicia el backend Flask y el servidor de desarrollo de Next.js de
forma local y abre la aplicación cuando ambos servicios están disponibles.

Para iniciar los servicios por separado:

```bash
cd backend
.venv/bin/python server.py
```

```bash
cd frontend
npm run dev
```

El backend estará disponible en `http://127.0.0.1:5000` y el frontend en
`http://localhost:3000` cuando se ejecuten de forma independiente.

## Compilación de producción

Genera una compilación local del renderer de Next.js:

```bash
npm run build:frontend
```

El empaquetado de Electron todavía no está configurado. Por ahora, el flujo
de escritorio compatible es el comando de desarrollo local anterior.

## Aplicación de escritorio

MyCatalog está diseñada como una aplicación privada y monousuario de Electron
para macOS, Windows y Linux. El renderer se comunica por HTTP con el servicio
Flask local. Electron selecciona el icono correspondiente a cada plataforma:

```text
electron/assets/mycatalog-icon-padded.png   macOS y Linux
electron/assets/mycatalog-icon-padded.ico   Windows
```

Electron inicia el backend usando `backend/.venv` cuando ese entorno existe.
Puedes definir `MYCATALOG_PYTHON` si necesitas utilizar otro ejecutable de
Python.

## Uso

1. Crea `backend/config.yaml` a partir de `backend/config.example.yaml` y añade las credenciales necesarias.
2. Inicia MyCatalog con `npm run dev`.
3. Consulta el catálogo desde la vista principal.
4. Usa los paneles de búsqueda de los proveedores para importar música, películas, series o libros.
5. Activa el modo editor cuando necesites editar o eliminar elementos.
6. Usa Configuración y Mantenimiento para actualizar las opciones, localizar imágenes, eliminar imágenes sin uso y revisar la calidad de los datos.

## Almacenamiento de datos

MyCatalog **no** utiliza una base de datos remota. El catálogo persistente se
guarda en:

```text
backend/db/catalog.sqlite3
```

La base de datos actual se migró desde los catálogos JSON anteriores. Los
archivos de origen y la copia de migración siguen disponibles localmente:

```text
backend/db/music.json
backend/db/movies.json
backend/db/books.json
backend/db/backups/json-before-sqlite-*/
```

Las imágenes descargadas se guardan fuera de SQLite:

```text
backend/covers/music/
backend/covers/movies/
backend/covers/books/
```

### Consideraciones importantes sobre el almacenamiento

- La copia de seguridad de Configuración descarga un ZIP con `backend/db/catalog.sqlite3` y `backend/covers/`; las copias antiguas `.sqlite3` independientes siguen siendo restaurables.
- La acción de imágenes locales reconcilia `backend/covers/` con la base de datos: descarga las imágenes que faltan, conserva los archivos referenciados y elimina las imágenes sin uso.
- Los datos reales del catálogo, las imágenes, los informes, las peticiones y las credenciales permanecen fuera de Git.
- Los archivos JSON se conservan como copia temporal de la migración y solo deben eliminarse después de comprobar la base SQLite de forma independiente.
- La aplicación está diseñada para una instalación privada y monousuario.
- No expongas públicamente el backend ni su directorio de datos: pueden contener información personal de la colección y credenciales de proveedores.

## Modelo de datos

SQLite utiliza una tabla compartida `media_items`. Cada catálogo tiene su
propia colección, identificador estable, posición de inserción y contenido JSON:

```text
collection   item_id   position   payload
album        123       0          { ... metadatos de Discogs ... }
movie        456       0          { ... metadatos de TMDb ... }
book         isbn...   0          { ... metadatos de libros ... }
```

Este diseño conserva los campos específicos de cada proveedor y permite usar
transacciones de escritura, además de facilitar futuros índices o tablas
normalizadas sin cambiar la API pública.

## API

### Salud e información del servicio

```http
GET /
GET /health
```

### Datos del catálogo

```http
GET  /api/music
POST /api/music
GET  /api/movies
POST /api/movies
GET  /api/books
POST /api/books
```

### Operaciones del catálogo

```http
DELETE /api/items/<kind>/<item_id>
PATCH  /api/items/<kind>/<item_id>
POST   /api/images/localize
```

### Consultas externas y mantenimiento

```http
GET  /api/books/search
GET  /api/books/metadata
POST /api/books/resolve
POST /api/external/music/search
POST /api/external/music/import
GET  /api/inconsistencies
POST /api/files/reveal
```

## Estructura del proyecto

```text
mycatalog/
├── backend/                 # API Flask, proveedores, SQLite y scripts
│   ├── src/                 # Servicios del catálogo y almacenamiento
│   ├── scripts/             # Ayudas de migración y mantenimiento
│   ├── config.example.yaml  # Plantilla de configuración segura
│   ├── db/                  # Base SQLite y archivos JSON locales
│   └── covers/              # Imágenes locales, ignoradas por Git
├── frontend/                # Renderer Next.js y componentes de interfaz
├── electron/                # Proceso principal y recursos de Electron
├── package.json             # Scripts de escritorio y dependencia de Electron
├── README.md                # Documentación en inglés
├── README.es.md             # Documentación en castellano
└── README.ca.md             # Documentación en catalán
```

## Scripts disponibles

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia el backend, el frontend y el shell de Electron. |
| `npm run build:frontend` | Genera una compilación de producción del renderer de Next.js. |
| `npm run lint:frontend` | Ejecuta el lint del frontend. |
| `python3 scripts/migrate_json_to_sqlite.py` | Importa los catálogos JSON en SQLite. |
| `python3 scripts/normalize_music_track_positions.py` | Informa o normaliza las posiciones de las pistas. |
| `python3 scripts/repair_music_covers.py` | Busca y, opcionalmente, repara carátulas musicales ausentes. |

Ejecuta los scripts del backend desde el directorio `backend/`.

## Validación

Antes de hacer commits de código, ejecuta:

```bash
node --check electron/main.js
cd backend && .venv/bin/python -m py_compile src/*.py scripts/*.py
cd ../frontend && npm run build
```

Para una migración del almacenamiento local, comprueba los recuentos de
elementos en SQLite, revisa las rutas de la aplicación y conserva la copia JSON
generada hasta haber revisado el catálogo.
