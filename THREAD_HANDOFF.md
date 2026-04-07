# Thread Handoff - Outlook Unread Badge

## Purpose
Chromium extension that calculates unread Outlook mail count from Favorites folders and applies it to:
- Outlook app icon badge (Dock/taskbar) via `navigator.setAppBadge`
- Outlook page title prefix (optional), e.g. `(2) Mail - ...`

## Current Status
Implemented and working with:
- Built-in folder exclusions (icon-signature based, language-agnostic)
- Custom include/exclude rules (name-based, case-insensitive, diacritics-sensitive)
- Popup quick toggles
- Full options page
- i18n structure with multiple locales

## Key Files
- `manifest.json`: MV3 config, content script injection, popup/options, i18n manifest fields
- `content.js`: unread calculation, rule engine, title updates, app badge updates
- `injected-bridge.js`: page-context badge ownership/guard logic around Badging API
- `popup.html`, `popup.css`, `popup.js`: quick settings + open settings + version
- `options.html`, `options.css`, `options.js`: full settings UI and storage management
- `i18n.js`: DOM i18n binding helper for popup/options
- `_locales/*/messages.json`: localized strings

## Storage Keys (`chrome.storage.sync`)
- `folderRules`: custom rules array
  - item shape: `{ name: string, mode: "include" | "exclude", enabled: boolean }`
- `builtInRuleState`: built-in exclusion toggles
  - shape: `{ drafts: boolean, deleted: boolean, junk: boolean, sent: boolean, archive: boolean }`
- `showUnreadInTitle`: boolean toggle for title prefix
- `showUnreadOnAppIcon`: boolean toggle for app icon badge

## Built-in Exclusion Detection
Language-agnostic via folder icon signatures from Outlook UI:
- Drafts: ``
- Deleted: ``
- Junk: ``
- Sent: ``
- Archive: ``

## Counting Logic (Favorites Scope)
1. Find Favorites root in tree (`favoritesRoot` or structural fallback)
2. Enumerate direct children only
3. Apply custom rules (enabled only; last match wins)
4. If no custom decision, apply built-in icon exclusion
5. Parse unread count in order:
   - Visible numeric badge chip in row (primary)
   - Last numeric value inside last parenthesized segment in title (fallback)
   - Text-based numeric extraction (last fallback)
6. Sum all included folder counts

## Title and Badge Behavior
- Title updates are optional (`showUnreadInTitle`), default `true`
- App icon badge updates are optional (`showUnreadOnAppIcon`)
  - platform-aware default when unset: `false` on Windows, `true` elsewhere
- On Windows, periodic reassert (12s) keeps app badge aligned if native integrations overwrite it
- Setting changes trigger immediate and deferred refresh to avoid throttle misses

## Popup vs Options
Popup provides quick actions:
- Toggle: `Show unread count in page title`
- Toggle: `Show unread count on app icon`
- Button: `Manage Rules & Settings`

Options provides full configuration:
- Disclaimer (Favorites-only scope)
- Title counter toggle
- App icon badge toggle
- Built-in exclusion toggles
- Custom rule list with include/exclude mode + enable/disable + remove
- Version footer

## Localization
Default locale: `en`

Currently present locales:
- `en`, `sk`, `de`, `es`, `fr`, `it`, `ru`, `uk`, `sv`, `fi`, `nb`, `no`, `et`, `sl`

To add another language:
1. Create `_locales/<code>/messages.json`
2. Copy all keys from `_locales/en/messages.json`
3. Translate values, keep placeholders and key names unchanged

## Validation Checklist
After changes:
1. Reload extension (`edge://extensions` / `chrome://extensions`)
2. Verify popup toggles immediately affect title/icon behavior
3. Verify built-in toggle changes affect included folders
4. Verify custom rule add/update/delete/enable updates counts without reload
5. Verify Favorites-only behavior remains intact
6. Verify no locale JSON syntax errors

## Known Constraints
- Extension cannot directly disable native Outlook/Windows badge pipelines
- Badge ownership can still race with host app/native integration; mitigations are in place
- DOM shape/icon glyphs can change after Outlook updates (monitor icon signatures/selectors)

## Suggested Next Work
- Add diagnostic mode (optional) to show per-folder decision and parsed count
- Add lightweight unit tests for parsing and rule precedence logic
- Consider exposing a read-only debug panel in options for current computed folder map
