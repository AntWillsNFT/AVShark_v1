"use strict";

const fs = require("node:fs");
const path = require("node:path");

const project = path.resolve(process.argv[2] || "");
if (!project || !fs.existsSync(project)) {
  throw new Error("AffiFlow project path was not found.");
}

const MARKER = "AFFIFLOW_ASSISTED_MEDIA_PHASE1";
const extensionRoot = path.join(project, "extensions", "affiflow-capture");

function file(relativePath) {
  return path.join(project, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(file(relativePath), "utf8");
}

function write(relativePath, content) {
  const destination = file(relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content.replaceAll("\r\n", "\n"), "utf8");
}

function replaceOnce(source, oldValue, newValue, label) {
  const index = source.indexOf(oldValue);
  if (index < 0) {
    throw new Error(`${label}: expected source block was not found.`);
  }
  return source.slice(0, index) + newValue + source.slice(index + oldValue.length);
}

function replaceRange(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker was not found.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`${label}: end marker was not found.`);
  return source.slice(0, start) + replacement + source.slice(end);
}

const assistedMediaCapture = String.raw`"use strict";

const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ALLOWED_SHOPEE_HOSTS = new Set([
  "shopee.com.my",
  "www.shopee.com.my",
  "affiliate.shopee.com.my",
  "s.shopee.com.my",
  "shope.ee",
  "shp.ee",
]);

function normalizeText(value, fieldName, maximumLength) {
  if (typeof value !== "string") {
    throw new TypeError(
      fieldName + " must be a string.",
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(
      fieldName + " is required.",
    );
  }

  if (normalized.length > maximumLength) {
    throw new RangeError(
      fieldName + " is too long.",
    );
  }

  return normalized;
}

function normalizeShopeeUrl(value) {
  const normalized = normalizeText(
    value,
    "productUrl",
    4096,
  );

  let parsed;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(
      "Product URL is invalid.",
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      "Product URL must use HTTPS.",
    );
  }

  const host = parsed.hostname.toLowerCase();
  const allowed =
    ALLOWED_SHOPEE_HOSTS.has(host) ||
    host.endsWith(".shopee.com.my");

  if (!allowed) {
    throw new Error(
      "Capture Media only supports Shopee product links.",
    );
  }

  return parsed.toString();
}

function findFilesByName(directory, fileName, maximumDepth = 8) {
  const results = [];

  function visit(currentDirectory, depth) {
    if (
      depth > maximumDepth ||
      !fs.existsSync(currentDirectory)
    ) {
      return;
    }

    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      const entryPath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        visit(entryPath, depth + 1);
        continue;
      }

      if (
        entry.isFile() &&
        entry.name.toLowerCase() === fileName.toLowerCase()
      ) {
        results.push(entryPath);
      }
    }
  }

  visit(directory, 0);
  return results;
}

class AssistedMediaCapture {
  constructor({ databasePath, projectRoot }) {
    this.databasePath = normalizeText(databasePath, "databasePath", 4096);
    this.projectRoot = path.resolve(
      normalizeText(projectRoot, "projectRoot", 4096),
    );

    this.extensionPath = path.join(
      this.projectRoot,
      "extensions",
      "affiflow-capture",
    );

    this.profilePath = path.join(
      this.projectRoot,
      ".affiflow-chrome-profile",
    );

    this.sessionDirectory = path.join(
      path.dirname(this.databasePath),
      "assisted-media",
    );

    this.activeSessionPath = path.join(
      this.sessionDirectory,
      "active-session.json",
    );
  }

  prepare() {
    fs.mkdirSync(this.sessionDirectory, { recursive: true });
    this.markAllPendingAsAssisted();
  }

  openDatabase() {
    return new DatabaseSync(this.databasePath, {
      enableForeignKeyConstraints: true,
    });
  }

  markAllPendingAsAssisted() {
    const database = this.openDatabase();
    const timestamp = new Date().toISOString();

    database.exec("BEGIN IMMEDIATE TRANSACTION;");

    try {
      database.prepare(\`
        UPDATE candidate_media_state
        SET
          batch_id = 'assisted-capture',
          status = 'Paused',
          last_error = 'Needs assisted media capture.',
          started_at = '',
          completed_at = '',
          updated_at = ?
        WHERE
          status != 'Ready'
          AND candidate_id IN (
            SELECT id
            FROM capture_candidates
            WHERE status = 'Imported'
          )
      \`).run(timestamp);

      database.prepare(\`
        UPDATE product_media_jobs
        SET
          status = 'Waiting for Source',
          progress = CASE WHEN downloaded_count > 0 THEN 25 ELSE 0 END,
          attempts = 0,
          failed_count = 0,
          last_error = 'Needs assisted media capture.',
          started_at = '',
          completed_at = '',
          updated_at = ?
        WHERE status != 'Completed'
      \`).run(timestamp);

      database.prepare(\`
        UPDATE product_media_state
        SET
          discovery_status = 'Not Checked',
          image_status = CASE
            WHEN downloaded_image_count > 0 THEN 'Partial'
            ELSE 'Missing'
          END,
          video_status = CASE
            WHEN downloaded_video_count > 0 THEN 'Ready'
            ELSE 'Not Checked'
          END,
          overall_status = 'Needs Attention',
          last_error = '',
          updated_at = ?
        WHERE overall_status != 'Ready'
      \`).run(timestamp);

      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    } finally {
      database.close();
    }
  }

  markProductsNeedsCapture(productIds) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return { updatedCount: 0 };
    }

    const normalizedIds = Array.from(new Set(
      productIds.map((productId) => normalizeText(productId, "productId", 100)),
    ));

    const database = this.openDatabase();
    const timestamp = new Date().toISOString();
    const placeholders = normalizedIds.map(() => "?").join(", ");

    database.exec("BEGIN IMMEDIATE TRANSACTION;");

    try {
      database.prepare(\`
        UPDATE product_media_jobs
        SET
          status = 'Waiting for Source',
          progress = 0,
          attempts = 0,
          failed_count = 0,
          last_error = 'Needs assisted media capture.',
          started_at = '',
          completed_at = '',
          updated_at = ?
        WHERE product_id IN (\${placeholders})
          AND status != 'Completed'
      \`).run(timestamp, ...normalizedIds);

      database.prepare(\`
        UPDATE product_media_state
        SET
          discovery_status = 'Not Checked',
          image_status = CASE
            WHEN downloaded_image_count > 0 THEN 'Partial'
            ELSE 'Missing'
          END,
          video_status = CASE
            WHEN downloaded_video_count > 0 THEN 'Ready'
            ELSE 'Not Checked'
          END,
          overall_status = CASE
            WHEN overall_status = 'Ready' THEN 'Ready'
            ELSE 'Needs Attention'
          END,
          last_error = '',
          updated_at = ?
        WHERE product_id IN (\${placeholders})
      \`).run(timestamp, ...normalizedIds);

      database.prepare(\`
        UPDATE candidate_media_state
        SET
          batch_id = 'assisted-capture',
          status = CASE WHEN status = 'Ready' THEN 'Ready' ELSE 'Paused' END,
          attempts = CASE WHEN status = 'Ready' THEN attempts ELSE 0 END,
          last_error = CASE
            WHEN status = 'Ready' THEN ''
            ELSE 'Needs assisted media capture.'
          END,
          started_at = '',
          completed_at = CASE WHEN status = 'Ready' THEN completed_at ELSE '' END,
          updated_at = ?
        WHERE candidate_id IN (
          SELECT capture_candidates.id
          FROM capture_candidates
          INNER JOIN products ON (
            capture_candidates.source_url = products.source_url
            OR (
              products.affiliate_link != ''
              AND capture_candidates.affiliate_link = products.affiliate_link
            )
            OR LOWER(TRIM(capture_candidates.name)) = LOWER(TRIM(products.name))
          )
          WHERE products.id IN (\${placeholders})
        )
      \`).run(timestamp, ...normalizedIds);

      database.exec("COMMIT;");
      return { updatedCount: normalizedIds.length };
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    } finally {
      database.close();
    }
  }

  findBrowser() {
    const browserRoot = path.join(
      this.projectRoot,
      ".affiflow-tools",
      "chrome-for-testing-media",
      "browser",
    );

    const candidates = findFilesByName(browserRoot, "chrome.exe")
      .map((filePath) => ({
        filePath,
        modifiedAt: fs.statSync(filePath).mtimeMs,
      }))
      .sort((first, second) => second.modifiedAt - first.modifiedAt);

    if (candidates.length < 1) {
      throw new Error(
        "AffiFlow Chrome for Testing was not found. Run the existing AffiFlow Chrome installer first.",
      );
    }

    return candidates[0].filePath;
  }

  openSession(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("Product capture data is required.");
    }

    const productId = normalizeText(input.productId, "productId", 100);
    const productName = normalizeText(input.productName, "productName", 500);
    const productUrl = normalizeShopeeUrl(input.productUrl);

    if (!fs.existsSync(this.extensionPath)) {
      throw new Error("AffiFlow Capture extension source was not found.");
    }

    const browserPath = this.findBrowser();

    const session = {
      sessionId: randomUUID(),
      productId,
      productName,
      productUrl,
      status: "Needs Capture",
      createdAt: new Date().toISOString(),
    };

    fs.mkdirSync(this.sessionDirectory, { recursive: true });
    fs.writeFileSync(
      this.activeSessionPath,
      JSON.stringify(session, null, 2) + "\n",
      "utf8",
    );

    this.markProductsNeedsCapture([productId]);

    const child = spawn(
      browserPath,
      [
        \`--user-data-dir=\${this.profilePath}\`,
        \`--disable-extensions-except=\${this.extensionPath}\`,
        \`--load-extension=\${this.extensionPath}\`,
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        productUrl,
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      },
    );

    child.unref();

    return {
      ok: true,
      ...session,
      browserPath,
      nextStep:
        "Open the AffiFlow Capture extension in the Shopee product tab.",
    };
  }
}

module.exports = {
  AssistedMediaCapture,
};
`.replaceAll("\\`", "`");

