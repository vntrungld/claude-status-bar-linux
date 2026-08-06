# Shared JS Core + KDE Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract every piece of pure logic out of the QML widget and the Python aggregator into a `shared/` ES-module core consumed by Qt today and GJS next, then cut the KDE widget over to it with no user-visible change.

**Architecture:** Pure logic lives in `shared/*.mjs` and never touches the clock or the filesystem. Platform code supplies data and builds widgets. Python shrinks to `claude-status-sessions.py`, which reads the session directory and prints raw documents with no logic; QML applies the shared `aggregate()` itself. Clawd animation moves from animated WebP to generated PNG sprite sheets that both frontends can consume.

**Tech Stack:** ES modules (`.mjs`), GJS 1.88 (canonical test runner), Node 22 (convenience runner), Qt 6 QML, Python 3 stdlib, Pillow (maintainer-only, for sprite generation).

**Spec:** `docs/superpowers/specs/2026-08-06-multi-desktop-support-design.md`

**Companion plan:** `docs/superpowers/plans/2026-08-06-gnome-shell-frontend.md` builds the GNOME frontend on top of this. Do not start it until this plan is complete and the KDE widget is verified working.

## Global Constraints

- Shared modules are pure: **no clock reads, no filesystem access, no platform globals**. Time is always a parameter.
- Shared modules must parse under **both** Qt 6's QML engine and GJS 1.88. No GJS-only or Node-only APIs (`imports`, `require`, `process`, `Gio`) in `shared/`.
- `gjs` is the canonical test runner. `node` may run the same suite but is never the source of truth.
- The KDE widget must be **behaviourally identical** at the end of this plan, with exactly two documented exceptions: the `started_at` truncation fix (Task 3) and the sprite frame rate (Task 12).
- Python stays **stdlib-only** for anything installed to `bin/`. Pillow is allowed only in `scripts/build-clawd-sprites.py`, a maintainer tool that is never installed.
- Existing hook behaviour, session file format, and usage-fetch output shape are untouched.
- Every task ends with a passing `python3 -m pytest` plus the shared suite once it exists. The Python baseline is **52 tests through Task 7**; Task 8 deliberately changes it to **50** by removing the eight aggregate tests and adding six session tests. A task that changes the count without saying so has broken something.

---

### Task 1: Confirm GJS consumes `.mjs`

This is a de-risking gate. The entire plan assumes one module format serves both engines. Qt was verified during design; GJS was not. **If this task fails, stop and report — do not work around it silently.**

**Files:**
- Create: `/tmp/gjs-spike/shared-spike.mjs`, `/tmp/gjs-spike/run.mjs`
- Modify: `docs/superpowers/specs/2026-08-06-multi-desktop-support-design.md` (record the outcome)

**Interfaces:**
- Consumes: nothing
- Produces: a confirmed decision on the shared module file extension, used by every later task

- [ ] **Step 1: Install the GNOME toolchain**

```bash
sudo pacman -S --needed gnome-shell gjs
gjs --version
gnome-shell --version
```

Expected: `gjs 1.88.x` and `GNOME Shell 50.x`.

- [ ] **Step 2: Write the spike module**

```bash
mkdir -p /tmp/gjs-spike
cat > /tmp/gjs-spike/shared-spike.mjs <<'EOF'
export const STALE_SECS = 900
export function toolLabel(t) {
    if (t && t.indexOf('mcp__') === 0) return 'Using MCP'
    return t === 'Bash' ? 'Running' : (t || '')
}
EOF
```

- [ ] **Step 3: Write the runner and run it under gjs**

```bash
cat > /tmp/gjs-spike/run.mjs <<'EOF'
import { STALE_SECS, toolLabel } from './shared-spike.mjs'
const ok = STALE_SECS === 900 && toolLabel('Bash') === 'Running' && toolLabel('mcp__a__b') === 'Using MCP'
console.log(ok ? 'GJS-MJS-OK' : 'GJS-MJS-WRONG-VALUES')
EOF
gjs -m /tmp/gjs-spike/run.mjs; echo "EXIT=$?"
```

Expected: prints `GJS-MJS-OK`, `EXIT=0`.

Note the `-m` flag — GJS needs it to treat the file as an ES module.

- [ ] **Step 4: Record the outcome in the spec**

If Step 3 printed `GJS-MJS-OK`, replace the "Unverified assumption" section of the spec with a confirmation naming the tested `gjs` version, and proceed with `.mjs` everywhere.

If GJS rejected the `.mjs` extension, **stop and report to the user**. The documented fallback is for `install.sh` to rename `shared/*.mjs` to `*.js` when assembling the GNOME bundle, which changes only Task 7 and the GNOME plan's install step — but this is a decision for the user, not one to make unilaterally.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-06-multi-desktop-support-design.md
git commit -m "Update: confirm GJS module format for the shared core

Installed gnome-shell and gjs, and verified that GJS 1.88 imports a
standard .mjs ES module with correct exported values, matching the
Qt 6 result recorded during design. The shared core can therefore use
one file format for both frontends with no build-time rename."
```

---

### Task 2: Shared test harness

A dependency-free assertion harness that runs under both `gjs -m` and `node`, so every later shared module has somewhere to put its tests.

**Files:**
- Create: `tests/shared/harness.mjs`
- Create: `tests/shared/run-all.mjs`
- Create: `tests/run-shared-tests.sh`

**Interfaces:**
- Consumes: nothing
- Produces: `eq(actual, expected, label)`, `ok(cond, label)`, `report() -> failureCount` from `harness.mjs`; `tests/run-shared-tests.sh` as the single command every later task runs.

- [ ] **Step 1: Write the harness**

Create `tests/shared/harness.mjs`:

```js
// Dependency-free assertions, runnable under `gjs -m` and `node`.
// console.log is the only output primitive both engines share.
let total = 0
let failures = 0

export function eq(actual, expected, label) {
    total++
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a !== e) {
        failures++
        console.log(`FAIL ${label}\n  expected: ${e}\n  actual:   ${a}`)
    }
}

export function ok(cond, label) {
    total++
    if (!cond) {
        failures++
        console.log(`FAIL ${label}`)
    }
}

export function report() {
    console.log(`${total - failures}/${total} shared assertions passed`)
    return failures
}
```

- [ ] **Step 2: Write the aggregating runner**

Create `tests/shared/run-all.mjs`. Later tasks add one import line each:

```js
// Entry point: imports every shared test module, then exits non-zero on failure.
import { report } from './harness.mjs'

const failures = report()

if (typeof process !== 'undefined') {
    process.exit(failures === 0 ? 0 : 1)
} else {
    const System = (await import('system')).default
    System.exit(failures === 0 ? 0 : 1)
}
```

- [ ] **Step 3: Write the runner script**

Create `tests/run-shared-tests.sh`:

```bash
#!/usr/bin/env bash
# Canonical runner for the shared JS core. gjs is the source of truth; node is
# a convenience for quick loops when gjs is not on PATH.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

if command -v gjs >/dev/null 2>&1; then
    exec gjs -m "$HERE/shared/run-all.mjs"
elif command -v node >/dev/null 2>&1; then
    echo "warning: gjs not found, falling back to node (not authoritative)" >&2
    exec node "$HERE/shared/run-all.mjs"
else
    echo "error: neither gjs nor node available" >&2
    exit 127
fi
```

- [ ] **Step 4: Verify the harness runs green and empty**

```bash
chmod +x tests/run-shared-tests.sh
./tests/run-shared-tests.sh; echo "EXIT=$?"
```

Expected: `0/0 shared assertions passed`, `EXIT=0`.

- [ ] **Step 5: Verify the harness actually fails when it should**

A test harness that cannot fail is worse than none. Prove it:

```bash
cat > /tmp/harness-check.mjs <<'EOF'
import { eq, report } from './tests/shared/harness.mjs'
eq(1, 2, 'deliberate failure')
console.log('failures=' + report())
EOF
gjs -m /tmp/harness-check.mjs
```

Expected: prints `FAIL deliberate failure`, then `0/1 shared assertions passed`, then `failures=1`.

- [ ] **Step 6: Commit**

```bash
git add tests/shared/harness.mjs tests/shared/run-all.mjs tests/run-shared-tests.sh
git commit -m "Update: add dependency-free test harness for the shared JS core

Adds a minimal assertion harness and runner that execute under both
gjs -m and node, so shared modules can be tested by the same engines
that will consume them. gjs is treated as authoritative; node prints a
warning and is used only as a fallback.

