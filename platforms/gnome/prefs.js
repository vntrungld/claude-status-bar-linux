import Adw from 'gi://Adw'
import Gio from 'gi://Gio'
import Gtk from 'gi://Gtk'

import {ExtensionPreferences, gettext as _}
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

export default class ClaudeStatusBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings()

        const page = new Adw.PreferencesPage()
        const group = new Adw.PreferencesGroup({title: _('Panel')})
        page.add(group)

        const row = new Adw.SwitchRow({
            title: _('Show usage percentages'),
            subtitle: _('Show 5-hour and weekly usage % in the top bar. ' +
                        'The popup always shows usage.'),
        })
        group.add(row)
        settings.bind('show-usage-on-panel', row, 'active',
                      Gio.SettingsBindFlags.DEFAULT)

        window.add(page)
    }
}
