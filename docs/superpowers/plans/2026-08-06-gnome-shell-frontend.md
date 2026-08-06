# GNOME Shell Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GNOME Shell extension with the same features as the KDE plasmoid, consuming the `shared/` ES-module core rather than reimplementing any of its logic.

**Architecture:** A `PanelMenu.Button` in the top bar renders the Clawd sprite, a shimmering tool label, an elapsed timer, and the usage readout; its popup carries the session list, usage bars, and per-account switch buttons. Session data is read directly with `Gio` and merged by `shared/aggregate.mjs` — no subprocess in the hot path. The Python usage fetchers are spawned every five minutes via `Gio.Subprocess`.

**Tech Stack:** GJS 1.88 (ESM), GNOME Shell 45+ API, St/Clutter, GSettings, `Gio.Subprocess`, the `shared/*.mjs` core.

**Spec:** `docs/superpowers/specs/2026-08-06-multi-desktop-support-design.md`

**Prerequisite:** `docs/superpowers/plans/2026-08-06-shared-core-and-kde-cutover.md` must be complete, with the KDE widget verified working on the shared core. This plan consumes `shared/aggregate.mjs`, `shared/labels.mjs`, `shared/usage.mjs`, `shared/shimmer.mjs`, and `shared/clawd/`.

## Global Constraints

- **UUID:** `claude-status-bar@vntrungld.github.io` — used verbatim in `metadata.json`, the install path, and the GSettings schema path.
- **Target:** GNOME Shell 45+ (ESM era), developed and verified against **50.4**. `shell-version` in `metadata.json` is `["45", "46", "47", "48", "49", "50"]`.
- **Versioning:** `"version": 1` (integer, required by the format) alongside `"version-name": "0.2.0"`, kept in lockstep with the plasmoid.
- **No logic in this plan.** Anything that transforms data belongs in `shared/`. If a task seems to need new logic, add it to the shared core with tests instead, and use it from both frontends.
- **`disable()` must fully tear down**: every `GLib` source removed, every `Gio.FileMonitor` cancelled, every in-flight subprocess cancelled, every actor destroyed. GNOME unloads extensions on screen lock, so a leak here compounds on every lock cycle.
- **Never spawn through a shell.** `Gio.Subprocess` takes an argv array, so account names need no escaping.
- Nothing in `platforms/gnome/` may import from `platforms/kde/`.
- The dev loop for every task: `./install.sh --gnome`, then `dbus-run-session -- gnome-shell --nested --wayland`.

---

### Task 1: Extension skeleton that loads in a nested shell

Get an empty-but-real extension loading and appearing in the top bar, plus the install branch that puts it there. Everything after this is filling it in.

**Files:**
- Create: `platforms/gnome/metadata.json`
- Create: `platforms/gnome/extension.js`
- Create: `platforms/gnome/stylesheet.css`
- Create: `platforms/gnome/schemas/org.gnome.shell.extensions.claude-status-bar.gschema.xml`
- Modify: `install.sh`, `uninstall.sh`

**Interfaces:**
- Consumes: nothing from `shared/` yet
- Produces: an installed, enableable extension at `~/.local/share/gnome-shell/extensions/claude-status-bar@vntrungld.github.io/`, with `shared/` copied to `<uuid>/shared/`; a `ClaudeStatusBarExtension` class exposing `enable()`/`disable()`.

- [ ] **Step 1: Write the metadata**

Create `platforms/gnome/metadata.json`:

```json
{
    "uuid": "claude-status-bar@vntrungld.github.io",
    "name": "Claude Status Bar",
    "description": "Live Claude Code activity and usage in the top bar",
    "shell-version": ["45", "46", "47", "48", "49", "50"],
    "url": "https://github.com/vntrungld/claude-status-bar",
    "settings-schema": "org.gnome.shell.extensions.claude-status-bar",
    "version": 1,
    "version-name": "0.2.0"
}
```

- [ ] **Step 2: Write the GSettings schema**

Create `platforms/gnome/schemas/org.gnome.shell.extensions.claude-status-bar.gschema.xml`, mirroring the plasmoid's single `showUsageOnPanel` option:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<schemalist>
  <schema id="org.gnome.shell.extensions.claude-status-bar"
          path="/org/gnome/shell/extensions/claude-status-bar/">
    <key name="show-usage-on-panel" type="b">
      <default>true</default>
      <summary>Show usage percentages in the top bar</summary>
      <description>
        Show the 5-hour and weekly usage percentages next to the status glyph.
        The popup always shows usage regardless of this setting.
      </description>
    </key>
  </schema>
</schemalist>
```

- [ ] **Step 3: Write a minimal extension**

Create `platforms/gnome/extension.js`:

```js
import GObject from 'gi://GObject'
import St from 'gi://St'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Claude Status Bar')
        this.add_child(new St.Label({
            text: 'Claude',
            y_align: 2, // Clutter.ActorAlign.CENTER
        }))
    }
})

export default class ClaudeStatusBarExtension extends Extension {
    enable() {
        this._indicator = new Indicator()
        Main.panel.addToStatusArea(this.uuid, this._indicator)
    }

    disable() {
        // GNOME unloads extensions on screen lock, so teardown must be total.
        this._indicator?.destroy()
        this._indicator = null
    }
}
```

- [ ] **Step 4: Write an empty stylesheet**

Create `platforms/gnome/stylesheet.css`:

```css
/* Styles for the Claude Status Bar indicator. Class names are prefixed
   `claude-` to avoid colliding with the shell's own theme. */
.claude-panel-box {
    spacing: 4px;
}
```

- [ ] **Step 5: Replace the GNOME branch in install.sh**

In `install.sh`, replace the `else` branch of the frontend section:

```bash
else
  UUID="claude-status-bar@vntrungld.github.io"
  EXTDIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
  echo "Installing GNOME extension to $EXTDIR"
  rm -rf "$EXTDIR"
  mkdir -p "$EXTDIR"
  cp -r "$HERE/platforms/gnome/." "$EXTDIR/"
  # Extensions must be self-contained, so the shared core is copied in.
  cp -r "$HERE/shared" "$EXTDIR/shared"
  glib-compile-schemas "$EXTDIR/schemas"

  echo "Done. Enable the extension with:"
  echo "  gnome-extensions enable $UUID"
  echo "Then log out and back in (or use a nested shell for development)."
fi
```

And the matching branch in `uninstall.sh`:

```bash
else
  UUID="claude-status-bar@vntrungld.github.io"
  EXTDIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
  echo "Removing GNOME extension"
  gnome-extensions disable "$UUID" 2>/dev/null || true
  rm -rf "$EXTDIR"
fi
```

- [ ] **Step 6: Install and verify the extension loads**

```bash
bash -n install.sh && bash -n uninstall.sh && echo "syntax OK"
./install.sh --gnome
ls ~/.local/share/gnome-shell/extensions/claude-status-bar@vntrungld.github.io/
ls ~/.local/share/gnome-shell/extensions/claude-status-bar@vntrungld.github.io/shared/
```

Expected: `extension.js`, `metadata.json`, `stylesheet.css`, `schemas/` (with a compiled `gschemas.compiled`), and `shared/` containing the four `.mjs` files plus `clawd/`.

- [ ] **Step 7: Verify it runs in a nested shell**

```bash
dbus-run-session -- gnome-shell --nested --wayland
```

In the nested shell's window, open a terminal within that session or use a second terminal:

```bash
gnome-extensions enable claude-status-bar@vntrungld.github.io
```

Expected: the word "Claude" appears in the nested shell's top bar. If it does not, check for errors:

```bash
journalctl --user -b -n 100 --no-pager | grep -i "claude-status-bar"
```

- [ ] **Step 8: Commit**

```bash
git add platforms/gnome/ install.sh uninstall.sh
git commit -m "Update: add a loadable GNOME Shell extension skeleton