Verified the harness reports failures rather than passing silently."
```

---

### Task 3: `shared/aggregate.mjs`

Port the Python aggregator's logic to JS, carrying over all eight existing test cases plus the `started_at` precision fix.

**The one intentional behaviour change:** Python's `_num()` calls `int(v)`, which truncates the float `started_at` that `claude-status-hook.py` writes (`time.time()`, from commit a972ce2). Truncating downward makes `started_at` earlier, so the elapsed counter reads up to a second high — reintroducing the bias a972ce2 removed. The JS port preserves float `started_at` and truncates only `updated_at`, which is compared against a 900s threshold where sub-second precision is irrelevant.

**Files:**
- Create: `shared/aggregate.mjs`
- Create: `tests/shared/test-aggregate.mjs`
- Modify: `tests/shared/run-all.mjs`

**Interfaces:**
- Consumes: `eq`, `ok`, `report` from `tests/shared/harness.mjs`
- Produces: `STALE_SECS` (number, 900) and `aggregate(docs, now) -> {state, tool, started_at, active_count, waiting_count, sessions}` where `state` is one of `"idle" | "thinking" | "tool" | "waiting"`, `tool` is a string or `null`, `started_at` is a number or `null`, and `sessions` is the array of non-stale documents.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/test-aggregate.mjs`:

```js
import { eq, ok } from './harness.mjs'
import { aggregate, STALE_SECS } from '../../shared/aggregate.mjs'

function d(sid, state, started = null, updated = 1000, tool = null) {
    return { session_id: sid, state, tool, started_at: started,
             updated_at: updated, cwd: '/w/' + sid }
}

eq(STALE_SECS, 900, 'STALE_SECS matches the Python original')

// Ported from tests/test_aggregate.py
let out = aggregate([d('a', 'idle'), d('b', 'idle')], 1000)
ok(out.state === 'idle' && out.active_count === 0, 'all idle')

out = aggregate([d('a', 'thinking', 500), d('b', 'tool', 600, 1000, 'Edit'),
                 d('c', 'waiting')], 1000)
ok(out.state === 'waiting' && out.waiting_count === 1, 'waiting beats tool and thinking')

out = aggregate([d('a', 'thinking', 500, 900), d('b', 'tool', 600, 950, 'Bash')], 1000)
ok(out.state === 'tool' && out.tool === 'Bash' && out.active_count === 2,
   'tool beats thinking and reports the latest tool')

out = aggregate([d('a', 'thinking', 800), d('b', 'thinking', 600)], 1000)
ok(out.state === 'thinking' && out.started_at === 600, 'thinking uses earliest started')

out = aggregate([d('a', 'tool', 100, 1, 'Edit')], 100000)
ok(out.state === 'idle' && out.active_count === 0, 'stale non-idle dropped')

out = aggregate([d('a', 'tool', null, 'garbage', 'Edit')], 100000)
ok(out.state === 'idle' && out.active_count === 0, 'malformed updated_at does not crash')

out = aggregate([d('a', 'thinking', 'oops', 999999999999)], 100000)
ok(out.state === 'thinking' && out.started_at === null, 'malformed started_at ignored')

// Idle sessions are never dropped for staleness, however old.
out = aggregate([d('a', 'idle', null, 1)], 100000)
eq(out.sessions.length, 1, 'stale idle sessions are retained')

// The precision fix: float started_at survives aggregation.
out = aggregate([d('a', 'thinking', 1000.98, 999999999999)], 1001)
eq(out.started_at, 1000.98, 'float started_at is not truncated')
```

Add the import to `tests/shared/run-all.mjs`, immediately below the harness import:

```js
import './test-aggregate.mjs'
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
./tests/run-shared-tests.sh; echo "EXIT=$?"
```

Expected: FAIL — the module does not exist yet, so GJS reports an import resolution error and a non-zero exit.

- [ ] **Step 3: Write the implementation**

Create `shared/aggregate.mjs`:

```js
// Pure session-merge logic, shared by the Plasma widget and the GNOME
// extension. No clock reads and no I/O: `now` is always supplied by the caller.

export const STALE_SECS = 900

// Coerce to an integer, mirroring Python's int()-with-fallback. Used for
// updated_at only, which is compared against a 900s threshold.
function intOr(v, dflt = 0) {
    const n = typeof v === 'number' ? Math.trunc(v) : parseInt(v, 10)
    return Number.isFinite(n) ? n : dflt
}

// started_at keeps full precision: claude-status-hook.py writes it as a float
// so the elapsed counter can be sub-second accurate. Truncating here would make
// the start look earlier and the counter read high.
function floatOrNull(v) {
    const n = typeof v === 'number' ? v : parseFloat(v)
    return Number.isFinite(n) ? n : null
}

export function aggregate(docs, now) {
    const live = docs.filter(x =>
        !(x.state !== 'idle' && now - intOr(x.updated_at) > STALE_SECS))

    const active = live.filter(x =>
        x.state === 'thinking' || x.state === 'tool' || x.state === 'waiting')
    const waiting = active.filter(x => x.state === 'waiting')
    const tools = active.filter(x => x.state === 'tool')

    let state, tool
    if (waiting.length) {
        state = 'waiting'
        tool = null
    } else if (tools.length) {
        state = 'tool'
        tool = tools.reduce((a, b) =>
            intOr(b.updated_at) > intOr(a.updated_at) ? b : a).tool
    } else if (active.length) {
        state = 'thinking'
        tool = null
    } else {
        state = 'idle'
        tool = null
    }

    const starts = active
        .map(x => floatOrNull(x.started_at))
        .filter(v => v !== null && v > 0)
    const started_at = starts.length ? Math.min(...starts) : null

    return { state, tool, started_at,
             active_count: active.length,
             waiting_count: waiting.length,
             sessions: live }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
./tests/run-shared-tests.sh; echo "EXIT=$?"
```

Expected: `10/10 shared assertions passed`, `EXIT=0`.

- [ ] **Step 5: Confirm the Python original still passes**

The Python aggregator is still in use by the widget at this point and must not have been disturbed.

```bash
python3 -m pytest -q
```

Expected: `52 passed`.

- [ ] **Step 6: Commit**

```bash
git add shared/aggregate.mjs tests/shared/test-aggregate.mjs tests/shared/run-all.mjs
git commit -m "Update: port session aggregation to a shared ES module

Ports aggregate() from claude-status-aggregate.py to shared/aggregate.mjs
so the Plasma widget and the GNOME extension run identical merge rules.
All eight cases from test_aggregate.py are carried over, plus coverage
for stale idle retention.

Fixes a latent precision bug in the process: the Python _num() helper
coerced started_at with int(), truncating the float that
claude-status-hook.py writes since a972ce2. Truncating downward moved
the start earlier and made the elapsed counter read up to a second
high, defeating that fix one stage downstream. The port keeps
started_at as a float and truncates only updated_at, which is compared
against a 900s threshold where sub-second precision is irrelevant."
```

---

### Task 4: `shared/labels.mjs`

Move the display-string logic out of `CompactView.qml` and `FullView.qml`.

**Deliberate fidelity note:** `CompactView.toolLabel` maps many tools ("Edit" to "Editing"); `FullView.toolLabel` maps only MCP and `AskUserQuestion`, showing raw names otherwise. That difference is preserved by exporting **two** functions, so the popup keeps reading "tool · Edit" exactly as it does today. Unifying them is a one-line follow-up if the user wants it, but this plan does not change visible behaviour.

**Files:**
- Create: `shared/labels.mjs`
- Create: `tests/shared/test-labels.mjs`
- Modify: `tests/shared/run-all.mjs`

**Interfaces:**
- Consumes: `eq`, `ok` from `tests/shared/harness.mjs`
- Produces: `toolLabel(tool) -> string` (full mapping, panel), `toolLabelShort(tool) -> string` (MCP/AskUserQuestion only, popup), `clawdAnim(state, tool) -> string`, `THINKING_WORDS` (string array), `pickThinkingWord(current, rand) -> string`, `fmt(seconds) -> string`, `displayName(account) -> string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/test-labels.mjs`:

