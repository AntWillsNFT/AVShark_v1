(() => {
  "use strict";

  const INSTALL_KEY = "__AFFIFLOW_GALLERY_PICKER_V0117__";
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  const PICK_MESSAGE = "AFFIFLOW_PICK_SELLER_GALLERY";
  const STATUS_MESSAGE = "AFFIFLOW_GET_SELLER_GALLERY_STATUS";
  const CAPTURE_MESSAGE = "AFFIFLOW_CAPTURE_SELECTED_GALLERY";

  const VIDEO_PATTERN = /\.mp4(?:$|[?#])|\.m3u8(?:$|[?#])|\/video\/|playback|stream|transcode|vod|cvf/i;
  const EXCLUDED_CONTEXT = /review|rating|comment|feedback|buyer|customer|avatar|profile|recommend|related|similar|suggest|header|footer|navbar|navigation|logo|banner|voucher|campaign|chat|share|social|favorite|follow/i;
  const EXCLUDED_URL = /avatar|profile|icon|logo|sprite|emoji|badge|banner|voucher|campaign|rating|review|comment|feedback/i;

  const state = {
    pickerActive: false,
    galleryRoot: null,
    galleryBounds: null,
    hoverRoot: null,
    overlay: null,
    label: null,
  };

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function rectOf(element) {
    try {
      return element.getBoundingClientRect();
    } catch {
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    }
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

  function visible(element) {
    if (!element) return false;
    const rect = rectOf(element);
    if (rect.width < 1 || rect.height < 1) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  }

  function hasOwnMediaEvidence(element) {
    if (!element || excluded(element)) return false;
    if (element.matches?.("img,video")) return true;
    if (backgroundUrls(element).length > 0) return true;
    return /video|play|movie|media/.test(signature(element));
  }

  function mediaEvidenceCount(root) {
    if (!root) return 0;
    let count = 0;
    const seen = new Set();
    const nodes = [root, ...root.querySelectorAll("img,video,button,li,[role='button'],div,span")];
    for (const node of nodes) {
      if (!visible(node) || excluded(node) || !hasOwnMediaEvidence(node)) continue;
      const rect = rectOf(node);
      if (rect.width < 24 || rect.height < 24) continue;
      const key = `${Math.round(rect.left / 8)}:${Math.round(rect.top / 8)}:${Math.round(rect.width / 8)}:${Math.round(rect.height / 8)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      count += 1;
      if (count >= 40) break;
    }
    return count;
  }

  function findGalleryRoot(target) {
    let current = target instanceof Element ? target : null;
    let fallback = null;

    for (let depth = 0; current && depth < 13; depth += 1) {
      const rect = rectOf(current);
      const count = mediaEvidenceCount(current);
      const validSize =
        rect.width >= 300 &&
        rect.height >= 300 &&
        rect.width <= Math.min(980, window.innerWidth * 0.84) &&
        rect.height <= Math.min(1050, window.innerHeight * 1.45);
      const validPosition = rect.left < window.innerWidth * 0.7 && rect.top < window.innerHeight * 0.85;

      if (validSize && validPosition && count >= 2 && !excluded(current)) {
        fallback = current;
        if (count >= 4) return current;
      }

      current = current.parentElement;
    }

    return fallback;
  }

  function ensureOverlay() {
    if (!state.overlay) {
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        zIndex: "2147483646",
        pointerEvents: "none",
        border: "3px solid #f59e0b",
        background: "rgba(245,158,11,0.08)",
        borderRadius: "8px",
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.12)",
        transition: "all 80ms linear",
      });
      document.documentElement.appendChild(overlay);
      state.overlay = overlay;
    }

    if (!state.label) {
      const label = document.createElement("div");
      Object.assign(label.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        left: "16px",
        top: "16px",
        maxWidth: "460px",
        padding: "12px 16px",
        borderRadius: "10px",
        background: "#07182d",
        border: "2px solid #22c55e",
        color: "#ffffff",
        font: "700 14px Arial, sans-serif",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      });
      document.documentElement.appendChild(label);
      state.label = label;
    }
  }

  function drawOverlay(root, selected) {
    ensureOverlay();
    if (!root) {
      state.overlay.style.display = "none";
      return;
    }
    const rect = rectOf(root);
    Object.assign(state.overlay.style, {
      display: "block",
      left: `${Math.max(0, rect.left)}px`,
      top: `${Math.max(0, rect.top)}px`,
      width: `${Math.max(0, rect.width)}px`,
      height: `${Math.max(0, rect.height)}px`,
      borderColor: selected ? "#22c55e" : "#f59e0b",
      background: selected ? "rgba(34,197,94,0.08)" : "rgba(245,158,11,0.08)",
    });
    state.label.textContent = selected
      ? "AffiFlow: Seller gallery locked. Open the extension and press Scan again."
      : "AffiFlow: Move over the seller gallery, then click once to lock it.";
  }

  function stopPickerListeners() {
    document.removeEventListener("mousemove", handlePickerMove, true);
    document.removeEventListener("click", handlePickerClick, true);
    document.removeEventListener("keydown", handlePickerKey, true);
  }

  function handlePickerMove(event) {
    if (!state.pickerActive) return;
    const root = findGalleryRoot(event.target);
    state.hoverRoot = root;
    drawOverlay(root, false);
  }

  function handlePickerClick(event) {
    if (!state.pickerActive) return;
    const root = state.hoverRoot || findGalleryRoot(event.target);
    if (!root) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    state.galleryRoot = root;
    const rect = rectOf(root);
    state.galleryBounds = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    state.pickerActive = false;
    state.hoverRoot = null;
    stopPickerListeners();
    drawOverlay(root, true);

    setTimeout(() => {
      if (state.overlay) state.overlay.style.boxShadow = "none";
    }, 1800);
  }

  function handlePickerKey(event) {
    if (!state.pickerActive || event.key !== "Escape") return;
    state.pickerActive = false;
    state.hoverRoot = null;
    stopPickerListeners();
    state.overlay?.remove();
    state.label?.remove();
    state.overlay = null;
    state.label = null;
  }

  function startPicker() {
    state.pickerActive = true;
    state.hoverRoot = null;
    state.galleryRoot = null;
    state.galleryBounds = null;
    ensureOverlay();
    state.label.textContent = "AffiFlow: Move over the seller gallery, then click once to lock it. Press Esc to cancel.";
    document.addEventListener("mousemove", handlePickerMove, true);
    document.addEventListener("click", handlePickerClick, true);
    document.addEventListener("keydown", handlePickerKey, true);
  }

  function resolveGalleryRoot() {
    if (state.galleryRoot && document.contains(state.galleryRoot)) return state.galleryRoot;
    if (!state.galleryBounds) return null;
    const x = Math.max(1, Math.min(window.innerWidth - 2, state.galleryBounds.left + state.galleryBounds.width / 2));
    const y = Math.max(1, Math.min(window.innerHeight - 2, state.galleryBounds.top + state.galleryBounds.height / 2));
    for (const element of document.elementsFromPoint(x, y)) {
      const root = findGalleryRoot(element);
      if (root) {
        state.galleryRoot = root;
        return root;
      }
    }
    return null;
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

  function collectRootMedia(root, images, imageSeen, videos, videoSeen) {
    const imagesInside = [];
    if (root.matches?.("img")) imagesInside.push(root);
    for (const image of root.querySelectorAll("img")) imagesInside.push(image);
    for (const image of imagesInside) {
      if (!visible(image) || excluded(image)) continue;
      for (const value of [
        largestSrcset(image),
        image.currentSrc,
        image.src,
        image.getAttribute("data-src"),
        image.getAttribute("data-original"),
        image.getAttribute("data-lazy-src"),
      ]) pushImage(images, imageSeen, value);
    }

    const videosInside = [];
    if (root.matches?.("video")) videosInside.push(root);
    for (const video of root.querySelectorAll("video")) videosInside.push(video);
    for (const video of videosInside) {
      if (excluded(video)) continue;
      for (const value of [
        video.currentSrc,
        video.src,
        video.getAttribute("data-src"),
        video.getAttribute("data-video-url"),
      ]) pushVideo(videos, videoSeen, value);
      for (const source of video.querySelectorAll("source")) {
        pushVideo(videos, videoSeen, source.src);
        pushVideo(videos, videoSeen, source.getAttribute("data-src"));
      }
    }

    const backgroundNodes = [root, ...root.querySelectorAll("div,span,button,li")];
    for (const node of backgroundNodes) {
      if (!visible(node) || excluded(node)) continue;
      const rect = rectOf(node);
      if (rect.width < 24 || rect.height < 24) continue;
      for (const url of backgroundUrls(node)) pushImage(images, imageSeen, url);
    }
  }

  function clickableAncestor(element, root) {
    let current = element;
    let fallback = element;
    for (let depth = 0; current && current !== root && depth < 6; depth += 1) {
      const rect = rectOf(current);
      if (rect.width >= 28 && rect.height >= 28 && rect.width <= 210 && rect.height <= 210) {
        fallback = current;
        let cursor = "";
        try { cursor = window.getComputedStyle(current).cursor; } catch { cursor = ""; }
        if (current.matches?.("button,li,a,[role='button']") || cursor === "pointer" || typeof current.onclick === "function") return current;
      }
      current = current.parentElement;
    }
    return fallback;
  }

  function collectThumbnailTargets(root) {
    const targets = [];
    const seen = new Set();
    const nodes = [
      ...root.querySelectorAll("img,video,button,li,[role='button'],div,span"),
    ];
    for (const node of nodes) {
      if (!visible(node) || excluded(node) || !hasOwnMediaEvidence(node)) continue;
      const rect = rectOf(node);
      if (rect.width < 28 || rect.height < 28 || rect.width > 210 || rect.height > 210) continue;
      const target = clickableAncestor(node, root);
      if (!target) continue;
      const targetRect = rectOf(target);
      const key = `${Math.round(targetRect.left / 8)}:${Math.round(targetRect.top / 8)}:${Math.round(targetRect.width / 8)}:${Math.round(targetRect.height / 8)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(target);
    }
    targets.sort((left, right) => {
      const leftRect = rectOf(left);
      const rightRect = rectOf(right);
      if (Math.abs(leftRect.top - rightRect.top) > 10) return leftRect.top - rightRect.top;
      return leftRect.left - rightRect.left;
    });
    return targets.slice(0, 24);
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
    await sleep(650);
  }

  function collectRecentVideoResources(startedAt, videos, videoSeen) {
    let entries = [];
    try { entries = performance.getEntriesByType("resource"); } catch { entries = []; }
    for (const entry of entries) {
      if (Number(entry.startTime) < startedAt - 100) continue;
      const url = typeof entry.name === "string" ? entry.name : "";
      if (!VIDEO_PATTERN.test(url) || !/shopee|susercontent/i.test(url)) continue;
      pushVideo(videos, videoSeen, url);
    }
  }

  async function captureSelectedGallery() {
    const root = resolveGalleryRoot();
    if (!root) throw new Error("Seller gallery selection was lost. Press Scan, then click the seller gallery again.");

    const images = [];
    const videos = [];
    const imageSeen = new Set();
    const videoSeen = new Set();
    collectRootMedia(root, images, imageSeen, videos, videoSeen);

    const targets = collectThumbnailTargets(root);
    for (const target of targets) {
      const startedAt = performance.now();
      await activateTarget(target);
      const currentRoot = resolveGalleryRoot() || root;
      collectRootMedia(currentRoot, images, imageSeen, videos, videoSeen);
      collectRecentVideoResources(startedAt, videos, videoSeen);
    }

    if (images.length < 1) throw new Error("No image was found inside the selected seller gallery.");

    return {
      ok: true,
      images: images.slice(0, 30),
      videos: videos.slice(0, 8),
      source: "user-selected-seller-gallery",
      scannerVersion: "0.11.7",
      diagnostics: {
        targetCount: targets.length,
        imageCount: images.length,
        videoCount: videos.length,
      },
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === PICK_MESSAGE) {
      startPicker();
      sendResponse({ ok: true, picking: true, selected: false, scannerVersion: "0.11.7" });
      return true;
    }

    if (message?.type === STATUS_MESSAGE) {
      sendResponse({
        ok: true,
        picking: state.pickerActive,
        selected: Boolean(resolveGalleryRoot()),
        scannerVersion: "0.11.7",
      });
      return true;
    }

    if (message?.type === CAPTURE_MESSAGE) {
      captureSelectedGallery().then(sendResponse).catch((error) => {
        sendResponse({
          ok: false,
          images: [],
          videos: [],
          source: "user-selected-seller-gallery",
          scannerVersion: "0.11.7",
          error: error instanceof Error ? error.message : "Selected gallery capture failed.",
        });
      });
      return true;
    }

    return undefined;
  });
})();
