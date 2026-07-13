#!/usr/bin/env bash
#
# Submit the extension to Chrome Web Store and Microsoft Edge Add-ons.
#
# Source of truth: GitHub Releases. The script downloads the source archive
# of a published release (latest by default), builds a clean extension ZIP
# from it, and uploads that to both stores. The state of your local working
# directory is irrelevant.
#
# What it does NOT do (not supported by either store API):
#   - store listing descriptions and screenshots (manage those in the
#     dashboards; in-package names/descriptions come from _locales)
#
# Requirements: 1Password CLI (`op`), curl, zip, unzip, python3
#
# Usage:
#   ./scripts/submit-to-stores.sh                  # latest release, both stores
#   ./scripts/submit-to-stores.sh --tag=v0.2.0     # specific release
#   ./scripts/submit-to-stores.sh --chrome         # Chrome Web Store only
#   ./scripts/submit-to-stores.sh --edge           # Edge Add-ons only
#   ./scripts/submit-to-stores.sh --dry-run        # build ZIP, skip uploads

set -euo pipefail

# ----------------------------------------------------------------------------
# Configuration - adjust these to your setup
# ----------------------------------------------------------------------------

GITHUB_REPO="holdenger/Outlook-Unread-Badge"

# Chrome Web Store (IDs are not secrets)
CWS_EXTENSION_ID="CHANGE_ME"                  # 32-char item ID from the CWS dashboard
CWS_PUBLISHER_ID="CHANGE_ME"                  # Publisher > Settings in the CWS dashboard

# Microsoft Edge Add-ons
EDGE_PRODUCT_ID="CHANGE_ME"                   # Product ID from Partner Center

# 1Password secret references (op://<vault>/<item>/<field>)
OP_CWS_CLIENT_ID="op://Private/Chrome Web Store API/client_id"
OP_CWS_CLIENT_SECRET="op://Private/Chrome Web Store API/client_secret"
OP_CWS_REFRESH_TOKEN="op://Private/Chrome Web Store API/refresh_token"
OP_EDGE_CLIENT_ID="op://Private/Edge Addons API/client_id"
OP_EDGE_API_KEY="op://Private/Edge Addons API/api_key"

# Files that go into the package (whitelist - nothing else gets shipped)
PACKAGE_CONTENTS=(
  manifest.json
  background.js
  content.js
  injected-bridge.js
  settings-store.js
  i18n.js
  options.html
  options.js
  options.css
  popup.html
  popup.js
  popup.css
  icons
  _locales
)

# ----------------------------------------------------------------------------

DO_CHROME=true
DO_EDGE=true
DRY_RUN=false
TAG=""
for arg in "$@"; do
  case "$arg" in
    --chrome) DO_EDGE=false ;;
    --edge) DO_CHROME=false ;;
    --dry-run) DRY_RUN=true ;;
    --tag=*) TAG="${arg#--tag=}" ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

json_get() { # json_get <key> ; reads JSON on stdin, prints value or empty
  python3 -c "
import json, sys
try:
    print(json.load(sys.stdin).get('$1', ''))
except Exception:
    pass
"
}

# ----------------------------------------------------------------------------
# Fetch release source from GitHub and build the package
# ----------------------------------------------------------------------------

if [ -z "$TAG" ]; then
  log "Resolving latest GitHub release of ${GITHUB_REPO}"
  TAG="$(curl -sf "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | json_get tag_name || true)"
  [ -n "$TAG" ] || die "Could not resolve the latest release tag (check network / GitHub availability)"
else
  # Fail early if the tag has no published release
  curl -sf "https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${TAG}" >/dev/null \
    || die "No published release found for tag ${TAG}"
fi
log "Source of truth: GitHub release ${TAG}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

log "Downloading source archive for ${TAG}"
curl -sfL "https://github.com/${GITHUB_REPO}/archive/refs/tags/${TAG}.zip" -o "$WORKDIR/src.zip"
unzip -q "$WORKDIR/src.zip" -d "$WORKDIR/src"
SRC_DIR="$(find "$WORKDIR/src" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -f "$SRC_DIR/manifest.json" ] || die "manifest.json not found in the release archive"

VERSION="$(python3 -c "import json; print(json.load(open('$SRC_DIR/manifest.json'))['version'])")"
[ "v${VERSION}" = "$TAG" ] \
  || die "Version mismatch: manifest says ${VERSION}, release tag is ${TAG}. Fix the release first."

DIST_DIR="$(cd "$(dirname "$0")/.." && pwd)/dist"
ZIP_PATH="${DIST_DIR}/outlook-unread-badge-${TAG}.zip"
mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"

log "Building package v${VERSION} from release source"
(cd "$SRC_DIR" && zip -r -q "$ZIP_PATH" "${PACKAGE_CONTENTS[@]}" -x '*.DS_Store')
log "Package: $ZIP_PATH ($(du -h "$ZIP_PATH" | cut -f1 | tr -d ' '))"

if $DRY_RUN; then
  log "Dry run - skipping uploads. Package contents:"
  unzip -l "$ZIP_PATH"
  exit 0
fi

command -v op >/dev/null || die "1Password CLI (op) not found"

# ----------------------------------------------------------------------------
# Chrome Web Store (API v2: upload package + publish; no listing/screenshots)
# https://developer.chrome.com/docs/webstore/using-api
# ----------------------------------------------------------------------------