```js
import { eq, ok } from './harness.mjs'
import { toolLabel, toolLabelShort, clawdAnim, THINKING_WORDS,
         pickThinkingWord, fmt, displayName } from '../../shared/labels.mjs'

eq(toolLabel('Edit'), 'Editing', 'Edit maps to Editing')
eq(toolLabel('Write'), 'Editing', 'Write maps to Editing')
eq(toolLabel('MultiEdit'), 'Editing', 'MultiEdit maps to Editing')
eq(toolLabel('Bash'), 'Running', 'Bash maps to Running')
eq(toolLabel('Read'), 'Reading', 'Read maps to Reading')
eq(toolLabel('Grep'), 'Searching', 'Grep maps to Searching')
eq(toolLabel('Glob'), 'Searching', 'Glob maps to Searching')
eq(toolLabel('WebFetch'), 'Browsing', 'WebFetch maps to Browsing')
eq(toolLabel('WebSearch'), 'Browsing', 'WebSearch maps to Browsing')
eq(toolLabel('Task'), 'Delegating', 'Task maps to Delegating')
eq(toolLabel('AskUserQuestion'), 'Awaiting you', 'AskUserQuestion maps to Awaiting you')
eq(toolLabel('mcp__srv__thing'), 'Using MCP', 'MCP tools collapse to one label')
eq(toolLabel('Unknown'), 'Unknown', 'unknown tools pass through')
eq(toolLabel(null), '', 'null tool is empty')

// The popup's narrower mapping, preserved exactly as it is today.
eq(toolLabelShort('mcp__srv__thing'), 'Using MCP', 'short: MCP collapses')
eq(toolLabelShort('AskUserQuestion'), 'Awaiting you', 'short: AskUserQuestion maps')
eq(toolLabelShort('Edit'), 'Edit', 'short: other tools stay raw')
eq(toolLabelShort(null), '', 'short: null tool is empty')

eq(clawdAnim('waiting', null), 'notification', 'waiting uses notification')
eq(clawdAnim('thinking', null), 'thinking', 'thinking uses thinking')
eq(clawdAnim('idle', null), 'idle', 'idle uses idle')
eq(clawdAnim('tool', 'AskUserQuestion'), 'notification', 'AskUserQuestion reads as your turn')
eq(clawdAnim('tool', 'Edit'), 'typing', 'Edit uses typing')
eq(clawdAnim('tool', 'Write'), 'typing', 'Write uses typing')
eq(clawdAnim('tool', 'MultiEdit'), 'typing', 'MultiEdit uses typing')
eq(clawdAnim('tool', 'Bash'), 'building', 'Bash uses building')
eq(clawdAnim('tool', 'Grep'), 'debugger', 'Grep uses debugger')
eq(clawdAnim('tool', 'Glob'), 'debugger', 'Glob uses debugger')
eq(clawdAnim('tool', 'Read'), 'carrying', 'Read uses carrying')
eq(clawdAnim('tool', 'Whatever'), 'typing', 'unknown tool falls back to typing')

ok(THINKING_WORDS.length > 1, 'there is more than one thinking word')
ok(THINKING_WORDS.indexOf('Brewing') === 0, 'Brewing is first')

// rand is injected, so selection is deterministic under test.
eq(pickThinkingWord('Brewing', () => 0), 'Pondering',
   'a rand landing on the current word advances past it')
eq(pickThinkingWord('Pondering', () => 0), 'Brewing',
   'a rand landing elsewhere returns that word')

eq(fmt(0), '0s', 'zero seconds')
eq(fmt(42), '42s', 'sub-minute')
eq(fmt(60), '1m 0s', 'exactly one minute')
eq(fmt(65), '1m 5s', 'over a minute')
eq(fmt(3600), '60m 0s', 'an hour stays in minutes')

eq(displayName({ alias: 'work', email: 'a@b.com' }), 'work', 'alias wins')
eq(displayName({ email: 'someone@example.com' }), 'someone', 'falls back to local-part')
eq(displayName({ email: 'nodomain' }), 'nodomain', 'email without @ passes through')
eq(displayName({}), '', 'empty account is empty string')
```

Add to `tests/shared/run-all.mjs`:

```js
import './test-labels.mjs'
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
./tests/run-shared-tests.sh; echo "EXIT=$?"
```

Expected: FAIL — `shared/labels.mjs` does not exist.

- [ ] **Step 3: Write the implementation**

Create `shared/labels.mjs`:

```js
// Display-string logic shared by both frontends. Pure: no clock, no I/O.

// Panel mapping: every known tool becomes a readable verb.
export function toolLabel(t) {
    // MCP tools are named mcp__<server>__<tool>; collapse them all to one
    // readable label rather than leaking the raw underscored identifier.
    if (t && t.indexOf('mcp__') === 0) return 'Using MCP'
    switch (t) {
    case 'Edit': case 'Write': case 'MultiEdit': return 'Editing'
    case 'Bash': return 'Running'
    case 'Read': return 'Reading'
    case 'Grep': case 'Glob': return 'Searching'
    case 'WebFetch': case 'WebSearch': return 'Browsing'
    case 'Task': return 'Delegating'
    case 'AskUserQuestion': return 'Awaiting you'
    default: return t || ''
    }
}

// Popup mapping: only the two cases whose raw names are unreadable. The session
// list shows real tool names, which is more useful when several are running.
export function toolLabelShort(t) {
    if (t && t.indexOf('mcp__') === 0) return 'Using MCP'
    if (t === 'AskUserQuestion') return 'Awaiting you'
    return t || ''
}

// Map activity state + current tool to a Clawd animation name (assets from
// clawd-tank, MIT-licensed — see shared/clawd/LICENSE.clawd-tank).
export function clawdAnim(state, tool) {
    if (state === 'waiting') return 'notification'
    if (state === 'thinking') return 'thinking'
    if (state === 'tool') {
        // AskUserQuestion is a request for the human — show the notification
        // Clawd (same as the "waiting" state) so it reads as "your turn".
        if (tool === 'AskUserQuestion') return 'notification'
        switch (tool) {
        case 'Edit': case 'Write': case 'MultiEdit': return 'typing'
        case 'Bash': return 'building'
        case 'Grep': case 'Glob': return 'debugger'
        case 'Read': return 'carrying'
        default: return 'typing'
        }
    }
    return 'idle'
}

// Playful "thinking" verbs, Claude-Code-CLI style.
export const THINKING_WORDS = [
    'Brewing', 'Pondering', 'Percolating', 'Noodling', 'Tinkering',
    'Simmering', 'Conjuring', 'Wrangling', 'Untangling', 'Musing',
    'Scheming', 'Crunching', 'Distilling', 'Puzzling', 'Weaving',
    'Sculpting', 'Forging', 'Ruminating', 'Marinating', 'Incubating',
    'Synthesizing', 'Orchestrating', 'Calibrating', 'Whittling',
    'Germinating', 'Concocting', 'Cogitating', 'Finagling'
]

// Pick a word that differs from `current`, so a new thinking phase never
// repeats the previous one. `rand` is injected to keep this testable.
export function pickThinkingWord(current, rand) {
    if (THINKING_WORDS.length < 2) return THINKING_WORDS[0]
    let w = current
    while (w === current) {
        w = THINKING_WORDS[Math.floor(rand() * THINKING_WORDS.length)]
        // A rand() that keeps landing on `current` would spin; step forward.
        if (w === current) {
            const i = THINKING_WORDS.indexOf(current)
            w = THINKING_WORDS[(i + 1) % THINKING_WORDS.length]
        }
    }
    return w
}

export function fmt(s) {
    const m = Math.floor(s / 60)
    return m > 0 ? (m + 'm ' + (s % 60) + 's') : (s + 's')
}

// Account display name: alias if set, else the email's local-part.
export function displayName(account) {
    const a = account || {}
    if (a.alias) return a.alias
    const e = a.email || ''
    const at = e.indexOf('@')
    return at >= 0 ? e.substring(0, at) : e
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
./tests/run-shared-tests.sh; echo "EXIT=$?"
```

Expected: all assertions pass, `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add shared/labels.mjs tests/shared/test-labels.mjs tests/shared/run-all.mjs
git commit -m "Update: extract display-string logic into shared/labels.mjs

Moves tool labels, Clawd animation selection, thinking words, elapsed
formatting, and account display names out of the QML files so both
frontends render identical strings.

The panel and popup use different tool mappings today — the panel says
Editing, the popup says Edit — so both are exported rather than
unified, keeping the widget behaviourally identical. pickThinkingWord
takes rand as a parameter so selection is deterministic under test."
```

---

### Task 5: `shared/usage.mjs`

Move usage formatting, thresholds, and fetch scheduling constants out of QML. Relative-time helpers return message ids rather than finished strings, so each platform applies its own i18n.

**Files:**
- Create: `shared/usage.mjs`
- Create: `tests/shared/test-usage.mjs`
- Modify: `tests/shared/run-all.mjs`

**Interfaces:**
- Consumes: `eq`, `ok` from `tests/shared/harness.mjs`
- Produces: `usagePct(w) -> number|null`, `usagePctText(w) -> string`, `usageDotColor(w) -> string`, `resetText(w, nowSec) -> null | {id, args}`, `updatedText(ts, nowSec) -> null | {id, args}`, `POLL_INTERVAL_MS`, `RETRY_INTERVAL_MS`, `MAX_RETRIES`, `shouldFastRetry(status) -> boolean`.
- Message ids produced by `resetText`: `resetting`, `resets_in_dh`, `resets_in_hm`, `resets_in_m`. By `updatedText`: `updated_now`, `updated_m`, `updated_h`.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/test-usage.mjs`:

```js
import { eq, ok } from './harness.mjs'
import { usagePct, usagePctText, usageDotColor, resetText, updatedText,
         POLL_INTERVAL_MS, RETRY_INTERVAL_MS, MAX_RETRIES,
         shouldFastRetry } from '../../shared/usage.mjs'

