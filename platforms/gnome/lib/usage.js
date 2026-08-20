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
                    // A cancellation means stop() tore this fetch down on
                    // purpose (disable, or a fresh refresh/switchAccount
                    // superseding it) -- not a failure, so it stays silent.
                    // Everything else keeps the previous value, exactly as
                    // the plasmoid does, but is worth logging.
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
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
