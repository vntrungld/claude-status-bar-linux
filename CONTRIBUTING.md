# Contributing

## Layout

- `shared/` — pure JavaScript consumed by **both** frontends. No clock reads,
  no filesystem access, no platform globals. Time is always a parameter.
- `platforms/kde/` — the Plasma 6 plasmoid (QML).
- `platforms/gnome/` — the GNOME Shell extension (GJS).
- `scripts/` — Python hooks and fetchers, stdlib only.
- `assets/clawd-src/` — source WebP art; sprite sheets are generated from it.

**The rule:** anything that transforms data goes in `shared/`. Anything that
touches the filesystem, builds a widget, or stores a preference is
per-platform. If you find yourself writing the same logic twice, it belongs in
`shared/`.

## Tests

```bash
python3 -m pytest            # Python hooks and fetchers
./tests/run-shared-tests.sh  # shared JS core (gjs is authoritative)
./tests/run-qml-tests.sh     # proves the shared modules load in Qt
```

`python3 -m pytest` needs the `pytest` package; `./tests/run-qml-tests.sh`
needs Qt6's `qml6` binary (package `qt6-declarative` on most distros) — both
are KDE/Python-dev tooling that a GNOME-only machine won't have installed by
default. `./tests/run-shared-tests.sh` only needs `gjs`, which the GNOME
requirements below already cover.

## Developing the GNOME extension without GNOME

The extension is developed on KDE using a nested shell — no logout, no VM:

```bash
sudo pacman -S --needed gnome-shell gjs   # or your distro's equivalent
./install.sh --gnome
dbus-run-session -- gnome-shell --nested --wayland
```

Then, in the nested session:

```bash
gnome-extensions enable claude-status-bar@vntrungld.github.io
journalctl --user -f | grep claude-status-bar   # watch for errors
```

Reloading after a change means restarting the nested shell.

**If `gnome-shell --nested --wayland` errors with "Unknown option
--nested"**, your `gnome-shell`/mutter version has dropped that flag (seen on
GNOME Shell 49). A windowed nested fallback wasn't found working in that
case either — `gnome-shell --wayland` from inside an existing session hit a
logind session conflict (`Failed to take control of the session:
GDBus.Error:System.Error.EBUSY`) unrelated to any extension code. The
fallback used to develop and verify this extension instead was headless:

```bash
dbus-run-session -- gnome-shell --headless --virtual-monitor 1024x768
```

in a second terminal, `gnome-extensions enable` as above. There's no visible
window, but the extension really runs — `gnome-extensions info` reports
`State: ACTIVE`, `journalctl --user` shows real errors if any occur, and
`gnome-extensions prefs` still opens the preferences window. Session data,
usage fetching, animation frame timing, and teardown on disable/enable all
exercise the same code path as a windowed session; only visually inspecting
the panel requires an actual GNOME desktop.

Run `dbus-run-session` under `env GSETTINGS_BACKEND=memory` when iterating
this way on a machine where GNOME is your **real, currently logged-in**
desktop (as opposed to a spare KDE box): GSettings persists to the same
on-disk dconf database regardless of which D-Bus session wrote it, so an
`enabled-extensions` change made inside a throwaway headless test session
would otherwise leak into your real desktop's settings.

## Regenerating the Clawd sprites

Only needed if the source art changes. Requires Pillow:

```bash
python3 scripts/build-clawd-sprites.py
```

`INTERVAL_MS` in that script sets the frame rate for **both** frontends.