Adds metadata, a GSettings schema mirroring the plasmoid's single
show-usage-on-panel option, a minimal PanelMenu.Button indicator, and
the install/uninstall branches that assemble the extension directory
with a copy of the shared core.

Verified it loads and appears in the top bar of a nested
gnome-shell --wayland session. Everything after this fills the
indicator in."
```

---

### Task 2: Session reading with the shared aggregate

Feed the extension real session data using `Gio`, merged by `shared/aggregate.mjs`.

**Files:**
- Create: `platforms/gnome/lib/sessions.js`
- Modify: `platforms/gnome/extension.js`

**Interfaces:**
- Consumes: `aggregate(docs, now)` from `shared/aggregate.mjs`
- Produces: a `SessionSource` class with `start()`, `stop()`, a `changed` callback receiving the aggregate object, and a `get agg()` accessor returning the same shape `main.qml` binds to.

- [ ] **Step 1: Write the session source**

Create `platforms/gnome/lib/sessions.js`:

```js
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'

import {aggregate} from '../shared/aggregate.mjs'

// Matches statusbar_paths.data_dir() on the Python side.
function sessionsDir() {
    const base = GLib.getenv('XDG_DATA_HOME') ||
        GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share'])
    return GLib.build_filenamev([base, 'claude-status-bar', 'sessions'])
}

const EMPTY = {
    state: 'idle', tool: null, started_at: null,
    active_count: 0, waiting_count: 0, sessions: [],
}

// Reads per-session JSON files and merges them with the shared aggregate.
//
// Updates are event-driven via Gio.FileMonitor, with a slow timer as a safety
// net: a session goes stale on a 900s clock with no file event to announce it,
// so watching alone would leave the panel showing a dead session indefinitely.
export class SessionSource {
    constructor(onChanged) {
        this._onChanged = onChanged
        this._agg = EMPTY
        this._monitor = null
        this._debounceId = 0
        this._staleId = 0
    }

    get agg() {
        return this._agg
    }

    start() {
        const dir = Gio.File.new_for_path(sessionsDir())
        try {
            this._monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null)
            this._monitor.connect('changed', () => this._scheduleRead())
        } catch (e) {
            // The directory may not exist until the first hook fires; the
            // staleness timer below still picks it up once it appears.
            logError(e, 'claude-status-bar: could not watch the sessions directory')
        }

        this._staleId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 5, () => {
            this._read()
            return GLib.SOURCE_CONTINUE
        })

        this._read()
    }

    stop() {
        if (this._debounceId) {
            GLib.Source.remove(this._debounceId)
            this._debounceId = 0
        }
        if (this._staleId) {
            GLib.Source.remove(this._staleId)
            this._staleId = 0
        }
        this._monitor?.cancel()
        this._monitor = null
    }

    // A single write can emit several change events; coalesce them.
    _scheduleRead() {
        if (this._debounceId)
            return
        this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._debounceId = 0
            this._read()
            return GLib.SOURCE_REMOVE
        })
    }

    _read() {
        const docs = this._loadDocs()
        // Fractional seconds are fine: aggregate compares updated_at against a
        // 900s threshold and preserves started_at precision untouched.
        const next = aggregate(docs, GLib.get_real_time() / 1000000)
        this._agg = next
        this._onChanged(next)
    }

    _loadDocs() {
        const docs = []
        let iter
        try {
            iter = Gio.File.new_for_path(sessionsDir()).enumerate_children(
                'standard::name', Gio.FileQueryInfoFlags.NONE, null)
        } catch (e) {
            return docs  // directory absent: no sessions yet
        }

        let info
        while ((info = iter.next_file(null)) !== null) {
            const name = info.get_name()
            if (!name.endsWith('.json'))
                continue
            try {
                const path = GLib.build_filenamev([sessionsDir(), name])
                const [ok, bytes] = GLib.file_get_contents(path)
                if (!ok)
                    continue
                docs.push(JSON.parse(new TextDecoder().decode(bytes)))
            } catch (e) {
                continue  // half-written or corrupt file must not break the panel
            }
        }
        iter.close(null)
        return docs
    }
}
```

- [ ] **Step 2: Wire it into the indicator**

In `platforms/gnome/extension.js`, import the source and show live state in the placeholder label:

```js
import {SessionSource} from './lib/sessions.js'
import {toolLabel} from './shared/labels.mjs'
```

Change `Indicator._init` to keep a label reference:

```js
    _init() {
        super._init(0.0, 'Claude Status Bar')
        this._label = new St.Label({text: 'idle', y_align: 2})
        this.add_child(this._label)
    }

    setAgg(agg) {
        this._label.text = agg.state === 'tool'
            ? toolLabel(agg.tool)
            : `${agg.state} (${agg.active_count})`
    }
```

And in the extension class:

```js
    enable() {
        this._indicator = new Indicator()
        Main.panel.addToStatusArea(this.uuid, this._indicator)
        this._sessions = new SessionSource(agg => this._indicator?.setAgg(agg))
        this._sessions.start()
    }

    disable() {
        this._sessions?.stop()
        this._sessions = null
        this._indicator?.destroy()
        this._indicator = null
    }
```

- [ ] **Step 3: Verify against live session data**

```bash
./install.sh --gnome
dbus-run-session -- gnome-shell --nested --wayland
```

Enable the extension, then in another terminal start a Claude Code session and watch the nested shell's top bar. Expected: the label tracks `idle`, `thinking (1)`, and tool names as the session works.

Confirm the shared aggregate is actually being applied, not bypassed:

```bash
python3 ~/.local/share/claude-status-bar/bin/claude-status-sessions.py | python3 -m json.tool | head -20
```

The panel's state must match what `aggregate()` would produce from those documents.

- [ ] **Step 4: Verify teardown does not leak**

```bash
gnome-extensions disable claude-status-bar@vntrungld.github.io
gnome-extensions enable claude-status-bar@vntrungld.github.io
journalctl --user -b -n 200 --no-pager | grep -i "claude-status-bar"
```

Repeat the disable/enable cycle five times. Expected: no errors, no warnings about sources or actors, and exactly one indicator in the top bar — not five.

- [ ] **Step 5: Commit**

```bash
git add platforms/gnome/
git commit -m "Update: read session files with Gio and merge via the shared core

Adds SessionSource, which enumerates the session directory with Gio and
applies shared/aggregate.mjs — the same merge rules the plasmoid runs,
with no subprocess in the hot path.

Updates are event-driven through a debounced Gio.FileMonitor, backed by
a 5s timer because a session goes stale on a 900s clock with no file
event to announce it. Corrupt or half-written files are skipped rather
than breaking the panel. Verified five disable/enable cycles leave no
duplicate indicators and no leaked sources."
```

---

### Task 3: Panel layout — elapsed timer and usage readout

Replace the placeholder label with the real panel row: a state icon placeholder, tool label, elapsed timer, and the two usage dots with percentages.

**Files:**
- Create: `platforms/gnome/lib/indicator.js`
- Modify: `platforms/gnome/extension.js`, `platforms/gnome/stylesheet.css`

**Interfaces:**
- Consumes: `toolLabel`, `fmt` from `shared/labels.mjs`; `usagePctText`, `usageDotColor` from `shared/usage.mjs`
- Produces: a `ClaudeIndicator` class (a `PanelMenu.Button`) with `setAgg(agg)`, `setUsage(usage)`, `setShowUsage(bool)`, and `destroy()`.

- [ ] **Step 1: Write the indicator**

Create `platforms/gnome/lib/indicator.js`:

```js
import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import St from 'gi://St'
import Clutter from 'gi://Clutter'

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'

import {toolLabel, fmt} from '../shared/labels.mjs'
import {usagePctText, usageDotColor} from '../shared/usage.mjs'

const EMPTY_USAGE = {status: 'loading', five_hour: {}, seven_day: {}}