write("electron/assistedMediaCapture.cjs", assistedMediaCapture);

let main = read("electron/main.cjs");

if (!main.includes(MARKER)) {
  main = replaceOnce(
    main,
    'const path = require("node:path");',
    'const path = require("node:path");\n\nconst {\n  AssistedMediaCapture,\n} = require("./assistedMediaCapture.cjs");',
    "main import",
  );

  main = replaceOnce(
    main,
    "let candidateMediaServer = null;",
    "let candidateMediaServer = null;\nlet assistedMediaCapture = null;",
    "main manager variable",
  );

  main = replaceRange(
    main,
    '  ipcMain.handle(\n    "capture-candidates:import-catalog",',
    "\n}\n\nfunction registerProductCleanupHandlers()",
    `  ipcMain.handle(
    "capture-candidates:import-catalog",
    async (event, candidateIds) => {
      assertTrustedRenderer(event);

      // ${MARKER}
      // Product import is immediate. Media is captured later from Product Catalog.
      const result = captureServer.importCandidatesToCatalog(candidateIds);

      const importedProductIds = result.results
        .filter((item) => !item.duplicate)
        .map((item) => item.productId);

      if (importedProductIds.length > 0) {
        foundationDatabase.syncExistingProductMedia();
        assistedMediaCapture.markProductsNeedsCapture(importedProductIds);
      }

      return {
        ...result,
        mediaQueuedCount: 0,
        mediaQueued: [],
        mediaQueueErrors: [],
        mediaStatus:
          importedProductIds.length > 0
            ? "Needs Capture"
            : "No new products",
      };
    },
  );`,
    "catalog import handler",
  );

  main = replaceOnce(
    main,
    'function registerFoundationHandlers() {\n  ipcMain.handle(\n    "foundation:product-readiness:list",',
    `function registerFoundationHandlers() {
  ipcMain.handle(
    "assisted-media:open",
    async (event, captureInput) => {
      assertTrustedRenderer(event);
      return assistedMediaCapture.openSession(captureInput);
    },
  );

  ipcMain.handle(
    "foundation:product-readiness:list",`,
    "assisted media IPC handler",
  );

  main = replaceRange(
    main,
    '  ipcMain.handle(\n    "foundation:product-media:retry",',
    '\n\n  ipcMain.handle(\n    "foundation:product-media:list",',
    `  ipcMain.handle(
    "foundation:product-media:retry",
    async (event, productId) => {
      assertTrustedRenderer(event);

      const product = productDatabase
        .listProducts()
        .find((item) => item.id === productId);

      if (!product) {
        throw new Error("Product was not found.");
      }

      return assistedMediaCapture.openSession({
        productId: product.id,
        productName: product.name,
        productUrl: product.sourceUrl,
      });
    },
  );`,
    "retry media handler",
  );

  main = replaceOnce(
    main,
    '    "foundation:product-readiness:list",',
    '    "assisted-media:open",\n    "foundation:product-readiness:list",',
    "IPC removal list",
  );

  main = replaceOnce(
    main,
    `  productMediaWorker =
    new ProductMediaWorker(
      databasePath,
    );`,
    `  // ${MARKER}
  // Automatic product media discovery is disabled.
  productMediaWorker = null;`,
    "automatic worker creation",
  );

  main = replaceOnce(
    main,
    `  candidateMediaServer =
    new CandidateMediaServer(
      databasePath,
    );`,
    `  candidateMediaServer =
    new CandidateMediaServer(
      databasePath,
    );

  assistedMediaCapture =
    new AssistedMediaCapture({
      databasePath,
      projectRoot: path.join(__dirname, ".."),
    });

  assistedMediaCapture.prepare();`,
    "assisted manager initialization",
  );

  main = replaceOnce(
    main,
    "  productMediaWorker.start();",
    "  // Automatic media worker intentionally not started.",
    "automatic worker start",
  );

  main = replaceOnce(
    main,
    "  if (foundationDatabase) {",
    "  assistedMediaCapture = null;\n\n  if (foundationDatabase) {",
    "assisted manager shutdown",
  );
}

