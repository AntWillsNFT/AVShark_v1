"use strict";

const fs = require("node:fs");
const path = require("node:path");

const project = path.resolve(process.argv[2] || "");
if (!project || !fs.existsSync(project)) {
  throw new Error("AffiFlow project path was not found.");
}

const mainPath = path.join(project, "electron", "main.cjs");
if (!fs.existsSync(mainPath)) {
  throw new Error("electron/main.cjs was not found.");
}

let source = fs.readFileSync(mainPath, "utf8");
const malformedPattern = /ipcMain\.handle\(\s*"assisted-media:open",\s*"foundation:product-readiness:list",/g;
const malformedMatches = source.match(malformedPattern) || [];

source = source.replace(
  malformedPattern,
  'ipcMain.handle(\n    "foundation:product-readiness:list",',
);

const validHandlerPattern = /ipcMain\.handle\(\s*"assisted-media:open",\s*async\s*\(/g;
const validHandlerMatches = source.match(validHandlerPattern) || [];

if (validHandlerMatches.length !== 1) {
  throw new Error(
    `Expected exactly one valid assisted-media:open handler after repair, found ${validHandlerMatches.length}.`,
  );
}

const listStartMarker = "const handlerNames = [";
const listEndMarker = "];";
const listStart = source.indexOf(listStartMarker);
const listEnd = source.indexOf(listEndMarker, listStart + listStartMarker.length);

if (listStart < 0 || listEnd < 0) {
  throw new Error("IPC handler cleanup list was not found.");
}

let handlerList = source.slice(listStart, listEnd + listEndMarker.length);

if (!handlerList.includes('"assisted-media:open"')) {
  handlerList = handlerList.replace(
    '    "foundation:product-readiness:list",',
    '    "assisted-media:open",\n    "foundation:product-readiness:list",',
  );

  if (!handlerList.includes('"assisted-media:open"')) {
    throw new Error("Could not add assisted-media:open to IPC cleanup list.");
  }

  source = source.slice(0, listStart) + handlerList + source.slice(listEnd + listEndMarker.length);
}

const finalMalformed = source.match(malformedPattern) || [];
const finalValidHandlers = source.match(validHandlerPattern) || [];

if (finalMalformed.length !== 0 || finalValidHandlers.length !== 1) {
  throw new Error(
    `IPC verification failed. malformed=${finalMalformed.length}, valid=${finalValidHandlers.length}`,
  );
}

fs.writeFileSync(mainPath, source.replaceAll("\r\n", "\n"), "utf8");

console.log(JSON.stringify({
  ok: true,
  malformedHandlersFixed: malformedMatches.length,
  validAssistedHandlers: finalValidHandlers.length,
  cleanupListContainsAssistedHandler: true,
}, null, 2));