export const ClaudeIndicator = GObject.registerClass(
class ClaudeIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Claude Status Bar')

        this._agg = {state: 'idle', tool: null, started_at: null,
                     active_count: 0, waiting_count: 0, sessions: []}
        this._usage = EMPTY_USAGE
        this._showUsage = true
        this._elapsedId = 0

        this._box = new St.BoxLayout({style_class: 'claude-panel-box'})
        this.add_child(this._box)

        // Placeholder until the sprite lands; keeps layout honest meanwhile.
        this._icon = new St.Icon({
            icon_name: 'utilities-terminal-symbolic',
            style_class: 'system-status-icon',
        })
        this._box.add_child(this._icon)

        this._toolLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER})
        this._box.add_child(this._toolLabel)

        this._elapsedLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER})
        this._box.add_child(this._elapsedLabel)

        this._usageBox = new St.BoxLayout({style_class: 'claude-usage-box'})
        this._box.add_child(this._usageBox)

        this._fiveDot = this._makeDot()
        this._fiveLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER})
        this._sevenDot = this._makeDot()
        this._sevenLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER})
        this._usageBox.add_child(this._fiveDot)
        this._usageBox.add_child(this._fiveLabel)
        this._usageBox.add_child(this._sevenDot)
        this._usageBox.add_child(this._sevenLabel)

        this._render()
    }

    _makeDot() {
        return new St.Widget({
            style_class: 'claude-usage-dot',
            y_align: Clutter.ActorAlign.CENTER,
        })
    }

    setAgg(agg) {
        this._agg = agg
        // The elapsed timer runs only while something is actually running.
        if (agg.started_at !== null && !this._elapsedId) {
            // Sampled 4x/s, not 1x: a 1s timer beats against the 1s display
            // quantum, so jitter walks the sample across the second boundary
            // and one displayed second stalls to ~2s. Flooring the difference
            // (not the difference of floors) keeps the count honest against a
            // float started_at instead of running up to a second ahead.
            this._elapsedId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                this._renderElapsed()
                return GLib.SOURCE_CONTINUE
            })
        } else if (agg.started_at === null && this._elapsedId) {
            GLib.Source.remove(this._elapsedId)
            this._elapsedId = 0
        }
        this._render()
    }

    setUsage(usage) {
        this._usage = usage || EMPTY_USAGE
        this._render()
    }

    setShowUsage(show) {
        this._showUsage = show
        this._render()
    }

    _renderElapsed() {
        const started = this._agg.started_at
        if (started === null) {
            this._elapsedLabel.visible = false
            return
        }
        const now = GLib.get_real_time() / 1000000
        this._elapsedLabel.text = fmt(Math.max(0, Math.floor(now - started)))
        this._elapsedLabel.visible = true
    }

    _render() {
        const showText = this._agg.state === 'thinking' || this._agg.state === 'tool'
        this._toolLabel.visible = showText
        if (showText)
            this._toolLabel.text = `${this._agg.state === 'tool' ? toolLabel(this._agg.tool) : 'Thinking'}…`

        this._renderElapsed()

        this._usageBox.visible = this._showUsage
        this._usageBox.opacity = this._usage.status === 'ok' ? 255 : 128
        this._fiveLabel.text = usagePctText(this._usage.five_hour)
        this._sevenLabel.text = usagePctText(this._usage.seven_day)
        this._fiveDot.style = `background-color: ${usageDotColor(this._usage.five_hour)};`
        this._sevenDot.style = `background-color: ${usageDotColor(this._usage.seven_day)};`
    }

    destroy() {
        if (this._elapsedId) {
            GLib.Source.remove(this._elapsedId)
            this._elapsedId = 0
        }
        super.destroy()
    }
})
```

The `Thinking…` placeholder is replaced by the shared thinking words in Task 5.

- [ ] **Step 2: Style the dots**

Append to `platforms/gnome/stylesheet.css`:

```css
.claude-usage-box {
    spacing: 3px;
}

/* Coloured status dot; the colour itself is set inline from
   shared/usage.mjs so both frontends use identical thresholds. */
.claude-usage-dot {
    width: 8px;
    height: 8px;
    border-radius: 4px;
}
```

- [ ] **Step 3: Use the real indicator**

In `platforms/gnome/extension.js`, delete the inline `Indicator` class and its now-unused `GObject`/`PanelMenu`/`toolLabel` imports, then:

```js
import {ClaudeIndicator} from './lib/indicator.js'
```

with `enable()` constructing `new ClaudeIndicator()`.

- [ ] **Step 4: Verify in the nested shell**

```bash
./install.sh --gnome
dbus-run-session -- gnome-shell --nested --wayland
```

With a Claude session running, confirm: the tool label appears and reads "Editing…", "Running…"; the elapsed timer counts up one second per second with no stalls or skips; and the usage percentages render (they will show `—%` until Task 6 wires the fetcher).

Watch the elapsed timer for a full minute against a stopwatch. It must not drift or stall.

- [ ] **Step 5: Verify the timer stops when idle**

End the Claude session and confirm the elapsed label disappears. Then check no timer is left running:

```bash
journalctl --user -b -n 100 --no-pager | grep -i "claude-status-bar"
```

Expected: no repeated log output, no errors.

- [ ] **Step 6: Commit**

```bash
git add platforms/gnome/
git commit -m "Update: build the GNOME panel row with elapsed timer and usage

Adds ClaudeIndicator with the tool label, elapsed timer, and the two
usage dots and percentages, all rendered through shared/labels.mjs and
shared/usage.mjs so the wording, rounding, and colour thresholds match
the plasmoid exactly.

