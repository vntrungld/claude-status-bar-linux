# Claude Status Bar

Shows Claude Code's live activity in your panel, with the account's 5-hour
and weekly usage percentages on the right — a KDE Plasma 6 plasmoid and a
GNOME Shell extension, built on the same Python hooks and JavaScript core.

- **Panel:** state glyph, tool label ("Editing"…), an elapsed timer, and
  `5h N% · 7d N%`.
- **Popup:** per-session list plus 5-hour / weekly usage bars, each with a
  reset-time countdown and a manual refresh button.
- **Configure** (KDE: right-click → Configure; GNOME: Extensions app →
  Settings): hide the panel usage percentages.

## Supported desktops

| Desktop | Frontend | Status |
|---|---|---|
| KDE Plasma 6 | Plasmoid (`platforms/kde`) | Developed and tested on Plasma 6 |
| GNOME Shell 45+ | Shell extension (`platforms/gnome`) | Verified on GNOME Shell 49; declared for 45–50, earlier versions untested |

Both frontends share the same Python hooks and the same JavaScript core
(`shared/`), so activity, usage, and account switching behave identically.

## Screenshots

Panel widget, idle — state glyph and `5h % · 7d %`:

![Idle panel widget](docs/screenshots/idle.png)

Panel widget, working — tool label and elapsed timer:

![Working panel widget](docs/screenshots/working.png)

Popup — per-session list plus 5-hour / weekly usage bars with reset countdowns:

![Usage popup](docs/screenshots/panel.png)

---

## Requirements

Make sure all of these are present **before** running the installer. The
first two rows are desktop-specific — you only need the row matching yours.

| Requirement | Why | Check |
|---|---|---|
| **KDE:** Plasma 6 (Qt6 / KF6) | The widget targets the Plasma 6 applet API. Plasma 5 is not supported. | `plasmashell --version` |
| **KDE:** `kpackagetool6` | Installs/upgrades the plasmoid package. Ships with Plasma 6. | `which kpackagetool6` |
| **GNOME:** GNOME Shell 45+ | The extension targets the ESM-era extension API. Shell 44 and older is not supported. | `gnome-shell --version` |
| **GNOME:** `gjs` | Runs the extension and its preferences window. Ships with GNOME Shell. | `gjs --version` |
| **Python 3** | Runs the hook, session-reading, and usage-fetch scripts (both desktops). | `python3 --version` |
| **Claude Code CLI, logged in** | Usage is read from the local OAuth token at `~/.claude/.credentials.json`. | `claude --version` |

The installer also reads `~/.claude/settings.json` (creating it if missing) to
register hooks. No root/sudo is needed — everything installs into your home
directory.

---

## Quick install

From the repository root:

```bash
./install.sh            # auto-detects KDE or GNOME from XDG_CURRENT_DESKTOP
./install.sh --kde      # or force a target
./install.sh --gnome
```

**KDE:** add the widget to a panel — right-click your panel → *Add Widgets…* →
search for **Claude Status Bar** → click to add. If it does not show up in the
list immediately, restart Plasma Shell:

```bash
kquitapp6 plasmashell && kstart plasmashell
```

**GNOME:** enable the extension:

```bash
gnome-extensions enable claude-status-bar@vntrungld.github.io
```

On GNOME Shell 45+/Wayland this takes effect immediately, no logout needed —
tested by installing and enabling from scratch. If `gnome-extensions info
claude-status-bar@vntrungld.github.io` reports `State: INACTIVE` right after
enabling, GNOME disables extensions while the screen is locked (by design,
see Troubleshooting); it will pick back up once you unlock.

That's it. Open a Claude Code session in a terminal and the panel will start
updating.

---

## What the installer does

`install.sh` performs three steps, all scoped to your user account. The first
two are identical on both desktops; the third branches on `--kde`/`--gnome`
or auto-detection.

### 1. Copies the Python scripts

Into `${XDG_DATA_HOME:-$HOME/.local/share}/claude-status-bar/bin/`:

- `statusbar_paths.py` — shared path helpers
- `claude-status-hook.py` — turns each Claude Code hook event into a
  per-session status file
- `claude-status-sessions.py` — prints the raw session documents as a JSON
  array; both frontends merge them with the same rules via
  `shared/aggregate.mjs` (this replaced `claude-status-aggregate.py`, which
  used to do that merge itself, in Python, for KDE only)
- `usage-fetch.py` — fetches single-account subscription usage and caches it
- `token-slayer-usage-fetch.py` — the script both frontends actually call;
  wraps `usage-fetch.py` and adds multi-account support when `token-slayer`
  is configured

It also **bakes your installed Claude version** into `usage-fetch.py`'s
User-Agent header (read from `claude --version`), so the usage endpoint sees a
matching client string.

### 2. Registers Claude Code hooks

It merges hook entries into `~/.claude/settings.json` (backing the file up to
`settings.json.bak.<timestamp>` first). The merge is **idempotent and additive**
— it only adds our entries and never touches existing hooks. Hooks are added for
these events:

