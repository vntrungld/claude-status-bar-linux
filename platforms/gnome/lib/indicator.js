import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import St from 'gi://St'
import Clutter from 'gi://Clutter'

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

import {toolLabel, fmt, THINKING_WORDS, pickThinkingWord} from '../shared/labels.mjs'
import {usagePctText, usageDotColor} from '../shared/usage.mjs'
import {ClawdSprite} from './clawd.js'
import {ShimmerLabel} from './shimmer.js'
import {PopupContent} from './popup.js'

const EMPTY_USAGE = {status: 'loading', five_hour: {}, seven_day: {}}

export const ClaudeIndicator = GObject.registerClass({
    Signals: {
        'refresh-requested': {},
        'switch-requested': {param_types: [GObject.TYPE_STRING]},
    },
}, class ClaudeIndicator extends PanelMenu.Button {
    _init(extPath) {
        super._init(0.0, 'Claude Status Bar')

        this._agg = {state: 'idle', tool: null, started_at: null,
                     active_count: 0, waiting_count: 0, sessions: []}
        this._usage = EMPTY_USAGE
        this._showUsage = true
        this._elapsedId = 0
        // See ShimmerLabel/ClawdSprite: the 'destroy' signal fires on every
        // disposal path, unlike our own destroy() override which only runs
        // when something calls .destroy() explicitly.
        this.connect('destroy', () => this._stopElapsed())

        this._box = new St.BoxLayout({style_class: 'claude-panel-box'})
        this.add_child(this._box)

        // Clawd sprite with the yellow "awaiting permission" dot overlaid on
        // its bottom-right corner, matching the plasmoid's CompactView.qml.
        this._clawdOverlay = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: false, y_expand: false,
        })
        this._clawd = new ClawdSprite(extPath, 16)
        this._clawdOverlay.add_child(this._clawd)
        this._waitingDot = new St.Widget({
            style_class: 'claude-waiting-dot',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
        })
        this._clawdOverlay.add_child(this._waitingDot)
        this._box.add_child(this._clawdOverlay)

        this._toolLabel = new ShimmerLabel()
        this._box.add_child(this._toolLabel)
        this._thinkingWord = THINKING_WORDS[0]
        this._prevState = ''

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

        this._popup = new PopupContent()
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
        })
        item.add_child(this._popup)
        this.menu.addMenuItem(item)

        this._popup.connect('refresh-requested', () => this.emit('refresh-requested'))
        this._popup.connect('switch-requested', (_p, name) => this.emit('switch-requested', name))

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
            this._stopElapsed()
        }
        this._popup.setAgg(agg)
        this._render()
    }

    _stopElapsed() {
        if (this._elapsedId) {
            GLib.Source.remove(this._elapsedId)
            this._elapsedId = 0
        }
    }

    setUsage(usage) {
        this._usage = usage || EMPTY_USAGE
        this._popup.setUsage(this._usage)
        this._render()
    }

    setShowUsage(show) {
        this._showUsage = show
        this._render()
    }

    setFetching(fetching) {
        this._popup.setFetching(fetching)
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

        this._clawd.setState(this._agg.state, this._agg.tool)
        this._waitingDot.visible = this._agg.state === 'waiting'

        this._renderElapsed()

        this._usageBox.visible = this._showUsage
        this._usageBox.opacity = this._usage.status === 'ok' ? 255 : 128
        this._fiveLabel.text = usagePctText(this._usage.five_hour)
        this._sevenLabel.text = usagePctText(this._usage.seven_day)
        this._fiveDot.style = `background-color: ${usageDotColor(this._usage.five_hour)};`
        this._sevenDot.style = `background-color: ${usageDotColor(this._usage.seven_day)};`
    }

    destroy() {
        this._stopElapsed()
        this._clawd?.destroy()
        this._toolLabel?.destroy()
        super.destroy()
    }
})
