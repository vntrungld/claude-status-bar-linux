# Multi-desktop support: GNOME Shell frontend on a shared JS core

Date: 2026-08-06
Status: approved, pending implementation plan

## Goal

Let GNOME Shell users run the Claude status bar with the same features KDE users
get, and restructure the project so the two frontends share every piece of logic
and every asset that can be shared. A third desktop should later cost only a
frontend, not a reimplementation.

The driver is other users, not the maintainer: development happens on KDE, and
GNOME is verified in a nested shell.

## Non-goals

- Publishing to extensions.gnome.org. Distribution is `install.sh` only.
- Plasma 5, or GNOME Shell 44 and older (pre-ESM).
- Any other desktop (Xfce, sway/waybar). The shared core exists to make one
  cheap later; none is built here.
- Behavioural change to the hook or usage-fetch scripts. Both frontends must
  observe the same data as today.

## Decisions

| Decision | Choice | Ruled out |
|---|---|---|
| Parity | Full — animation, shimmer, elapsed timer, usage readout, popup, account switching | Static icon; minimal indicator |
| Repo | Rename to `claude-status-bar`, split into `platforms/kde` + `platforms/gnome` | Keep name; separate GNOME repo |
| Distribution | `install.sh` with desktop detection | extensions.gnome.org |
| Verification | Nested `gnome-shell --wayland` on the KDE host | Container; VM; shipping untested |
| Aggregation | Shared JS core; Python reduced to raw session I/O | Duplicating logic per platform; QML reading the directory itself |
| Assets | One sprite-sheet set for both frontends | Animated WebP on KDE, sheets on GNOME |

### Why aggregation moves to JS

KDE currently spawns `claude-status-aggregate.py` once a second and parses its
stdout. Porting that logic to GNOME would mean maintaining the same merge rules
in two languages.

Instead the logic becomes one `.mjs` module that both engines import, and the
platform-specific part shrinks to *reading a directory of JSON files* — which is
genuinely platform I/O, not logic. KDE gets the docs from a thin Python script
it already spawns; GNOME reads them with `Gio`.

Going further — having QML list the directory itself via `FolderListModel` plus
`XMLHttpRequest` on `file://`, deleting the Python aggregator outright — was
considered and rejected. It rewrites a working data path using QML's clumsiest
APIs for no user-visible gain. Because the seam is clean, that move remains
available later and would touch only the I/O adapter.

### Verified assumption

Qt 6 QML imports a standard `.mjs` ES module and correctly reads exported
constants, functions, and logic. Confirmed locally with `qml6` by asserting
shared values through the process exit code, with a deliberately broken import
as a negative control (exit 2, "Did not load any objects").

### Unverified assumption

GJS 1.88 is ESM-native, but whether its module loader accepts the `.mjs`
extension specifically is untested — `gjs` is not yet installed on the dev
machine. **This must be confirmed as the first implementation step, before any
shared code is written.** If GJS rejects `.mjs`, the fallback is for `install.sh`
to rename the files to `.js` when assembling the extension directory. Either way
no logic is duplicated; only the packaging step changes.

## Architecture

```
                    shared/*.mjs  (pure logic, no I/O)
                   /                              \
        QML import                                 GJS import
             |                                          |
   platforms/kde/package                     platforms/gnome
   - Plasma5Support.DataSource               - Gio.File / Gio.FileMonitor
     spawns sessions.py                      - Gio.Subprocess for usage
   - QML declarative widgets                 - St / Clutter widgets
   - KConfigXT setting                       - GSettings setting
```

The rule: **anything that transforms data is shared; anything that touches the
filesystem, builds a widget, or stores a preference is per-platform.**

### Shared modules

`shared/aggregate.mjs`
- `STALE_SECS = 900`
- `aggregate(docs, now) -> {state, tool, started_at, active_count, waiting_count, sessions}`
- Preserves current semantics exactly: non-idle docs older than `STALE_SECS` are
  dropped; state precedence is `waiting > tool > thinking > idle`; the reported
  tool is that of the most recently updated tool-state session; `started_at` is
  the minimum over active sessions, or `null`.

