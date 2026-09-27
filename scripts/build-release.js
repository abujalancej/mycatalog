const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const target = process.argv[2];

if (!["mac", "win"].includes(target)) {
  console.error("Uso: node scripts/build-release.js <mac|win>");
  process.exit(2);
}

const expectedPlatform = target === "mac" ? "darwin" : "win32";
if (process.platform !== expectedPlatform) {
  console.error(
    target === "mac"
      ? "El DMG de macOS debe construirse en macOS con `npm run build:mac`."
      : "El instalador EXE debe construirse en Windows con `npm run build:win`.",
  );
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    ...options,
  });
  if (result.error || result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const electronBuilderCommand = process.platform === "win32"
  ? path.join(projectRoot, "node_modules", ".bin", "electron-builder.cmd")
  : path.join(projectRoot, "node_modules", ".bin", "electron-builder");
const stagingRoot = path.join(projectRoot, "release", "packaging");
const stagedFrontend = path.join(stagingRoot, "frontend");
const stagedBackend = path.join(stagingRoot, "backend");

console.log("==> Compilando frontend Next.js");
run(npmCommand, ["run", "build:frontend"]);

console.log("==> Compilando backend Python");
run(process.execPath, [path.join(__dirname, "build-backend.js")]);

fs.rmSync(stagingRoot, { recursive: true, force: true });
fs.mkdirSync(stagingRoot, { recursive: true });

const standaloneDir = path.join(projectRoot, "frontend", ".next", "standalone");
const staticDir = path.join(projectRoot, "frontend", ".next", "static");
const publicDir = path.join(projectRoot, "frontend", "public");
if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
  throw new Error("No se encontró frontend/.next/standalone/server.js después del build.");
}

fs.cpSync(standaloneDir, stagedFrontend, { recursive: true });
if (fs.existsSync(staticDir)) {
  fs.cpSync(staticDir, path.join(stagedFrontend, ".next", "static"), { recursive: true });
}
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, path.join(stagedFrontend, "public"), { recursive: true });
}

const builtBackend = path.join(
  projectRoot,
  "backend",
  "dist",
  process.platform === "win32" ? "mycatalogue-backend.exe" : "mycatalogue-backend",
);
if (!fs.existsSync(builtBackend)) {
  throw new Error(`No se encontró el backend compilado en ${builtBackend}.`);
}
fs.mkdirSync(stagedBackend, { recursive: true });
fs.copyFileSync(builtBackend, path.join(stagedBackend, path.basename(builtBackend)));
fs.copyFileSync(
  path.join(projectRoot, "backend", "config.example.yaml"),
  path.join(stagedBackend, "config.example.yaml"),
);

console.log(`==> Generando instalador ${target}`);
run(electronBuilderCommand, [target === "mac" ? "--mac" : "--win"]);
