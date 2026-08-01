(() => {
  "use strict";

  // AFFIFLOW_ASSISTED_MEDIA_PHASE2

  const MEDIA_BRIDGE_URL =
    "http://127.0.0.1:47833";

  const assistedState = {
    mediaBridgeConnected: false,
    session: null,
    assets: [],
    isDiscovering: false,
    isSaving: false,
  };

  const assistedElements = {
    scannerTabButton:
      document.getElementById(
        "scannerTabButton",
      ),

    mediaTabButton:
      document.getElementById(
        "mediaTabButton",
      ),

    mediaSessionBadge:
      document.getElementById(
        "mediaSessionBadge",
      ),

    scannerView:
      document.getElementById(
        "scannerView",
      ),

    mediaView:
      document.getElementById(
        "mediaView",
      ),

    mediaSessionCard:
      document.getElementById(
        "mediaSessionCard",
      ),

    mediaProductName:
      document.getElementById(
        "mediaProductName",
      ),

    mediaProductUrl:
      document.getElementById(
        "mediaProductUrl",
      ),

    discoverMediaButton:
      document.getElementById(
        "discoverMediaButton",
      ),

    mediaSummary:
      document.getElementById(
        "mediaSummary",
      ),

    mediaSelectionToolbar:
      document.getElementById(
        "mediaSelectionToolbar",
      ),

    mediaSelectedSummary:
      document.getElementById(
        "mediaSelectedSummary",
      ),

    mediaSelectAllButton:
      document.getElementById(
        "mediaSelectAllButton",
      ),

    mediaClearButton:
      document.getElementById(
        "mediaClearButton",
      ),

    mediaGrid:
      document.getElementById(
        "mediaGrid",
      ),

    saveMediaButton:
      document.getElementById(
        "saveMediaButton",
      ),

    mediaMessage:
      document.getElementById(
        "mediaMessage",
      ),
  };

  function setAssistedMessage(
    message = "",
    type = "",
  ) {
    assistedElements
      .mediaMessage
      .textContent =
      message;

    assistedElements
      .mediaMessage
      .className =
      `message ${type}`.trim();
  }

  function switchCaptureView(
    viewName,
  ) {
    const mediaActive =
      viewName === "media";

    assistedElements
      .scannerView
      .hidden =
      mediaActive;

    assistedElements
      .mediaView
      .hidden =
      !mediaActive;

    assistedElements
      .scannerTabButton
      .classList
      .toggle(
        "active",
        !mediaActive,
      );

    assistedElements
      .mediaTabButton
      .classList
      .toggle(
        "active",
        mediaActive,
      );
  }

  function isShopeeProductTab(tab) {
    if (
      !tab?.id ||
      typeof tab.url !== "string"
    ) {
      return false;
    }

    try {
      const parsed =
        new URL(tab.url);

      return (
        parsed.protocol === "https:" &&
        (
          parsed.hostname ===
            "shopee.com.my" ||
          parsed.hostname ===
            "www.shopee.com.my" ||
          parsed.hostname.endsWith(
            ".shopee.com.my",
          )
        ) &&
        !parsed.hostname.startsWith(
          "affiliate.",
        )
      );
    } catch {
      return false;
    }
  }

  function selectedAssets() {
    return assistedState
      .assets
      .filter(
        (asset) =>
          asset.selected,
      );
  }

  function updateAssistedControls() {
    const selected =
      selectedAssets();

    const selectedImages =
      selected.filter(
        (asset) =>
          asset.mediaType ===
          "Image",
      ).length;

    const selectedVideos =
      selected.filter(
        (asset) =>
          asset.mediaType ===
          "Video",
      ).length;

    assistedElements
      .mediaSelectedSummary
      .textContent =
      `${selected.length} selected · ` +
      `${selectedImages} images · ` +
      `${selectedVideos} videos`;

    assistedElements
      .mediaSelectionToolbar
      .hidden =
      assistedState.assets.length < 1;

    assistedElements
      .mediaSelectAllButton
      .disabled =
      assistedState.assets.length < 1 ||
      assistedState.isSaving;

    assistedElements
      .mediaClearButton
      .disabled =
      selected.length < 1 ||
      assistedState.isSaving;

    assistedElements
      .discoverMediaButton
      .disabled =
      !assistedState
        .mediaBridgeConnected ||
      !assistedState.session ||
      assistedState.isDiscovering ||
      assistedState.isSaving;

    assistedElements
      .saveMediaButton
      .disabled =
      !assistedState
        .mediaBridgeConnected ||
      !assistedState.session ||
      selectedImages < 1 ||
      assistedState.isDiscovering ||
      assistedState.isSaving;
  }

  function renderAssistedAssets() {
    if (
      assistedState.assets.length < 1
    ) {
      assistedElements
        .mediaGrid
        .innerHTML = `
          <div class="emptyState">
            Detected product images and videos will appear here.
          </div>
        `;

      updateAssistedControls();
      return;
    }

    assistedElements
      .mediaGrid
      .innerHTML =
      assistedState.assets
        .map(
          (
            asset,
            index,
          ) => {
            const safeUrl =
              escapeHtml(
                asset.url,
              );

            const preview =
              asset.mediaType ===
              "Video"
                ? `
                  <video
                    class="mediaAssetPreview"
                    src="${safeUrl}"
                    controls
                    muted
                    preload="metadata"
                  ></video>
                `
                : `
                  <img
                    class="mediaAssetPreview"
                    src="${safeUrl}"
                    alt="Product image ${index + 1}"
                    loading="lazy"
                  />
                `;

            return `
              <article
                class="mediaAssetCard ${
                  asset.selected
                    ? "selected"
                    : ""
                }"
              >
                ${preview}

                <label class="mediaAssetFooter">
                  <input
                    class="mediaAssetCheckbox"
                    type="checkbox"
                    data-media-index="${index}"
                    ${
                      asset.selected
                        ? "checked"
                        : ""
                    }
                  />

                  <span class="mediaAssetType">
                    ${escapeHtml(asset.mediaType)}
                  </span>

                  <span class="mediaAssetNumber">
                    #${index + 1}
                  </span>
                </label>
              </article>
            `;
          },
        )
        .join("");

    for (
      const checkbox
      of assistedElements
        .mediaGrid
        .querySelectorAll(
          "[data-media-index]",
        )
    ) {
      checkbox.addEventListener(
        "change",
        () => {
          const index =
            Number(
              checkbox.dataset
                .mediaIndex,
            );

          if (
            !Number.isInteger(index) ||
            !assistedState.assets[index]
          ) {
            return;
          }

          assistedState
            .assets[index]
            .selected =
            checkbox.checked;

          renderAssistedAssets();
        },
      );
    }

    updateAssistedControls();
  }

  function renderAssistedSession() {
    const session =
      assistedState.session;

    assistedElements
      .mediaSessionBadge
      .hidden =
      !session;

    assistedElements
      .mediaSessionCard
      .classList
      .toggle(
        "ready",
        Boolean(session),
      );

    if (!session) {
      assistedElements
        .mediaProductName
        .textContent =
        "Waiting for Product Catalog...";

      assistedElements
        .mediaProductUrl
        .textContent =
        "Press Capture Media from AffiFlow Desktop.";

      assistedElements
        .mediaSummary
        .textContent =
        "No active media session. Return to Product Catalog and press Capture Media.";

      updateAssistedControls();
      return;
    }

    assistedElements
      .mediaProductName
      .textContent =
      session.productName ||
      "Shopee Product";

    assistedElements
      .mediaProductUrl
      .textContent =
      session.productUrl ||
      "";

    const mediaState =
      session.mediaState;

    if (
      mediaState?.status ===
      "Ready"
    ) {
      assistedElements
        .mediaSummary
        .textContent =
        `${mediaState.downloadedImageCount || 0} images and ` +
        `${mediaState.downloadedVideoCount || 0} videos are already Ready in AffiFlow.`;
    } else {
      assistedElements
        .mediaSummary
        .textContent =
        "Active capture session loaded. Scan the current Shopee product page.";
    }

    updateAssistedControls();
  }

  async function loadAssistedSession() {
    try {
      const health =
        await requestJson(
          MEDIA_BRIDGE_URL,
          "/health",
        );

      assistedState
        .mediaBridgeConnected =
        health.ok === true;

      const payload =
        await requestJson(
          MEDIA_BRIDGE_URL,
          "/api/assisted/session",
        );

      assistedState.session =
        payload.session ||
        null;

      renderAssistedSession();

      if (assistedState.session) {
        switchCaptureView(
          "media",
        );

        setAssistedMessage(
          "Product session loaded. Press Scan Current Product Page.",
          "success",
        );
      }
    } catch (error) {
      assistedState
        .mediaBridgeConnected =
        false;

      assistedState.session =
        null;

      renderAssistedSession();

      setAssistedMessage(
        error instanceof Error
          ? error.message
          : "Media Bridge is unavailable.",
        "error",
      );
    }
  }

  function normalizeAssistedAssets(
    response,
  ) {
    const assets = [];
    const seen = new Set();

    for (
      const [
        mediaType,
        values,
      ] of [
        [
          "Image",
          response?.images,
        ],
        [
          "Video",
          response?.videos,
        ],
      ]
    ) {
      if (!Array.isArray(values)) {
        continue;
      }

      for (const value of values) {
        if (
          typeof value !== "string" ||
          !value.trim()
        ) {
          continue;
        }

        const url =
          value.trim();

        const key =
          `${mediaType}:${url}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);

        assets.push({
          mediaType,
          url,
          selected: true,
        });
      }
    }

    return assets;
  }

  async function discoverAssistedMedia() {
    if (
      assistedState.isDiscovering ||
      !assistedState.session
    ) {
      return;
    }

    assistedState.isDiscovering =
      true;

    assistedState.assets = [];

    assistedElements
      .discoverMediaButton
      .textContent =
      "Scanning Product Gallery...";

    setAssistedMessage(
      "Reading gallery images and videos from the current tab...",
    );

    renderAssistedAssets();
    updateAssistedControls();

    try {
      const activeTab =
        await getActiveTab();

      if (
        !isShopeeProductTab(
          activeTab,
        )
      ) {
        throw new Error(
          "Open the Shopee product page launched by Capture Media, then open this extension again.",
        );
      }

      const response =
        await sendTabMessageWithRecovery(
          activeTab.id,
          {
            type:
              "AFFIFLOW_DISCOVER_PRODUCT_MEDIA",
          },
          {
            isolatedFiles: [
              "productMediaCapture.js",
            ],
          },
        );

      if (!response?.ok) {
        throw new Error(
          response?.error ||
          "Product media discovery failed.",
        );
      }

      assistedState.assets =
        normalizeAssistedAssets(
          response,
        );

      const imageCount =
        assistedState.assets.filter(
          (asset) =>
            asset.mediaType ===
            "Image",
        ).length;

      const videoCount =
        assistedState.assets.filter(
          (asset) =>
            asset.mediaType ===
            "Video",
        ).length;

      if (imageCount < 1) {
        throw new Error(
          "No product image was detected on the current Shopee page.",
        );
      }

      renderAssistedAssets();

      assistedElements
        .mediaSummary
        .textContent =
        `${imageCount} images and ${videoCount} videos detected. Review the preview, then save.`;

      setAssistedMessage(
        "Media preview is ready.",
        "success",
      );
    } catch (error) {
      assistedState.assets = [];
      renderAssistedAssets();

      setAssistedMessage(
        error instanceof Error
          ? error.message
          : "Media scan failed.",
        "error",
      );
    } finally {
      assistedState.isDiscovering =
        false;

      assistedElements
        .discoverMediaButton
        .textContent =
        "Scan Current Product Page";

      updateAssistedControls();
    }
  }

  async function waitForCompletion(
    candidateId,
  ) {
    for (
      let attempt = 0;
      attempt < 80;
      attempt += 1
    ) {
      await delay(1500);

      const payload =
        await requestJson(
          MEDIA_BRIDGE_URL,
          "/api/assisted/status" +
            `?candidateId=${encodeURIComponent(candidateId)}`,
        );

      const mediaState =
        payload.state;

      const images =
        Number(
          mediaState
            ?.downloadedImageCount,
        ) || 0;

      const videos =
        Number(
          mediaState
            ?.downloadedVideoCount,
        ) || 0;

      setAssistedMessage(
        `Desktop download: ${images}/${mediaState?.expectedImageCount || 0} images · ` +
          `${videos}/${mediaState?.expectedVideoCount || 0} videos`,
        "mediaProgress",
      );

      if (
        mediaState?.status ===
        "Ready"
      ) {
        return mediaState;
      }

      if (
        mediaState?.status ===
        "Failed"
      ) {
        throw new Error(
          mediaState.lastError ||
          "Desktop media download failed.",
        );
      }
    }

    throw new Error(
      "Desktop is still downloading media. Check Catalog Media Status shortly.",
    );
  }

  async function saveAssistedMedia() {
    if (
      assistedState.isSaving ||
      !assistedState.session
    ) {
      return;
    }

    const selected =
      selectedAssets();

    const images =
      selected
        .filter(
          (asset) =>
            asset.mediaType ===
            "Image",
        )
        .map(
          (asset) =>
            asset.url,
        );

    const videos =
      selected
        .filter(
          (asset) =>
            asset.mediaType ===
            "Video",
        )
        .map(
          (asset) =>
            asset.url,
        );

    if (images.length < 1) {
      setAssistedMessage(
        "Select at least one product image.",
        "error",
      );
      return;
    }

    assistedState.isSaving =
      true;

    assistedElements
      .saveMediaButton
      .textContent =
      "Sending to AffiFlow...";

    setAssistedMessage(
      "Sending the selected media manifest to AffiFlow Desktop...",
    );

    updateAssistedControls();

    try {
      await requestJson(
        MEDIA_BRIDGE_URL,
        "/api/jobs/" +
          encodeURIComponent(
            assistedState
              .session
              .candidateId,
          ) +
          "/manifest",
        {
          method: "POST",
          body:
            JSON.stringify({
              images,
              videos,
            }),
        },
      );

      assistedElements
        .saveMediaButton
        .textContent =
        "Downloading to Vault...";

      const completedState =
        await waitForCompletion(
          assistedState
            .session
            .candidateId,
        );

      await requestJson(
        MEDIA_BRIDGE_URL,
        "/api/assisted/complete",
        {
          method: "POST",
          body:
            JSON.stringify({
              candidateId:
                assistedState
                  .session
                  .candidateId,
            }),
        },
      );

      assistedState
        .session
        .mediaState =
        completedState;

      renderAssistedSession();

      setAssistedMessage(
        `${completedState.downloadedImageCount || 0} images and ` +
          `${completedState.downloadedVideoCount || 0} videos saved to AffiFlow Vault.`,
        "success",
      );

      assistedElements
        .saveMediaButton
        .textContent =
        "Saved to AffiFlow";
    } catch (error) {
      setAssistedMessage(
        error instanceof Error
          ? error.message
          : "Selected media could not be saved.",
        "error",
      );

      assistedElements
        .saveMediaButton
        .textContent =
        "Save Selected to AffiFlow";
    } finally {
      assistedState.isSaving =
        false;

      updateAssistedControls();
    }
  }

  function selectAllAssistedMedia() {
    for (
      const asset
      of assistedState.assets
    ) {
      asset.selected = true;
    }

    renderAssistedAssets();
  }

  function clearAssistedSelection() {
    for (
      const asset
      of assistedState.assets
    ) {
      asset.selected = false;
    }

    renderAssistedAssets();
  }

  assistedElements
    .scannerTabButton
    .addEventListener(
      "click",
      () => {
        switchCaptureView(
          "scanner",
        );
      },
    );

  assistedElements
    .mediaTabButton
    .addEventListener(
      "click",
      () => {
        switchCaptureView(
          "media",
        );

        if (!assistedState.session) {
          void loadAssistedSession();
        }
      },
    );

  assistedElements
    .discoverMediaButton
    .addEventListener(
      "click",
      () => {
        void discoverAssistedMedia();
      },
    );

  assistedElements
    .mediaSelectAllButton
    .addEventListener(
      "click",
      selectAllAssistedMedia,
    );

  assistedElements
    .mediaClearButton
    .addEventListener(
      "click",
      clearAssistedSelection,
    );

  assistedElements
    .saveMediaButton
    .addEventListener(
      "click",
      () => {
        void saveAssistedMedia();
      },
    );

  renderAssistedAssets();
  renderAssistedSession();
  void loadAssistedSession();
})();
