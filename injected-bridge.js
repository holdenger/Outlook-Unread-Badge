(() => {
  const CHANNEL = "OUTLOOK_PWA_BADGE_CHANNEL";
  const REAPPLY_AFTER_BLOCK_MS = 100;
  let desiredCount = null;
  let enforceOwnership = false;
  let ownerWriteInProgress = false;
  let reapplyTimer = null;

  const nativeSetAppBadge =
    typeof navigator.setAppBadge === "function" ? navigator.setAppBadge.bind(navigator) : null;
  const nativeClearAppBadge =
    typeof navigator.clearAppBadge === "function" ? navigator.clearAppBadge.bind(navigator) : null;

  function scheduleReapply() {
    if (reapplyTimer !== null) return;
    reapplyTimer = window.setTimeout(async () => {
      reapplyTimer = null;
      await applyDesiredBadge();
    }, REAPPLY_AFTER_BLOCK_MS);
  }

  async function applyDesiredBadge() {
    if (!nativeSetAppBadge || !nativeClearAppBadge) return;
    if (desiredCount === null) return;

    ownerWriteInProgress = true;
    try {
      if (!Number.isInteger(desiredCount) || desiredCount <= 0) {
        await nativeClearAppBadge();
        return;
      }
      await nativeSetAppBadge(desiredCount);
    } finally {
      ownerWriteInProgress = false;
    }
  }

  function installBadgeGuards() {
    if (!nativeSetAppBadge || !nativeClearAppBadge) return;

    try {
      Object.defineProperty(navigator, "clearAppBadge", {
        configurable: true,
        writable: true,
        value: async () => {
          if (ownerWriteInProgress) {
            return nativeClearAppBadge();
          }

          if (enforceOwnership) {
            scheduleReapply();
            return;
          }

          if (Number.isInteger(desiredCount) && desiredCount > 0) {
            scheduleReapply();
            return;
          }
          return nativeClearAppBadge();
        }
      });
    } catch (_) {
      // Ignore if the property cannot be redefined in this runtime.
    }

    try {
      Object.defineProperty(navigator, "setAppBadge", {
        configurable: true,
        writable: true,
        value: async (count) => {
          if (ownerWriteInProgress) {
            return nativeSetAppBadge(count);
          }

          if (enforceOwnership) {
            if (Number.isInteger(desiredCount) && desiredCount > 0) {
              scheduleReapply();
            }
            return;
          }

          if (Number.isInteger(desiredCount) && desiredCount > 0 && count !== desiredCount) {
            scheduleReapply();
            return;
          }
          return nativeSetAppBadge(count);
        }
      });
    } catch (_) {
      // Ignore if the property cannot be redefined in this runtime.
    }
  }

  installBadgeGuards();

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data;
    try {
      if (!data || data.channel !== CHANNEL) return;

      if (data.type === "SET_OPTIONS") {
        enforceOwnership = Boolean(data.enforceOwnership);
        return;
      }

      if (data.type === "DISABLE_BADGE") {
        desiredCount = null;
        return;
      }

      if (data.type === "SET_BADGE") {
        desiredCount = Number.isInteger(data.count) ? data.count : 0;
        await applyDesiredBadge();
      }
    } catch (_) {
      // Ignore unsupported or transient failures.
    }
  });
})();
