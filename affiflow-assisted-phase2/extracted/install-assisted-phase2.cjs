"use strict";

const fs = require("node:fs");
const path = require("node:path");

const project = path.resolve(process.argv[2] || "");
const assetDirectory = path.resolve(process.argv[3] || "");

if (!project || !fs.existsSync(project)) {
  throw new Error("AffiFlow project path was not found.");
}

if (!assetDirectory || !fs.existsSync(assetDirectory)) {
  throw new Error("Phase 2 asset directory was not found.");
}

const MARKER = "AFFIFLOW_ASSISTED_MEDIA_PHASE2";

function projectPath(relativePath) {
  return path.join(project, relativePath);
}

function assetPath(fileName) {
  return path.join(assetDirectory, fileName);
}

function readProject(relativePath) {
  return fs.readFileSync(projectPath(relativePath), "utf8");
}

function writeProject(relativePath, content) {
  const destination = projectPath(relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content.replaceAll("\r\n", "\n"), "utf8");
}

function readAsset(fileName) {
  const source = assetPath(fileName);

  if (!fs.existsSync(source)) {
    throw new Error(`Phase 2 asset was not found: ${fileName}`);
  }

  return fs.readFileSync(source, "utf8");
}

function replaceOnce(source, oldValue, newValue, label) {
  const index = source.indexOf(oldValue);

  if (index < 0) {
    throw new Error(`${label}: expected source block was not found.`);
  }

  return source.slice(0, index) + newValue + source.slice(index + oldValue.length);
}

function insertBefore(source, marker, addition, label) {
  const index = source.indexOf(marker);

  if (index < 0) {
    throw new Error(`${label}: insertion marker was not found.`);
  }

  return source.slice(0, index) + addition + source.slice(index);
}

const fragments = JSON.parse(
  readAsset("candidate-media-phase2-fragments.json"),
);

for (const key of ["property", "statements", "methods", "routes"]) {
  if (typeof fragments[key] !== "string" || !fragments[key]) {
    throw new Error(`Candidate Media fragment is invalid: ${key}`);
  }
}

writeProject(
  "extensions/affiflow-capture/popup.html",
  readAsset("popup-phase2.html"),
);

writeProject(
  "extensions/affiflow-capture/popup-assisted-media.js",
  readAsset("popup-assisted-media.js"),
);

let popupCss = readProject("extensions/affiflow-capture/popup.css");

if (!popupCss.includes(MARKER)) {
  popupCss = popupCss.replace(/\s*$/, "\n") + readAsset("popup-phase2.css");
}

writeProject("extensions/affiflow-capture/popup.css", popupCss);

let popupJs = readProject("extensions/affiflow-capture/popup.js");
const runnerMarker = "// AFFIFLOW_PERSISTENT_MEDIA_RUNNER_POPUP_V1";
const runnerIndex = popupJs.indexOf(runnerMarker);

if (runnerIndex >= 0) {
  popupJs = popupJs.slice(0, runnerIndex).replace(/\s*$/, "\n");
}

writeProject("extensions/affiflow-capture/popup.js", popupJs);

let server = readProject("electron/candidateMediaServer.cjs");

if (!server.includes(MARKER)) {
  const productVaultBlock = [
    "    this.productVaultPath =",
    "      path.join(",
    "        path.dirname(databasePath),",
    '        "AffiFlow-Vault",',
    '        "products",',
    "      );",
  ].join("\n");

  server = replaceOnce(
    server,
    productVaultBlock,
    productVaultBlock + "\n\n" + fragments.property.trimEnd(),
    "Candidate Media assisted session path",
  );

  const statementMarker = [
    "      markCandidatePending:",
    "        this.database.prepare(`",
  ].join("\n");

  server = replaceOnce(
    server,
    statementMarker,
    fragments.statements + statementMarker,
    "Candidate Media assisted statements",
  );

  server = insertBefore(
    server,
    "  async handleRequest(\n",
    fragments.methods,
    "Candidate Media assisted methods",
  );

  const claimRouteMarker = [
    "    if (",
    '      request.method === "POST" &&',
    "      requestUrl.pathname ===",
    '        "/api/jobs/claim"',
    "    ) {",
  ].join("\n");

  server = insertBefore(
    server,
    claimRouteMarker,
    fragments.routes,
    "Candidate Media assisted routes",
  );
}

const strictFailureCondition = [
  "    if (",
  "      downloadedImages < 1 ||",
  "      failedImages > 0 ||",
  "      failedVideos > 0",
  "    ) {",
].join("\n");

const assistedFailureCondition = [
  "    if (",
  "      downloadedImages < 1",
  "    ) {",
].join("\n");

if (server.includes(strictFailureCondition)) {
  server = server.replace(
    strictFailureCondition,
    assistedFailureCondition,
  );
}

writeProject("electron/candidateMediaServer.cjs", server);

const assistedManagerRelative = "electron/assistedMediaCapture.cjs";
const assistedManagerFull = projectPath(assistedManagerRelative);

if (fs.existsSync(assistedManagerFull)) {
  let assistedManager = readProject(assistedManagerRelative);

  assistedManager = assistedManager.replace(
    "Open the AffiFlow Capture extension in the Shopee product tab.",
    "Open the AffiFlow Capture extension; Media Capture will be selected automatically.",
  );

  writeProject(assistedManagerRelative, assistedManager);
}

const manifestRelative = "extensions/affiflow-capture/manifest.json";
const manifest = JSON.parse(readProject(manifestRelative));
manifest.version = "0.11.0";
manifest.description =
  "Shopee Product Scanner with assisted media preview, selection and Save to AffiFlow Vault.";
writeProject(manifestRelative, JSON.stringify(manifest, null, 2) + "\n");

const verification = {
  version: JSON.parse(readProject(manifestRelative)).version,
  popupHtml: readProject("extensions/affiflow-capture/popup.html")
    .includes("popup-assisted-media.js"),
  popupScript: readProject("extensions/affiflow-capture/popup-assisted-media.js")
    .includes(MARKER),
  popupCss: readProject("extensions/affiflow-capture/popup.css")
    .includes(MARKER),
  server: readProject("electron/candidateMediaServer.cjs")
    .includes(MARKER),
  sessionRoute: readProject("electron/candidateMediaServer.cjs")
    .includes("/api/assisted/session"),
  manifestRoute: readProject("extensions/affiflow-capture/popup-assisted-media.js")
    .includes("/manifest"),
  oldPopupRunnerRemoved: !readProject("extensions/affiflow-capture/popup.js")
    .includes(runnerMarker),
};

if (
  verification.version !== "0.11.0" ||
  Object.entries(verification)
    .filter(([key]) => key !== "version")
    .some(([, value]) => value !== true)
) {
  throw new Error(
    "Assisted Media Phase 2 verification failed: " +
      JSON.stringify(verification),
  );
}

console.log(JSON.stringify({
  ok: true,
  phase: "Assisted Media Phase 2",
  ...verification,
}, null, 2));
