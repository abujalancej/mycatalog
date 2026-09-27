const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const BACKEND_START_PORT = 5000;
const FRONTEND_START_PORT = 3000;
const projectRoot = path.resolve(__dirname, "..");
const isPackaged = app.isPackaged;
const sourceBackendDir = path.join(projectRoot, "backend");
const sourceFrontendDir = path.join(projectRoot, "frontend");
const resourcesRoot = isPackaged ? process.resourcesPath : projectRoot;
const packagedBackendDir = path.join(resourcesRoot, "backend");
const packagedFrontendDir = path.join(resourcesRoot, "frontend");
const isDevelopment = process.argv.includes("--dev");

let mainWindow;
let backendProcess;
let frontendProcess;
let isQuitting = false;

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function pythonCommand() {
  if (process.env.MYCATALOG_PYTHON) {
    return process.env.MYCATALOG_PYTHON;
  }

  const venvPython = process.platform === "win32"
    ? path.join(sourceBackendDir, ".venv", "Scripts", "python.exe")
    : path.join(sourceBackendDir, ".venv", "bin", "python");

  return require("node:fs").existsSync(venvPython)
    ? venvPython
    : process.platform === "win32" ? "python" : "python3";
}

function startProcess(command, args, options, label) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });
  child.on("error", (error) => {
    console.error(`[${label}] failed to start:`, error);
  });
  child.on("exit", (code, signal) => {
    if (!isQuitting && code !== 0) {
      console.error(`[${label}] exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`);
    }
  });

  return child;
}

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(findFreePort(startPort + 1));
        return;
      }
      reject(error);
    });

    probe.listen(startPort, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : startPort;
      probe.close(() => resolve(port));
    });
  });
}

function waitForHttp(url, label, timeoutMs = 60_000, child) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      child?.removeListener("exit", onExit);
      callback(value);
    };

    const onExit = (code, signal) => {
      finish(
        reject,
        new Error(`${label} process exited before becoming ready (code ${code ?? "unknown"}${signal ? `, ${signal}` : ""})`)
      );
    };

    child?.once("exit", onExit);

    const check = () => {
      if (settled) {
        return;
      }

      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          finish(resolve);
          return;
        }
        retry();
      });

      request.on("error", retry);
      request.setTimeout(1_000, () => {
        request.destroy();
        retry();
      });
    };

    const retry = () => {
      if (settled) {
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        finish(reject, new Error(`${label} did not become ready at ${url}`));
        return;
      }
      setTimeout(check, 250);
    };

    check();
  });
}

async function startDevelopmentServers() {
  const backendPort = await findFreePort(BACKEND_START_PORT);
  const frontendPort = await findFreePort(FRONTEND_START_PORT);
  const backendUrl = `http://127.0.0.1:${backendPort}`;

  console.log(`[desktop] backend: ${backendUrl}`);
  console.log(`[desktop] frontend: http://127.0.0.1:${frontendPort}`);

  backendProcess = startProcess(
    pythonCommand(),
    ["server.py"],
    {
      cwd: sourceBackendDir,
      env: {
        PYTHONUNBUFFERED: "1",
        MYCATALOG_PORT: String(backendPort)
      }
    },
    "backend"
  );

  // Next's root page calls the backend while rendering. Wait for Flask first
  // so the readiness probe cannot accidentally render the offline screen.
  await waitForHttp(`${backendUrl}/health`, "Backend", 60_000, backendProcess);

  frontendProcess = startProcess(
    npmCommand(),
    ["run", "dev", "--", "-H", "127.0.0.1", "-p", String(frontendPort)],
    {
      cwd: sourceFrontendDir,
      env: { CATALOG_BACKEND_URL: backendUrl }
    },
    "frontend"
  );

  await waitForHttp(`http://127.0.0.1:${frontendPort}/favicon.ico`, "Frontend", 60_000, frontendProcess);

  return `http://127.0.0.1:${frontendPort}`;
}

function ensurePackagedDataDirectory() {
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const configPath = path.join(dataDir, "config.yaml");
  const templatePath = path.join(packagedBackendDir, "config.example.yaml");
  if (!fs.existsSync(configPath) && fs.existsSync(templatePath)) {
    fs.copyFileSync(templatePath, configPath);
  }

  return dataDir;
}

async function startPackagedServers() {
  const backendPort = await findFreePort(BACKEND_START_PORT);
  const frontendPort = await findFreePort(FRONTEND_START_PORT);
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const dataDir = ensurePackagedDataDirectory();
  const backendExecutable = path.join(
    packagedBackendDir,
    process.platform === "win32" ? "mycatalogue-backend.exe" : "mycatalogue-backend"
  );

  if (!fs.existsSync(backendExecutable)) {
    throw new Error(`No se encuentra el backend empaquetado: ${backendExecutable}`);
  }

  console.log(`[desktop] backend: ${backendUrl}`);
  console.log(`[desktop] frontend: http://127.0.0.1:${frontendPort}`);

  backendProcess = startProcess(
    backendExecutable,
    [],
    {
      cwd: dataDir,
      env: {
        PYTHONUNBUFFERED: "1",
        MYCATALOG_PORT: String(backendPort),
        MYCATALOG_DATA_DIR: dataDir,
        MYCATALOG_CONFIG_PATH: path.join(dataDir, "config.yaml")
      }
    },
    "backend"
  );

  await waitForHttp(`${backendUrl}/health`, "Backend", 60_000, backendProcess);

  frontendProcess = startProcess(
    process.execPath,
    [path.join(packagedFrontendDir, "server.js")],
    {
      cwd: packagedFrontendDir,
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(frontendPort),
        CATALOG_BACKEND_URL: backendUrl
      }
    },
    "frontend"
  );

  await waitForHttp(`http://127.0.0.1:${frontendPort}/favicon.ico`, "Frontend", 60_000, frontendProcess);

  return `http://127.0.0.1:${frontendPort}`;
}

function createWindow(url) {
  const iconName = process.platform === "win32" ? "mycatalog-icon-padded.ico" : "mycatalog-icon-padded.png";
  const iconPath = path.join(__dirname, "assets", iconName);

  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(iconPath);
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: "#f6f6f4",
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow) {
      return;
    }

    mainWindow.show();
    setTimeout(() => {
      void mainWindow?.loadURL(url);
    }, 120);
  });
  void mainWindow.loadFile(path.join(__dirname, "splash.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function stopProcess(child) {
  if (!child || child.killed) {
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  } else {
    child.kill("SIGTERM");
  }
}

function stopServers() {
  isQuitting = true;
  stopProcess(frontendProcess);
  stopProcess(backendProcess);
}

async function startApplication() {
  const url = isDevelopment || !isPackaged
    ? await startDevelopmentServers()
    : await startPackagedServers();
  createWindow(url);
}

app.whenReady().then(async () => {
  try {
    await startApplication();
  } catch (error) {
    console.error(error);
    await dialog.showMessageBox({
      type: "error",
      title: "MyCatalog no se pudo iniciar",
      message: error instanceof Error ? error.message : String(error),
      detail: "Revisa la salida de la terminal para ver el error completo."
    });
    app.quit();
  }
});

app.on("before-quit", stopServers);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWindow) {
    mainWindow.show();
  }
});
