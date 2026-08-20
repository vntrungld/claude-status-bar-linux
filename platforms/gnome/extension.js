import GObject from 'gi://GObject'
import St from 'gi://St'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'

import {SessionSource} from './lib/sessions.js'
import {toolLabel} from './shared/labels.mjs'

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Claude Status Bar')
        this._label = new St.Label({text: 'idle', y_align: 2})
        this.add_child(this._label)
    }

    setAgg(agg) {
        this._label.text = agg.state === 'tool'
            ? toolLabel(agg.tool)
            : `${agg.state} (${agg.active_count})`
    }
})

export default class ClaudeStatusBarExtension extends Extension {
    enable() {
        this._indicator = new Indicator()
        Main.panel.addToStatusArea(this.uuid, this._indicator)
        this._sessions = new SessionSource(agg => this._indicator?.setAgg(agg))
        this._sessions.start()
    }

    disable() {
        // GNOME unloads extensions on screen lock, so teardown must be total.
        this._sessions?.stop()
        this._sessions = null
        this._indicator?.destroy()
        this._indicator = null
    }
}
