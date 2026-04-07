(() => {
  const { msg } = window.__i18n;
  const settingsStore = window.OutlookUnreadBadgeSettings;

  const BUILT_IN_RULES = [
    { id: "drafts", labelKey: "optionsBuiltInRuleDrafts" },
    { id: "deleted", labelKey: "optionsBuiltInRuleDeleted" },
    { id: "junk", labelKey: "optionsBuiltInRuleJunk" },
    { id: "sent", labelKey: "optionsBuiltInRuleSent" },
    { id: "archive", labelKey: "optionsBuiltInRuleArchive" }
  ];

  const form = document.getElementById("rule-form");
  const nameInput = document.getElementById("rule-name");
  const modeSelect = document.getElementById("rule-mode");
  const rulesList = document.getElementById("rules-list");
  const builtInRulesList = document.getElementById("builtin-rules-list");
  const showTitleCountToggle = document.getElementById("show-title-count-toggle");
  const showAppBadgeToggle = document.getElementById("show-app-badge-toggle");
  const status = document.getElementById("status");
  const version = document.getElementById("version");
  const resetButton = document.getElementById("reset-settings");
  const syncWarning = document.getElementById("sync-warning");

  const diagExtensionId = document.getElementById("diag-extension-id");
  const diagSettingsVersion = document.getElementById("diag-settings-version");
  const diagStorageBackend = document.getElementById("diag-storage-backend");
  const diagLastSyncWrite = document.getElementById("diag-last-sync-write");
  const diagSettingsHash = document.getElementById("diag-settings-hash");

  let currentSettings = null;

  version.textContent = msg("versionLabel", chrome.runtime.getManifest().version);

  function normalizeRuleName(name) {
    return settingsStore.normalizeRuleName(name);
  }

  function setStatus(message) {
    status.textContent = message;
    window.setTimeout(() => {
      if (status.textContent === message) {
        status.textContent = "";
      }
    }, 1800);
  }

  function formatTimestamp(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return msg("optionsDiagNever");
    try {
      return new Date(ts).toLocaleString();
    } catch (_) {
      return String(ts);
    }
  }

  function renderDiagnostics(settings) {
    const diagnostics = settingsStore.getDiagnostics(settings);
    diagExtensionId.textContent = diagnostics.extensionId;
    diagSettingsVersion.textContent = String(diagnostics.settingsVersion);
    diagStorageBackend.textContent = diagnostics.storageArea;
    diagLastSyncWrite.textContent = formatTimestamp(diagnostics.lastSyncWriteAt);
    diagSettingsHash.textContent = diagnostics.settingsHash;

    if (diagnostics.storageArea === "local" || diagnostics.lastSyncError) {
      const errorSuffix = diagnostics.lastSyncError ? ` (${diagnostics.lastSyncError})` : "";
      syncWarning.textContent = `${msg("optionsSyncFallbackWarning")}${errorSuffix}`;
      syncWarning.hidden = false;
    } else {
      syncWarning.textContent = "";
      syncWarning.hidden = true;
    }
  }

  function renderBuiltInRules(settings) {
    builtInRulesList.textContent = "";

    BUILT_IN_RULES.forEach((rule) => {
      const li = document.createElement("li");
      li.className = "builtin-item";

      const label = document.createElement("span");
      label.textContent = msg(rule.labelKey);

      const switchLabel = document.createElement("label");
      switchLabel.className = "switch";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = settings.builtInRuleState[rule.id] !== false;
      input.setAttribute("aria-label", msg("optionsAriaBuiltInExclusionEnabled", msg(rule.labelKey)));

      const slider = document.createElement("span");
      slider.className = "slider";

      input.addEventListener("change", async () => {
        await settingsStore.updateSettings((draft) => {
          draft.builtInRuleState[rule.id] = input.checked;
        }, ["builtIn"]);
        setStatus(msg("optionsStatusBuiltInUpdated"));
      });

      switchLabel.append(input, slider);
      li.append(label, switchLabel);
      builtInRulesList.appendChild(li);
    });
  }

  function renderRules(settings) {
    const rules = settings.folderRules;
    rulesList.textContent = "";

    if (rules.length === 0) {
      const empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = msg("optionsNoCustomRules");
      rulesList.appendChild(empty);
      return;
    }

    rules.forEach((rule, idx) => {
      const li = document.createElement("li");
      li.className = "rule-item";

      const name = document.createElement("span");
      name.textContent = rule.name;

      const mode = document.createElement("span");
      mode.className = `badge ${rule.mode}`;
      mode.textContent = rule.mode === "include" ? msg("optionsModeInclude") : msg("optionsModeExclude");

      const toggleLabel = document.createElement("label");
      toggleLabel.className = "switch";
      const toggleInput = document.createElement("input");
      toggleInput.type = "checkbox";
      toggleInput.checked = rule.enabled !== false;
      toggleInput.setAttribute("aria-label", msg("optionsAriaCustomRuleEnabled", rule.name));
      const toggleSlider = document.createElement("span");
      toggleSlider.className = "slider";
      toggleInput.addEventListener("change", async () => {
        await settingsStore.updateSettings((draft) => {
          if (!draft.folderRules[idx]) return;
          draft.folderRules[idx].enabled = toggleInput.checked;
          draft.folderRules[idx].updatedAt = Date.now();
        }, ["rules"]);
        setStatus(msg("optionsStatusRuleUpdated"));
      });
      toggleLabel.append(toggleInput, toggleSlider);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-btn";
      remove.textContent = msg("optionsRemoveRule");
      remove.addEventListener("click", async () => {
        await settingsStore.updateSettings((draft) => {
          draft.folderRules.splice(idx, 1);
        }, ["rules"]);
        setStatus(msg("optionsStatusRuleRemoved"));
      });

      li.append(name, mode, toggleLabel, remove);
      rulesList.appendChild(li);
    });
  }

  function render(settings) {
    currentSettings = settings;
    showTitleCountToggle.checked = settings.display.showUnreadInTitle;
    showAppBadgeToggle.checked = settings.display.showUnreadOnAppIcon;
    renderBuiltInRules(settings);
    renderRules(settings);
    renderDiagnostics(settings);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = nameInput.value.trim();
    const mode = modeSelect.value;
    if (!name || (mode !== "include" && mode !== "exclude")) return;

    await settingsStore.updateSettings((draft) => {
      const normalized = normalizeRuleName(name);
      const idx = draft.folderRules.findIndex((rule) => normalizeRuleName(rule.name) === normalized);
      const nextRule = { name, mode, enabled: true, updatedAt: Date.now() };

      if (idx >= 0) {
        draft.folderRules[idx] = nextRule;
      } else {
        draft.folderRules.push(nextRule);
      }
    }, ["rules"]);

    setStatus(msg("optionsStatusRuleAdded"));
    form.reset();
    modeSelect.value = mode;
  });

  showTitleCountToggle.addEventListener("change", async () => {
    await settingsStore.updateSettings((draft) => {
      draft.display.showUnreadInTitle = showTitleCountToggle.checked;
    }, ["display"]);
    setStatus(msg("optionsStatusTitleCounterUpdated"));
  });

  showAppBadgeToggle.addEventListener("change", async () => {
    await settingsStore.updateSettings((draft) => {
      draft.display.showUnreadOnAppIcon = showAppBadgeToggle.checked;
    }, ["display"]);
    setStatus(msg("optionsStatusAppBadgeUpdated"));
  });

  resetButton.addEventListener("click", async () => {
    await settingsStore.resetSettings();
    setStatus(msg("optionsStatusResetCompleted"));
  });

  settingsStore.subscribe((settings) => {
    render(settings);
  });

  settingsStore
    .loadSettings()
    .then((settings) => {
      render(settings);
    })
    .catch(() => {
      if (currentSettings) return;
      setStatus(msg("optionsStatusLoadFailed"));
    });
})();
