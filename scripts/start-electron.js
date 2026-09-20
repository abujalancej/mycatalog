const { spawn } = require("node:child_process");

const electronPath = require("electron");
const environment = { ...process.env };

// Some development shells set this flag globally, which makes the Electron
// executable run as plain Node.js and leaves `app` unavailable to main.js.
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["electron/main.js", "--dev"], {
  cwd: process.cwd(),
  env: environment,
  stdio: "inherit",
  windowsHide: false,
});

child.on("close", (code, signal) => {
  if (code === null) {
    console.error(`${electronPath} exited with signal ${signal}`);
    process.exit(1);
  }
  process.exit(code);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}