if $DO_CHROME; then
  [ "$CWS_EXTENSION_ID" != "CHANGE_ME" ] || die "Set CWS_EXTENSION_ID first"
  [ "$CWS_PUBLISHER_ID" != "CHANGE_ME" ] || die "Set CWS_PUBLISHER_ID first"

  log "Chrome Web Store: reading credentials from 1Password"
  CWS_CLIENT_ID="$(op read "$OP_CWS_CLIENT_ID")"
  CWS_CLIENT_SECRET="$(op read "$OP_CWS_CLIENT_SECRET")"
  CWS_REFRESH_TOKEN="$(op read "$OP_CWS_REFRESH_TOKEN")"

  log "Chrome Web Store: obtaining access token"
  CWS_TOKEN="$(curl -sf https://oauth2.googleapis.com/token \
    -d "client_id=${CWS_CLIENT_ID}" \
    -d "client_secret=${CWS_CLIENT_SECRET}" \
    -d "refresh_token=${CWS_REFRESH_TOKEN}" \
    -d "grant_type=refresh_token" | json_get access_token)"
  [ -n "$CWS_TOKEN" ] || die "Chrome: failed to obtain access token"

  CWS_BASE="https://chromewebstore.googleapis.com/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}"

  log "Chrome Web Store: uploading package"
  UPLOAD_RESPONSE="$(curl -sf -X POST \
    -H "Authorization: Bearer ${CWS_TOKEN}" \
    -T "$ZIP_PATH" \
    "https://chromewebstore.googleapis.com/upload/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}:upload")"
  echo "$UPLOAD_RESPONSE"

  UPLOAD_STATE="$(echo "$UPLOAD_RESPONSE" | json_get uploadState)"
  while [ "$UPLOAD_STATE" = "UPLOAD_IN_PROGRESS" ]; do
    log "Chrome Web Store: upload in progress, waiting 10s..."
    sleep 10
    STATUS_RESPONSE="$(curl -sf -H "Authorization: Bearer ${CWS_TOKEN}" "${CWS_BASE}:fetchStatus")"
    UPLOAD_STATE="$(echo "$STATUS_RESPONSE" | json_get uploadState)"
  done
  [ "$UPLOAD_STATE" = "UPLOAD_SUCCESS" ] || [ "$UPLOAD_STATE" = "SUCCESS" ] \
    || die "Chrome: upload did not succeed (state: ${UPLOAD_STATE:-unknown})"

  log "Chrome Web Store: publishing (submits for review)"
  curl -sf -X POST -H "Authorization: Bearer ${CWS_TOKEN}" "${CWS_BASE}:publish"
  echo
  log "Chrome Web Store: submitted"
fi

# ----------------------------------------------------------------------------
# Microsoft Edge Add-ons (API v1.1: upload draft package + publish)
# https://learn.microsoft.com/microsoft-edge/extensions/update/api/addons-api-reference
# ----------------------------------------------------------------------------

if $DO_EDGE; then
  [ "$EDGE_PRODUCT_ID" != "CHANGE_ME" ] || die "Set EDGE_PRODUCT_ID first"

  log "Edge Add-ons: reading credentials from 1Password"
  EDGE_CLIENT_ID="$(op read "$OP_EDGE_CLIENT_ID")"
  EDGE_API_KEY="$(op read "$OP_EDGE_API_KEY")"

  EDGE_BASE="https://api.addons.microsoftedge.microsoft.com/v1.1/products/${EDGE_PRODUCT_ID}"
  EDGE_AUTH=(-H "Authorization: ApiKey ${EDGE_API_KEY}" -H "X-ClientID: ${EDGE_CLIENT_ID}")

  log "Edge Add-ons: uploading package"
  UPLOAD_HEADERS="$(curl -sf -D - -o /dev/null -X POST \
    "${EDGE_AUTH[@]}" \
    -H "Content-Type: application/zip" \
    --data-binary @"$ZIP_PATH" \
    "${EDGE_BASE}/submissions/draft/package")"
  OPERATION_ID="$(echo "$UPLOAD_HEADERS" | awk -F'/' 'tolower($0) ~ /^location:/ {gsub(/[[:space:]]/,"",$NF); print $NF}')"
  [ -n "$OPERATION_ID" ] || die "Edge: no operation ID returned for upload"

  log "Edge Add-ons: waiting for package validation (operation ${OPERATION_ID})"
  while :; do
    OP_STATUS="$(curl -sf "${EDGE_AUTH[@]}" \
      "${EDGE_BASE}/submissions/draft/package/operations/${OPERATION_ID}" | json_get status)"
    case "$OP_STATUS" in
      Succeeded) break ;;
      InProgress) sleep 10 ;;
      *) die "Edge: package validation failed (status: ${OP_STATUS:-unknown})" ;;
    esac
  done

  log "Edge Add-ons: publishing (submits for review)"
  PUBLISH_HEADERS="$(curl -sf -D - -o /dev/null -X POST \
    "${EDGE_AUTH[@]}" \
    "${EDGE_BASE}/submissions")"
  PUBLISH_OP_ID="$(echo "$PUBLISH_HEADERS" | awk -F'/' 'tolower($0) ~ /^location:/ {gsub(/[[:space:]]/,"",$NF); print $NF}')"

  if [ -n "$PUBLISH_OP_ID" ]; then
    while :; do
      PUB_STATUS="$(curl -sf "${EDGE_AUTH[@]}" \
        "${EDGE_BASE}/submissions/operations/${PUBLISH_OP_ID}" | json_get status)"
      case "$PUB_STATUS" in
        Succeeded) break ;;
        InProgress) sleep 10 ;;
        *) die "Edge: publish submission failed (status: ${PUB_STATUS:-unknown})" ;;
      esac
    done
  fi
  log "Edge Add-ons: submitted"
fi

log "Done. Release ${TAG} submitted; both stores will now run their review."
