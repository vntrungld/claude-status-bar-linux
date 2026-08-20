import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'

import {SessionSource} from './lib/sessions.js'
import {UsageSource} from './lib/usage.js'
import {ClaudeIndicator} from './lib/indicator.js'

export default class ClaudeStatusBarExtension extends Extension {
    enable() {
        this._indicator = new ClaudeIndicator(this.path)
        Main.panel.addToStatusArea(this.uuid, this._indicator)

        this._settings = this.getSettings()
        this._indicator.setShowUsage(this._settings.get_boolean('show-usage-on-panel'))
        this._settingsId = this._settings.connect('changed::show-usage-on-panel',
            () => this._indicator?.setShowUsage(
                this._settings.get_boolean('show-usage-on-panel')))

        this._sessions = new SessionSource(agg => this._indicator?.setAgg(agg))
        this._sessions.start()

        this._usage = new UsageSource(
            usage => this._indicator?.setUsage(usage),
            fetching => this._indicator?.setFetching(fetching))
        this._usage.start()

        this._indicator.connect('refresh-requested', () => this._usage?.refresh())
        this._indicator.connect('switch-requested', (_i, name) => this._usage?.switchAccount(name))
    }

    disable() {
        // GNOME unloads extensions on screen lock, so teardown must be total.
        this._usage?.stop()
        this._usage = null
        this._sessions?.stop()
        this._sessions = null
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId)
            this._settingsId = 0
        }
        this._settings = null
        this._indicator?.destroy()
        this._indicator = null
    }
}
