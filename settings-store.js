(() => {
  const SETTINGS_KEY = "outlookUnreadBadgeSettings";
  const SETTINGS_SCHEMA_VERSION = 1;
  const LEGACY_KEYS = [
    "folderRules",
    "builtInRuleState",
    "showUnreadInTitle",
    "showUnreadOnAppIcon"
  ];

  const BUILT_IN_RULE_IDS = ["drafts", "deleted", "junk", "sent", "archive"];

  let cache = null;
  let writeTimer = null;
  let pendingWriteValue = null;
  let pendingResolvers = [];
  let pendingRejectors = [];
  let loadPromise = null;
  let updateChain = Promise.resolve();

  function now() {
    return Date.now();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isWindowsPlatform() {
    const uaPlatform = navigator.userAgentData && navigator.userAgentData.platform;
    if (typeof uaPlatform === "string" && uaPlatform.toLowerCase().includes("windows")) return true;
    const platform = navigator.platform || "";
    if (/win/i.test(platform)) return true;
    const ua = navigator.userAgent || "";
    return /windows/i.test(ua);
  }

  function normalizeRuleName(name) {
    if (!name) return "";
    return String(name).replace(/\s+/g, " ").toLowerCase().trim();
  }

  function defaultBuiltInRuleState() {
    return BUILT_IN_RULE_IDS.reduce((acc, id) => {
      acc[id] = true;
      return acc;
    }, {});
  }

  function getDefaultSettings() {
    const ts = now();
    return {
      settingsVersion: SETTINGS_SCHEMA_VERSION,
      groupsUpdatedAt: {
        rules: ts,
        builtIn: ts,
        display: ts
      },
      display: {
        showUnreadInTitle: true,
        showUnreadOnAppIcon: !isWindowsPlatform()
      },
      builtInRuleState: defaultBuiltInRuleState(),
      folderRules: [],
      meta: {
        updatedAt: ts,
        lastWriteAt: 0,
        lastSyncWriteAt: 0,
        storageArea: "sync",
        lastSyncError: ""
      }
    };
  }

  function normalizeRule(rule) {
    if (!rule || typeof rule.name !== "string") return null;
    const normalizedName = normalizeRuleName(rule.name);
    if (!normalizedName) return null;
    const mode = rule.mode === "include" ? "include" : "exclude";
    const updatedAt = Number.isFinite(rule.updatedAt) ? Number(rule.updatedAt) : 0;
    return {
      name: rule.name.trim(),
      mode,
      enabled: rule.enabled !== false,
      updatedAt
    };
  }

  function normalizeRules(rules) {
    if (!Array.isArray(rules)) return [];
    const byName = new Map();

    for (const raw of rules) {
      const normalized = normalizeRule(raw);
      if (!normalized) continue;
      const key = normalizeRuleName(normalized.name);
      const existing = byName.get(key);
      if (!existing || normalized.updatedAt >= existing.updatedAt) {
        byName.set(key, normalized);
      }
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function normalizeBuiltInRuleState(raw) {
    const fallback = defaultBuiltInRuleState();
    if (!raw || typeof raw !== "object") return fallback;
    for (const id of BUILT_IN_RULE_IDS) {
      if (Object.prototype.hasOwnProperty.call(raw, id)) {
        fallback[id] = Boolean(raw[id]);
      }
    }
    return fallback;
  }

  function normalizeGroupsUpdatedAt(raw, fallbackTs) {
    const result = {
      rules: fallbackTs,
      builtIn: fallbackTs,
      display: fallbackTs
    };
    if (!raw || typeof raw !== "object") return result;
    for (const key of ["rules", "builtIn", "display"]) {
      if (Number.isFinite(raw[key])) result[key] = Number(raw[key]);
    }
    return result;
  }

  function normalizeMeta(raw, fallbackTs) {
    const meta = {
      updatedAt: fallbackTs,
      lastWriteAt: 0,
      lastSyncWriteAt: 0,
      storageArea: "sync",
      lastSyncError: ""
    };
    if (!raw || typeof raw !== "object") return meta;
    if (Number.isFinite(raw.updatedAt)) meta.updatedAt = Number(raw.updatedAt);
    if (Number.isFinite(raw.lastWriteAt)) meta.lastWriteAt = Number(raw.lastWriteAt);
    if (Number.isFinite(raw.lastSyncWriteAt)) meta.lastSyncWriteAt = Number(raw.lastSyncWriteAt);
    if (raw.storageArea === "local" || raw.storageArea === "sync") {
      meta.storageArea = raw.storageArea;
    }
    if (typeof raw.lastSyncError === "string") {
      meta.lastSyncError = raw.lastSyncError;
    }
    return meta;
  }

  function normalizeSettings(raw) {
    const defaults = getDefaultSettings();
    if (!raw || typeof raw !== "object") return defaults;

    const display = {
      showUnreadInTitle:
        typeof raw.display?.showUnreadInTitle === "boolean"
          ? raw.display.showUnreadInTitle
          : defaults.display.showUnreadInTitle,
      showUnreadOnAppIcon:
        typeof raw.display?.showUnreadOnAppIcon === "boolean"
          ? raw.display.showUnreadOnAppIcon
          : defaults.display.showUnreadOnAppIcon
    };

    const normalized = {
      settingsVersion: SETTINGS_SCHEMA_VERSION,
      groupsUpdatedAt: normalizeGroupsUpdatedAt(raw.groupsUpdatedAt, defaults.meta.updatedAt),
      display,
      builtInRuleState: normalizeBuiltInRuleState(raw.builtInRuleState),
      folderRules: normalizeRules(raw.folderRules),
      meta: normalizeMeta(raw.meta, defaults.meta.updatedAt)
    };

    return normalized;
  }

  function mergeRules(baseRules, incomingRules) {
    const map = new Map();
    for (const rule of normalizeRules(baseRules)) {
      map.set(normalizeRuleName(rule.name), rule);
    }
    for (const rule of normalizeRules(incomingRules)) {
      const key = normalizeRuleName(rule.name);
      const existing = map.get(key);
      if (!existing || rule.updatedAt >= existing.updatedAt) {
        map.set(key, rule);
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function mergeSettings(a, b) {
    if (!a) return b ? normalizeSettings(b) : getDefaultSettings();
    if (!b) return normalizeSettings(a);

    const left = normalizeSettings(a);
    const right = normalizeSettings(b);
    const merged = getDefaultSettings();

    for (const group of ["display", "builtIn", "rules"]) {
      const leftTs = left.groupsUpdatedAt[group] || 0;
      const rightTs = right.groupsUpdatedAt[group] || 0;
      if (group === "display") {
        merged.display = rightTs >= leftTs ? right.display : left.display;
      } else if (group === "builtIn") {
        merged.builtInRuleState = rightTs >= leftTs ? right.builtInRuleState : left.builtInRuleState;
      } else {
        if (rightTs > leftTs) {
          merged.folderRules = right.folderRules;
        } else if (leftTs > rightTs) {
          merged.folderRules = left.folderRules;
        } else {
          merged.folderRules = mergeRules(left.folderRules, right.folderRules);
        }
      }
      merged.groupsUpdatedAt[group] = Math.max(leftTs, rightTs);
    }

    merged.meta = right.meta.updatedAt >= left.meta.updatedAt ? right.meta : left.meta;
    merged.meta.updatedAt = Math.max(left.meta.updatedAt || 0, right.meta.updatedAt || 0);
    merged.settingsVersion = SETTINGS_SCHEMA_VERSION;
    return normalizeSettings(merged);
  }

  async function readSettingsFromArea(area) {
    const data = await area.get(SETTINGS_KEY);
    const raw = data?.[SETTINGS_KEY];
    if (!raw || typeof raw !== "object") return null;
    return normalizeSettings(raw);
  }

  async function readLegacyFromArea(area) {
    const legacy = await area.get(LEGACY_KEYS);
    const hasAny = LEGACY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(legacy, key));
    if (!hasAny) return null;

    const defaults = getDefaultSettings();
    const ts = now();
    return normalizeSettings({
      settingsVersion: SETTINGS_SCHEMA_VERSION,
      groupsUpdatedAt: {
        rules: Object.prototype.hasOwnProperty.call(legacy, "folderRules") ? ts : defaults.groupsUpdatedAt.rules,
        builtIn: Object.prototype.hasOwnProperty.call(legacy, "builtInRuleState")
          ? ts
          : defaults.groupsUpdatedAt.builtIn,
        display:
          Object.prototype.hasOwnProperty.call(legacy, "showUnreadInTitle") ||
          Object.prototype.hasOwnProperty.call(legacy, "showUnreadOnAppIcon")
            ? ts
            : defaults.groupsUpdatedAt.display
      },
      display: {
        showUnreadInTitle:
          typeof legacy.showUnreadInTitle === "boolean"
            ? legacy.showUnreadInTitle
            : defaults.display.showUnreadInTitle,
        showUnreadOnAppIcon:
          typeof legacy.showUnreadOnAppIcon === "boolean"
            ? legacy.showUnreadOnAppIcon
            : defaults.display.showUnreadOnAppIcon
      },
      builtInRuleState: normalizeBuiltInRuleState(legacy.builtInRuleState),
      folderRules: normalizeRules(legacy.folderRules).map((r) => ({ ...r, updatedAt: ts })),
      meta: {
        updatedAt: ts,
        lastWriteAt: 0,
        lastSyncWriteAt: 0,
        storageArea: "sync",
        lastSyncError: ""
      }
    });
  }

  async function persistNow(settings) {
    const next = normalizeSettings(settings);
    const writeTs = now();
    next.meta.lastWriteAt = writeTs;
    next.meta.updatedAt = writeTs;

    try {
      await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
      next.meta.storageArea = "sync";
      next.meta.lastSyncWriteAt = writeTs;
      next.meta.lastSyncError = "";
      cache = next;
      return next;
    } catch (error) {
      next.meta.storageArea = "local";
      next.meta.lastSyncError = String(error?.message || error || "sync write failed");
      await chrome.storage.local.set({ [SETTINGS_KEY]: next });
      cache = next;
      return next;
    }
  }

  function flushPending() {
    const toWrite = pendingWriteValue;
    pendingWriteValue = null;

    persistNow(toWrite)
      .then((saved) => {
        const resolvers = pendingResolvers;
        pendingResolvers = [];
        pendingRejectors = [];
        resolvers.forEach((resolve) => resolve(saved));
      })
      .catch((error) => {
        const rejectors = pendingRejectors;
        pendingResolvers = [];
        pendingRejectors = [];
        rejectors.forEach((reject) => reject(error));
      });
  }

  function queuePersist(settings, debounceMs = 300) {
    pendingWriteValue = normalizeSettings(settings);
    return new Promise((resolve, reject) => {
      pendingResolvers.push(resolve);
      pendingRejectors.push(reject);

      if (writeTimer !== null) {
        clearTimeout(writeTimer);
      }
      writeTimer = setTimeout(() => {
        writeTimer = null;
        flushPending();
      }, debounceMs);
    });
  }

  async function loadSettings() {
    if (cache) return clone(cache);
    if (loadPromise) return clone(await loadPromise);

    loadPromise = (async () => {
      const [syncSettings, localSettings, legacySync, legacyLocal] = await Promise.all([
        readSettingsFromArea(chrome.storage.sync).catch(() => null),
        readSettingsFromArea(chrome.storage.local).catch(() => null),
        readLegacyFromArea(chrome.storage.sync).catch(() => null),
        readLegacyFromArea(chrome.storage.local).catch(() => null)
      ]);

      const hasCurrent = Boolean(syncSettings || localSettings);
      const hasLegacy = Boolean(legacySync || legacyLocal);

      let merged;
      if (hasCurrent) {
        // If versioned settings already exist, do not let legacy flat keys override them.
        merged = mergeSettings(syncSettings, localSettings);
      } else if (hasLegacy) {
        merged = mergeSettings(legacySync, legacyLocal);
      } else {
        merged = getDefaultSettings();
      }

      cache = normalizeSettings(merged);

      if (!syncSettings || cache.settingsVersion !== SETTINGS_SCHEMA_VERSION || (hasLegacy && !hasCurrent)) {
        await persistNow(cache).catch(() => {});
      }

      // Cleanup one-time legacy keys so they cannot interfere with future loads.
      if (hasLegacy) {
        await Promise.all([
          chrome.storage.sync.remove(LEGACY_KEYS).catch(() => {}),
          chrome.storage.local.remove(LEGACY_KEYS).catch(() => {})
        ]);
      }

      return cache;
    })();

    try {
      const loaded = await loadPromise;
      return clone(loaded);
    } finally {
      loadPromise = null;
    }
  }

  async function updateSettings(mutator, groups = [], options = {}) {
    const debounceMs = Number.isFinite(options.debounceMs) ? Math.max(0, options.debounceMs) : 300;

    const run = async () => {
      const current = await loadSettings();
      const next = clone(current);
      mutator(next);

      const ts = now();
      for (const group of groups) {
        if (group === "rules" || group === "builtIn" || group === "display") {
          next.groupsUpdatedAt[group] = ts;
        }
      }

      next.settingsVersion = SETTINGS_SCHEMA_VERSION;
      next.folderRules = normalizeRules(next.folderRules);
      next.builtInRuleState = normalizeBuiltInRuleState(next.builtInRuleState);
      next.display = {
        showUnreadInTitle: Boolean(next.display?.showUnreadInTitle),
        showUnreadOnAppIcon: Boolean(next.display?.showUnreadOnAppIcon)
      };
      cache = normalizeSettings(next);

      await queuePersist(cache, debounceMs);
      return clone(cache);
    };

    updateChain = updateChain.then(run, run);
    return updateChain;
  }

  async function resetSettings() {
    const defaults = getDefaultSettings();
    const ts = now();
    defaults.groupsUpdatedAt = {
      rules: ts,
      builtIn: ts,
      display: ts
    };
    cache = normalizeSettings(defaults);
    await queuePersist(cache, 0);
    return clone(cache);
  }

  function subscribe(onChange) {
    if (!chrome.storage?.onChanged) return () => {};

    const handler = async (changes, areaName) => {
      if (areaName !== "sync" && areaName !== "local") return;
      if (!changes[SETTINGS_KEY]) return;
      const incoming = normalizeSettings(changes[SETTINGS_KEY].newValue);
      cache = mergeSettings(cache, incoming);
      onChange(clone(cache));
    };

    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  function getDiagnostics(settings) {
    const normalized = normalizeSettings(settings || cache || getDefaultSettings());
    const summary = JSON.stringify({
      v: normalized.settingsVersion,
      d: normalized.display,
      b: normalized.builtInRuleState,
      r: normalized.folderRules
    });

    let hash = 5381;
    for (let i = 0; i < summary.length; i += 1) {
      hash = (hash * 33) ^ summary.charCodeAt(i);
    }
    const settingsHash = (hash >>> 0).toString(16);

    return {
      extensionId: chrome.runtime.id,
      settingsVersion: normalized.settingsVersion,
      storageArea: normalized.meta.storageArea,
      lastSyncWriteAt: normalized.meta.lastSyncWriteAt,
      lastWriteAt: normalized.meta.lastWriteAt,
      lastSyncError: normalized.meta.lastSyncError,
      settingsHash
    };
  }

  globalThis.OutlookUnreadBadgeSettings = {
    SETTINGS_KEY,
    SETTINGS_SCHEMA_VERSION,
    BUILT_IN_RULE_IDS,
    normalizeRuleName,
    defaultBuiltInRuleState,
    loadSettings,
    updateSettings,
    resetSettings,
    subscribe,
    getDiagnostics
  };
})();
