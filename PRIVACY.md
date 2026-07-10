# Privacy Policy

**Outlook Unread Badge**

Last updated: 2026-07-10

## Summary
Outlook Unread Badge does **not** collect, store, transmit, sell, or share personal data.

## What the extension does
The extension reads unread-count information from Outlook Web / Outlook PWA pages and uses it to:
- show an unread badge on the app icon (when enabled),
- optionally show unread count in the page title,
- apply user-defined include/exclude folder rules.

## Data handling
- Processing happens locally in your browser.
- No email content is sent to any server.
- No personal data is transmitted to the developer or third parties.

## Permissions
- `storage`: used only to save extension settings (rules, toggles, preferences).
- `scripting`: used only to register the extension's own content script on the optional MCAS-proxied Outlook domain when the user enables proxy support.
- `activeTab`: used only when the user opens the extension popup, to check locally whether the current tab is an MCAS-proxied Outlook page and offer enabling proxy support. The URL is processed locally and is never stored or transmitted.
- Host permissions for Outlook domains: used only to run on supported Outlook pages and calculate unread counts.
- Optional host permission for `outlook.cloud.microsoft.mcas.ms`: requested only when the user explicitly enables Defender for Cloud Apps (MCAS) proxy support, and used for the same unread-count functionality on that domain.

## Sync behavior
If browser sync is enabled, settings may be synced by your browser account (for example, Edge/Chrome sync). This is handled by the browser platform, not by our own backend.

## Remote code
The extension does not load or execute remote code. All executable code is packaged with the extension.

## Third-party sharing
We do not sell or transfer user data to third parties.

## Changes to this policy
If this policy changes, the updated version will be published at this location with a new “Last updated” date.

## Contact
For privacy questions, contact the developer through the extension listing support channel.