`shared/labels.mjs`
- `toolLabel(tool)` — `mcp__*` collapses to "Using MCP"; `AskUserQuestion` reads
  "Awaiting you"; the existing Edit/Bash/Read/Grep/WebFetch/Task mappings.
- `clawdAnim(state, tool)` — state and tool to animation name.
- `THINKING_WORDS` and `pickThinkingWord(current, rand)` — `rand` is injected so
  the function is deterministic under test.
- `fmt(seconds)` — `"1m 5s"` / `"42s"`.
- `displayName(account)` — alias, else the email local-part.

`shared/usage.mjs`
- `usagePct(window)`, `usagePctText(window)`, `usageDotColor(window)` — the
  existing green/yellow/red thresholds at 50 and 80.
- `resetText(window, nowSec)` and `updatedText(ts, nowSec)` — these return a
  message id and its substitution values rather than a finished string, so each
  platform applies its own i18n (`i18n()` on KDE, `gettext` on GNOME). Concretely
  `resetText` returns `null` when there is nothing to show, else one of
  `{id: "resets_in_dh", args: [days, hours]}`, `{id: "resets_in_hm", args: [hours, mins]}`,
  `{id: "resets_in_m", args: [mins]}`, or `{id: "resetting"}`. `updatedText`
  returns `null`, `{id: "updated_now"}`, `{id: "updated_m", args: [m]}`, or
  `{id: "updated_h", args: [h]}`. Each frontend owns the id-to-template map, so
  the English wording stays exactly what it is today.
- Scheduling constants: `POLL_INTERVAL_MS = 300000`, `RETRY_INTERVAL_MS = 10000`,
  `MAX_RETRIES = 18`, and the set of statuses that warrant a fast retry
  (`loading`, `error` — never `reauth` or `rate_limited`).

`shared/shimmer.mjs`
- `shimmerOpacity(index, head)` — the existing `0.4 + 0.6 · max(0, 1 - |i-head|/2.4)` curve.
- `shimmerDuration(n)` — `max(700, n · 130)` ms.

`shared/clawd/` — generated sprite sheets plus `frames.mjs`.

Time is always passed in as a parameter. No shared module reads the clock, which
keeps every function testable without mocking.

## Repository layout

```
claude-status-bar/
├── shared/                       # as above
├── scripts/
│   ├── statusbar_paths.py
│   ├── claude-status-hook.py
│   ├── claude-status-sessions.py  # NEW: replaces claude-status-aggregate.py
│   ├── usage-fetch.py
│   ├── token-slayer-usage-fetch.py
│   ├── settings_merge.py, apply_settings_{merge,unmerge}.py
│   └── build-clawd-sprites.py     # NEW: maintainer tool, Pillow
├── platforms/
│   ├── kde/package/               # moved verbatim from ./package
│   └── gnome/
│       ├── metadata.json
│       ├── extension.js
│       ├── prefs.js
│       ├── stylesheet.css
│       ├── schemas/org.gnome.shell.extensions.claude-status-bar.gschema.xml
│       └── lib/{indicator,clawd,sessions,usage}.js
├── tests/
│   ├── shared/                    # NEW: JS suite for shared/
│   ├── qml/                       # NEW: QML smoke test proving .mjs loads
│   └── test_{hook,usage_fetch,token_slayer_usage_fetch,paths,install_merge}.py
├── install.sh / uninstall.sh
└── README.md
```

`claude-status-aggregate.py` is removed. Its merge logic moves to
`shared/aggregate.mjs`; its file-reading becomes `claude-status-sessions.py`,
which prints the raw session documents as a JSON array and contains no logic.
`tests/test_aggregate.py` is removed only once its cases exist in the JS suite.

## KDE changes

The KDE widget must be behaviourally identical when this lands. Changes are:

