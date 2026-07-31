"use strict";

const fs = require("node:fs");
const path = require("node:path");

const project = path.resolve(process.argv[2]);
const extension = path.join(project, "extensions", "affiflow-capture");
const backgroundPath = path.join(extension, "background.js");
const runnerPath = path.join(extension, "mediaRunner.js");
const manifestPath = path.join(extension, "manifest.json");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content, "utf8");
}

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker not found.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`${label}: end marker not found.`);
  return source.slice(0, start) + replacement + "\n\n" + source.slice(end);
}

function replaceOnce(source, oldValue, newValue, label) {
  const index = source.indexOf(oldValue);
  if (index < 0) throw new Error(`${label}: expected block not found.`);
  return source.slice(0, index) + newValue + source.slice(index + oldValue.length);
}

const PATCH_MARKER = "AFFIFLOW_MEDIA_RUNNER_V13";

let background = read(backgroundPath);

background = replaceBetween(
  background,
  "function ensureRunner() {",
  "function scheduleResume() {",
  `function ensureRunner() {
  // ${PATCH_MARKER}: the old batch engine must never claim post-approval media jobs.
  return Promise.resolve(null);
}`,
  "Disable legacy batch runner",
);

background = replaceBetween(
  background,
  "function scheduleResume() {",
  "async function pauseBatch() {",
  `function scheduleResume() {
  // ${PATCH_MARKER}: clear the old alarm instead of scheduling background discovery.
  void chrome.alarms.clear(
    RESUME_ALARM,
  );
}`,
  "Disable legacy resume alarm",
);

if (!background.includes(`${PATCH_MARKER}_CLEANUP`)) {
  background += `\n\n// ${PATCH_MARKER}_CLEANUP\nvoid chrome.alarms.clear(RESUME_ALARM);\nvoid chrome.storage.local.remove(STORAGE_KEY);\n`;
}

write(backgroundPath, background);

let runner = read(runnerPath);