The elapsed timer samples at 250ms and floors the difference rather
than the difference of floors, carrying over the fix from CompactView:
a 1s timer beats against the 1s display quantum and makes one displayed
second occasionally stall to ~2s. The timer runs only while a session
is active and is removed in destroy()."
```

---

### Task 4: Clawd sprite animation

Replace the placeholder icon with the shared sprite sheets.

**Files:**
- Create: `platforms/gnome/lib/clawd.js`
- Modify: `platforms/gnome/lib/indicator.js`, `platforms/gnome/stylesheet.css`

**Interfaces:**
- Consumes: `clawdAnim` from `shared/labels.mjs`; `shared/clawd/*.png` and `frames.json`
- Produces: a `ClawdSprite` class (an `St.Bin` or `St.Widget` subclass) with `setState(state, tool)`, `pause()`, `resume()`, and `destroy()`.

- [ ] **Step 1: Introspect the shell's own sprite animation API**

GNOME Shell ships `Animation` in `ui/animation.js`, which already does horizontal sprite-sheet playback — it is what the shell's own spinners use. Using it is far better than hand-rolling Cairo. Confirm the exact constructor signature on the installed version before writing against it:

```bash
gresource extract /usr/lib/gnome-shell/libgnome-shell.so \
  /org/gnome/shell/ui/animation.js 2>/dev/null | head -80 \
  || gresource list /usr/lib/gnome-shell/libgnome-shell.so | grep animation
```

Read the `Animation` and `AnimatedIcon` class definitions and note the constructor parameters and the play/stop method names.

**If `Animation` exists and takes a sprite sheet**, use it — implement Step 2 against the real signature. **If it does not**, fall back to an `St.Widget` whose `background-image` is the sheet and whose `background-position` is stepped by a timer; that is the same technique, hand-rolled. Record which path was taken in the commit message.

- [ ] **Step 2: Write the sprite wrapper**

Create `platforms/gnome/lib/clawd.js`. Adjust the `Animation` call to match what Step 1 found:

```js
import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import St from 'gi://St'

import * as Animation from 'resource:///org/gnome/shell/ui/animation.js'

import {clawdAnim} from '../shared/labels.mjs'

// Sprite sheet metadata generated by scripts/build-clawd-sprites.py. Loaded
// once at construction; a few hundred bytes from the extension's own directory.
function loadFrames(extPath) {
    try {
        const path = GLib.build_filenamev([extPath, 'shared', 'clawd', 'frames.json'])
        const [ok, bytes] = GLib.file_get_contents(path)
        if (ok)
            return JSON.parse(new TextDecoder().decode(bytes))
    } catch (e) {
        logError(e, 'claude-status-bar: could not read clawd frames.json')
    }
    return {}
}

// Animated Clawd, played from the same sprite sheets the plasmoid uses so both
// frontends show identical frames at an identical rate.
export const ClawdSprite = GObject.registerClass(
class ClawdSprite extends St.Bin {
    _init(extPath, size) {
        super._init({style_class: 'claude-clawd'})
        this._extPath = extPath
        this._size = size
        this._meta = loadFrames(extPath)
        this._current = null
        this._anim = null
        this.setState('idle', null)
    }

    setState(state, tool) {
        const name = clawdAnim(state, tool)
        if (name === this._current)
            return
        this._current = name

        const info = this._meta[name]
        if (!info)
            return

        this._anim?.stop()
        this.set_child(null)
        this._anim?.destroy?.()

        const file = Gio.File.new_for_path(
            GLib.build_filenamev([this._extPath, 'shared', 'clawd', `${name}.png`]))
        // Frame dimensions come from frames.json; Animation derives the frame
        // count from the sheet width, which matches how the sheets are built.
        this._anim = new Animation.Animation(
            file, info.width, info.height, info.interval_ms)
        this.set_child(this._anim)
        this._anim.play()
    }

    pause() {
        this._anim?.stop()
    }

    resume() {
        this._anim?.play()
    }

    destroy() {
        this._anim?.stop()
        this._anim = null
        super.destroy()
    }
})
```

- [ ] **Step 3: Use the sprite in the indicator**

`ClawdSprite` needs the extension's install path to find its assets, so `ClaudeIndicator._init` takes it as a parameter. In `lib/indicator.js`:

```js
import {ClawdSprite} from './clawd.js'
```

Replace the `St.Icon` placeholder:

```js
    _init(extPath) {
        super._init(0.0, 'Claude Status Bar')
        this._extPath = extPath
        // ... existing property initialisation ...
        this._clawd = new ClawdSprite(extPath, 16)
        this._box.add_child(this._clawd)
```

and in `_render()`, add:

```js
        this._clawd.setState(this._agg.state, this._agg.tool)
```

Add the waiting dot as an overlay, matching the plasmoid:

```js
        this._waitingDot.visible = this._agg.state === 'waiting'
```

with the dot created in `_init` and styled by CSS.

In `destroy()`, add `this._clawd?.destroy()` before `super.destroy()`.

In `extension.js`, pass the path: `new ClaudeIndicator(this.path)`.

- [ ] **Step 4: Style the sprite and waiting dot**

Append to `platforms/gnome/stylesheet.css`:

```css
.claude-clawd {
    width: 16px;
    height: 16px;
}

/* Yellow "awaiting permission" dot, overlaid on the notification Clawd. */
.claude-waiting-dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background-color: #f5c451;
    border: 1px solid rgba(0, 0, 0, 0.25);
}
```

- [ ] **Step 5: Verify every animation renders**

```bash
./install.sh --gnome
dbus-run-session -- gnome-shell --nested --wayland
```

Exercise each state with a Claude session and confirm the sprite animates smoothly, at the same speed as the KDE widget, with no visible seams between frames:

- idle (no session), thinking, Edit → typing, Bash → building, Grep → debugger, Read → carrying, permission prompt → notification with the yellow dot

Compare side by side against the plasmoid on your KDE session — both read the same `interval_ms`, so any speed difference means the sprite wrapper is not honouring it.

- [ ] **Step 6: Verify animation stops when hidden**

Lock the nested shell, or disable the extension. Confirm no repaint activity continues:

```bash
journalctl --user -b -n 200 --no-pager | grep -i "claude-status-bar"
```

Expected: no errors on disable, and no leaked animation after five disable/enable cycles.

- [ ] **Step 7: Commit**

```bash
git add platforms/gnome/
git commit -m "Update: animate Clawd from the shared sprite sheets on GNOME

Replaces the placeholder icon with sprite playback driven by the same
sheets and the same frames.json interval the plasmoid uses, so both
frontends show identical frames at an identical rate. Animation
selection goes through shared/labels.mjs clawdAnim, so the
state-and-tool mapping cannot drift between desktops.

Adds the yellow awaiting-permission dot overlaid on the notification
animation, matching the plasmoid. The sprite is stopped and destroyed
in destroy()."
```

---

### Task 5: The shimmer label

Port the right-to-left brightness sweep, and the thinking words that ride on it.

**Files:**
- Create: `platforms/gnome/lib/shimmer.js`
- Modify: `platforms/gnome/lib/indicator.js`

**Interfaces:**
- Consumes: `shimmerOpacity`, `shimmerDuration` from `shared/shimmer.mjs`; `THINKING_WORDS`, `pickThinkingWord`, `toolLabel` from `shared/labels.mjs`
- Produces: a `ShimmerLabel` class with `setText(str)`, `stop()`, and `destroy()`.

- [ ] **Step 1: Write the shimmer label**

Create `platforms/gnome/lib/shimmer.js`:

```js
import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import St from 'gi://St'
import Clutter from 'gi://Clutter'

import {shimmerOpacity, shimmerDuration} from '../shared/shimmer.mjs'

// One St.Label per character, opacity swept right-to-left. The curve and the
// sweep duration come from the shared core, so both frontends shimmer
// identically. St has no per-character text effects, so the characters are
// real actors — the same approach QML's Repeater takes.
const TICK_MS = 40

export const ShimmerLabel = GObject.registerClass(
class ShimmerLabel extends St.BoxLayout {
    _init() {
        super._init({style_class: 'claude-shimmer'})
        this._chars = []
        this._text = ''
        this._head = 0
        this._tickId = 0
    }

    setText(str) {
        if (str === this._text)
            return
        this._text = str

        this.remove_all_children()
        this._chars = []
        for (const ch of str) {
            const label = new St.Label({
                text: ch === ' ' ? ' ' : ch,
                y_align: Clutter.ActorAlign.CENTER,
            })
            this._chars.push(label)
            this.add_child(label)
        }

        this._head = this._chars.length + 2
        this._start()
    }

    _start() {
        this.stop()
        if (!this._chars.length)
            return

        const n = this._chars.length
        // shimmerDuration is the time for one full sweep; convert to a
        // per-tick step across the same range QML animates (n+2 down to -2).
        const step = (n + 4) / (shimmerDuration(n) / TICK_MS)

        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
            this._head -= step
            if (this._head < -2)
                this._head = n + 2
            for (let i = 0; i < this._chars.length; i++)
                this._chars[i].opacity = Math.round(255 * shimmerOpacity(i, this._head))
            return GLib.SOURCE_CONTINUE
        })
    }

    stop() {
        if (this._tickId) {
            GLib.Source.remove(this._tickId)
            this._tickId = 0
        }
    }

    destroy() {
        this.stop()
        super.destroy()
    }
})
```

- [ ] **Step 2: Use it in the indicator with the shared thinking words**

In `lib/indicator.js`, replace the plain `_toolLabel` with a `ShimmerLabel`, and add thinking-word selection:

```js
import {ShimmerLabel} from './shimmer.js'
import {toolLabel, fmt, THINKING_WORDS, pickThinkingWord} from '../shared/labels.mjs'
```

In `_init`, replace the `_toolLabel` creation:

```js
        this._toolLabel = new ShimmerLabel()
        this._box.add_child(this._toolLabel)
        this._thinkingWord = THINKING_WORDS[0]
        this._prevState = ''
```

In `_render()`, replace the label text logic:

```js
        // A fresh word is chosen each time a session enters the thinking state
        // and held for that phase, avoiding an immediate repeat.
        if (this._agg.state === 'thinking' && this._prevState !== 'thinking')
            this._thinkingWord = pickThinkingWord(this._thinkingWord, Math.random)
        this._prevState = this._agg.state

        const showText = this._agg.state === 'thinking' || this._agg.state === 'tool'
        this._toolLabel.visible = showText
        if (showText) {
            const word = this._agg.state === 'tool'
                ? toolLabel(this._agg.tool) : this._thinkingWord
            this._toolLabel.setText(`${word}…`)
        } else {
            this._toolLabel.stop()
        }
