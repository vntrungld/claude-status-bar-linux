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
