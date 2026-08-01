(() => {
  "use strict";

  const INSTALL_KEY = "__AFFIFLOW_TOP_GALLERY_AUTO_V0118__";
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  const MESSAGE_TYPE = "AFFIFLOW_CAPTURE_TOP_SELLER_GALLERY";
  const MAX_IMAGES = 30;
  const MAX_VIDEOS = 8;
  const MAX_TARGETS = 24;

  const EXCLUDED_CONTEXT = /review|rating|comment|feedback|buyer|customer|avatar|profile|recommend|related|similar|suggest|header|footer|navbar|navigation|logo|banner|voucher|campaign|chat|share|social|favorite|follow|payment|visa|mastercard/i;
  const EXCLUDED_URL = /avatar|profile|icon|logo|sprite|emoji|badge|banner|voucher|campaign|rating|review|comment|feedback|visa|mastercard/i;
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

    let style;
    try {
      style = window.getComputedStyle(element);
    } catch {
      return false;
    }

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0
    );
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

    const entries = srcset
      .split(",")
      .map((part) => {
        const pieces = part.trim().split(/\s+/);
        return {
          url: pieces[0] || "",
          size: Number.parseFloat(pieces[1] || "0") || 0,
        };
      })
      .filter((entry) => entry.url)
      .sort((left, right) => right.size - left.size);

    return entries[0]?.url || "";
  }

  function pushImage(images, seen, value) {
    const normalized = improveImageUrl(value);
    if (!normalized || EXCLUDED_URL.test(normalized)) return;
    if (!/shopee|susercontent/i.test(normalized)) return;

    const key = normalized.replace(/[?#].*$/, "").toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    images.push(normalized);
  }

  function pushVideo(videos, seen, value) {
    if (typeof value !== "string" || !value || value.startsWith("blob:")) return;

    const normalized = absoluteUrl(value);
    if (!normalized || EXCLUDED_URL.test(normalized)) return;
    if (!/shopee|susercontent/i.test(normalized)) return;

    const key = normalized.replace(/[?#].*$/, "").toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    videos.push(normalized);
  }

  function hasMediaEvidence(element) {
    if (!element || excluded(element)) return false;
    if (element.matches?.("img,video,canvas")) return true;
    if (backgroundUrls(element).length > 0) return true;
    if (element.querySelector?.("img,video,canvas")) return true;
    return /video|play|movie|media/.test(signature(element));
  }

  function clickableAncestor(element) {
    let current = element;
    let fallback = element;

    for (let depth = 0; current && depth < 6; depth += 1) {
      const rect = rectOf(current);

      if (
        rect.width >= 28 &&
        rect.height >= 28 &&
        rect.width <= 210 &&
        rect.height <= 210
      ) {
        fallback = current;

        let cursor = "";
        try {
          cursor = window.getComputedStyle(current).cursor;
        } catch {
          cursor = "";
        }

        if (
          current.matches?.("button,li,a,[role='button']") ||
          cursor === "pointer" ||
          typeof current.onclick === "function"
        ) {
          return current;
        }
      }

      current = current.parentElement;
    }

    return fallback;
  }

  function boxKey(element) {
    const rect = rectOf(element);
    return [
      Math.round(rect.left / 8),
      Math.round(rect.top / 8),
      Math.round(rect.width / 8),
      Math.round(rect.height / 8),
    ].join(":");
  }

  function collectSmallMediaBoxes() {
    const boxes = [];
    const seen = new Set();
    const selector = "img,video,canvas,button,li,[role='button'],div,span";

    for (const element of document.querySelectorAll(selector)) {
      if (!visible(element) || excluded(element) || !hasMediaEvidence(element)) continue;

      const rect = rectOf(element);
      const top = pageTop(element);
      const centreX = rect.left + rect.width / 2;

      if (
        rect.width < 28 ||
        rect.height < 28 ||
        rect.width > 180 ||
        rect.height > 180 ||
        top < 180 ||
        top > 950 ||
        centreX > Math.min(760, window.innerWidth * 0.66)
      ) {
        continue;
      }

      const target = clickableAncestor(element);
      if (!target || excluded(target)) continue;

      const targetRect = rectOf(target);
      if (
        targetRect.width < 28 ||
        targetRect.height < 28 ||
        targetRect.width > 210 ||
        targetRect.height > 210
      ) {
        continue;
      }

      const key = boxKey(target);
      if (seen.has(key)) continue;
      seen.add(key);

      boxes.push({
        target,
        left: targetRect.left,
        right: targetRect.right,
        top: pageTop(target),
        bottom: pageTop(target) + targetRect.height,
        width: targetRect.width,
        height: targetRect.height,
        centreX: targetRect.left + targetRect.width / 2,
        centreY: pageTop(target) + targetRect.height / 2,
      });
    }

    return boxes;
  }

  function clusterRows(boxes) {
    const rows = [];
    const sorted = [...boxes].sort((left, right) => left.centreY - right.centreY);

    for (const box of sorted) {
      let row = rows.find((candidate) => Math.abs(candidate.meanY - box.centreY) <= 26);

      if (!row) {
        row = { meanY: box.centreY, boxes: [] };
        rows.push(row);
      }

      row.boxes.push(box);
      row.meanY = row.boxes.reduce((total, item) => total + item.centreY, 0) / row.boxes.length;
    }

    return rows
      .map((row) => {
        const unique = [];
        const xSeen = new Set();

        for (const box of row.boxes.sort((left, right) => left.left - right.left)) {
          const key = Math.round(box.centreX / 18);
          if (xSeen.has(key)) continue;
          xSeen.add(key);
          unique.push(box);
        }

        const left = Math.min(...unique.map((item) => item.left));
        const right = Math.max(...unique.map((item) => item.right));
        const spread = right - left;
        const score = unique.length * 100000 + spread * 500 - Math.abs(row.meanY - 700) * 40;

        return {
          boxes: unique,
          meanY: row.meanY,
          left,
          right,
          spread,
          score,
        };
      })
      .filter((row) => row.boxes.length >= 3 && row.spread >= 180)
      .sort((left, right) => right.score - left.score);
  }

  function largeViewerEvidence(element) {
    if (!visible(element) || excluded(element)) return false;

    const rect = rectOf(element);
    if (rect.width < 260 || rect.height < 260) return false;

    if (element.matches?.("img,video,canvas")) return true;
    if (backgroundUrls(element).length > 0) return true;

    for (const child of element.querySelectorAll?.("img,video,canvas") || []) {
      const childRect = rectOf(child);
      if (
        childRect.width >= rect.width * 0.55 &&
        childRect.height >= rect.height * 0.55
      ) {
        return true;
      }
    }

    return false;
  }

  function findViewerForRow(row) {
    const candidates = [];
    const selector = "img,video,canvas,div,section,figure";

    for (const element of document.querySelectorAll(selector)) {
      if (!largeViewerEvidence(element)) continue;

      const rect = rectOf(element);
      const top = pageTop(element);
      const bottom = top + rect.height;
      const centreX = rect.left + rect.width / 2;
      const ratio = rect.width / Math.max(rect.height, 1);
      const verticalGap = row.meanY - bottom;

      if (
        rect.width > 720 ||
        rect.height > 720 ||
        ratio < 0.52 ||
        ratio > 1.45 ||
        top < 100 ||
        top > row.meanY ||
        verticalGap < -90 ||
        verticalGap > 240 ||
        centreX < row.left - 220 ||
        centreX > row.right + 220 ||
        rect.left > Math.min(700, window.innerWidth * 0.62)
      ) {
        continue;
      }

      const horizontalPenalty = Math.abs(rect.left - row.left);
      const area = rect.width * rect.height;
      const score = area - Math.abs(verticalGap) * 900 - horizontalPenalty * 180;

      candidates.push({ element, rect, top, bottom, score });
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0] || null;
  }

  function detectGallery() {
    const rows = clusterRows(collectSmallMediaBoxes());
    const candidates = [];

    for (const row of rows) {
      const viewer = findViewerForRow(row);
      if (!viewer) continue;

      const verticalGap = row.meanY - viewer.bottom;
      const rowScore = row.score + viewer.score - Math.abs(verticalGap) * 1200;

      candidates.push({ row, viewer, score: rowScore });
    }

    candidates.sort((left, right) => right.score - left.score);
    const selected = candidates[0];

    if (!selected) {
      throw new Error(
        "AffiFlow could not identify the top seller gallery. Keep the large product viewer and its thumbnail row visible, then scan again."
      );
    }

    const targets = selected.row.boxes
      .map((box) => box.target)
      .slice(0, MAX_TARGETS);

    if (targets.length < 3) {
      throw new Error("AffiFlow identified fewer than three seller gallery thumbnails.");
    }

    const viewerRect = selected.viewer.rect;
    const rowTop = Math.min(...selected.row.boxes.map((box) => box.top));
    const rowBottom = Math.max(...selected.row.boxes.map((box) => box.bottom));

    return {
      viewer: selected.viewer.element,
      viewerRect,
      targets,
      bounds: {
        left: Math.min(viewerRect.left, selected.row.left) - 12,
        right: Math.max(viewerRect.right, selected.row.right) + 12,
        top: Math.min(viewerRect.top, rowTop - window.scrollY) - 12,
        bottom: Math.max(viewerRect.bottom, rowBottom - window.scrollY) + 12,
      },
      diagnostics: {
        rowCount: rows.length,
        targetCount: targets.length,
        viewerWidth: Math.round(viewerRect.width),
        viewerHeight: Math.round(viewerRect.height),
        rowSpread: Math.round(selected.row.spread),
      },
    };
  }

  function insideBounds(element, bounds) {
    const rect = rectOf(element);
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;

    return (
      centreX >= bounds.left &&
      centreX <= bounds.right &&
      centreY >= bounds.top &&
      centreY <= bounds.bottom
    );
  }

  function collectImageElement(image, images, imageSeen) {
    for (const value of [
      largestSrcset(image),
      image.currentSrc,
      image.src,
      image.getAttribute("data-src"),
      image.getAttribute("data-original"),
      image.getAttribute("data-lazy-src"),
      image.getAttribute("poster"),
    ]) {
      pushImage(images, imageSeen, value);
    }
  }

  function collectVideoElement(video, videos, videoSeen, images, imageSeen) {
    for (const value of [
      video.currentSrc,
      video.src,
      video.getAttribute("data-src"),
      video.getAttribute("data-video-url"),
    ]) {
      pushVideo(videos, videoSeen, value);
    }

    pushImage(images, imageSeen, video.poster);

    for (const source of video.querySelectorAll("source")) {
      pushVideo(videos, videoSeen, source.src);
      pushVideo(videos, videoSeen, source.getAttribute("data-src"));
    }
  }

  function collectViewerMedia(gallery, images, imageSeen, videos, videoSeen) {
    const viewerRect = gallery.viewerRect;
    const x = Math.max(1, Math.min(window.innerWidth - 2, viewerRect.left + viewerRect.width / 2));
    const y = Math.max(1, Math.min(window.innerHeight - 2, viewerRect.top + viewerRect.height / 2));
    const roots = [];
    const rootSeen = new Set();

    for (const pointElement of document.elementsFromPoint(x, y)) {
      let current = pointElement;

      for (let depth = 0; current && depth < 7; depth += 1) {
        if (!rootSeen.has(current)) {
          rootSeen.add(current);
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
        if (!insideBounds(video, gallery.bounds)) continue;
        collectVideoElement(video, videos, videoSeen, images, imageSeen);
      }
    }

    for (const root of roots) {
      const imagesAtPoint = [];
      if (root.matches?.("img")) imagesAtPoint.push(root);
      for (const image of root.querySelectorAll?.("img") || []) imagesAtPoint.push(image);

      for (const image of imagesAtPoint) {
        if (!insideBounds(image, gallery.bounds) || excluded(image)) continue;
        collectImageElement(image, images, imageSeen);
      }
    }

    for (const root of roots) {
      if (!insideBounds(root, gallery.bounds) || excluded(root)) continue;
      for (const url of backgroundUrls(root)) pushImage(images, imageSeen, url);
    }
  }

  function collectTargetFallback(target, gallery, images, imageSeen) {
    const nodes = [target, ...target.querySelectorAll?.("img,div,span") || []];

    for (const node of nodes) {
      if (!insideBounds(node, gallery.bounds) || excluded(node)) continue;

      if (node.matches?.("img")) collectImageElement(node, images, imageSeen);
      for (const url of backgroundUrls(node)) pushImage(images, imageSeen, url);
    }
  }

  async function activateTarget(target) {
    try {
      target.scrollIntoView({ block: "nearest", inline: "center" });
    } catch {}

    await sleep(80);

    for (const eventName of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        target.dispatchEvent(
          new MouseEvent(eventName, {
            bubbles: true,
            cancelable: true,
            view: window,
          })
        );
      } catch {}
    }

    try {
      target.click();
    } catch {}

    await sleep(700);
  }

  function collectRecentVideoResources(startedAt, videos, videoSeen) {
    let entries = [];

    try {
      entries = performance.getEntriesByType("resource");
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (Number(entry.startTime) < startedAt - 100) continue;

      const url = typeof entry.name === "string" ? entry.name : "";
      if (!VIDEO_URL_PATTERN.test(url)) continue;
      if (!/shopee|susercontent/i.test(url) || EXCLUDED_URL.test(url)) continue;

      pushVideo(videos, videoSeen, url);
    }
  }

  async function captureTopSellerGallery() {
    const gallery = detectGallery();
    const images = [];
    const videos = [];
    const imageSeen = new Set();
    const videoSeen = new Set();

    collectViewerMedia(gallery, images, imageSeen, videos, videoSeen);

    for (const target of gallery.targets) {
      const startedAt = performance.now();
      await activateTarget(target);
      collectViewerMedia(gallery, images, imageSeen, videos, videoSeen);
      collectTargetFallback(target, gallery, images, imageSeen);
      collectRecentVideoResources(startedAt, videos, videoSeen);
    }

    if (images.length < 1) {
      throw new Error("No seller image was captured from the detected top gallery.");
    }

    return {
      ok: true,
      images: images.slice(0, MAX_IMAGES),
      videos: videos.slice(0, MAX_VIDEOS),
      source: "automatic-top-seller-gallery",
      scannerVersion: "0.11.8",
      diagnostics: {
        ...gallery.diagnostics,
        imageCount: images.length,
        videoCount: videos.length,
      },
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPE) return undefined;

    captureTopSellerGallery()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          images: [],
          videos: [],
          source: "automatic-top-seller-gallery",
          scannerVersion: "0.11.8",
          error: error instanceof Error ? error.message : "Automatic seller gallery capture failed.",
        });
      });

    return true;
  });
})();