```

In `destroy()`, add `this._toolLabel?.destroy()`.

- [ ] **Step 3: Verify the shimmer visually**

```bash
./install.sh --gnome
dbus-run-session -- gnome-shell --nested --wayland
```

With a Claude session running, confirm the label brightens in a wave travelling right to left, at the same rate as the plasmoid, and that the thinking word changes between thinking phases without immediately repeating.

- [ ] **Step 4: Verify the shimmer timer stops**

Let the session go idle and confirm the label disappears. Then cycle disable/enable five times and check for leaked sources:

```bash
journalctl --user -b -n 200 --no-pager | grep -i "claude-status-bar"
```

Expected: clean, no warnings.

- [ ] **Step 5: Commit**

```bash
git add platforms/gnome/
git commit -m "Update: port the shimmer sweep and thinking words to GNOME

Adds ShimmerLabel, one St.Label per character with opacity driven by
shared/shimmer.mjs, so the falloff curve and sweep duration match the
plasmoid rather than being re-tuned by eye. St has no per-character
text effects, so the characters are real actors — the same approach
QML's Repeater takes.

Thinking words come from shared/labels.mjs with the same no-immediate-
repeat rule. The sweep timer is removed on idle and in destroy()."
```

---

### Task 6: Usage fetching

Spawn the Python fetchers and render their results, on the same schedule as the plasmoid.

**Files:**
- Create: `platforms/gnome/lib/usage.js`
- Modify: `platforms/gnome/extension.js`

**Interfaces:**
- Consumes: `POLL_INTERVAL_MS`, `RETRY_INTERVAL_MS`, `MAX_RETRIES`, `shouldFastRetry` from `shared/usage.mjs`
- Produces: a `UsageSource` class with `start()`, `stop()`, `refresh()`, `switchAccount(name)`, a `changed` callback receiving the usage object, and a `get fetching()` accessor.

- [ ] **Step 1: Write the usage source**

Create `platforms/gnome/lib/usage.js`:

```js
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'

import {POLL_INTERVAL_MS, RETRY_INTERVAL_MS, MAX_RETRIES,
        shouldFastRetry} from '../shared/usage.mjs'

const EMPTY = {status: 'loading', five_hour: {}, seven_day: {}}

function binDir() {
    const base = GLib.getenv('XDG_DATA_HOME') ||
        GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share'])
    return GLib.build_filenamev([base, 'claude-status-bar', 'bin'])
}

// Runs the Python usage fetchers and publishes their JSON.
//
// Unlike the session path this does spawn a subprocess, but only every five
// minutes, and always with an argv array — no shell, so account names need no
// escaping.
export class UsageSource {
    constructor(onChanged, onFetchingChanged) {
        this._onChanged = onChanged
        this._onFetchingChanged = onFetchingChanged
        this._usage = EMPTY
        this._fetching = false
        this._retries = 0
        this._pollId = 0
        this._retryId = 0
        this._cancellable = null
    }

    get usage() {
        return this._usage
    }

    get fetching() {
        return this._fetching
    }

    start() {
        this._pollId = GLib.timeout_add(GLib.PRIORITY_LOW, POLL_INTERVAL_MS, () => {
            this.refresh()
            return GLib.SOURCE_CONTINUE
        })
        this.refresh()  // fetch immediately at startup
        this._armRetry()
    }

    stop() {
        for (const id of ['_pollId', '_retryId']) {
            if (this[id]) {
                GLib.Source.remove(this[id])
                this[id] = 0
            }
        }
        this._cancellable?.cancel()
        this._cancellable = null
    }

    // User- or schedule-initiated fetch: fresh retry budget.
    refresh() {
        this._retries = 0
        this._run([])
    }

    // Switch the active token-slayer account, then re-list. The script prints
    // the refreshed result, so the same handler updates the UI.
    switchAccount(name) {
        if (!name)
            return
        this._retries = 0
        this._run(['switch', name])
    }

    // Boot resilience: if the first fetch fails (no network yet right after
    // login), retry quickly until usage lands, then idle. Bounded so a
    // persistent failure does not spin; the 5-minute poll takes over after.
    _armRetry() {
        if (this._retryId)
            return
        this._retryId = GLib.timeout_add(GLib.PRIORITY_LOW, RETRY_INTERVAL_MS, () => {
            if (shouldFastRetry(this._usage.status) && this._retries < MAX_RETRIES) {
                this._retries += 1
                this._run([])
            }
            return GLib.SOURCE_CONTINUE
        })
    }

    _setFetching(v) {
        this._fetching = v
        this._onFetchingChanged(v)
    }

    _run(extraArgs) {
        if (this._cancellable)
            return  // a fetch is already in flight

        this._setFetching(true)
        this._cancellable = new Gio.Cancellable()

        const argv = ['python3',
            GLib.build_filenamev([binDir(), 'token-slayer-usage-fetch.py']),
            ...extraArgs]

        try {
            const proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE)
            proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
                this._cancellable = null
                this._setFetching(false)
                try {
                    const [, stdout] = p.communicate_utf8_finish(res)
                    const parsed = JSON.parse((stdout || '').trim())
                    this._usage = parsed
                    this._onChanged(parsed)
                } catch (e) {
                    // Keep the previous value, exactly as the plasmoid does.
                    logError(e, 'claude-status-bar: usage fetch failed')
                }
            })
        } catch (e) {
            this._cancellable = null
            this._setFetching(false)
            logError(e, 'claude-status-bar: could not spawn the usage fetcher')
        }
    }
}
```

- [ ] **Step 2: Wire it into the extension**

In `platforms/gnome/extension.js`:

```js
import {UsageSource} from './lib/usage.js'
```

```js
    enable() {
        this._indicator = new ClaudeIndicator(this.path)
        Main.panel.addToStatusArea(this.uuid, this._indicator)

        this._settings = this.getSettings()
        this._indicator.setShowUsage(this._settings.get_boolean('show-usage-on-panel'))
        this._settingsId = this._settings.connect('changed::show-usage-on-panel',
            () => this._indicator?.setShowUsage(
                this._settings.get_boolean('show-usage-on-panel')))

        this._sessions = new SessionSource(agg => this._indicator?.setAgg(agg))
        this._sessions.start()

        this._usage = new UsageSource(
            usage => this._indicator?.setUsage(usage),
            fetching => this._indicator?.setFetching(fetching))
        this._usage.start()
    }

    disable() {
        this._usage?.stop()
        this._usage = null
        this._sessions?.stop()
        this._sessions = null
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId)
            this._settingsId = 0
        }
        this._settings = null
        this._indicator?.destroy()
        this._indicator = null
    }
```

Add a no-op `setFetching(v)` to `ClaudeIndicator` for now; Task 7 gives it a spinner.

- [ ] **Step 3: Verify usage appears**

```bash
./install.sh --gnome
dbus-run-session -- gnome-shell --nested --wayland
```

Expected: within a few seconds the panel shows `5h N% · 7d N%` with correctly coloured dots, matching what the KDE widget shows for the same account.

Cross-check against the fetcher directly:

```bash
python3 ~/.local/share/claude-status-bar/bin/token-slayer-usage-fetch.py | python3 -m json.tool
```

- [ ] **Step 4: Verify the setting works**

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/claude-status-bar@vntrungld.github.io/schemas \
  set org.gnome.shell.extensions.claude-status-bar show-usage-on-panel false
```

Expected: the percentages disappear from the panel immediately. Set it back to `true` and they return.

- [ ] **Step 5: Verify no subprocess leak**

```bash
watch -n1 'pgrep -af "token-slayer-usage-fetch" | wc -l'
```