eq(usagePct({ utilization: 42.4 }), 42, 'utilization rounds')
eq(usagePct({ utilization: 0 }), 0, 'zero is a real value, not missing')
eq(usagePct({}), null, 'missing utilization is null')
eq(usagePct(null), null, 'null window is null')

eq(usagePctText({ utilization: 42.4 }), '42%', 'percent text')
eq(usagePctText({}), '—%', 'missing shows an em dash')

eq(usageDotColor({ utilization: 10 }), '#3fb950', 'under 50 is green')
eq(usageDotColor({ utilization: 49.4 }), '#3fb950', 'rounds below 50 stays green')
eq(usageDotColor({ utilization: 50 }), '#f5c451', 'at 50 is yellow')
eq(usageDotColor({ utilization: 79 }), '#f5c451', 'under 80 is yellow')
eq(usageDotColor({ utilization: 80 }), '#e05252', 'at 80 is red')
eq(usageDotColor({}), '#888888', 'missing is grey')

// resets_at is ISO8601; nowSec is epoch seconds.
const iso = s => new Date(s * 1000).toISOString()
eq(resetText(null, 1000), null, 'no window is null')
eq(resetText({}, 1000), null, 'no resets_at is null')
eq(resetText({ resets_at: 'not-a-date' }, 1000), null, 'unparseable resets_at is null')
eq(resetText({ resets_at: iso(1000) }, 1000), { id: 'resetting' }, 'already elapsed is resetting')
eq(resetText({ resets_at: iso(1000) }, 2000), { id: 'resetting' }, 'past is resetting')
eq(resetText({ resets_at: iso(100000 + 90000) }, 100000),
   { id: 'resets_in_dh', args: [1, 1] }, 'over a day shows days and hours')
eq(resetText({ resets_at: iso(100000 + 7260) }, 100000),
   { id: 'resets_in_hm', args: [2, 1] }, 'over an hour shows hours and minutes')
eq(resetText({ resets_at: iso(100000 + 300) }, 100000),
   { id: 'resets_in_m', args: [5] }, 'under an hour shows minutes')

eq(updatedText(null, 1000), null, 'no timestamp is null')
eq(updatedText(1000, 1000), { id: 'updated_now' }, 'just now')
eq(updatedText(1000, 1030), { id: 'updated_now' }, 'under a minute is just now')
eq(updatedText(1000, 1200), { id: 'updated_m', args: [3] }, 'minutes ago')
eq(updatedText(1000, 8200), { id: 'updated_h', args: [2] }, 'hours ago')
eq(updatedText(2000, 1000), { id: 'updated_now' }, 'future timestamps clamp to now')

eq(POLL_INTERVAL_MS, 300000, 'polls every five minutes')
eq(RETRY_INTERVAL_MS, 10000, 'retries every ten seconds')
eq(MAX_RETRIES, 18, 'retry budget matches main.qml')

ok(shouldFastRetry('loading'), 'loading warrants a fast retry')
ok(shouldFastRetry('error'), 'error warrants a fast retry')
ok(!shouldFastRetry('ok'), 'ok does not retry')
ok(!shouldFastRetry('reauth'), 'reauth cannot be fixed by retrying')
ok(!shouldFastRetry('rate_limited'), 'rate_limited must back off')
```

Add to `tests/shared/run-all.mjs`:

```js
import './test-usage.mjs'
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
./tests/run-shared-tests.sh; echo "EXIT=$?"
```

Expected: FAIL — `shared/usage.mjs` does not exist.

- [ ] **Step 3: Write the implementation**

Create `shared/usage.mjs`:

```js
// Usage formatting, thresholds, and fetch scheduling. Pure: `nowSec` is always
// supplied by the caller.

export function usagePct(w) {
    return (w && w.utilization !== undefined && w.utilization !== null)
        ? Math.round(w.utilization) : null
}

export function usagePctText(w) {
    const v = usagePct(w)
    return (v === null ? '—' : v) + '%'
}

// Green under 50, yellow to 80, red at or above 80; grey when unknown.
export function usageDotColor(w) {
    const v = usagePct(w)
    if (v === null) return '#888888'
    if (v >= 80) return '#e05252'
    if (v >= 50) return '#f5c451'
    return '#3fb950'
}

// Relative-time helpers return a message id plus substitution values rather
// than a finished string, so each frontend applies its own i18n — i18n() on
// KDE, gettext on GNOME.
export function resetText(w, nowSec) {
    if (!w || !w.resets_at) return null
    const t = Date.parse(w.resets_at)
    if (isNaN(t)) return null
    const d = Math.floor(t / 1000) - nowSec
    if (d <= 0) return { id: 'resetting' }
    const days = Math.floor(d / 86400)
    const hours = Math.floor((d % 86400) / 3600)
    const mins = Math.floor((d % 3600) / 60)
    if (days > 0) return { id: 'resets_in_dh', args: [days, hours] }
    if (hours > 0) return { id: 'resets_in_hm', args: [hours, mins] }
    return { id: 'resets_in_m', args: [mins] }
}

export function updatedText(ts, nowSec) {
    if (!ts) return null
    const d = Math.max(0, nowSec - ts)
    if (d < 60) return { id: 'updated_now' }
    if (d < 3600) return { id: 'updated_m', args: [Math.floor(d / 60)] }
    return { id: 'updated_h', args: [Math.floor(d / 3600)] }
}

// Fetch scheduling, shared so both frontends poll identically.
export const POLL_INTERVAL_MS = 300000
export const RETRY_INTERVAL_MS = 10000
export const MAX_RETRIES = 18

