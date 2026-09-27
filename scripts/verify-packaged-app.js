const fs = require("node:fs");
const path = require("node:path");

module.exports = async function verifyPackagedApp(context) {
  const resourcesDir = context.electronPlatformName === "darwin"
    ? path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources",
    )
    : path.join(context.appOutDir, "resources");
  const backendName = context.electronPlatformName === "win32"
    ? "mycatalogue-backend.exe"
    : "mycatalogue-backend";
  const requiredFiles = [
    path.join("backend", backendName),
    path.join("backend", "config.example.yaml"),
    path.join("frontend", "server.js"),
    path.join("frontend", ".next", "BUILD_ID"),
    path.join("frontend", "node_modules", "next", "package.json"),
  ];
  const missingFiles = requiredFiles.filter(
    (relativePath) => !fs.existsSync(path.join(resourcesDir, relativePath)),
  );

  if (missingFiles.length > 0) {
    throw new Error(
      `El paquete está incompleto; faltan: ${missingFiles.join(", ")}`,
    );
  }

  console.log("==> Contenido del paquete verificado");
};