write("electron/main.cjs", main);

let preload = read("electron/preload.cjs");

if (!preload.includes("const assistedMediaApi")) {
  preload = replaceOnce(
    preload,
    "const clipboardApi =\n  Object.freeze({",
    `const assistedMediaApi =
  Object.freeze({
    open(captureInput) {
      return ipcRenderer.invoke(
        "assisted-media:open",
        captureInput,
      );
    },
  });

const clipboardApi =
  Object.freeze({`,
    "preload assisted media API",
  );

  preload = replaceOnce(
    preload,
    "    captureCandidates:\n      captureCandidatesApi,",
    "    captureCandidates:\n      captureCandidatesApi,\n    assistedMedia:\n      assistedMediaApi,",
    "preload API exposure",
  );
}

write("electron/preload.cjs", preload);

write(
  "frontend/src/services/assistedMedia.js",
  `function getAssistedMediaApi() {
  const api = window.affiFlow?.assistedMedia;

  if (!api || typeof api.open !== "function") {
    throw new Error(
      "AffiFlow Assisted Media service is unavailable.",
    );
  }

  return api;
}

export async function openAssistedMediaCapture({
  productId,
  productName,
  productUrl,
}) {
  return getAssistedMediaApi().open({
    productId,
    productName,
    productUrl,
  });
}
`,
);