const discoverMedia = String.raw`async function discoverMedia(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async () => {
      const MAX_IMAGES = 60;
      const MAX_VIDEOS = 10;
      const images = new Set();
      const videos = new Set();
      const sleep = (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds));

      function absoluteUrl(value) {
        if (typeof value !== "string" || !value.trim()) return "";

        const cleaned = value
          .trim()
          .replaceAll("\\u002F", "/")
          .replaceAll("\\u002f", "/")
          .replaceAll("\\u0026", "&")
          .replaceAll("\\/", "/")
          .replace(/^['\"]+|['\"]+$/g, "");

        try {
          return new URL(cleaned, location.href).toString();
        } catch {
          return "";
        }
      }

      function normalizeImage(value) {
        if (typeof value !== "string" || !value.trim()) return "";

        const raw = value.trim();

        if (/^[A-Za-z0-9_-]{16,}$/.test(raw)) {
          return "https://down-my.img.susercontent.com/file/" + raw;
        }

        const url = absoluteUrl(raw);
        if (!url) return "";

        try {
          const parsed = new URL(url);
          if (!parsed.hostname.toLowerCase().includes("susercontent.com")) return "";

          parsed.search = "";
          parsed.hash = "";
          parsed.pathname = parsed.pathname
            .replace(/@resize_[^/]+$/i, "")
            .replace(/_tn$/i, "");

          return parsed.toString();
        } catch {
          return "";
        }
      }

      function addImage(value) {
        const url = normalizeImage(value);
        if (url) images.add(url);
      }

      function addVideo(value) {
        const url = absoluteUrl(value);
        if (!url || !/^https?:/i.test(url)) return;

        const lower = url.toLowerCase();
        if (/\.mp4(?:$|[?#])/i.test(url) ||
            (lower.includes("susercontent.com") && lower.includes("video"))) {
          videos.add(url);
        }
      }

      function walk(value, depth = 0, keyHint = "") {
        if (value === null || value === undefined || depth > 9) return;

        if (typeof value === "string") {
          if (/image|media|cover|thumb|display|banner|url|src/i.test(keyHint)) {
            addImage(value);
          }
          if (/video|play|url|src/i.test(keyHint)) {
            addVideo(value);
          }
          return;
        }

        if (Array.isArray(value)) {
          for (const item of value) walk(item, depth + 1, keyHint);
          return;
        }

        if (typeof value !== "object") return;

        for (const [key, item] of Object.entries(value)) {
          if (/image|images|media|cover|thumb|display|video|play|url|src|poster/i.test(key) ||
              typeof item === "object") {
            walk(item, depth + 1, key);
          }
        }
      }

      function collectScriptText(text) {
        if (typeof text !== "string" || !text) return;

        const normalized = text
          .replaceAll("\\u002F", "/")
          .replaceAll("\\u002f", "/")
          .replaceAll("\\u0026", "&")
          .replaceAll("\\/", "/");

        const urlPattern = /https?:\/\/[^\s"'<>]+/gi;
        for (const match of normalized.matchAll(urlPattern)) {
          const value = match[0].replace(/[),;]+$/g, "");
          addImage(value);
          addVideo(value);
        }

        const keyedImagePattern = /"(?:image|image_id|display_image|cover|thumbnail|thumb_url)"\s*:\s*"([A-Za-z0-9_-]{16,})"/gi;
        for (const match of normalized.matchAll(keyedImagePattern)) addImage(match[1]);

        const imageArrayPattern = /"images"\s*:\s*\[([^\]]{1,30000})\]/gi;
        for (const arrayMatch of normalized.matchAll(imageArrayPattern)) {
          const idPattern = /"([A-Za-z0-9_-]{16,})"/g;
          for (const idMatch of arrayMatch[1].matchAll(idPattern)) addImage(idMatch[1]);
        }
      }

      function collectGlobalData() {
        const globalNames = [
          "__INITIAL_STATE__",
          "__NEXT_DATA__",
          "__NUXT__",
          "__APOLLO_STATE__",
          "__SHOPEE__",
          "__PRELOADED_STATE__",
        ];

        for (const name of globalNames) {
          try {
            walk(globalThis[name], 0, name);
          } catch {
          }
        }
      }

      function collectDomMedia() {
        collectGlobalData();

        for (const meta of document.querySelectorAll(
          'meta[property="og:image"],meta[name="twitter:image"],meta[property="og:video"],meta[property="og:video:url"]',
        )) {
          addImage(meta.content);
          addVideo(meta.content);
        }

        for (const image of document.querySelectorAll("img")) {
          addImage(image.currentSrc);
          addImage(image.src);
          addImage(image.getAttribute("data-src"));
          addImage(image.getAttribute("data-lazy-src"));
          addImage(image.getAttribute("data-original"));

          const srcset = image.getAttribute("srcset") || "";
          for (const entry of srcset.split(",")) {
            addImage(entry.trim().split(/\s+/)[0]);
          }
        }

        for (const element of document.querySelectorAll("[style],source,video")) {
          for (const attribute of element.attributes || []) {
            if (/src|poster|image|url|style/i.test(attribute.name)) {
              collectScriptText(attribute.value);
              addImage(attribute.value);
              addVideo(attribute.value);
            }
          }

          try {
            const backgroundImage = getComputedStyle(element).backgroundImage;
            if (backgroundImage && backgroundImage !== "none") collectScriptText(backgroundImage);
          } catch {
          }
        }

        for (const video of document.querySelectorAll("video")) {
          addVideo(video.currentSrc);
          addVideo(video.src);
          addImage(video.poster);
          for (const source of video.querySelectorAll("source")) addVideo(source.src);
        }

        for (const resource of performance.getEntriesByType("resource")) {
          addImage(resource.name);
          addVideo(resource.name);
        }

        for (const script of document.scripts) {
          const text = script.textContent || "";
          if (/susercontent|"images"|image_id|video_info/i.test(text)) {
            collectScriptText(text.slice(0, 1500000));
          }
        }
      }

      function productIds() {
        const patterns = [
          /-i\.(\d+)\.(\d+)/i,
          /\/product\/(\d+)\/(\d+)/i,
        ];

        for (const pattern of patterns) {
          const match = location.pathname.match(pattern);
          if (match) return { shopId: match[1], itemId: match[2] };
        }

        const parsed = new URL(location.href);
        const shopId = parsed.searchParams.get("shop_id") || parsed.searchParams.get("shopid");
        const itemId = parsed.searchParams.get("item_id") || parsed.searchParams.get("itemid");
        return shopId && itemId ? { shopId, itemId } : null;
      }

      async function collectApiMedia() {
        const ids = productIds();
        if (!ids) return;

        const endpoints = [
          "/api/v4/pdp/get_pc?" + new URLSearchParams({ item_id: ids.itemId, shop_id: ids.shopId }),
          "/api/v4/item/get?" + new URLSearchParams({ itemid: ids.itemId, shopid: ids.shopId }),
        ];

        for (const endpoint of endpoints) {
          try {
            const response = await fetch(endpoint, {
              credentials: "include",
              headers: { accept: "application/json" },
              cache: "no-store",
            });
            if (!response.ok) continue;
            walk(await response.json(), 0, "api");
          } catch {
          }
        }
      }

      function galleryControls() {
        const controls = [];
        const seen = new Set();

        for (const image of document.querySelectorAll("img")) {
          const source = image.currentSrc || image.src || "";
          const rect = image.getBoundingClientRect();

          if (!/susercontent\.com/i.test(source) ||
              rect.width < 26 || rect.height < 26 ||
              rect.width > 250 || rect.height > 250 ||
              rect.top < -100 || rect.top > 1150 ||
              rect.left < -100 || rect.left > 1000) {
            continue;
          }

          const control =
            image.closest("button,[role='button'],[tabindex],li") ||
            image.parentElement || image;

          if (seen.has(control)) continue;
          seen.add(control);
          controls.push(control);
        }

        return controls.slice(0, 30);
      }

      try {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      } catch {
      }

      await collectApiMedia();

      for (let round = 0; round < 8; round += 1) {
        collectDomMedia();
        await sleep(500);
      }

      for (const control of galleryControls()) {
        try {
          control.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
          control.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }));
          await sleep(650);
          collectDomMedia();
        } catch {
        }
      }

      try {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      } catch {
      }

      for (let round = 0; round < 12; round += 1) {
        collectDomMedia();
        await sleep(500);
      }

      const imageList = Array.from(images).slice(0, MAX_IMAGES);
      const videoList = Array.from(videos).slice(0, MAX_VIDEOS);

      return {
        ok: imageList.length > 0,
        sourceUrl: location.href,
        images: imageList,
        videos: videoList,
        noVideoAvailable: videoList.length === 0,
        error: imageList.length > 0
          ? ""
          : "No official Shopee product images were found after DOM, resource, script, CSS and API discovery.",
      };
    },
  });

  return results.find((entry) => entry.frameId === 0)?.result || results[0]?.result || null;
}`;

