(() => {
  const { msg } = window.__i18n;
  const settingsStore = window.OutlookUnreadBadgeSettings;

  const openSettingsButton = document.getElementById("open-settings");
  const showTitleCountToggle = document.getElementById("show-title-count-toggle");
  const showAppBadgeToggle = document.getElementById("show-app-badge-toggle");
  const versionEl = document.getElementById("version");

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

  settingsStore.subscribe((settings) => {
    showTitleCountToggle.checked = settings.display.showUnreadInTitle;
    showAppBadgeToggle.checked = settings.display.showUnreadOnAppIcon;
  });

  loadToggles().catch(() => {});
})();
