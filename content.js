(() => {
  const CHANNEL = "OUTLOOK_PWA_BADGE_CHANNEL";
  const MIN_SEND_INTERVAL_MS = 1200;
  const ZERO_CONFIRM_MS = 5000;
  const BADGE_REASSERT_MS = 12000;
  const settingsStore = globalThis.OutlookUnreadBadgeSettings;

  const BUILT_IN_EXCLUSIONS = [
    { id: "drafts", signature: "" },
    { id: "deleted", signature: "" },
    { id: "junk", signature: "" },
    { id: "sent", signature: "" },
    { id: "archive", signature: "" }
  ];
  const DEFAULT_BUILTIN_RULE_STATE = Object.freeze(settingsStore.defaultBuiltInRuleState());

  let customFolderRules = [];
  let builtInRuleState = { ...DEFAULT_BUILTIN_RULE_STATE };
  let showUnreadInTitle = true;
  let showUnreadOnAppIcon = true;
  let isWindows = isWindowsPlatform();
  let settingsLoaded = false;
  let titleUpdateInProgress = false;
  let lastKnownUnread = null;

  function injectBridgeScript() {
    if (document.documentElement.dataset.outlookBadgeBridgeInjected === "1") {
      return;
    }

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected-bridge.js");
    script.async = false;
    script.onload = () => {
      script.remove();
      document.documentElement.dataset.outlookBadgeBridgeInjected = "1";
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function normalizeFolderName(name) {
    if (!name) return "";
    return name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function normalizeRuleName(name) {
    if (!name) return "";
    return String(name).replace(/\s+/g, " ").toLowerCase().trim();
  }

  function getIconSignature(item) {
    const icons = item.querySelectorAll("i.fui-Icon-font");
    if (icons.length >= 2) {
      const first = (icons[0].textContent || "").trim();
      const second = (icons[1].textContent || "").trim();
      const pair = `${first}${second}`;
      if (pair) return pair;
    }

    const iconContainer = item.querySelector(".ppZg6");
    if (iconContainer) {
      const compact = (iconContainer.textContent || "").replace(/\s+/g, "").trim();
      if (compact.length >= 2) return compact.slice(0, 2);
    }

    return "";
  }

  function isDefaultExcludedFolder(item) {
    const iconSignature = getIconSignature(item);
    const match = BUILT_IN_EXCLUSIONS.find((rule) => rule.signature === iconSignature);
    if (!match) return false;
    return builtInRuleState[match.id] !== false;
  }

  function getItemFolderName(item) {
    const folderName = item.getAttribute("data-folder-name") || "";
    if (folderName) return folderName;

    const title = item.getAttribute("title") || "";
    if (title) {
      const firstChunk = title.split(" - ")[0].split(" – ")[0].trim();
      if (firstChunk) return firstChunk;
    }

    const nameNode = item.querySelector("span.gtcPn");
    if (nameNode && nameNode.textContent) {
      return nameNode.textContent.trim();
    }

    return "";
  }

  function normalizeRules(rawRules) {
    if (!Array.isArray(rawRules)) return [];
    return rawRules
      .filter((rule) => rule && typeof rule.name === "string" && typeof rule.mode === "string")
      .map((rule) => ({
        name: normalizeRuleName(rule.name),
        mode: rule.mode === "include" ? "include" : "exclude",
        enabled: rule.enabled !== false
      }))
      .filter((rule) => rule.name.length > 0);
  }

  function normalizeBuiltInRuleState(rawState) {
    const normalized = { ...DEFAULT_BUILTIN_RULE_STATE };
    if (!rawState || typeof rawState !== "object") return normalized;

    for (const rule of BUILT_IN_EXCLUSIONS) {
      if (Object.prototype.hasOwnProperty.call(rawState, rule.id)) {
        normalized[rule.id] = Boolean(rawState[rule.id]);
      }
    }
    return normalized;
  }

  function normalizeShowTitleCount(rawValue) {
    if (typeof rawValue === "boolean") return rawValue;
    return true;
  }

  function isWindowsPlatform() {
    const uaPlatform = navigator.userAgentData && navigator.userAgentData.platform;
    if (typeof uaPlatform === "string" && uaPlatform.toLowerCase().includes("windows")) return true;
    const platform = navigator.platform || "";
    if (/win/i.test(platform)) return true;
    const ua = navigator.userAgent || "";
    return /windows/i.test(ua);
  }

  function normalizeShowAppBadge(rawValue) {
    if (typeof rawValue === "boolean") return rawValue;
    return !isWindowsPlatform();
  }

  function publishBadgeOptions() {
    window.postMessage(
      {
        channel: CHANNEL,
        type: "SET_OPTIONS",
        enforceOwnership: false
      },
      window.location.origin
    );
  }

  function disableBadgeControl() {
    window.postMessage(
      {
        channel: CHANNEL,
        type: "DISABLE_BADGE"
      },
      window.location.origin
    );
  }

  function stripLeadingCountPrefix(title) {
    if (!title) return "";
    return title.replace(/^\(\d+\)\s+/, "").trim();
  }

  function shouldSuppressTitleCount() {
    return false;
  }

  function updatePageTitle(unread) {
    if (!showUnreadInTitle || shouldSuppressTitleCount()) {
      enforceTitleSuppression();
      return;
    }

    if (!Number.isInteger(unread) || unread < 0) return;

    const baseTitle = stripLeadingCountPrefix(document.title);
    const nextTitle = unread > 0 ? `(${unread}) ${baseTitle}` : baseTitle;
    if (!nextTitle || nextTitle === document.title) return;

    titleUpdateInProgress = true;
    document.title = nextTitle;
    queueMicrotask(() => {
      titleUpdateInProgress = false;
    });
  }

  function enforceTitleSuppression() {
    const stripped = stripLeadingCountPrefix(document.title);
    if (!stripped || stripped === document.title) return;
    titleUpdateInProgress = true;
    document.title = stripped;
    queueMicrotask(() => {
      titleUpdateInProgress = false;
    });
  }

  function applySettings(settings) {
    customFolderRules = normalizeRules(settings.folderRules);
    builtInRuleState = normalizeBuiltInRuleState(settings.builtInRuleState);
    showUnreadInTitle = normalizeShowTitleCount(settings.display.showUnreadInTitle);
    showUnreadOnAppIcon = normalizeShowAppBadge(settings.display.showUnreadOnAppIcon);
    isWindows = isWindowsPlatform();
  }

  function isExcludedFolder(item) {
    const normalizedFolderName = normalizeRuleName(getItemFolderName(item));

    // Last matching rule wins.
    let decision = null;
    for (const rule of customFolderRules) {
      if (!rule.enabled) continue;
      if (rule.name === normalizedFolderName) {
        decision = rule.mode;
      }
    }

    if (decision === "include") return false;
    if (decision === "exclude") return true;

    return isDefaultExcludedFolder(item);
  }

  function parseUnreadFromTitleText(title) {
    if (!title) return null;

    // Outlook title formats vary by locale:
    // - "... (40 unread)"
    // - "... (neprečítané: 1)"
    // - "... (1 neprečítaných)"
    // We parse the last parenthesized segment and take the last number from it.
    const parenSegments = [...title.matchAll(/\(([^)]*)\)/g)];
    if (parenSegments.length > 0) {
      const lastSegment = parenSegments[parenSegments.length - 1][1] || "";
      const numbers = [...lastSegment.matchAll(/(\d[\d\s,.\u00A0]*)/g)];
      if (numbers.length > 0) {
        const normalized = numbers[numbers.length - 1][1].replace(/[^\d]/g, "");
        if (normalized) return Number(normalized);
      }
    }

    return null;
  }

  function parseUnreadFromTreeItemText(item) {
    const rawText = (item.textContent || "").replace(/\s+/g, " ").trim();
    if (!rawText) return null;

    const folderName = item.getAttribute("data-folder-name") || "";
    const normalizedFolderName = normalizeFolderName(folderName);
    const normalizedText = normalizeFolderName(rawText);

    // Outlook usually renders unread as a standalone badge number next to folder name.
    // Remove the folder name, then extract the first remaining number.
    let tail = normalizedText;
    if (normalizedFolderName && tail.startsWith(normalizedFolderName)) {
      tail = tail.slice(normalizedFolderName.length).trim();
    }

    const numberFromTail = tail.match(/(\d[\d\s,.\u00A0]*)/);
    if (numberFromTail) {
      const normalized = numberFromTail[1].replace(/[^\d]/g, "");
      if (normalized) return Number(normalized);
    }

    // Fallback: parse last number visible in tree item text.
    const allNumbers = [...normalizedText.matchAll(/(\d[\d\s,.\u00A0]*)/g)];
    if (allNumbers.length > 0) {
      const normalized = allNumbers[allNumbers.length - 1][1].replace(/[^\d]/g, "");
      if (normalized) return Number(normalized);
    }

    return null;
  }

  function parseCountFromBadgeChip(item) {
    // Prefer explicit numeric badge chip rendered next to folder name.
    // This avoids relying on locale-specific title formats.
    const candidates = item.querySelectorAll("span,div");
    let lastNumeric = null;

    for (const node of candidates) {
      const text = (node.textContent || "").replace(/\s+/g, "").trim();
      if (!text) continue;
      if (!/^\d{1,6}$/.test(text)) continue;
      lastNumeric = Number(text);
    }

    return Number.isInteger(lastNumeric) ? lastNumeric : null;
  }

  function parseUnreadFromWindowTitle(title) {
    if (!title) return null;

    // Common Outlook title formats: "(12) Mail - ...".
    const parenMatch = title.match(/^\s*\((\d{1,6})\)/);
    if (parenMatch) return Number(parenMatch[1]);

    return null;
  }

  function getFavoritesUnreadCount() {
    const items = Array.from(document.querySelectorAll('[role="treeitem"]'));
    let favoritesIndex = items.findIndex((el) => el.id === "favoritesRoot");
    if (favoritesIndex === -1) {
      // Fallback for variants where favorites root id differs.
      // Pick the first level-1 tree root before the primary mailbox root.
      const firstPrimaryIndex = items.findIndex((el) =>
        (el.id || "").startsWith("primaryMailboxRoot_")
      );
      favoritesIndex = items.findIndex(
        (el, i) =>
          Number(el.getAttribute("aria-level") || "0") === 1 &&
          i >= 0 &&
          (firstPrimaryIndex === -1 || i < firstPrimaryIndex)
      );
    }
    if (favoritesIndex === -1) return null;

    const rootLevel = Number(items[favoritesIndex].getAttribute("aria-level") || "1");
    const favoriteFolderItems = [];

    for (let i = favoritesIndex + 1; i < items.length; i += 1) {
      const el = items[i];
      const level = Number(el.getAttribute("aria-level") || "0");
      if (level <= rootLevel) break;

      // Only include direct children under Favorites to avoid nested mailbox traversal.
      if (level === rootLevel + 1) {
        favoriteFolderItems.push(el);
      }
    }

    // Outlook can briefly unmount/rebuild this subtree during folder switches.
    // Treat empty favorites as unknown, not zero, to avoid false clears.
    if (favoriteFolderItems.length === 0) return null;

    const seenKeys = new Set();
    let totalUnread = 0;

    for (const item of favoriteFolderItems) {
      const folderName = getItemFolderName(item);
      if (isExcludedFolder(item)) continue;

      const identityKey = [
        normalizeFolderName(folderName),
        item.getAttribute("title") || "",
        item.textContent || ""
      ].join("|");

      if (seenKeys.has(identityKey)) continue;
      seenKeys.add(identityKey);

      let unread = parseCountFromBadgeChip(item);
      if (unread === null) {
        unread = parseUnreadFromTitleText(item.getAttribute("title") || "");
      }
      if (unread === null) {
        unread = parseUnreadFromTreeItemText(item);
      }
      if (Number.isInteger(unread) && unread > 0) {
        totalUnread += unread;
      }
    }

    return totalUnread;
  }

  let lastSentCount = null;
  let lastSentAt = 0;
  let pendingZeroSince = 0;
  let deferredTickTimer = null;

  function scheduleDeferredTick(delayMs) {
    const delay = Math.max(0, Number(delayMs) || 0);
    if (deferredTickTimer !== null) {
      window.clearTimeout(deferredTickTimer);
    }
    deferredTickTimer = window.setTimeout(() => {
      deferredTickTimer = null;
      tick();
    }, delay);
  }

  function publishCount(count, force = false) {
    if (!Number.isInteger(count) || count < 0) return;
    const now = Date.now();

    // Avoid clearing badge on transient zero during Outlook pane rerenders.
    if (!force && count === 0 && Number.isInteger(lastSentCount) && lastSentCount > 0) {
      if (pendingZeroSince === 0) {
        pendingZeroSince = now;
        return;
      }
      if (now - pendingZeroSince < ZERO_CONFIRM_MS) {
        return;
      }
    } else {
      pendingZeroSince = 0;
    }
    if (!force && now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      scheduleDeferredTick(MIN_SEND_INTERVAL_MS - (now - lastSentAt) + 20);
      return;
    }

    window.postMessage(
      {
        channel: CHANNEL,
        type: "SET_BADGE",
        count
      },
      window.location.origin
    );

    lastSentCount = count;
    lastSentAt = now;
  }

  function calculateUnreadCount() {
    // Primary mode: sum unread from Favorites only.
    const favoritesCount = getFavoritesUnreadCount();
    if (favoritesCount !== null) return favoritesCount;

    // Fallback mode if Favorites tree is unavailable.
    const titleCount = parseUnreadFromWindowTitle(document.title);
    if (titleCount !== null) return titleCount;

    return null;
  }

  function tick() {
    if (!settingsLoaded) return;
    if (shouldSuppressTitleCount()) {
      enforceTitleSuppression();
    }
    const unread = calculateUnreadCount();
    if (unread === null) return;
    lastKnownUnread = unread;
    updatePageTitle(unread);
    if (!showUnreadOnAppIcon) {
      publishBadgeOptions();
      disableBadgeControl();
      return;
    }
    publishBadgeOptions();
    publishCount(unread);
  }

  injectBridgeScript();

  const titleObserverTarget = document.querySelector("title") || document.head || document.documentElement;
  const titleObserver = new MutationObserver(() => {
    if (titleUpdateInProgress) return;
    if (settingsLoaded && shouldSuppressTitleCount()) {
      enforceTitleSuppression();
    }
    tick();
  });
  titleObserver.observe(titleObserverTarget, {
    subtree: true,
    childList: true,
    characterData: true
  });

  const bodyObserver = new MutationObserver(() => {
    // Outlook updates tree nodes dynamically; debounce to microtask.
    queueMicrotask(tick);
  });
  bodyObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-label", "title", "aria-expanded", "aria-selected"]
  });

  window.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });

  // Keep app-icon badge aligned with our computed unread count in environments
  // where native integrations may overwrite badge state (commonly Windows).
  setInterval(() => {
    if (!showUnreadOnAppIcon) return;
    if (!isWindows) return;
    if (!Number.isInteger(lastKnownUnread)) return;
    publishBadgeOptions();
    publishCount(lastKnownUnread, true);
  }, BADGE_REASSERT_MS);

  settingsStore.subscribe((settings) => {
    const prevShowUnreadInTitle = showUnreadInTitle;
    const prevShowUnreadOnAppIcon = showUnreadOnAppIcon;
    applySettings(settings);

    if (prevShowUnreadInTitle !== showUnreadInTitle) {
      if (!showUnreadInTitle) {
        updatePageTitle(0);
      } else if (Number.isInteger(lastKnownUnread)) {
        updatePageTitle(lastKnownUnread);
      }
    }

    if (prevShowUnreadOnAppIcon !== showUnreadOnAppIcon) {
      if (!showUnreadOnAppIcon) {
        publishBadgeOptions();
        disableBadgeControl();
      } else if (Number.isInteger(lastKnownUnread)) {
        publishBadgeOptions();
        publishCount(lastKnownUnread, true);
      }
    }

    tick();
    scheduleDeferredTick(MIN_SEND_INTERVAL_MS + 30);
  });

  settingsStore.loadSettings().then((settings) => {
    applySettings(settings);
    settingsLoaded = true;
    publishBadgeOptions();
    tick();
  });
})();
