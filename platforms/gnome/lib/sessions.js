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
