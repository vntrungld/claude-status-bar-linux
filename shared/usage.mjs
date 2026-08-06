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