runner = replaceBetween(
  runner,
  "async function discoverMedia(tabId) {",
  "async function failJob(candidateId, error) {",
  discoverMedia,
  "Replace persistent media discovery",
);

const oldDiscoveryBlock = `    setState("Collecting gallery", job.name || candidateId);
    const media = await discoverMedia(productTabId);

    if (!media?.ok || !Array.isArray(media.images) || media.images.length < 1) {
      throw new Error(media?.error || "No official product images were discovered.");
    }`;

const newDiscoveryBlock = `    setState("Collecting gallery", job.name || candidateId);
    let media = await discoverMedia(productTabId);

    if (!media?.ok || !Array.isArray(media.images) || media.images.length < 1) {
      log("First gallery pass found no images. Reloading the Shopee product once.");
      await chrome.tabs.reload(productTabId, { bypassCache: true });
      const reloaded = await waitForProductPage(productTabId);

      if (reloaded.captcha) {
        keepOpen = true;
        await requestJson(\`/api/jobs/\${encodeURIComponent(candidateId)}/requeue\`, {
          method: "POST",
          body: JSON.stringify({ reason: "Complete Shopee verification in the opened tab." }),
        });
        throw new Error("Shopee verification is required. Complete it in the opened product tab.");
      }

      await delay(2500);
      media = await discoverMedia(productTabId);
    }

    if (!media?.ok || !Array.isArray(media.images) || media.images.length < 1) {
      throw new Error(media?.error || "No official product images were discovered after retry.");
    }`;

runner = replaceOnce(
  runner,
  oldDiscoveryBlock,
  newDiscoveryBlock,
  "Add one clean product reload retry",
);

if (!runner.includes(PATCH_MARKER)) {
  runner = `// ${PATCH_MARKER}\n` + runner;
}

write(runnerPath, runner);

const manifest = JSON.parse(read(manifestPath));
manifest.version = "0.9.13";
manifest.description = "Persistent Shopee media runner with isolated legacy jobs and robust DOM, resource and script discovery.";
write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

for (const [filePath, markers] of [
  [backgroundPath, [PATCH_MARKER, `${PATCH_MARKER}_CLEANUP`, "return Promise.resolve(null)"]],
  [runnerPath, [PATCH_MARKER, "collectScriptText", "getComputedStyle", "First gallery pass found no images"]],
  [manifestPath, ['"version": "0.9.13"']],
]) {
  const source = read(filePath);
  for (const marker of markers) {
    if (!source.includes(marker)) {
      throw new Error(`Verification failed: ${path.basename(filePath)} missing ${marker}`);
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  version: manifest.version,
  legacyBatchRunner: "disabled",
  persistentRunner: "enabled",
  discovery: "DOM + CSS + resources + scripts + page globals + API + one reload",
}, null, 2));