Expected: 0 almost always, briefly 1 during a fetch. Never a growing count.

- [ ] **Step 6: Commit**

```bash
git add platforms/gnome/
git commit -m "Update: fetch usage on GNOME via Gio.Subprocess

Adds UsageSource, running the same Python fetchers on the same schedule
as the plasmoid — startup fetch, five-minute poll, and a bounded fast
retry whose budget and eligible statuses come from shared/usage.mjs, so
reauth and rate_limited still back off rather than hammering.

Spawning uses an argv array with no shell, so the account-name escaping
main.qml has to do by hand does not arise here. In-flight fetches are
cancelled on disable. Also wires show-usage-on-panel through GSettings."
```

---

### Task 7: The popup

Session list, usage bars, per-account blocks with switch buttons, and the refresh control.

**Files:**
- Create: `platforms/gnome/lib/popup.js`
- Modify: `platforms/gnome/lib/indicator.js`, `platforms/gnome/stylesheet.css`

**Interfaces:**
- Consumes: `toolLabelShort`, `displayName` from `shared/labels.mjs`; `usagePct`, `resetText`, `updatedText` from `shared/usage.mjs`
- Produces: a `PopupContent` class with `setAgg(agg)`, `setUsage(usage)`, `setFetching(bool)`, and callbacks `onRefresh` and `onSwitch(name)`.

- [ ] **Step 1: Write the popup content**

Create `platforms/gnome/lib/popup.js`:

```js
import GObject from 'gi://GObject'
import St from 'gi://St'
import Clutter from 'gi://Clutter'

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js'

import {toolLabelShort, displayName} from '../shared/labels.mjs'
import {usagePct, resetText, updatedText} from '../shared/usage.mjs'

// Shared helpers return {id, args}; each frontend owns its own wording so
// neither has to share a translation catalogue with the other.
//
// NOTE: String.prototype.format() below is defined by gnome-shell's own
// environment.js, so it is available here but NOT in prefs.js, which runs in a
// separate GTK process. Do not use .format() there — prefs.js sticks to plain
// _() calls with no substitution for exactly this reason.
function msg(m) {
    if (!m)
        return ''
    switch (m.id) {
    case 'resetting':    return _('resetting…')
    case 'resets_in_dh': return _('resets in %dd %dh').format(m.args[0], m.args[1])
    case 'resets_in_hm': return _('resets in %dh %dm').format(m.args[0], m.args[1])
    case 'resets_in_m':  return _('resets in %dm').format(m.args[0])
    case 'updated_now':  return _('updated just now')
    case 'updated_m':    return _('updated %dm ago').format(m.args[0])
    case 'updated_h':    return _('updated %dh ago').format(m.args[0])
    }
    return ''
}

function nowSec() {
    return Math.floor(GLib.get_real_time() / 1000000)
}

// A single usage window: label, filled bar, percentage, and reset countdown.
const UsageBar = GObject.registerClass(
class UsageBar extends St.BoxLayout {
    _init(label) {
        super._init({vertical: true, style_class: 'claude-usage-bar'})
        this._row = new St.BoxLayout({style_class: 'claude-usage-bar-row'})
        this.add_child(this._row)

        this._name = new St.Label({text: label, style_class: 'claude-usage-bar-name'})
        this._row.add_child(this._name)

        // St has no progress bar; a fixed-width trough with a styled fill is
        // the standard shell idiom.
        this._trough = new St.Widget({style_class: 'claude-usage-trough'})
        this._fill = new St.Widget({style_class: 'claude-usage-fill'})
        this._trough.add_child(this._fill)
        this._row.add_child(this._trough)

        this._pct = new St.Label({style_class: 'claude-usage-pct'})
        this._row.add_child(this._pct)

        this._reset = new St.Label({style_class: 'claude-usage-reset'})
        this.add_child(this._reset)
    }

    setWindow(w) {
        const v = usagePct(w)
        this.visible = v !== null
        if (v === null)
            return
        this._pct.text = `${v}%`
        // The trough is 120px wide; the fill mirrors the percentage.
        this._fill.style = `width: ${Math.round(120 * v / 100)}px;`
        const r = msg(resetText(w, nowSec()))
        this._reset.text = r
        this._reset.visible = r !== ''
    }
})

export {UsageBar}
```

Continue the file with the account block and the container. The account block reuses `UsageBar`:

```js
// One managed account: name, active marker, freshness, a switch button for
// inactive accounts, and its two usage bars.
const AccountBlock = GObject.registerClass({
    Signals: {'switch-requested': {param_types: [GObject.TYPE_STRING]}},
}, class AccountBlock extends St.BoxLayout {
    _init() {
        super._init({vertical: true, style_class: 'claude-account'})

        const header = new St.BoxLayout({style_class: 'claude-account-header'})
        this.add_child(header)

        this._name = new St.Label({style_class: 'claude-account-name'})
        header.add_child(this._name)

        this._active = new St.Label({text: _('active'), style_class: 'claude-account-active'})
        header.add_child(this._active)

        this._updated = new St.Label({style_class: 'claude-account-updated'})
        header.add_child(this._updated)

        this._switch = new St.Button({
            label: _('Switch'),
            style_class: 'claude-switch-button',
            x_align: Clutter.ActorAlign.END,
        })
        this._switch.connect('clicked', () => {
            if (this._accountName)
                this.emit('switch-requested', this._accountName)
        })
        header.add_child(this._switch)

        this._five = new UsageBar(_('5-hour'))
        this._seven = new UsageBar(_('Weekly'))
        this.add_child(this._five)
        this.add_child(this._seven)

        this._noData = new St.Label({
            text: _('no usage data yet'),
            style_class: 'claude-account-nodata',
        })
        this.add_child(this._noData)
    }

    setAccount(account, busy) {
        this._accountName = account.name
        this._name.text = displayName(account)
        this._active.visible = account.active === true
        // Hidden for the already-active account; disabled while a fetch or an
        // earlier switch is still in flight.
        this._switch.visible = account.active !== true && !!account.name
        this._switch.reactive = !busy
        this._switch.opacity = busy ? 128 : 255

        const u = msg(updatedText(account.polled_at, nowSec()))
        this._updated.text = u
        this._updated.visible = u !== ''

        const hasData = account.has_data !== false
        this._five.visible = hasData
        this._seven.visible = hasData
        this._noData.visible = !hasData
        if (hasData) {
            this._five.setWindow(account.five_hour)
            this._seven.setWindow(account.seven_day)
        }
    }
})
```

Add `import GLib from 'gi://GLib'` at the top for `nowSec()`.

- [ ] **Step 2: Build the popup container**

Continue `platforms/gnome/lib/popup.js` with the top-level content that assembles the session list, the "Usage limits" header with refresh button and spinner, and either the single-account bars or the multi-account list:

