import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'

import {SessionSource} from './lib/sessions.js'
import {ClaudeIndicator} from './lib/indicator.js'

export default class ClaudeStatusBarExtension extends Extension {
    enable() {
        this._indicator = new ClaudeIndicator(this.path)
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
