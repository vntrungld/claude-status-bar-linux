import GObject from 'gi://GObject'
import St from 'gi://St'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Claude Status Bar')
        this.add_child(new St.Label({
            text: 'Claude',
            y_align: 2, // Clutter.ActorAlign.CENTER
        }))
    }
})

export default class ClaudeStatusBarExtension extends Extension {
    enable() {
        this._indicator = new Indicator()
        Main.panel.addToStatusArea(this.uuid, this._indicator)
    }

    disable() {
        // GNOME unloads extensions on screen lock, so teardown must be total.
        this._indicator?.destroy()
        this._indicator = null
    }
}