```js
export const PopupContent = GObject.registerClass({
    Signals: {
        'refresh-requested': {},
        'switch-requested': {param_types: [GObject.TYPE_STRING]},
    },
}, class PopupContent extends St.BoxLayout {
    _init() {
        super._init({vertical: true, style_class: 'claude-popup'})

        this._heading = new St.Label({style_class: 'claude-popup-heading'})
        this.add_child(this._heading)

        this._sessionBox = new St.BoxLayout({vertical: true})
        this.add_child(this._sessionBox)

        this._noSessions = new St.Label({
            text: _('No active sessions'),
            style_class: 'claude-popup-dim',
        })
        this.add_child(this._noSessions)

        const usageHeader = new St.BoxLayout({style_class: 'claude-popup-usage-header'})
        this.add_child(usageHeader)
        usageHeader.add_child(new St.Label({
            text: _('Usage limits'),
            style_class: 'claude-popup-heading',
        }))
        this._refresh = new St.Button({
            style_class: 'claude-refresh-button',
            child: new St.Icon({icon_name: 'view-refresh-symbolic', icon_size: 16}),
        })
        this._refresh.connect('clicked', () => this.emit('refresh-requested'))
        usageHeader.add_child(this._refresh)

        // Single-account mode (no token-slayer).
        this._five = new UsageBar(_('5-hour'))
        this._seven = new UsageBar(_('Weekly'))
        this.add_child(this._five)
        this.add_child(this._seven)

        // Multi-account mode; one block per managed account.
        this._accountBox = new St.BoxLayout({vertical: true})
        this.add_child(this._accountBox)
        this._accountBlocks = []

        this._busy = false
    }

    setAgg(agg) {
        this._heading.text = _('Claude Code — %d active').format(agg.active_count)

        this._sessionBox.destroy_all_children()
        for (const s of agg.sessions) {
            const row = new St.BoxLayout({style_class: 'claude-session-row'})
            const name = (s.cwd || '').split('/').pop() ||
                (s.session_id || '').substring(0, 8)
            row.add_child(new St.Label({text: name}))
            const detail = s.state + (s.tool ? ` · ${toolLabelShort(s.tool)}` : '') +
                (s.state === 'idle' ? '' : '…')
            row.add_child(new St.Label({
                text: detail,
                style_class: 'claude-popup-dim',
                x_align: Clutter.ActorAlign.END,
                x_expand: true,
            }))
            this._sessionBox.add_child(row)
        }
        this._noSessions.visible = agg.active_count === 0
    }

    setUsage(usage) {
        const multi = usage.multi === true
        this._five.visible = !multi
        this._seven.visible = !multi
        this._accountBox.visible = multi

        if (!multi) {
            this._five.setWindow(usage.five_hour)
            this._seven.setWindow(usage.seven_day)
            return
        }

        const accounts = usage.accounts || []
        // Reuse blocks across refreshes so switch buttons keep their identity.
        while (this._accountBlocks.length < accounts.length) {
            const block = new AccountBlock()
            block.connect('switch-requested',
                (_b, name) => this.emit('switch-requested', name))
            this._accountBlocks.push(block)
            this._accountBox.add_child(block)
        }
        for (let i = 0; i < this._accountBlocks.length; i++) {
            const block = this._accountBlocks[i]
            block.visible = i < accounts.length
            if (i < accounts.length)
                block.setAccount(accounts[i], this._busy)
        }
    }

    setFetching(busy) {
        this._busy = busy
        this._refresh.reactive = !busy
        this._refresh.opacity = busy ? 128 : 255
    }
})
```

- [ ] **Step 3: Attach the popup to the indicator**

In `lib/indicator.js`, import `PopupMenu` and `PopupContent`, and in `_init`:

```js
        this._popup = new PopupContent()
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
        })
        item.add_child(this._popup)
        this.menu.addMenuItem(item)

        this._popup.connect('refresh-requested', () => this.emit('refresh-requested'))
        this._popup.connect('switch-requested', (_p, name) => this.emit('switch-requested', name))
```

Register those two signals on `ClaudeIndicator` via the `GObject.registerClass` metadata object, and forward `setAgg`/`setUsage`/`setFetching` into `this._popup`.

In `extension.js`, connect them:

```js
        this._indicator.connect('refresh-requested', () => this._usage?.refresh())
        this._indicator.connect('switch-requested', (_i, name) => this._usage?.switchAccount(name))
```

- [ ] **Step 4: Style the popup**

Append to `platforms/gnome/stylesheet.css`:

```css
.claude-popup { spacing: 6px; padding: 8px; min-width: 300px; }
.claude-popup-heading { font-weight: bold; }
.claude-popup-dim { opacity: 0.7; }
.claude-popup-usage-header { spacing: 6px; }
.claude-session-row { spacing: 8px; }
.claude-usage-bar { spacing: 2px; }
.claude-usage-bar-row { spacing: 6px; }
.claude-usage-bar-name { min-width: 60px; }
.claude-usage-trough {
    width: 120px; height: 8px; border-radius: 4px;
    background-color: rgba(255, 255, 255, 0.15);
}
.claude-usage-fill {
    height: 8px; border-radius: 4px;
    background-color: #3fb950;
}
.claude-usage-reset { font-size: 0.85em; opacity: 0.6; }
.claude-account { spacing: 4px; padding: 4px 0; }
.claude-account-header { spacing: 6px; }
.claude-account-name { font-weight: bold; }
.claude-account-active { font-size: 0.85em; color: #6ab7ff; }
.claude-account-updated { font-size: 0.85em; opacity: 0.6; }
.claude-account-nodata { font-size: 0.85em; opacity: 0.6; }
.claude-switch-button { padding: 2px 8px; border-radius: 4px; }
.claude-refresh-button { padding: 2px; }
```

- [ ] **Step 5: Verify the popup**

```bash
./install.sh --gnome
dbus-run-session -- gnome-shell --nested --wayland
```

Click the indicator and confirm against `docs/screenshots/panel.png`:

- the heading reads "Claude Code — N active"
- each running session appears with its directory name and `state · Tool`
- "No active sessions" shows when idle
- usage bars fill proportionally, with reset countdowns reading "resets in 2h 5m"
- with token-slayer configured, one block per account with freshness and a Switch button on the inactive ones

- [ ] **Step 6: Verify refresh and switching**

Click the refresh button and confirm the values update and the button dims while fetching. Then click Switch on an inactive account and confirm the active marker moves and usage re-renders.

```bash
token-slayer list --json | python3 -m json.tool | grep -E '"(name|active)"'
```

Expected: the active account matches what the popup shows.

- [ ] **Step 7: Commit**

```bash
git add platforms/gnome/
git commit -m "Update: build the GNOME popup with usage bars and account switching

Adds the session list, usage bars, per-account blocks, and the refresh
control. Wording, rounding, thresholds, countdowns, and account display
names all come from the shared core; only the widget construction and
the gettext wording are GNOME-specific.

St has no progress bar, so usage bars are a styled trough and fill.
Account blocks are reused across refreshes so switch buttons keep their
identity, and are disabled while a fetch is in flight — matching the
plasmoid's guard against firing a second switch before the first lands."
```

---

### Task 8: Preferences window

**Files:**
- Create: `platforms/gnome/prefs.js`

**Interfaces:**
- Consumes: the `show-usage-on-panel` GSettings key from Task 1
- Produces: a preferences window reachable from GNOME Extensions.

- [ ] **Step 1: Write prefs.js**

Create `platforms/gnome/prefs.js`:

```js
import Adw from 'gi://Adw'
import Gtk from 'gi://Gtk'

import {ExtensionPreferences, gettext as _}
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

export default class ClaudeStatusBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings()

        const page = new Adw.PreferencesPage()
        const group = new Adw.PreferencesGroup({title: _('Panel')})
        page.add(group)

        const row = new Adw.SwitchRow({
            title: _('Show usage percentages'),
            subtitle: _('Show 5-hour and weekly usage % in the top bar. ' +
                        'The popup always shows usage.'),
        })
        group.add(row)
        settings.bind('show-usage-on-panel', row, 'active',
                      Gio.SettingsBindFlags.DEFAULT)

        window.add(page)
    }
}
```

Add `import Gio from 'gi://Gio'` at the top.

`Adw.SwitchRow` requires libadwaita 1.4 (GNOME 45+), which the `shell-version` floor already guarantees.

- [ ] **Step 2: Verify the preferences window opens**

```bash
./install.sh --gnome
gnome-extensions prefs claude-status-bar@vntrungld.github.io
```

Expected: a window with a "Panel" group and a working switch. Toggling it changes the key:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/claude-status-bar@vntrungld.github.io/schemas \
  get org.gnome.shell.extensions.claude-status-bar show-usage-on-panel
```

- [ ] **Step 3: Verify the panel reacts live**

With the nested shell running, toggle the switch and confirm the percentages appear and disappear without restarting the shell.

- [ ] **Step 4: Commit**

```bash
git add platforms/gnome/prefs.js
git commit -m "Update: add a preferences window for the GNOME extension

