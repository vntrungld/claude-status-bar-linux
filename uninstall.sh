#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/claude-status-bar"
BIN="$DATA/bin"
SETTINGS="$HOME/.claude/settings.json"

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
      echo "Could not detect your desktop. Re-run with --kde or --gnome." >&2
      exit 2 ;;
  esac
fi

if [ "$DESKTOP" = kde ]; then
  echo "Removing plasmoid"
  kpackagetool6 --type Plasma/Applet --remove org.kde.claudestatusbar || true
else
  UUID="claude-status-bar@vntrungld.github.io"
  EXTDIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
  echo "Removing GNOME extension"
  gnome-extensions disable "$UUID" 2>/dev/null || true
  rm -rf "$EXTDIR"
fi

if [ -f "$SETTINGS" ]; then
  cp "$SETTINGS" "$SETTINGS.bak.$(date +%s)"
  python3 "$HERE/scripts/apply_settings_unmerge.py" "$SETTINGS" "$BIN"
fi
echo "Left data dir in place: $DATA (remove manually if desired)."
