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
