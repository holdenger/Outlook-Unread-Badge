(() => {
  const { msg } = window.__i18n;
  const settingsStore = window.OutlookUnreadBadgeSettings;

  const openSettingsButton = document.getElementById("open-settings");
  const showTitleCountToggle = document.getElementById("show-title-count-toggle");
  const showAppBadgeToggle = document.getElementById("show-app-badge-toggle");
  const versionEl = document.getElementById("version");
  const mcasBanner = document.getElementById("mcas-banner");
  const mcasBannerText = document.getElementById("mcas-banner-text");
  const mcasEnableButton = document.getElementById("mcas-enable");

  const MCAS_HOSTNAME = "outlook.cloud.microsoft.mcas.ms";
  const MCAS_ORIGIN = "https://outlook.cloud.microsoft.mcas.ms/*";
  const MCAS_SCRIPT_ID = "outlook-unread-badge-mcas";

  const version = chrome.runtime.getManifest().version;
  versionEl.textContent = msg("versionLabel", version);

  async function loadToggles() {
    const settings = await settingsStore.loadSettings();
    showTitleCountToggle.checked = settings.display.showUnreadInTitle;
    showAppBadgeToggle.checked = settings.display.showUnreadOnAppIcon;
  }

  showTitleCountToggle.addEventListener("change", async () => {
    await settingsStore.updateSettings((draft) => {
      draft.display.showUnreadInTitle = showTitleCountToggle.checked;
    }, ["display"], { debounceMs: 0 });
  });

  showAppBadgeToggle.addEventListener("change", async () => {
    await settingsStore.updateSettings((draft) => {
      draft.display.showUnreadOnAppIcon = showAppBadgeToggle.checked;
    }, ["display"], { debounceMs: 0 });
  });

  openSettingsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  async function isMcasSupportEnabled() {
    const granted = await chrome.permissions.contains({ origins: [MCAS_ORIGIN] });
    if (!granted) return false;
    const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [MCAS_SCRIPT_ID] });
    return scripts.length > 0;
  }

  async function initMcasBanner() {
    try {
      // activeTab grants URL access for the active tab once the popup is opened.
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) return;
      if (new URL(tab.url).hostname !== MCAS_HOSTNAME) return;
      if (await isMcasSupportEnabled()) return;
      mcasBanner.hidden = false;
    } catch (_) {
      // No URL access or unexpected state; keep the banner hidden.
    }
  }

  mcasEnableButton.addEventListener("click", async () => {
    try {
      const granted = await chrome.permissions.request({ origins: [MCAS_ORIGIN] });
      if (!granted) {
        mcasBannerText.textContent = msg("optionsStatusMcasPermissionDenied");
        return;
      }
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [MCAS_SCRIPT_ID] });
      if (existing.length === 0) {
        await chrome.scripting.registerContentScripts([
          {
            id: MCAS_SCRIPT_ID,
            matches: [MCAS_ORIGIN],
            js: ["settings-store.js", "content.js"],
            runAt: "document_start",
            persistAcrossSessions: true
          }
        ]);
      }
      mcasBannerText.textContent = msg("popupMcasEnabledConfirmation");
      mcasEnableButton.hidden = true;
    } catch (_) {
      mcasBannerText.textContent = msg("optionsStatusMcasError");
    }
  });

  initMcasBanner();

  settingsStore.subscribe((settings) => {
    showTitleCountToggle.checked = settings.display.showUnreadInTitle;
    showAppBadgeToggle.checked = settings.display.showUnreadOnAppIcon;
  });

  loadToggles().catch(() => {});
})();
