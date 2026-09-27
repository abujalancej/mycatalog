const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.error(
        `No se encontró ${command}. Instala GitHub CLI y ejecuta \`gh auth login\` para solicitar el build remoto de Windows.`,
      );
    }
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (process.platform === "win32") {
  const npmCommand = "npm.cmd";
  run(npmCommand, ["run", "build:win:local"]);
  process.exit(0);
}

const branch = spawnSync("git", ["branch", "--show-current"], {
  cwd: projectRoot,
  encoding: "utf8",
});
const branchName = branch.status === 0 ? branch.stdout.trim() : "";
if (!branchName) {
  console.error("El build remoto requiere una rama Git activa.");
  process.exit(1);
}

const changes = spawnSync("git", ["status", "--porcelain"], {
  cwd: projectRoot,
  encoding: "utf8",
});
if (changes.status !== 0 || changes.stdout.trim()) {
  console.error("Confirma y sube los cambios antes de solicitar el build remoto de Windows.");
  process.exit(1);
}

console.log(`==> Solicitando build Windows para la rama remota ${branchName}`);
run("gh", ["workflow", "run", "build-windows.yml", "--ref", branchName]);
console.log("==> Build solicitado. Descarga el artefacto desde GitHub Actions cuando finalice.");