`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
`PostToolUseFailure`, `Notification`, `Stop`, `SessionEnd`.

Each hook simply runs `python3 <bin>/claude-status-hook.py <EventName>`, which
writes a small JSON file describing the session's current state. Hooks always
exit 0 and can never fail your Claude Code session.

### 3. Assembles and installs the frontend

The installer **assembles** a self-contained bundle rather than just copying
files, because `shared/` (the JavaScript core both frontends consume) is
copied into each bundle rather than referenced from the repo:

- **KDE:** `platforms/kde/package/` plus `shared/` (as
  `contents/shared/`) are assembled into `build/kde/package/`, then installed
  via `kpackagetool6` as the `org.kde.claudestatusbar` applet (falling back to
  `--upgrade` if it's already installed).
- **GNOME:** `platforms/gnome/*` plus `shared/` are assembled directly into
  `~/.local/share/gnome-shell/extensions/claude-status-bar@vntrungld.github.io/`,
  then `glib-compile-schemas` compiles its GSettings schema.

---

## Verifying the install

1. **Scripts present:**
   ```bash
   ls ~/.local/share/claude-status-bar/bin/
   ```
   You should see five `.py` files.

2. **Hooks registered:**
   ```bash
   grep claude-status-hook ~/.claude/settings.json
   ```

3. **Frontend registered:**
   ```bash
   kpackagetool6 --type Plasma/Applet --list | grep claudestatusbar   # KDE
   gnome-extensions info claude-status-bar@vntrungld.github.io        # GNOME
   ```

4. **End to end:** start a Claude Code session in any terminal. Within a couple
   of seconds the panel glyph/label should change, and the popup should list the
   session. Usage percentages appear once the first fetch succeeds (usage is
   polled at most every 5 minutes).

---

## Data & files

Everything lives under `${XDG_DATA_HOME:-$HOME/.local/share}/claude-status-bar/`:

```
claude-status-bar/
├── bin/                 # installed Python scripts
├── sessions/            # one JSON file per live Claude Code session
└── usage-cache.json     # last known 5h / 7d usage
```

### Usage data

Usage comes from Claude's `/api/oauth/usage` endpoint (the same source as the
`/usage` command), polled at most every 5 minutes. It is undocumented and
rate-limited; if a fetch fails, the last known values are shown dimmed. A manual
refresh button in the popup forces an immediate re-fetch.

---

## Updating

Pull the latest changes and re-run the installer — it re-assembles the
frontend bundle and re-syncs the scripts and hooks in place:

```bash
git pull
./install.sh
```

**KDE:** if you changed only the QML (widget UI), a Plasma Shell restart is
needed to clear its applet cache:

```bash
kquitapp6 plasmashell && kstart plasmashell
```

**GNOME:** the running extension keeps its old code in memory until reloaded;
a disable/enable cycle picks up the new files:

```bash
gnome-extensions disable claude-status-bar@vntrungld.github.io
gnome-extensions enable claude-status-bar@vntrungld.github.io
```

---

## Uninstall

```bash
./uninstall.sh            # auto-detects, same as install.sh
./uninstall.sh --kde
./uninstall.sh --gnome
```

This removes the frontend (plasmoid or GNOME extension) and strips **only**
our hook entries from `~/.claude/settings.json` (again backing it up first).
It intentionally leaves the data directory
(`~/.local/share/claude-status-bar/`) in place — remove it manually if you
want a clean slate:

```bash
rm -rf ~/.local/share/claude-status-bar
```

---

## Troubleshooting

**Widget doesn't appear in "Add Widgets" (KDE).**
Restart Plasma Shell: `kquitapp6 plasmashell && kstart plasmashell`. Confirm it
is registered with `kpackagetool6 --type Plasma/Applet --list | grep
claudestatusbar`.

**Extension does not appear or won't stay enabled (GNOME).**
Check it is installed and enabled:
`gnome-extensions info claude-status-bar@vntrungld.github.io`. If `State`
reads `INACTIVE` right after enabling, check whether the screen is currently
locked — GNOME disables `sessionModes: ['user']` extensions like this one
while locked, by design, and re-activates them on unlock; this is not
specific to this extension. Check for load errors with
`journalctl --user -b | grep claude-status-bar`.

**Panel never updates during a Claude session.**
Check that the hooks landed in `~/.claude/settings.json` (see *Verifying*
above), and that session files appear while a session runs:
`ls ~/.local/share/claude-status-bar/sessions/`. If the directory stays empty,
the hooks aren't firing — re-run `./install.sh`.

**Usage shows dashes / stays dimmed.**
Make sure Claude Code is logged in (`~/.claude/.credentials.json` exists). Run
the fetcher directly to see the error:
```bash
python3 ~/.local/share/claude-status-bar/bin/token-slayer-usage-fetch.py
```
A `reauth` status means the OAuth token expired — re-login with Claude Code. A
`rate_limited` status means you hit the endpoint's rate limit; it will recover
on the next poll.

**`kpackagetool6: command not found` (KDE).**
You're likely on Plasma 5 or KDE isn't fully installed. The plasmoid requires
Plasma 6.

---

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository layout, the
shared-core rule, and how to develop the GNOME extension from a KDE session
without logging out. Quick reference for the three test suites:

```bash
python3 -m pytest            # Python: hooks, sessions, usage-fetch, paths, settings-merge
./tests/run-shared-tests.sh  # shared/*.mjs: aggregate, labels, usage, shimmer
./tests/run-qml-tests.sh     # proves the shared modules load inside Qt/QML
```

---

## Credits

The animated Clawd crab artwork (source WebPs in `assets/clawd-src/`) is
derived from [clawd-tank](https://github.com/marciogranzotto/clawd-tank) by
Marcio Granzotto, used under the MIT License (see
`assets/clawd-src/LICENSE.clawd-tank`). The SVG animations were rendered to
animated WebP, then converted to the PNG sprite sheets shipped at
`shared/clawd/` (same licence, carried alongside as
`shared/clawd/LICENSE.clawd-tank`) for use by both frontends.