// A fast retry helps only when the failure might be transient. `reauth` needs
// the user, and `rate_limited` must back off rather than hammer the endpoint.
export function shouldFastRetry(status) {
    return status === 'loading' || status === 'error'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
./tests/run-shared-tests.sh; echo "EXIT=$?"
```

Expected: all assertions pass, `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add shared/usage.mjs tests/shared/test-usage.mjs tests/shared/run-all.mjs
git commit -m "Update: extract usage formatting and scheduling into shared module

Moves percentage rounding, the green/yellow/red thresholds, reset and
freshness countdowns, and the poll/retry constants out of the QML views.

Relative-time helpers return a message id plus substitution values
rather than a finished string, so KDE can apply i18n() and GNOME can
apply gettext without either owning the other's translation catalogue."
```

---

### Task 6: `shared/shimmer.mjs` and the QML smoke test

The shimmer curve is small, so it is folded in with the Qt-side proof that all four shared modules load in the QML engine. That smoke test is what catches a shared module drifting into syntax Qt rejects — the failure mode the whole architecture is exposed to.

**Files:**
- Create: `shared/shimmer.mjs`
- Create: `tests/shared/test-shimmer.mjs`
- Create: `tests/qml/shared-smoke.qml`
- Create: `tests/run-qml-tests.sh`
- Modify: `tests/shared/run-all.mjs`

**Interfaces:**
- Consumes: every module from Tasks 3–5, plus `eq`/`ok`
- Produces: `shimmerOpacity(index, head) -> number`, `shimmerDuration(n) -> number`, and `tests/run-qml-tests.sh` as the Qt-side gate.

- [ ] **Step 1: Write the failing shimmer tests**

Create `tests/shared/test-shimmer.mjs`:

```js
import { eq, ok } from './harness.mjs'
import { shimmerOpacity, shimmerDuration } from '../../shared/shimmer.mjs'

eq(shimmerOpacity(3, 3), 1.0, 'the highlight position is fully bright')
eq(shimmerOpacity(0, 10), 0.4, 'far from the highlight is the dim baseline')
ok(shimmerOpacity(3, 4) > 0.4 && shimmerOpacity(3, 4) < 1.0,
   'one step away is partially lit')
eq(shimmerOpacity(3, 4), shimmerOpacity(3, 2), 'the falloff is symmetric')
ok(shimmerOpacity(0, 2.4) === 0.4, 'the falloff reaches baseline at 2.4 characters')

eq(shimmerDuration(0), 700, 'short strings clamp to the 700ms floor')
eq(shimmerDuration(5), 700, 'five characters still clamps')
eq(shimmerDuration(10), 1300, 'longer strings scale at 130ms per character')
```

Add to `tests/shared/run-all.mjs`:

```js
import './test-shimmer.mjs'
```

- [ ] **Step 2: Run to verify it fails**

```bash
./tests/run-shared-tests.sh; echo "EXIT=$?"
```

Expected: FAIL — `shared/shimmer.mjs` does not exist.

- [ ] **Step 3: Write the shimmer module**

Create `shared/shimmer.mjs`:

```js
// The right-to-left brightness sweep across the status word. Pure maths, shared
// so both frontends shimmer at the same rate and with the same falloff.

// Dim base, brightening to full at the sweeping highlight.
export function shimmerOpacity(index, head) {
    return 0.4 + 0.6 * Math.max(0, 1 - Math.abs(index - head) / 2.4)
}

// Longer words take proportionally longer to sweep, with a floor so short
// labels do not strobe.
export function shimmerDuration(n) {
    return Math.max(700, n * 130)
}
```

- [ ] **Step 4: Run to verify the shared suite passes**

```bash
./tests/run-shared-tests.sh; echo "EXIT=$?"
```

Expected: all assertions pass, `EXIT=0`.

- [ ] **Step 5: Write the QML smoke test**

Create `tests/qml/shared-smoke.qml`. It asserts through the exit code because QML's `console.log` is unreliable under `qml6` in a headless shell:

```qml
import QtQuick
import "../../shared/aggregate.mjs" as Aggregate
import "../../shared/labels.mjs" as Labels
import "../../shared/usage.mjs" as Usage
import "../../shared/shimmer.mjs" as Shimmer

// Proves Qt's QML engine parses and executes every shared module. A module that
// drifts into syntax Qt rejects fails here rather than in the running widget.
Item {
    Component.onCompleted: {
        var checks = [
            Aggregate.STALE_SECS === 900,
            Aggregate.aggregate([{state: "waiting", updated_at: 1000}], 1000).state === "waiting",
            Aggregate.aggregate([{state: "thinking", started_at: 1000.5, updated_at: 1000}], 1000).started_at === 1000.5,
            Labels.toolLabel("Bash") === "Running",
            Labels.toolLabelShort("Edit") === "Edit",
            Labels.clawdAnim("tool", "Bash") === "building",
            Labels.fmt(65) === "1m 5s",
            Labels.displayName({email: "a@b.com"}) === "a",
            Labels.THINKING_WORDS.length > 1,
            Usage.usagePctText({utilization: 42.4}) === "42%",
            Usage.usageDotColor({utilization: 80}) === "#e05252",
            Usage.resetText({resets_at: new Date(190000 * 1000).toISOString()}, 100000).id === "resets_in_dh",
            Usage.updatedText(1000, 1200).id === "updated_m",
            Usage.POLL_INTERVAL_MS === 300000,
            Usage.shouldFastRetry("error") === true,
            Shimmer.shimmerOpacity(3, 3) === 1.0,
            Shimmer.shimmerDuration(10) === 1300
        ]
        for (var i = 0; i < checks.length; i++) {
            if (!checks[i]) {
                // Exit code encodes which assertion failed: 10 + index.
                Qt.exit(10 + i)
                return
            }
        }
        Qt.exit(0)
    }
}
```

- [ ] **Step 6: Write the QML runner**

Create `tests/run-qml-tests.sh`:

```bash
#!/usr/bin/env bash
# Proves the shared ES modules load and execute in Qt's QML engine.
# Exit 0 = pass. Exit 10+N = assertion N failed. Exit 2 = a module failed to load.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

if ! command -v qml6 >/dev/null 2>&1; then
    echo "error: qml6 not found (install qt6-declarative)" >&2
    exit 127
fi

QT_QPA_PLATFORM=offscreen qml6 "$HERE/qml/shared-smoke.qml"
code=$?
if [ "$code" -eq 0 ]; then
    echo "QML shared-module smoke test passed"
else
    echo "QML shared-module smoke test FAILED (exit $code)" >&2
fi
exit "$code"
```

- [ ] **Step 7: Verify the QML smoke test passes, and that it can fail**

```bash
chmod +x tests/run-qml-tests.sh
./tests/run-qml-tests.sh; echo "EXIT=$?"
```

Expected: `QML shared-module smoke test passed`, `EXIT=0`.

Now prove it detects a broken module, so a green result means something:

```bash
cp shared/shimmer.mjs /tmp/shimmer-backup.mjs
printf '\nthis is not valid javascript ===\n' >> shared/shimmer.mjs
./tests/run-qml-tests.sh; echo "EXIT=$? (expect non-zero)"
cp /tmp/shimmer-backup.mjs shared/shimmer.mjs
./tests/run-qml-tests.sh; echo "EXIT=$? (expect 0 again)"
```

Expected: non-zero while broken, 0 after restoring.

- [ ] **Step 8: Commit**

```bash
git add shared/shimmer.mjs tests/shared/test-shimmer.mjs tests/shared/run-all.mjs \
        tests/qml/shared-smoke.qml tests/run-qml-tests.sh
git commit -m "Update: add shimmer module and a QML smoke test for the shared core

Adds the shimmer opacity curve and sweep duration as the last shared
module, and a qml6-driven smoke test that imports all four modules and
asserts through the process exit code.

The smoke test is what catches a shared module drifting into syntax
Qt's engine rejects — the failure mode a two-engine core is most
exposed to, and one the gjs suite cannot see. Verified it fails when a
module is deliberately corrupted."
```

---

### Task 7: Repository restructure

Move the plasmoid under `platforms/kde/`, teach `install.sh` to assemble a self-contained bundle, and add desktop detection. The widget must still install and run identically at the end of this task.

**Files:**
- Move: `package/` to `platforms/kde/package/`
- Modify: `install.sh`, `uninstall.sh`
- Modify: `.gitignore` (add `build/`)

**Interfaces:**
- Consumes: `shared/` from Tasks 3–6
- Produces: `install.sh [--kde|--gnome]` and `uninstall.sh [--kde|--gnome]`; a KDE bundle at `build/kde/package/` with `shared/` at `contents/shared/`.

- [ ] **Step 1: Move the package with git**

```bash
mkdir -p platforms/kde
git mv package platforms/kde/package
git status --short
```

Expected: renames only, no content changes.

- [ ] **Step 2: Ignore the build directory**

Append to `.gitignore`:

```
build/
```

- [ ] **Step 3: Rewrite install.sh**

Replace the whole file:

```bash
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
```

- [ ] **Step 4: Add the same branch to uninstall.sh**

Replace the whole file:

```bash
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
  echo "GNOME frontend is not installed by this version yet."
fi

if [ -f "$SETTINGS" ]; then
  cp "$SETTINGS" "$SETTINGS.bak.$(date +%s)"
  python3 "$HERE/scripts/apply_settings_unmerge.py" "$SETTINGS" "$BIN"
fi
echo "Left data dir in place: $DATA (remove manually if desired)."
```

- [ ] **Step 5: Verify the bundle assembles correctly**

`claude-status-sessions.py` does not exist until Task 8, so verify the assembly logic alone first:

```bash
bash -n install.sh && bash -n uninstall.sh && echo "syntax OK"
rm -rf build/kde && mkdir -p build/kde/package
cp -r platforms/kde/package/. build/kde/package/
cp -r shared build/kde/package/contents/shared
ls build/kde/package/contents/
ls build/kde/package/contents/shared/
```

Expected: `contents/` holds `config`, `icons`, `ui`, and `shared`; `contents/shared/` holds the four `.mjs` files.

- [ ] **Step 6: Verify the relative import path the QML files will use**

From `contents/ui/`, the shared modules sit at `../shared/`. Confirm before any QML depends on it:

```bash
cat > build/kde/package/contents/ui/path-check.qml <<'EOF'
import QtQuick
import "../shared/labels.mjs" as Labels
Item { Component.onCompleted: Qt.exit(Labels.toolLabel("Bash") === "Running" ? 0 : 9) }
EOF
QT_QPA_PLATFORM=offscreen qml6 build/kde/package/contents/ui/path-check.qml
echo "EXIT=$? (expect 0)"
rm build/kde/package/contents/ui/path-check.qml
```

Expected: `EXIT=0`.

- [ ] **Step 7: Confirm nothing else broke**

```bash
python3 -m pytest -q && ./tests/run-shared-tests.sh && ./tests/run-qml-tests.sh
```

Expected: `52 passed`, shared assertions pass, QML smoke passes.

- [ ] **Step 8: Commit**

```bash
git add -A install.sh uninstall.sh .gitignore platforms/
git commit -m "Update: move the plasmoid under platforms/kde and assemble bundles

Restructures for a second frontend: the plasmoid moves to
platforms/kde/package, and install.sh grows desktop detection with
--kde/--gnome overrides. An undetected desktop is a hard error naming
both flags rather than a silent no-op.

Plasmoid packages must be self-contained, so the installer now
assembles build/kde/package from the platform directory plus a copy of
shared/ at contents/shared, instead of installing the source tree
directly. Verified that ../shared/*.mjs resolves from contents/ui.

The GNOME branch is stubbed and exits non-zero until its plan lands.
Also drops the obsolete claude-status-aggregate.py from installed bin
directories on upgrade."
```

---

### Task 8: `claude-status-sessions.py`

Replace the Python aggregator with a script that only reads the session directory and prints the raw documents. All logic now lives in `shared/aggregate.mjs`.

**Files:**
- Create: `scripts/claude-status-sessions.py`
- Create: `tests/test_sessions.py`
- Delete: `scripts/claude-status-aggregate.py`, `tests/test_aggregate.py`

**Interfaces:**
- Consumes: `statusbar_paths` (`sessions_dir()`)
- Produces: a CLI printing a JSON **array** of session documents on stdout — note the shape change from the aggregator's JSON **object**. `main.qml` consumes this in Task 9.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_sessions.py`:

```python
import json, os, subprocess, sys

SESSIONS = os.path.join(os.path.dirname(__file__), "..", "scripts",
                        "claude-status-sessions.py")


def _run(data_home):
    env = dict(os.environ)
    env["XDG_DATA_HOME"] = str(data_home)
    r = subprocess.run([sys.executable, SESSIONS],
                       capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def d(sid, state, started=None, updated=1000, tool=None):
    return {"session_id": sid, "state": state, "tool": tool,
            "started_at": started, "updated_at": updated, "cwd": "/w/" + sid}


def test_empty_dir_prints_empty_array(data_home):
    assert _run(data_home) == []


def test_reads_all_session_files(data_home):
    import statusbar_paths as p
    p.atomic_write_json(p.session_file("s1"), d("s1", "waiting"))
    p.atomic_write_json(p.session_file("s2"), d("s2", "thinking", started=5))
    out = _run(data_home)
    assert sorted(x["session_id"] for x in out) == ["s1", "s2"]


def test_documents_are_passed_through_unmodified(data_home):
    import statusbar_paths as p
    doc = d("s1", "thinking", started=1000.98, updated=1234, tool=None)
    p.atomic_write_json(p.session_file("s1"), doc)
    out = _run(data_home)
    assert out == [doc], "the script must not transform documents"


def test_float_started_at_precision_is_preserved(data_home):
    import statusbar_paths as p
    p.atomic_write_json(p.session_file("s1"), d("s1", "thinking", started=1000.98))
    assert _run(data_home)[0]["started_at"] == 1000.98


def test_malformed_file_is_skipped_not_fatal(data_home):
    import statusbar_paths as p
    p.atomic_write_json(p.session_file("good"), d("good", "waiting"))
    with open(p.session_file("bad"), "w") as fh:
        fh.write("{not json")
    out = _run(data_home)
    assert [x["session_id"] for x in out] == ["good"]


def test_missing_sessions_dir_prints_empty_array(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "nonexistent"))
    env = dict(os.environ)
    env["XDG_DATA_HOME"] = str(tmp_path / "nonexistent")
    r = subprocess.run([sys.executable, SESSIONS],
                       capture_output=True, text=True, env=env)
    assert r.returncode == 0
    assert json.loads(r.stdout) == []
```

- [ ] **Step 2: Run to verify the tests fail**

```bash
python3 -m pytest tests/test_sessions.py -q
```

Expected: FAIL — the script does not exist.

- [ ] **Step 3: Write the script**

Create `scripts/claude-status-sessions.py`:

```python
#!/usr/bin/env python3
"""Print every per-session status file as a JSON array on stdout.

Deliberately logic-free. Merging, staleness, and state precedence live in
shared/aggregate.mjs so the Plasma widget and the GNOME extension apply
identical rules; this script exists only because QML cannot list a directory.
Documents are passed through untouched — in particular started_at keeps its
sub-second precision.
"""
import glob, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def load_docs():
    import statusbar_paths as p
    docs = []
    for f in sorted(glob.glob(os.path.join(p.sessions_dir(), "*.json"))):
        try:
            with open(f) as fh:
                docs.append(json.load(fh))
        except (OSError, ValueError):
            continue  # a half-written or corrupt file must not break the widget
    return docs


if __name__ == "__main__":
    print(json.dumps(load_docs()))
```

- [ ] **Step 4: Run to verify the tests pass**

```bash
chmod +x scripts/claude-status-sessions.py
python3 -m pytest tests/test_sessions.py -q
```

Expected: `6 passed`.

- [ ] **Step 5: Remove the aggregator and its tests**

Its logic and every one of its test cases now live in `shared/aggregate.mjs` and `tests/shared/test-aggregate.mjs`, verified passing in Task 3.

```bash
git rm scripts/claude-status-aggregate.py tests/test_aggregate.py
python3 -m pytest -q
```

Expected: `50 passed` (52 baseline − 8 aggregate tests + 6 new session tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/claude-status-sessions.py tests/test_sessions.py
git commit -m "Update: replace the Python aggregator with a logic-free reader

claude-status-sessions.py reads the session directory and prints the
raw documents as a JSON array, nothing more. Merging, staleness, and
state precedence moved to shared/aggregate.mjs in an earlier commit, so
both frontends apply the same rules rather than one of them shelling
out to a second implementation.

Note the output shape changed from a JSON object to a JSON array;
main.qml is cut over in the next commit. Documents pass through
untouched, so started_at keeps the sub-second precision the hook
writes. Removes claude-status-aggregate.py and test_aggregate.py, whose
cases are all covered by the shared suite."
```

---

### Task 9: Cut `main.qml` over to the shared aggregate

**Files:**
- Modify: `platforms/kde/package/contents/ui/main.qml`

**Interfaces:**
- Consumes: `aggregate(docs, now)` from `shared/aggregate.mjs`; `claude-status-sessions.py` from Task 8
- Produces: `root.agg` with the same shape the views already bind to — no change for `CompactView` or `FullView`.

- [ ] **Step 1: Add the import and swap the command**

In `platforms/kde/package/contents/ui/main.qml`, add after the existing imports:

```qml
import "../shared/aggregate.mjs" as Aggregate
```

Change the command property:

```qml
    readonly property string aggCmd: "python3 " + binDir + "/claude-status-sessions.py"
```

- [ ] **Step 2: Apply the shared aggregate to the raw documents**

Replace the `aggSrc` `onNewData` handler:

```qml
        onNewData: (source, data) => {
            disconnectSource(source)  // allow the same command to re-run next tick
            try {
                // The script prints raw session documents; the merge rules live
                // in the shared core so GNOME applies exactly the same ones.
                var docs = JSON.parse((data["stdout"] || "").trim())
                root.agg = Aggregate.aggregate(docs, Date.now() / 1000)
            }
            catch (e) { /* keep previous value */ }
        }
