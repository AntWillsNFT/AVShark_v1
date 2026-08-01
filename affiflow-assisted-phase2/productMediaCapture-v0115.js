(() => {
  "use strict";

  const INSTALL_KEY = "__AFFIFLOW_COORDINATE_GALLERY_V0115__";
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  const MESSAGE_TYPE = "AFFIFLOW_DISCOVER_PRODUCT_MEDIA";
  const MAX_IMAGES = 24;
  const MAX_VIDEOS = 8;
  const MAX_TARGETS = 20;
  const EXCLUDED_CONTEXT = /review|rating|comment|feedback|buyer|customer|avatar|profile|recommend|related|similar|suggest|header|footer|navbar|navigation|logo|banner|voucher|campaign|chat|share|social|favorite|follow/i;
  const EXCLUDED_URL = /avatar|profile|icon|logo|sprite|emoji|badge|banner|voucher|campaign|rating|review|comment|feedback/i;
  const VIDEO_URL_PATTERN = /\.mp4(?:$|[?#])|\.m3u8(?:$|[?#])|\/video\/|playback|stream|transcode|vod|cvf/i;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function rectOf(element) {
    try {
      return element.getBoundingClientRect();
    } catch {
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    }
  }

  function pageTop(element) {
    return rectOf(element).top + window.scrollY;
  }

  function signature(element) {
    const parts = [];
    let current = element;
    for (let depth = 0; current && depth < 7; depth += 1) {
      parts.push(
        current.id || "",
        typeof current.className === "string" ? current.className : "",
        current.getAttribute?.("data-sqe") || "",
        current.getAttribute?.("data-testid") || "",
        current.getAttribute?.("aria-label") || "",
        current.getAttribute?.("title") || "",
        current.getAttribute?.("role") || ""
      );
      current = current.parentElement;
    }
    return parts.join(" ").toLowerCase();
  }

  function excluded(element) {
    return !element || EXCLUDED_CONTEXT.test(signature(element));
  }

  function visible(element) {
    if (!element) return false;
    const rect = rectOf(element);
    if (rect.width < 1 || rect.height < 1) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  }

  function absoluteUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value.trim(), window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.href;
    } catch {
      return "";
    }
  }

  function improveImageUrl(value) {
    const absolute = absoluteUrl(value);
    if (!absolute) return "";
    try {
      const url = new URL(absolute);
      url.pathname = url.pathname
        .replace(/@resize_w\d+_nl(?:\.[a-z0-9]+)?$/i, "")
        .replace(/_tn$/i, "");
      return url.href;
    } catch {
      return absolute;
    }
  }

  function backgroundUrls(element) {
    const results = [];
    let value = "";
    try {
      value = window.getComputedStyle(element).backgroundImage;
    } catch {
      value = "";
    }
    if (!value || value === "none") return results;
    for (const match of value.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
      if (match[2]) results.push(match[2]);
    }
    return results;
  }

  function largestSrcset(image) {
    const srcset = image.getAttribute("srcset");
    if (!srcset) return "";
    const entries = srcset.split(",").map((part) => {
      const pieces = part.trim().split(/\s+/);
      return { url: pieces[0] || "", size: Number.parseFloat(pieces[1] || "0") || 0 };
    }).filter((entry) => entry.url).sort((left, right) => right.size - left.size);
    return entries[0]?.url || "";
  }

  function pushImage(images, seen, value) {
    const normalized = improveImageUrl(value);
    if (!normalized || EXCLUDED_URL.test(normalized)) return;
    const key = normalized.replace(/[?#].*$/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    images.push(normalized);
  }

  function pushVideo(videos, seen, value) {
    if (typeof value !== "string" || !value || value.startsWith("blob:")) return;
    const normalized = absoluteUrl(value);
    if (!normalized || EXCLUDED_URL.test(normalized)) return;
    const key = normalized.replace(/[?#].*$/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    videos.push(normalized);
  }

  function mainMediaScore(element) {
    if (!visible(element) || excluded(element)) return -1;
    const rect = rectOf(element);
    const top = pageTop(element);
    if (rect.width < 250 || rect.height < 250 || top < 100 || top > 1700 || rect.left > window.innerWidth * 0.65) return -1;
    const area = rect.width * rect.height;
    const leftBonus = rect.left < window.innerWidth * 0.5 ? 350000 : 0;
    const mediaBonus = element.tagName === "VIDEO" ? 300000 : 0;
    let source = "";
    if (element.tagName === "IMG") source = element.currentSrc || element.src || "";
    const hostBonus = /shopee|susercontent/i.test(source) ? 180000 : 0;
    return area + leftBonus + mediaBonus + hostBonus - top * 20;
  }

  function findMainMedia() {
    const candidates = Array.from(document.querySelectorAll("img,video")).map((element) => ({
      element,
      score: mainMediaScore(element)
    })).filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score);
    return candidates[0]?.element || null;
  }

  function hasMediaEvidence(element) {
    if (!element || excluded(element)) return false;
    if (element.matches?.("img,video")) return true;
    if (element.querySelector?.("img,video")) return true;
    if (backgroundUrls(element).length > 0) return true;
    return /video|play|movie|media/.test(signature(element));
  }

  function clickableAncestor(element) {
    let current = element;
    let fallback = element;
    for (let depth = 0; current && depth < 6; depth += 1) {
      const rect = rectOf(current);
      if (rect.width >= 28 && rect.height >= 28 && rect.width <= 180 && rect.height <= 180) {
        fallback = current;
        let cursor = "";
        try { cursor = window.getComputedStyle(current).cursor; } catch { cursor = ""; }
        if (current.matches?.("button,li,a,[role='button']") || cursor === "pointer" || typeof current.onclick === "function") return current;
      }
      current = current.parentElement;
    }
    return fallback;
  }

  function candidateKey(element) {
    const rect = rectOf(element);
    return [
      Math.round(rect.left / 6),
      Math.round(rect.top / 6),
      Math.round(rect.width / 6),
      Math.round(rect.height / 6)
    ].join(":");
  }

  function collectCoordinateTargets(mainRect) {
    const rowTop = Math.max(0, mainRect.bottom - 15);
    const rowBottom = Math.min(window.innerHeight - 1, mainRect.bottom + 145);
    const left = Math.max(0, mainRect.left - 150);
    const right = Math.min(window.innerWidth - 1, mainRect.right + 220);
    const targetMap = new Map();
    const ySteps = [rowTop + 12, rowTop + 34, rowTop + 58, rowTop + 84, rowTop + 112, rowTop + 136]
      .filter((value) => value >= 0 && value <= rowBottom);

    for (let x = left; x <= right; x += 12) {
      for (const y of ySteps) {
        const stack = document.elementsFromPoint(x, y);
        for (const element of stack) {
          if (!visible(element) || excluded(element) || !hasMediaEvidence(element)) continue;
          const target = clickableAncestor(element);
          if (!target || excluded(target)) continue;
          const rect = rectOf(target);
          if (rect.width < 28 || rect.height < 28 || rect.width > 180 || rect.height > 180) continue;
          if (rect.bottom < rowTop || rect.top > rowBottom || rect.right < left || rect.left > right) continue;
          const key = candidateKey(target);
          if (!targetMap.has(key)) targetMap.set(key, target);
        }
      }
    }

    for (const element of document.querySelectorAll("img,video,button,li,[role='button'],div")) {
      if (!visible(element) || excluded(element) || !hasMediaEvidence(element)) continue;
      const rect = rectOf(element);
      if (rect.width < 28 || rect.height < 28 || rect.width > 180 || rect.height > 180) continue;
      if (rect.bottom < rowTop || rect.top > rowBottom || rect.right < left || rect.left > right) continue;
      const target = clickableAncestor(element);
      if (!target || excluded(target)) continue;
      const key = candidateKey(target);
      if (!targetMap.has(key)) targetMap.set(key, target);
    }

    const targets = Array.from(targetMap.values()).sort((leftElement, rightElement) => {
      const leftRect = rectOf(leftElement);
      const rightRect = rectOf(rightElement);
      if (Math.abs(leftRect.top - rightRect.top) > 10) return leftRect.top - rightRect.top;
      return leftRect.left - rightRect.left;
    });

    const filtered = [];
    for (const target of targets) {
      const rect = rectOf(target);
      const duplicate = filtered.some((existing) => {
        const existingRect = rectOf(existing);
        return Math.abs(existingRect.left - rect.left) < 10 && Math.abs(existingRect.top - rect.top) < 10;
      });
      if (!duplicate) filtered.push(target);
    }
    return filtered.slice(0, MAX_TARGETS);
  }

  function collectImageElement(image, images, imageSeen) {
    const values = [
      largestSrcset(image),
      image.currentSrc,
      image.src,
      image.getAttribute("data-src"),
      image.getAttribute("data-original"),
      image.getAttribute("data-lazy-src")
    ];
    for (const value of values) pushImage(images, imageSeen, value);
  }

  function collectVideoElement(video, videos, videoSeen) {
    const values = [
      video.currentSrc,
      video.src,
      video.getAttribute("data-src"),
      video.getAttribute("data-video-url")
    ];
    for (const source of video.querySelectorAll("source")) {
      values.push(source.src, source.getAttribute("data-src"));
    }
    for (const value of values) pushVideo(videos, videoSeen, value);
  }

  function coversPoint(element, x, y) {
    const rect = rectOf(element);
    return rect.width >= 100 && rect.height >= 100 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function captureMainPoint(anchorRect, images, imageSeen, videos, videoSeen) {
    const x = Math.max(1, Math.min(window.innerWidth - 2, anchorRect.left + anchorRect.width / 2));
    const y = Math.max(1, Math.min(window.innerHeight - 2, anchorRect.top + anchorRect.height / 2));
    const roots = [];
    const seenRoots = new Set();
    for (const pointElement of document.elementsFromPoint(x, y)) {
      let current = pointElement;
      for (let depth = 0; current && depth < 7; depth += 1) {
        if (!seenRoots.has(current)) {
          seenRoots.add(current);
          roots.push(current);
        }
        current = current.parentElement;
      }
    }

    for (const root of roots) {
      const videosAtPoint = [];
      if (root.matches?.("video")) videosAtPoint.push(root);
      for (const video of root.querySelectorAll?.("video") || []) videosAtPoint.push(video);
      for (const video of videosAtPoint) {
        if (coversPoint(video, x, y)) {
          collectVideoElement(video, videos, videoSeen);
          return "Video";
        }
      }
    }

    for (const root of roots) {
      const imagesAtPoint = [];
      if (root.matches?.("img")) imagesAtPoint.push(root);
      for (const image of root.querySelectorAll?.("img") || []) imagesAtPoint.push(image);
      for (const image of imagesAtPoint) {
        if (coversPoint(image, x, y) && !excluded(image)) {
          collectImageElement(image, images, imageSeen);
          return "Image";
        }
      }
    }

    for (const root of roots) {
      if (!coversPoint(root, x, y) || excluded(root)) continue;
      const urls = backgroundUrls(root);
      if (urls.length < 1) continue;
      for (const url of urls) pushImage(images, imageSeen, url);
      return "Image";
    }
    return "";
  }

  function collectTargetFallback(target, images, imageSeen) {
    const imagesInside = [];
    if (target.matches?.("img")) imagesInside.push(target);
    for (const image of target.querySelectorAll?.("img") || []) imagesInside.push(image);
    for (const image of imagesInside) collectImageElement(image, images, imageSeen);
    for (const url of backgroundUrls(target)) pushImage(images, imageSeen, url);
    for (const child of target.querySelectorAll?.("div,span") || []) {
      for (const url of backgroundUrls(child)) pushImage(images, imageSeen, url);
    }
  }

  async function activateTarget(target) {
    try { target.scrollIntoView({ block: "nearest", inline: "center" }); } catch {}
    await sleep(80);
    for (const eventName of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        target.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
      } catch {}
    }
    try { target.click(); } catch {}
    await sleep(700);
  }

  function collectRecentVideoResources(startedAt, videos, videoSeen) {
    let entries = [];
    try { entries = performance.getEntriesByType("resource"); } catch { entries = []; }
    for (const entry of entries) {
      if (Number(entry.startTime) < startedAt - 100) continue;
      const url = typeof entry.name === "string" ? entry.name : "";
      if (!VIDEO_URL_PATTERN.test(url) || !/shopee|susercontent/i.test(url)) continue;
      pushVideo(videos, videoSeen, url);
    }
  }

  async function scanCoordinateGallery() {
    const mainMedia = findMainMedia();
    if (!mainMedia) throw new Error("AffiFlow could not identify the main seller media. Return to the top of the product page and scan again.");
    const anchorRect = rectOf(mainMedia);
    const targets = collectCoordinateTargets(anchorRect);
    if (targets.length < 2) {
      throw new Error("AffiFlow found only " + targets.length + " gallery target(s). Keep the product gallery visible and scan again.");
    }

    const images = [];
    const videos = [];
    const imageSeen = new Set();
    const videoSeen = new Set();
    captureMainPoint(anchorRect, images, imageSeen, videos, videoSeen);

    for (const target of targets) {
      const startedAt = performance.now();
      await activateTarget(target);
      const capturedType = captureMainPoint(anchorRect, images, imageSeen, videos, videoSeen);
      collectRecentVideoResources(startedAt, videos, videoSeen);
      if (capturedType !== "Video") collectTargetFallback(target, images, imageSeen);
    }

    if (images.length < 1) throw new Error("No seller product image was detected.");
    return {
      ok: true,
      images: images.slice(0, MAX_IMAGES),
      videos: videos.slice(0, MAX_VIDEOS),
      source: "coordinate-gallery-row",
      scannerVersion: "0.11.5",
      diagnostics: {
        targetCount: targets.length,
        imageCount: images.length,
        videoCount: videos.length,
        mainWidth: Math.round(anchorRect.width),
        mainHeight: Math.round(anchorRect.height),
        rowTop: Math.round(anchorRect.bottom - 15),
        rowBottom: Math.round(anchorRect.bottom + 145)
      }
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPE) return undefined;
    scanCoordinateGallery().then(sendResponse).catch((error) => {
      sendResponse({
        ok: false,
        images: [],
        videos: [],
        source: "coordinate-gallery-row",
        scannerVersion: "0.11.5",
        error: error instanceof Error ? error.message : "Seller gallery scan failed."
      });
    });
    return true;
  });
})();
