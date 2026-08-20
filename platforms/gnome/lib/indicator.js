import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import St from 'gi://St'
import Clutter from 'gi://Clutter'

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'

import {toolLabel, fmt} from '../shared/labels.mjs'
import {usagePctText, usageDotColor} from '../shared/usage.mjs'
import {ClawdSprite} from './clawd.js'

const EMPTY_USAGE = {status: 'loading', five_hour: {}, seven_day: {}}

export const ClaudeIndicator = GObject.registerClass(
class ClaudeIndicator extends PanelMenu.Button {
    _init(extPath) {
        super._init(0.0, 'Claude Status Bar')

        this._agg = {state: 'idle', tool: null, started_at: null,
                     active_count: 0, waiting_count: 0, sessions: []}
        this._usage = EMPTY_USAGE
        this._showUsage = true
        this._elapsedId = 0

        this._box = new St.BoxLayout({style_class: 'claude-panel-box'})
        this.add_child(this._box)

        // Clawd sprite with the yellow "awaiting permission" dot overlaid on
        // its bottom-right corner, matching the plasmoid's CompactView.qml.
        this._clawdOverlay = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
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

        this._toolLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER})
        this._box.add_child(this._toolLabel)

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
            GLib.Source.remove(this._elapsedId)
            this._elapsedId = 0
        }
        this._render()
    }

    setUsage(usage) {
        this._usage = usage || EMPTY_USAGE
        this._render()
    }

    setShowUsage(show) {
        this._showUsage = show
        this._render()
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
        const showText = this._agg.state === 'thinking' || this._agg.state === 'tool'
        this._toolLabel.visible = showText
        if (showText)
            this._toolLabel.text = `${this._agg.state === 'tool' ? toolLabel(this._agg.tool) : 'Thinking'}…`

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
        if (this._elapsedId) {
            GLib.Source.remove(this._elapsedId)
            this._elapsedId = 0
        }
        this._clawd?.destroy()
        super.destroy()
    }
})
