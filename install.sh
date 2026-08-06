#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/claude-status-bar"
BIN="$DATA/bin"
SETTINGS="$HOME/.claude/settings.json"

# --- desktop selection -------------------------------------------------------
DESKTOP=""
case "${1:-}" in
  --kde)   DESKTOP=kde ;;
  --gnome) DESKTOP=gnome ;;
  "")      : ;;
  *) echo "usage: $0 [--kde|--gnome]" >&2; exit 2 ;;
esac

if [ -z "$DESKTOP" ]; then
  case "${XDG_CURRENT_DESKTOP:-}" in
    *KDE*)   DESKTOP=kde ;;
    *GNOME*) DESKTOP=gnome ;;
    *)
      echo "Could not detect your desktop from XDG_CURRENT_DESKTOP='${XDG_CURRENT_DESKTOP:-}'." >&2
      echo "Re-run with an explicit flag: $0 --kde   or   $0 --gnome" >&2
      exit 2 ;;
  esac
fi
echo "Target desktop: $DESKTOP"

# --- 1. shared python scripts ------------------------------------------------
echo "Installing scripts to $BIN"
mkdir -p "$BIN"
cp "$HERE"/scripts/statusbar_paths.py "$HERE"/scripts/claude-status-hook.py \
   "$HERE"/scripts/claude-status-sessions.py "$HERE"/scripts/usage-fetch.py \
   "$HERE"/scripts/token-slayer-usage-fetch.py "$BIN/"
chmod +x "$BIN"/*.py

# The aggregator moved into shared/aggregate.mjs; drop the stale copy so
# upgrading users are not left with a script nothing calls.
rm -f "$BIN/claude-status-aggregate.py"

# Bake the current claude version into the UA header.
VER="$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
[ -n "$VER" ] && sed -i "s#claude-code/[0-9.]*#claude-code/$VER#" "$BIN/usage-fetch.py"

# --- 2. claude code hooks ----------------------------------------------------
echo "Merging hooks into $SETTINGS (backup first)"
if [ -f "$SETTINGS" ]; then cp "$SETTINGS" "$SETTINGS.bak.$(date +%s)"; fi
python3 "$HERE/scripts/apply_settings_merge.py" "$SETTINGS" "$BIN"

# --- 3. frontend -------------------------------------------------------------
if [ "$DESKTOP" = kde ]; then
  echo "Assembling plasmoid bundle"
  BUILD="$HERE/build/kde/package"
  rm -rf "$HERE/build/kde"
  mkdir -p "$BUILD"
  cp -r "$HERE/platforms/kde/package/." "$BUILD/"
  # Plasmoid packages must be self-contained, so the shared core is copied in
  # rather than referenced from the repo.
  cp -r "$HERE/shared" "$BUILD/contents/shared"

  echo "Installing plasmoid"
  kpackagetool6 --type Plasma/Applet --install "$BUILD" 2>/dev/null \
    || kpackagetool6 --type Plasma/Applet --upgrade "$BUILD"

  echo "Done. Add the 'Claude Status Bar' widget to a panel."
  echo "If it does not appear, run: kquitapp6 plasmashell && kstart plasmashell"
else
  echo "GNOME frontend is not installed by this version yet."
  exit 1
fi
