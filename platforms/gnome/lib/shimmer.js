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