let hunter = read("frontend/src/pages/ProductHunterPage.jsx");

if (!hunter.includes("catalogCaptureMediaButton")) {
  hunter = replaceOnce(
    hunter,
    "  ImageOff,\n  Link2,",
    "  ImageOff,\n  Images,\n  Link2,",
    "Product Hunter Images icon import",
  );

  hunter = replaceOnce(
    hunter,
    'import {\n  loadImportedProductMedia,\n} from "../services/catalogMedia.js";',
    'import {\n  loadImportedProductMedia,\n} from "../services/catalogMedia.js";\n\nimport {\n  openAssistedMediaCapture,\n} from "../services/assistedMedia.js";',
    "Product Hunter assisted service import",
  );

  hunter = replaceOnce(
    hunter,
    "  isDeleting,\n  onSelectionChange,",
    "  isDeleting,\n  isOpeningCapture,\n  onSelectionChange,",
    "catalog card capture state property",
  );

  hunter = replaceOnce(
    hunter,
    "  onCopyAffiliateLink,\n  onDelete,",
    "  onCopyAffiliateLink,\n  onCaptureMedia,\n  onDelete,",
    "catalog card capture handler property",
  );

  hunter = replaceOnce(
    hunter,
    `        <div className="catalogProductLinkActions">
          <button
            className={
              affiliateLink
                ? "catalogAffiliateButton available"
                : "catalogAffiliateButton"
            }`,
    `        <div className="catalogProductLinkActions">
          <button
            className="catalogCaptureMediaButton"
            type="button"
            disabled={
              isOpeningCapture ||
              !(affiliateLink || product.sourceUrl)
            }
            title="Open this product in AffiFlow Chrome for assisted media capture"
            onClick={() =>
              onCaptureMedia(
                product,
                affiliateLink || product.sourceUrl,
              )
            }
          >
            {isOpeningCapture ? (
              <LoaderCircle className="catalogSpinner" size={14} />
            ) : (
              <Images size={14} />
            )}

            {isOpeningCapture ? "Opening..." : "Capture Media"}
          </button>

          <button
            className={
              affiliateLink
                ? "catalogAffiliateButton available"
                : "catalogAffiliateButton"
            }`,
    "Product Catalog Capture Media button",
  );

  hunter = replaceOnce(
    hunter,
    `  const [
    copiedProductId,
    setCopiedProductId,
  ] = useState("");`,
    `  const [
    copiedProductId,
    setCopiedProductId,
  ] = useState("");

  const [
    openingCaptureProductId,
    setOpeningCaptureProductId,
  ] = useState("");

  const [
    captureMessage,
    setCaptureMessage,
  ] = useState("");`,
    "Product Catalog capture state",
  );

  hunter = replaceOnce(
    hunter,
    `  async function handleCopyAffiliateLink(
    productId,
    affiliateLink,
  ) {
    await copyAffiliateLink(
      affiliateLink,
    );

    setCopiedProductId(
      productId,
    );

    window.setTimeout(
      () => {
        setCopiedProductId("");
      },
      1600,
    );
  }

  return (`,
    `  async function handleCopyAffiliateLink(
    productId,
    affiliateLink,
  ) {
    await copyAffiliateLink(affiliateLink);
    setCopiedProductId(productId);

    window.setTimeout(() => {
      setCopiedProductId("");
    }, 1600);
  }

  async function handleCaptureMedia(product, productUrl) {
    setOpeningCaptureProductId(product.id);
    setCaptureMessage("");
    setError("");

    try {
      const result = await openAssistedMediaCapture({
        productId: product.id,
        productName: product.name,
        productUrl,
      });

      setCaptureMessage(
        result?.nextStep ||
          "Shopee product opened in AffiFlow Chrome. Open the AffiFlow Capture extension to continue.",
      );
    } catch (captureError) {
      setError(
        captureError instanceof Error
          ? captureError.message
          : "Assisted media capture could not be opened.",
      );
    } finally {
      setOpeningCaptureProductId("");
    }
  }

  return (`,
    "Product Catalog capture handler",
  );

  hunter = replaceOnce(
    hunter,
    `      {error && (
        <div className="catalogDeleteError">
          {error}
        </div>
      )}`,
    `      {error && (
        <div className="catalogDeleteError">
          {error}
        </div>
      )}

      {captureMessage && (
        <div className="catalogCaptureMessage">
          <CheckCircle2 size={16} />
          {captureMessage}
        </div>
      )}`,
    "Product Catalog capture status message",
  );

  hunter = replaceOnce(
    hunter,
    `                isDeleting={
                  deletingProductId ===
                  product.id
                }
                onSelectionChange={`,
    `                isDeleting={
                  deletingProductId ===
                  product.id
                }
                isOpeningCapture={
                  openingCaptureProductId ===
                  product.id
                }
                onSelectionChange={`,
    "Product card capture state pass-through",
  );

  hunter = replaceOnce(
    hunter,
    `                onCopyAffiliateLink={
                  handleCopyAffiliateLink
                }
                onDelete={`,
    `                onCopyAffiliateLink={
                  handleCopyAffiliateLink
                }
                onCaptureMedia={
                  handleCaptureMedia
                }
                onDelete={`,
    "Product card capture handler pass-through",
  );
}