1. `main.qml` spawns `claude-status-sessions.py` instead of the aggregator, then
   applies `Aggregate.aggregate(docs, Date.now()/1000)` in QML. Poll cadence,
   `disconnectSource` handling, and the usage timers are unchanged.
2. `CompactView.qml`, `FullView.qml`, `UsageBars.qml`, `UsageAccount.qml` drop
   their local helper functions and import the shared modules.
3. `CompactView.qml` switches the Clawd from `AnimatedImage` on WebP to
   `AnimatedSprite` on the shared sheets.
4. `package/metadata.json` version bumped `0.1.2` → `0.2.0`. GNOME's
   `metadata.json` uses an integer `version` field, so it carries `"version": 1`
   alongside `"version-name": "0.2.0"` (supported on Shell 45+). The
   `version-name` stays in lockstep with the plasmoid, so a reported version
   identifies one commit regardless of desktop.

Two existing behaviours are load-bearing and must survive:

- The elapsed counter samples at **250 ms**, not 1 s, and floors the
  *difference* rather than the difference of floors. A 1 s timer beats against
  the 1 s display quantum and makes a displayed second occasionally stall to
  ~2 s. Both frontends use this approach.
- The account-switch argument is currently hand-escaped for `/bin/sh` in
  `main.qml`. That stays as-is on KDE; GNOME avoids the problem entirely by
  passing an argv array with no shell.

## GNOME extension

Target GNOME Shell 45+ (ESM era), developed and verified against **50.4**.
UUID `claude-status-bar@vntrungld.github.io`.

- `extension.js` — an `Extension` subclass. `enable()` constructs the indicator
  and adds it to `Main.panel`; `disable()` destroys the indicator and **every**
  timer, file monitor, and in-flight subprocess cancellable. GNOME unloads and
  reloads extensions on screen lock, so incomplete teardown leaks on every lock.
- `lib/sessions.js` — reads the session directory with `Gio`, feeds
  `aggregate()`. Updates are driven by a `Gio.FileMonitor` on the directory
  (debounced ~100 ms), plus a 5 s timer that re-evaluates staleness expiry —
  a session can go stale with no file event to announce it.
- `lib/usage.js` — `Gio.Subprocess` (argv array, no shell) running the same
  Python fetchers, on the schedule from `shared/usage.mjs`: fetch at startup,
  every 5 minutes, bounded fast retry while the status warrants it, plus manual
  refresh and `switch <account>`.
- `lib/indicator.js` — a `PanelMenu.Button` holding the Clawd sprite, the
  shimmer label, the elapsed label, and the two usage dots with percentages.
  The popup carries the session list, the "Usage limits" header with its
  refresh/spinner swap, and per-account blocks with switch buttons. St has no
  progress bar, so usage bars are a styled `St.Widget` fill driven from
  `stylesheet.css`.
- `lib/clawd.js` — a `St.DrawingArea` painting one sub-rect of the sprite sheet
  via Cairo, advanced by a timer. Painting stops when the actor is not mapped,
  so a locked screen does not repaint.
- `prefs.js` + GSettings schema for `show-usage-on-panel`, mirroring KDE's
  `showUsageOnPanel`.

## Asset pipeline

`scripts/build-clawd-sprites.py` (Pillow) converts each of the seven animated
WebPs — 128×128, 12–14 frames — into a horizontal PNG sprite sheet plus a
`frames.mjs` (an ES module both engines import) recording frame count and playback interval per animation.

**The generated sheets are committed.** The script is a maintainer tool, re-run
only when the source art changes; installing requires no Pillow.

The source WebPs carry no per-frame duration metadata, so QML's `AnimatedImage`
has been falling back to its own default. The sheets make the frame rate
explicit and identical on both platforms. It starts at 12 fps and is matched by
eye against the current plasmoid during implementation.

Attribution for the derived sheets follows the existing `LICENSE.clawd-tank`
(MIT, Marcio Granzotto) and is carried into `shared/clawd/`.

