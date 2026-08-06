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
eq(out.sessions.length, 0, 'stale non-idle session is not rendered')

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
