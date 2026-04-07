(() => {
  function msg(key, substitutions) {
    return chrome.i18n.getMessage(key, substitutions) || key;
  }

  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = msg(el.dataset.i18n);
    });

    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", msg(el.dataset.i18nPlaceholder));
    });

    root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", msg(el.dataset.i18nAriaLabel));
    });

    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", msg(el.dataset.i18nTitle));
    });
  }

  window.__i18n = { msg, apply };
  apply();
})();