## Install and uninstall

`install.sh` steps 1 (copy Python scripts, bake the `claude --version` UA) and 2
(merge hooks into `~/.claude/settings.json`) are shared and unchanged.

Step 3 branches on `$XDG_CURRENT_DESKTOP`, overridable with `--kde` / `--gnome`
— the override is needed to drive the nested-shell loop from a KDE session.
An undetected desktop is a hard error naming both flags, never a silent no-op.

Because both bundles must be self-contained, the installer *assembles* rather
than copies, and `shared/` lands at a fixed path inside each bundle:

- KDE: `build/kde/package/` = `platforms/kde/package/`, with `shared/` copied to
  `build/kde/package/contents/shared/`. QML then imports it as
  `import "../shared/aggregate.mjs" as Aggregate` from files in `contents/ui/`.
  Installed with `kpackagetool6 --install`, falling back to `--upgrade`.
- GNOME: `~/.local/share/gnome-shell/extensions/<uuid>/` = `platforms/gnome/*`,
  with `shared/` copied to `<uuid>/shared/`, then `glib-compile-schemas schemas/`.

Step 1 also deletes the now-obsolete `claude-status-aggregate.py` from the
installed `bin/` directory, so upgrading users are not left with a stale script
that nothing calls.

`uninstall.sh` mirrors the branch, and keeps the existing behaviour of stripping
only our hook entries and leaving the data directory in place.

## Testing

- **Shared core** — one JS suite under `tests/shared/`, carrying over every case
  from the current `test_aggregate.py` plus coverage of the label, usage, and
  shimmer helpers. **`gjs` is the canonical runner** — it is installed anyway for
  GNOME work, and it is the engine that actually ships the code. The suite avoids
  GJS-only APIs so it also runs under `node` when present, but `node` is a
  convenience, never the source of truth.
- **QML consumption** — a smoke test under `tests/qml/` that imports the shared
  modules and asserts values through the process exit code, using the harness
  already spiked. This is what catches a shared module drifting into syntax Qt's
  engine rejects.
- **Python** — the existing hook, usage-fetch, paths, and settings-merge suites,
  minus `test_aggregate.py`, plus coverage for `claude-status-sessions.py`.
- **Nested shell** — install `gnome-shell` and `gjs` on the host, then
  `./install.sh --gnome` and `dbus-run-session -- gnome-shell --nested
  --wayland`. Documented as the dev loop in CONTRIBUTING.
- **Manual checklist** against a live Claude Code session on both desktops:
  each state glyph, tool labels, elapsed timer, usage percentages, popup session
  list, refresh, and account switch.

## Documentation

The README gains a platform matrix; the KDE instructions stay as they are in
substance. The GNOME section lists its own requirements (GNOME Shell 45+, `gjs`,
Python 3) and mirrors the existing troubleshooting shape.

It will state plainly that the extension is **verified on GNOME Shell 50 and
declared for 45–50**. The earlier versions are API-compatible but untested, and
saying so is more useful to a stranger than an unqualified claim.

## Risks

| Risk | Mitigation |
|---|---|
| GJS rejects the `.mjs` extension | Confirm first, before writing shared code. Fallback is a rename during install; no logic duplicated. |
| Refactoring the working KDE widget regresses it | Shared modules land with tests and the QML smoke test before the QML is cut over; the manual checklist runs on KDE too. |
| Sprite animation or the per-character shimmer fights St/Clutter | These are the two pieces with no toolkit equivalent and the least functional payoff. If the nested-shell pass shows them fighting, fall back to a static frame per state; nothing else in the extension depends on them. |
| Extension leaks on lock/unlock | `disable()` teardown is explicit in review, and the nested-shell pass exercises a lock cycle. |
| GNOME users hit bugs the maintainer cannot reproduce | The nested shell is a real Shell, so most breakage surfaces there. The README is honest about which version was verified. |