Adds an Adw preferences page binding the show-usage-on-panel key,
mirroring the plasmoid's Configure dialog. The panel reacts live
through the settings signal connected in enable(), so no shell restart
is needed."
```

---

### Task 9: Documentation

**Files:**
- Modify: `README.md`
- Create: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: everything above
- Produces: install and troubleshooting instructions for both desktops, and the nested-shell dev loop.

- [ ] **Step 1: Restructure the README**

Add a platform matrix near the top, immediately after the intro:

```markdown
## Supported desktops

| Desktop | Frontend | Status |
|---|---|---|
| KDE Plasma 6 | Plasmoid (`platforms/kde`) | Developed and tested on Plasma 6 |
| GNOME Shell 45+ | Shell extension (`platforms/gnome`) | Verified on GNOME Shell 50; declared for 45–50, earlier versions untested |

Both frontends share the same Python hooks and the same JavaScript core
(`shared/`), so activity, usage, and account switching behave identically.
```

Update the Requirements table so KDE-only rows are marked as such, and add GNOME rows (`GNOME Shell 45+`, `gjs`, checked with `gnome-shell --version` and `gjs --version`).

Update the Quick install section to cover both:

```markdown
./install.sh            # auto-detects KDE or GNOME
./install.sh --gnome    # or force a target
```

with a GNOME follow-up step:

```bash
gnome-extensions enable claude-status-bar@vntrungld.github.io
```

and a note that GNOME requires a logout/login to load a new extension on Wayland.

Update "What the installer does" to describe the assembly step and both frontends, and rename `claude-status-aggregate.py` to `claude-status-sessions.py` in the script list, noting that merging now happens in `shared/aggregate.mjs`.

Add GNOME entries to Troubleshooting:

```markdown
**Extension does not appear in GNOME.**
Check it is installed and enabled:
`gnome-extensions info claude-status-bar@vntrungld.github.io`.
On Wayland a new extension needs a logout/login. Check for load errors with
`journalctl --user -b | grep claude-status-bar`.
```

- [ ] **Step 2: Write CONTRIBUTING.md**

Create `CONTRIBUTING.md` covering the layout, the shared-core rule, and the test commands:

```markdown
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
python3 -m pytest          # Python hooks and fetchers
./tests/run-shared-tests.sh  # shared JS core (gjs is authoritative)
./tests/run-qml-tests.sh     # proves the shared modules load in Qt
```

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

## Regenerating the Clawd sprites

Only needed if the source art changes. Requires Pillow:

```bash
python3 scripts/build-clawd-sprites.py
```

`INTERVAL_MS` in that script sets the frame rate for **both** frontends.
```

- [ ] **Step 3: Verify every documented command works**

Run each command block from the README and CONTRIBUTING exactly as written and confirm it behaves as described. Documentation that has never been executed is a common source of first-contact failures for exactly the GNOME users this targets.

- [ ] **Step 4: Commit**

```bash
git add README.md CONTRIBUTING.md
git commit -m "Update: document both desktops and the nested-shell dev loop

Adds a platform matrix, GNOME install and troubleshooting steps, and a
CONTRIBUTING guide covering the shared-core rule, the three test
commands, and how to develop the GNOME extension from a KDE session
using a nested shell.

The matrix states plainly that the extension is verified on GNOME Shell
50 and merely declared for 45-49, which is more useful to a stranger
than an unqualified compatibility claim. Every documented command was
run as written."
```

---

### Task 10: Final verification and release

**Files:**
- Modify: `platforms/gnome/metadata.json`, `platforms/kde/package/metadata.json` (only if versions drifted)
- Modify: `docs/superpowers/specs/2026-08-06-multi-desktop-support-design.md` (mark implemented)

**Interfaces:**
- Consumes: everything
- Produces: a verified release on both desktops.

- [ ] **Step 1: Confirm version lockstep**

```bash
grep -E '"(Version|version-name)"' platforms/kde/package/metadata.json platforms/gnome/metadata.json
```

Expected: both report `0.2.0`.

- [ ] **Step 2: Run every suite**

```bash
python3 -m pytest -q
./tests/run-shared-tests.sh
./tests/run-qml-tests.sh
```

Expected: all pass. Record the actual counts in the commit message rather than asserting success generically.

- [ ] **Step 3: Verify a clean install on KDE**

```bash
./uninstall.sh --kde
./install.sh --kde
kquitapp6 plasmashell && kstart plasmashell
```

Walk the full checklist with a live Claude Code session: each state glyph animates, tool labels shimmer, the elapsed timer counts accurately, usage percentages and dot colours render, the popup lists sessions, refresh works, and account switching works.

- [ ] **Step 4: Verify a clean install on GNOME**

```bash
./uninstall.sh --gnome
./install.sh --gnome
dbus-run-session -- gnome-shell --nested --wayland
```

Walk the identical checklist. Then compare the two side by side and confirm the wording, percentages, colours, and animation speed match.

- [ ] **Step 5: Verify the lock/unlock cycle**

The failure mode most likely to reach users and least likely to show up in a quick test:

```bash
for i in 1 2 3 4 5; do
  gnome-extensions disable claude-status-bar@vntrungld.github.io
  gnome-extensions enable claude-status-bar@vntrungld.github.io
done
journalctl --user -b -n 300 --no-pager | grep -i "claude-status-bar"
pgrep -af "token-slayer-usage-fetch" | wc -l
```

Expected: no errors or warnings, exactly one indicator in the top bar, and no accumulating subprocesses.

- [ ] **Step 6: Mark the spec implemented**

Add a line under the spec's Status field recording the implementing commits and the verified GNOME Shell version.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-08-06-multi-desktop-support-design.md \
        platforms/gnome/metadata.json platforms/kde/package/metadata.json
git commit -m "Update: verify GNOME and KDE frontends at 0.2.0

Full verification pass on both desktops from a clean install: activity
states, tool labels, elapsed timer, usage readout, popup session list,
refresh, and account switching, checked side by side for identical
wording, colours, and animation speed.

Also exercised five disable/enable cycles on GNOME to confirm teardown
leaves no duplicate indicators, leaked GLib sources, or orphaned usage
subprocesses — the leak path that compounds on every screen lock."
```

---

## Self-Review

**Spec coverage.** Every GNOME-side spec section maps to a task: extension architecture and `disable()` teardown (1, 2, 10), `lib/sessions.js` with FileMonitor plus staleness timer (2), `lib/indicator.js` panel row (3), `lib/clawd.js` sprite playback (4), shimmer (5), `lib/usage.js` scheduling and argv-array spawning (6), popup with usage bars and switching (7), `prefs.js` and GSettings (1, 6, 8), install/uninstall assembly (1), documentation (9), version lockstep and verification (10). The 250ms elapsed sampling carries over in Task 3.

**Placeholders.** None. Task 4 Step 1 is a genuine introspection step with both branches specified — the `Animation` API is read from the installed shell rather than guessed, and the fallback is named — not a deferred decision.

**Type consistency.** `SessionSource.agg` returns `aggregate()`'s shape, consumed by `setAgg` in Tasks 3, 5, and 7. `UsageSource` publishes the fetcher's JSON unchanged, so `usage.multi`, `usage.accounts`, `has_data`, `polled_at`, `active`, and `name` match `token-slayer-usage-fetch.py`'s `build_multi()` output and the plasmoid's bindings. `toolLabelShort` is used in the popup and `toolLabel` in the panel, matching the KDE split. `frames.json` keys (`frames`, `width`, `height`, `interval_ms`) are read under the names Task 11 of the companion plan writes. Signal names `refresh-requested` and `switch-requested` are consistent between `PopupContent`, `ClaudeIndicator`, and `extension.js`.

**Known risk carried from the spec.** Task 4's sprite playback and Task 5's shimmer are the two pieces with no toolkit equivalent to lean on. If either fights St/Clutter, the documented fallback is a static frame per state; nothing else depends on them.
