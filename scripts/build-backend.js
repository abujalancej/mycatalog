const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const backendDir = path.join(projectRoot, "backend");
const pyinstallerConfigDir = path.join(projectRoot, "release", ".pyinstaller");
const pythonFromEnvironment = process.env.MYCATALOG_BUILD_PYTHON;
const venvPython = process.platform === "win32"
  ? path.join(backendDir, ".venv", "Scripts", "python.exe")
  : path.join(backendDir, ".venv", "bin", "python");
const pythonCommand = pythonFromEnvironment || (fs.existsSync(venvPython)
  ? venvPython
  : process.platform === "win32" ? "python" : "python3");

const result = spawnSync(
  pythonCommand,
  ["-m", "PyInstaller", "--clean", "--noconfirm", "mycatalogue-backend.spec"],
  {
    cwd: backendDir,
    stdio: "inherit",
    env: { ...process.env, PYINSTALLER_CONFIG_DIR: pyinstallerConfigDir },
  },
);

if (result.error || result.status !== 0) {
  console.error("No se pudo construir el backend Python con PyInstaller.");
  console.error(
    process.platform === "win32"
      ? "Instálalo con: backend\\.venv\\Scripts\\pip.exe install -r backend\\requirements-build.txt"
      : "Instálalo con: backend/.venv/bin/pip install -r backend/requirements-build.txt",
  );
  process.exit(result.status || 1);
}