```

`Date.now() / 1000` is deliberately not floored: `aggregate` compares `updated_at` against a 900s threshold, and passing the fractional value keeps the comparison honest.

- [ ] **Step 3: Verify the QML still parses**

```bash
QT_QPA_PLATFORM=offscreen qml6 --quit platforms/kde/package/contents/ui/main.qml 2>&1 | head -5
```

Expected: complaints about the missing Plasma applet context are fine; a **syntax or import** error is not. Confirm no line mentions `aggregate.mjs`.

- [ ] **Step 4: Install and verify end to end on the live desktop**

```bash
./install.sh --kde
kquitapp6 plasmashell && kstart plasmashell
```

Then, with the widget on a panel, start a Claude Code session in a terminal and confirm:

- the glyph and tool label change as the session works
- the elapsed timer counts up smoothly, one second per second, with no stalls
- the popup lists the session
- usage percentages still render

- [ ] **Step 5: Verify the elapsed counter no longer reads high**

This is the behaviour the Task 3 precision fix targets. With a session running, compare the widget's elapsed value against a stopwatch started at the same prompt submission. It should agree within one second and must not run ahead.

```bash
cat ~/.local/share/claude-status-bar/sessions/*.json | python3 -m json.tool | grep started_at
```

Expected: a float with a fractional part, now reaching the widget intact.

- [ ] **Step 6: Commit**

```bash
git add platforms/kde/package/contents/ui/main.qml
git commit -m "Update: apply the shared aggregate in main.qml

The widget now spawns claude-status-sessions.py for raw session
documents and merges them with shared/aggregate.mjs, rather than
shelling out to a Python implementation of the same rules. The agg
shape the views bind to is unchanged.

Because the shared aggregate preserves float started_at, the elapsed
counter no longer inherits the up-to-one-second truncation bias the
Python helper introduced. Verified against a running session."
```

---

### Task 10: Cut the QML views over to the shared modules

Remove the duplicated helper functions from all four view files.

**Files:**
- Modify: `platforms/kde/package/contents/ui/CompactView.qml`
- Modify: `platforms/kde/package/contents/ui/FullView.qml`
- Modify: `platforms/kde/package/contents/ui/UsageBars.qml`
- Modify: `platforms/kde/package/contents/ui/UsageAccount.qml`

**Interfaces:**
- Consumes: `shared/labels.mjs`, `shared/usage.mjs`, `shared/shimmer.mjs`
- Produces: no interface change; the views render exactly as before.

- [ ] **Step 1: Cut CompactView over**

In `CompactView.qml`, add the imports:

```qml
import "../shared/labels.mjs" as Labels
import "../shared/usage.mjs" as Usage
import "../shared/shimmer.mjs" as Shimmer
```

Delete the local `toolLabel`, `clawdAnim`, `thinkingWords`, `pickThinkingWord`, `fmt`, `usagePct`, `usagePctText`, and `usageDotColor` definitions, and replace their call sites:

- `thinkingWord` initialiser becomes `Labels.THINKING_WORDS[0]`
- `pickThinkingWord()` calls become `Labels.pickThinkingWord(thinkingWord, Math.random)`
- `toolLabel(agg.tool)` becomes `Labels.toolLabel(agg.tool)`
- `clawdAnim(agg.state, agg.tool)` becomes `Labels.clawdAnim(agg.state, agg.tool)`
- `fmt(compact.elapsed)` becomes `Labels.fmt(compact.elapsed)`
- `usagePctText(usage.five_hour)` becomes `Usage.usagePctText(usage.five_hour)`, and likewise `seven_day`
- `usageDotColor(...)` becomes `Usage.usageDotColor(...)`
- the shimmer `opacity` expression becomes `Shimmer.shimmerOpacity(index, animText.head)`
- the shimmer `NumberAnimation` duration becomes `Shimmer.shimmerDuration(animText.n)`

Keep the `elapsed` Timer exactly as it is — the 250ms sampling and floored difference are load-bearing and stay in the view.

- [ ] **Step 2: Cut the popup views over**

In `FullView.qml`, add `import "../shared/labels.mjs" as Labels` and `import "../shared/usage.mjs" as Usage`. Delete the local `toolLabel` and `updatedText`, then:

- `fullRoot.toolLabel(modelData.tool)` becomes `Labels.toolLabelShort(modelData.tool)` — the popup's narrower mapping, unchanged from today
- add a message-id renderer, so `i18n()` still sees literal strings for extraction:

```qml
    // Shared helpers return {id, args}; each frontend owns its own wording.
    function msg(m) {
        if (!m) return ""
        switch (m.id) {
        case "updated_now": return i18n("updated just now")
        case "updated_m":   return i18n("updated %1m ago", m.args[0])
        case "updated_h":   return i18n("updated %1h ago", m.args[0])
        }
        return ""
    }
```

- `fullRoot.updatedText(fullRoot.usage.fetched_at)` becomes `fullRoot.msg(Usage.updatedText(fullRoot.usage.fetched_at, fullRoot.nowSec))`

In `UsageBars.qml`, add `import "../shared/usage.mjs" as Usage`, delete the local `pct` and `resetText`, replace `pct(...)` with `Usage.usagePct(...)`, and add the reset renderer:

```qml
    function msg(m) {
        if (!m) return ""
        switch (m.id) {
        case "resetting":    return i18n("resetting…")
        case "resets_in_dh": return i18n("resets in %1d %2h", m.args[0], m.args[1])
        case "resets_in_hm": return i18n("resets in %1h %2m", m.args[0], m.args[1])
        case "resets_in_m":  return i18n("resets in %1m", m.args[0])
        }
        return ""
    }
```

with the label becoming `text: bars.msg(Usage.resetText(modelData.w, bars.nowSec))`.

In `UsageAccount.qml`, add `import "../shared/labels.mjs" as Labels` and `import "../shared/usage.mjs" as Usage`, delete the local `displayName` and `updatedText`, replace `acct.displayName()` with `Labels.displayName(acct.account)`, and add the same `msg` renderer as `FullView` with `acct.updatedText(acct.account.polled_at)` becoming `acct.msg(Usage.updatedText(acct.account.polled_at, acct.nowSec))`.

- [ ] **Step 3: Confirm no duplicated logic remains**

```bash
grep -nE "function (toolLabel|clawdAnim|pickThinkingWord|fmt|usagePct|usageDotColor|resetText|updatedText|displayName)" \
     platforms/kde/package/contents/ui/*.qml
```

Expected: no matches. Only the `msg` renderers and view-specific helpers remain.

- [ ] **Step 4: Verify every QML file still parses**

```bash
./tests/run-qml-tests.sh
for f in platforms/kde/package/contents/ui/*.qml; do
  QT_QPA_PLATFORM=offscreen qml6 --quit "$f" 2>&1 | grep -iE "syntax|is not a type|cannot load|\.mjs" && echo "PROBLEM in $f"
done
echo "parse sweep done"
```

Expected: no `PROBLEM` lines.

- [ ] **Step 5: Verify on the live desktop**

```bash
./install.sh --kde
kquitapp6 plasmashell && kstart plasmashell
```

With a Claude session running, confirm against the screenshots in `docs/screenshots/`:

- panel: Clawd animates, the tool label shimmers right-to-left, the elapsed timer counts, `5h N% · 7d N%` renders with correct dot colours
- popup: session rows read `state · Edit` (the raw tool name, as before), usage bars fill correctly, reset countdowns read "resets in 2h 5m", freshness reads "updated just now", and per-account switch buttons appear

- [ ] **Step 6: Commit**

```bash
git add platforms/kde/package/contents/ui/
git commit -m "Update: cut the QML views over to the shared modules

CompactView, FullView, UsageBars, and UsageAccount now import the
shared core instead of carrying their own copies of tool labels,
animation selection, thinking words, elapsed formatting, usage
thresholds, and the shimmer curve.

Relative-time helpers return {id, args}, so each view keeps a small msg
renderer mapping ids to i18n() calls with literal strings — extraction
still works, and GNOME can supply its own wording without sharing a
catalogue. The popup keeps its narrower tool mapping via
toolLabelShort, so session rows read exactly as they did before."
```

---

### Task 11: Generate the Clawd sprite sheets

**Files:**
- Create: `scripts/build-clawd-sprites.py`
- Create: `shared/clawd/*.png`, `shared/clawd/frames.json`, `shared/clawd/LICENSE.clawd-tank`

**Interfaces:**
- Consumes: `platforms/kde/package/contents/icons/clawd/*.webp` (source art)
- Produces: one horizontal sprite sheet per animation at `shared/clawd/<name>.png`, plus `shared/clawd/frames.json` mapping each name to `{frames, width, height, interval_ms}`. Consumed by Task 12 and by the GNOME plan.

- [ ] **Step 1: Write the build script**

Create `scripts/build-clawd-sprites.py`:

```python
#!/usr/bin/env python3
"""Convert the animated Clawd WebPs into horizontal PNG sprite sheets.

Maintainer tool — NOT installed, and the only script allowed to need Pillow.
Its output is committed, so installing needs no image libraries.

GNOME cannot decode animated WebP without the non-default webp-pixbuf-loader
package, and the source files carry no per-frame duration metadata (QML's
AnimatedImage has been falling back to its own default). Sheets fix both: one
asset format both toolkits read, and an explicit, identical frame rate.

Usage: python3 scripts/build-clawd-sprites.py
"""
import json, os, sys

try:
    from PIL import Image
except ImportError:
    sys.exit("error: Pillow is required (pip install --user Pillow)")

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "platforms", "kde", "package", "contents", "icons", "clawd")
OUT = os.path.join(HERE, "..", "shared", "clawd")

# The source art has no frame durations. 12fps matches the original clawd-tank
# SVG animations and reads correctly at panel size; change here to retune both
# frontends at once.
INTERVAL_MS = 83


def build(name, path):
    im = Image.open(path)
    n = getattr(im, "n_frames", 1)
    w, h = im.size
    sheet = Image.new("RGBA", (w * n, h), (0, 0, 0, 0))
    for i in range(n):
        im.seek(i)
        sheet.paste(im.convert("RGBA"), (i * w, 0))
    sheet.save(os.path.join(OUT, name + ".png"), optimize=True)
    return {"frames": n, "width": w, "height": h, "interval_ms": INTERVAL_MS}


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for f in sorted(os.listdir(SRC)):
        if not f.endswith(".webp"):
            continue
        name = f[:-len(".webp")]
        meta[name] = build(name, os.path.join(SRC, f))
        print(f"{name}: {meta[name]['frames']} frames "
              f"{meta[name]['width']}x{meta[name]['height']}")
    with open(os.path.join(OUT, "frames.json"), "w") as fh:
        json.dump(meta, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print(f"wrote {len(meta)} sheets + frames.json to {OUT}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Generate the sheets**

```bash
python3 scripts/build-clawd-sprites.py
```

Expected: seven lines reporting 12–14 frames at 128x128, then a summary.

- [ ] **Step 3: Verify the output**

```bash
ls -la shared/clawd/
cat shared/clawd/frames.json
python3 -c "
from PIL import Image
import json, os
meta = json.load(open('shared/clawd/frames.json'))
for name, m in sorted(meta.items()):
    im = Image.open(f'shared/clawd/{name}.png')
    assert im.size == (m['width'] * m['frames'], m['height']), name
    print(f\"{name}: sheet {im.size} = {m['frames']} x {m['width']}x{m['height']} OK\")
print('all sheets match frames.json')
"
```

Expected: every sheet's width equals `frames × width`, and the height matches.

- [ ] **Step 4: Carry the attribution across**

```bash
cp platforms/kde/package/contents/icons/clawd/LICENSE.clawd-tank shared/clawd/
```

The sheets are a derived work of clawd-tank, so the MIT licence travels with them.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-clawd-sprites.py shared/clawd/
git commit -m "Update: generate Clawd sprite sheets for both frontends

Adds a maintainer-only Pillow script converting the seven animated
WebPs into horizontal PNG sprite sheets, plus a frames.json recording
frame count, dimensions, and playback interval. The generated sheets
are committed so installing needs no image libraries.

GNOME cannot decode animated WebP without the non-default
webp-pixbuf-loader package, and the source files carry no per-frame
duration metadata, so QML has been picking its own rate. Sheets give
both toolkits one readable format and one explicit frame rate. The
clawd-tank MIT licence travels with the derived art."
```

---

### Task 12: Switch the KDE widget to sprite playback

The last KDE change. `AnimatedSprite` consumes the shared sheets, so both frontends animate from identical assets at an identical rate.

**Files:**
- Modify: `platforms/kde/package/contents/ui/CompactView.qml`
- Modify: `platforms/kde/package/metadata.json`
- Delete: `platforms/kde/package/contents/icons/clawd/` (source art moves to `assets/`)
- Create: `assets/clawd-src/` (the source WebPs, kept for regeneration)

**Interfaces:**
- Consumes: `shared/clawd/frames.json` and the sheets from Task 11
- Produces: the finished KDE frontend on the shared core.

- [ ] **Step 1: Preserve the source art outside the shipped package**

The WebPs are no longer installed, but `build-clawd-sprites.py` still needs them.

```bash
mkdir -p assets/clawd-src
git mv platforms/kde/package/contents/icons/clawd/*.webp assets/clawd-src/
git mv platforms/kde/package/contents/icons/clawd/LICENSE.clawd-tank assets/clawd-src/
rmdir platforms/kde/package/contents/icons/clawd platforms/kde/package/contents/icons
```

Update the `SRC` path in `scripts/build-clawd-sprites.py`:

```python
SRC = os.path.join(HERE, "..", "assets", "clawd-src")
```

Verify regeneration still works and produces identical output:

```bash
python3 scripts/build-clawd-sprites.py && git status --short shared/clawd/
```

Expected: the script succeeds and reports no changes to `shared/clawd/` — byte-identical regeneration.

- [ ] **Step 2: Load the sheet metadata in CompactView**

In `CompactView.qml`, add to the imports:

```qml
import "../shared/labels.mjs" as Labels
```

(already present from Task 10) and add a property that reads `frames.json` once:

```qml
    // Sprite sheet metadata, loaded once. Frame counts differ per animation, so
    // AnimatedSprite needs the right frameCount for whichever sheet is showing.
    property var clawdMeta: ({})
    Component.onCompleted: {
        var xhr = new XMLHttpRequest()
        xhr.open("GET", Qt.resolvedUrl("../shared/clawd/frames.json"), false)
        xhr.send()
        if (xhr.status === 200 || xhr.status === 0)
            compact.clawdMeta = JSON.parse(xhr.responseText)
    }
    readonly property string clawdName: Labels.clawdAnim(agg.state, agg.tool)
    readonly property var clawdInfo:
        clawdMeta[clawdName] || ({ frames: 1, width: 128, height: 128, interval_ms: 83 })
```

The synchronous read is deliberate: it happens once at construction, the file is a few hundred bytes and local, and an async load would leave the sprite unsized on first paint.

- [ ] **Step 3: Replace AnimatedImage with AnimatedSprite**

Replace the `AnimatedImage { id: clawd ... }` block, keeping the waiting-dot child exactly as it is:

```qml
        AnimatedSprite {
            id: clawd
            Layout.alignment: Qt.AlignVCenter
            // Square, sized to panel thickness (compact.height is set by the
            // panel, so this does not feed back into the row's implicit width).
            Layout.preferredHeight: Math.max(16, compact.height)
            Layout.preferredWidth: Layout.preferredHeight
            width: Layout.preferredWidth
            height: Layout.preferredHeight
            smooth: true
            running: true
            loops: AnimatedSprite.Infinite
            // Animated Clawd chosen by activity state / current tool, played
            // from the shared sprite sheets so GNOME renders the same frames.
            source: Qt.resolvedUrl("../shared/clawd/" + compact.clawdName + ".png")
            frameCount: compact.clawdInfo.frames
            frameWidth: compact.clawdInfo.width
            frameHeight: compact.clawdInfo.height
            frameDuration: compact.clawdInfo.interval_ms

            // Yellow "awaiting permission" dot on top of the notification anim.
            Rectangle {
                visible: agg.state === "waiting"
                width: Math.round(parent.height * 0.3)
                height: width
                radius: width / 2
                color: "#f5c451"
                border.color: "#40000000"
                border.width: 1
                anchors.right: parent.right
                anchors.bottom: parent.bottom
            }
        }
```

- [ ] **Step 4: Bump the version**

In `platforms/kde/package/metadata.json`, change `"Version": "0.1.2"` to `"Version": "0.2.0"`.

- [ ] **Step 5: Install and verify the animation visually**

```bash
./install.sh --kde
kquitapp6 plasmashell && kstart plasmashell
```

With a Claude session running, confirm each state animates smoothly and at a natural speed — not obviously faster or slower than before. Compare against `docs/screenshots/working.png`. Check every animation by exercising the states: idle, thinking, Edit (typing), Bash (building), Grep (debugger), Read (carrying), and a permission prompt (notification, with the yellow dot).

If the speed looks wrong, retune `INTERVAL_MS` in `scripts/build-clawd-sprites.py`, re-run it, and reinstall. Both frontends inherit the change.

- [ ] **Step 6: Run the full suite**

```bash
python3 -m pytest -q && ./tests/run-shared-tests.sh && ./tests/run-qml-tests.sh
```

Expected: `50 passed`, shared assertions pass, QML smoke passes.

- [ ] **Step 7: Commit**

```bash
git add -A platforms/kde/ assets/ scripts/build-clawd-sprites.py
git commit -m "Update: play Clawd from the shared sprite sheets on KDE

CompactView switches from AnimatedImage on animated WebP to
AnimatedSprite on the shared PNG sheets, so both frontends animate from
identical assets at an identical, explicit frame rate rather than
whichever default each toolkit picks.

Frame counts differ per animation, so the view reads frames.json once
at construction to size each sheet. The source WebPs move to
assets/clawd-src, out of the shipped package but still available for
regeneration; verified the sheets rebuild byte-identically from the new
location. Bumps the plasmoid to 0.2.0."
```

---

## Self-Review

**Spec coverage.** Every spec section for this phase maps to a task: repo layout (7), shared module inventory (3–6), KDE changes 1–4 (8, 9, 10, 12), asset pipeline (11), install/uninstall assembly (7), testing (2, 6, and verification steps throughout), the GJS unknown (1). Spec sections deferred to the companion plan: the GNOME extension, its packaging, README/CONTRIBUTING rewrites, and the version lockstep — all listed in `2026-08-06-gnome-shell-frontend.md`.

**Placeholders.** None. Every step carries runnable commands or complete code.

**Type consistency.** `aggregate(docs, now)` returns the same keys `main.qml` assigns to `root.agg` and the views bind to. `toolLabel`/`toolLabelShort` are used consistently — panel and popup respectively — in Tasks 4, 10, and 12. `resetText`/`updatedText` return `{id, args}` in Task 5 and every consumer in Task 10 routes through a `msg()` renderer. `frames.json` keys (`frames`, `width`, `height`, `interval_ms`) are written in Task 11 and read under the same names in Task 12. `clawdAnim` returns bare animation names matching the sheet filenames.

**Known deviations from "no behaviour change", both intentional and documented:** the `started_at` precision fix (Task 3) and the explicit sprite frame rate (Tasks 11–12).