write("frontend/src/pages/ProductHunterPage.jsx", hunter);

let hunterCss = read("frontend/src/pages/ProductHunterPage.css");

if (!hunterCss.includes(MARKER)) {
  hunterCss += `

/* ${MARKER} */
.catalogCaptureMessage {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  margin-bottom: 15px;
  border: 1px solid rgba(34, 197, 94, 0.42);
  border-radius: 8px;
  background: rgba(20, 83, 45, 0.3);
  color: #bbf7d0;
  font-size: 11px;
}

.catalogCaptureMediaButton {
  padding: 7px 9px !important;
  border: 1px solid rgba(34, 197, 94, 0.42) !important;
  border-radius: 7px;
  background: rgba(20, 83, 45, 0.26) !important;
  color: #86efac !important;
  white-space: nowrap;
}

.catalogCaptureMediaButton:hover:not(:disabled) {
  background: rgba(22, 101, 52, 0.46) !important;
  color: #dcfce7 !important;
}

.catalogCaptureMediaButton:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.catalogProductLinkActions {
  flex-wrap: wrap;
  justify-content: flex-end;
}
`;
}

write("frontend/src/pages/ProductHunterPage.css", hunterCss);

let readiness = read("frontend/src/components/ProductReadinessPanel.jsx");

if (!readiness.includes("openAssistedMediaCapture")) {
  readiness = replaceOnce(
    readiness,
    "  Image,\n  Link2,",
    "  Image,\n  Images,\n  Link2,",
    "Readiness Images icon import",
  );

  readiness = replaceOnce(
    readiness,
    "  RefreshCw,\n  Video,",
    "  Video,",
    "Readiness old retry icon removal",
  );

  readiness = replaceOnce(
    readiness,
    'import {\n  retryProductMedia,\n} from "../services/foundation.js";',
    'import {\n  openAssistedMediaCapture,\n} from "../services/assistedMedia.js";',
    "Readiness assisted service import",
  );

  readiness = replaceOnce(
    readiness,
    `  async function handleRetry(
    productId,
  ) {
    setRetryingProductId(
      productId,
    );

    try {
      await retryProductMedia(
        productId,
      );

      if (onRefresh) {
        await onRefresh();
      }
    } finally {
      setRetryingProductId("");
    }
  }`,
    `  async function handleRetry(productId) {
    setRetryingProductId(productId);

    try {
      const product = products.find((item) => item.id === productId);

      if (!product) {
        throw new Error("Product was not found.");
      }

      await openAssistedMediaCapture({
        productId: product.id,
        productName: product.name,
        productUrl: product.sourceUrl,
      });

      if (onRefresh) {
        await onRefresh();
      }
    } finally {
      setRetryingProductId("");
    }
  }`,
    "Readiness capture handler",
  );

  readiness = replaceOnce(
    readiness,
    `                  {item.jobStatus ===
                    "Failed" && (`,
    `                  {item.overallStatus !==
                    "Ready" && (`,
    "Readiness capture action condition",
  );

  readiness = replaceOnce(
    readiness,
    `                        <RefreshCw
                          size={14}
                        />`,
    `                        <Images
                          size={14}
                        />`,
    "Readiness capture icon",
  );

  readiness = replaceOnce(
    readiness,
    "                      Retry",
    "                      Capture Media",
    "Readiness capture label",
  );
}

