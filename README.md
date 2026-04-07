# Outlook Unread Badge (Chromium Extension)

This extension reads unread email count from Outlook Web (`outlook.office.com` / `outlook.live.com`) and updates the installed Outlook app icon badge using the Badging API.

## How it works

- `content.js` sums unread counts from folders listed under `Favorites`.
- Optional title counter (enabled by default): prepends unread count to the page title (for example `(2) Pošta – ...`).
- Optional app icon badge counter: can be disabled in settings, and defaults to disabled on Windows when unset.
- It excludes common system folders by default using folder icon signatures (language-agnostic): `Drafts`, `Deleted`, `Junk`, `Sent`, `Archive`.
- In settings, you can disable any built-in exclusion with toggle switches.
- You can override folder handling with custom rules in extension settings (`Include` / `Exclude` by folder name; last matching rule wins), but these rules are applied only to folders currently present in `Favorites`.
- It posts unread count events into page context.
- `injected-bridge.js` runs in page context and calls:
  - `navigator.setAppBadge(count)`
  - `navigator.clearAppBadge()`

## Install locally (Edge/Chrome)

1. Open `edge://extensions` (or `chrome://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.
5. Open Outlook PWA (`outlook.office.com`) in your installed app window.
6. Open extension settings and define custom folder rules if needed:
   - `edge://extensions` -> Outlook Unread Badge -> **Extension options**
   - or `chrome://extensions` -> Outlook Unread Badge -> **Extension options**

## Notes

- This sets the **PWA app icon badge** (Dock/taskbar), not the extension toolbar badge.
- Badge behavior depends on browser + OS support for Badging API.
- Outlook UI changes may require selector/title parsing updates.
- If `Favorites` is unavailable, the extension falls back to unread count from window title if present.
- Settings disclaimer: only folders in `Favorites` are considered for counting.
