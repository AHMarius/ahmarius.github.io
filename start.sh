#!/usr/bin/env bash
#
# start.sh — build / install / launch the AH Marius Content Studio.
#
# The app's version is derived AUTOMATICALLY from the git state of this repo
# (last commit touching admin-app + a "-dirty" marker when local changes exist),
# so you never bump it by hand. The version is baked into the binary at build
# time via build.rs (see admin-app/src-tauri/.build-version).
#
# Behavior:
#   1. Verifies the installed binary's version matches the current git state.
#   2. If it does  -> just launches the installed app.
#   3. If it doesn't -> installs npm deps, builds the frontend, builds the
#      release binary, installs it next to this script, then launches it.
#
# Usage: ./start.sh [app-args...]
#        ./start.sh --version      # print the expected version and exit
#        ./start.sh --force        # always rebuild, even if version matches

set -euo pipefail

# ---- paths -------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$SCRIPT_DIR")"
APP_DIR="$REPO_ROOT/admin-app"
SRC_T="$APP_DIR/src-tauri"
BIN_NAME="ahmarius-content-studio"
TARGET_BIN="$SRC_T/target/release/$BIN_NAME"
INSTALL_BIN="${AHMARIUS_BIN:-"$REPO_ROOT/bin/$BIN_NAME"}"
VERSION_MARKER="$SRC_T/.build-version"

# ---- tooling checks ----------------------------------------------------
for tool in git node npm cargo rustc; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: '$tool' is required but not installed." >&2
    echo "  On Arch: sudo pacman -S --needed git nodejs npm rust" >&2
    exit 1
  fi
done

# ---- version computation (must match build.rs logic) --------------------
compute_version() {
  local base sha dirty=""
  base="$(sed -n 's/^version *= *"\([^"]*\)"/\1/p' "$SRC_T/Cargo.toml" | head -1)"
  base="${base:-0.0.0}"

  # Last commit that touched admin-app (content-only commits don't bump the app).
  sha="$(git -C "$REPO_ROOT" log -1 --format=%h -- admin-app 2>/dev/null || true)"
  if [[ -z "$sha" ]]; then
    sha="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || true)"
  fi
  sha="${sha:-dev}"

  # Locally modified files under admin-app make it "-dirty".
  if git -C "$REPO_ROOT" status --porcelain -- admin-app 2>/dev/null | grep -q .; then
    dirty="-dirty"
  fi

  printf '%s+%s%s' "$base" "$sha" "$dirty"
}

expected_version="$(compute_version)"

if [[ "${1:-}" == "--version" || "${1:-}" == "-V" ]]; then
  echo "$expected_version"
  exit 0
fi

echo "  expected app version: $expected_version"

mk_bin() { mkdir -p "$(dirname "$1")"; }
installed_version() {
  if [[ -x "$1" ]]; then
    "$1" --version 2>/dev/null || true
  fi
}

install_binary() {
  echo "  installing binary → $INSTALL_BIN"
  mk_bin "$INSTALL_BIN"
  cp "$TARGET_BIN" "$INSTALL_BIN"
  chmod +x "$INSTALL_BIN"
}

launch() {
  echo "  launching $1"
  exec "$1" "${@:2}"
}

# ---- main ---------------------------------------------------------------
if [[ "${1:-}" == "--force" ]]; then
  force_rebuild=1
  shift
else
  force_rebuild=0
fi

current_version="$(installed_version "$INSTALL_BIN")"

if [[ $force_rebuild -eq 0 && "$current_version" == "$expected_version" ]]; then
  echo "  version is current — launching installed app"
  launch "$INSTALL_BIN" "$@"
fi

echo "  version changed (was: '${current_version:-none}') — installing & building"

# 1. frontend deps (idempotent: fast no-op when already up to date).
echo "  installing npm dependencies…"
(cd "$APP_DIR" && npm install --no-audit --no-fund)

# 2. production build (tauri CLI enables the custom-protocol feature and embeds
#    the frontend into the binary; plain `cargo build` produces a DEV build that
#    tries to load vite's devUrl http://localhost:1420 instead of the assets).
echo "  building frontend…"
(cd "$APP_DIR" && npm run build)

# 3. stamp the expected version so build.rs bakes it into the binary.
printf '%s' "$expected_version" > "$VERSION_MARKER"

# 4. release build.
echo "  building release binary…"
(cd "$APP_DIR" && npx tauri build --no-bundle)

install_binary

launch "$INSTALL_BIN" "$@"