write("frontend/src/components/ProductReadinessPanel.jsx", readiness);

let workspace = read("frontend/src/pages/ProductHunterWorkspacePage.jsx");
workspace = workspace.replace(
  "Media telah dimasukkan ke processing queue.",
  "Status media ditetapkan kepada Needs Capture. Gunakan butang Capture Media dalam Product Catalog.",
);
write("frontend/src/pages/ProductHunterWorkspacePage.jsx", workspace);

let popup = read("extensions/affiflow-capture/popup.js");
const popupMarker = "// AFFIFLOW_PERSISTENT_MEDIA_RUNNER_POPUP_V1";
const popupIndex = popup.indexOf(popupMarker);

if (popupIndex >= 0) {
  popup = popup.slice(0, popupIndex) +
    `// ${MARKER}\n// Persistent background media runner removed.\n`;
}

write("extensions/affiflow-capture/popup.js", popup);

const manifestPath = "extensions/affiflow-capture/manifest.json";
const manifest = JSON.parse(read(manifestPath));
manifest.version = "0.10.0";
manifest.description =
  "Shopee Product Scanner with one-click assisted media capture from Product Catalog.";
write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

let launcher = read("Launch-AffiFlow-Chrome.cmd");
launcher = launcher
  .split(/\r?\n/)
  .filter((line) =>
    !line.includes("mediaRunner.html") &&
    !line.toLowerCase().startsWith("timeout /t 7"),
  )
  .join("\n")
  .replace(/\n*$/, "\n");
write("Launch-AffiFlow-Chrome.cmd", launcher);

const verification = {
  version: JSON.parse(read(manifestPath)).version,
  main: read("electron/main.cjs").includes(MARKER),
  manager: fs.existsSync(file("electron/assistedMediaCapture.cjs")),
  preload: read("electron/preload.cjs").includes("assistedMediaApi"),
  productCatalog: read("frontend/src/pages/ProductHunterPage.jsx").includes("Capture Media"),
  readiness: read("frontend/src/components/ProductReadinessPanel.jsx").includes("openAssistedMediaCapture"),
  oldPopupRunnerRemoved: !read("extensions/affiflow-capture/popup.js").includes(
    "AFFIFLOW_PERSISTENT_MEDIA_RUNNER_POPUP_V1",
  ),
};

if (
  verification.version !== "0.10.0" ||
  Object.entries(verification)
    .filter(([key]) => key !== "version")
    .some(([, value]) => value !== true)
) {
  throw new Error("Assisted Media Phase 1 verification failed: " + JSON.stringify(verification));
}

console.log(JSON.stringify({
  ok: true,
  phase: "Assisted Media Phase 1",
  ...verification,
}, null, 2));
