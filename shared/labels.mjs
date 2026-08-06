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
