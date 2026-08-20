import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import St from 'gi://St'
import Clutter from 'gi://Clutter'

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js'

import {toolLabelShort, displayName} from '../shared/labels.mjs'
import {usagePct, resetText, updatedText} from '../shared/usage.mjs'

// Shared helpers return {id, args}; each frontend owns its own wording so
// neither has to share a translation catalogue with the other.
//
// NOTE: String.prototype.format() below is defined by gnome-shell's own
// environment.js, so it is available here but NOT in prefs.js, which runs in a
// separate GTK process. Do not use .format() there — prefs.js sticks to plain
// _() calls with no substitution for exactly this reason.
function msg(m) {
    if (!m)
        return ''
    switch (m.id) {
    case 'resetting':    return _('resetting…')
    case 'resets_in_dh': return _('resets in %dd %dh').format(m.args[0], m.args[1])
    case 'resets_in_hm': return _('resets in %dh %dm').format(m.args[0], m.args[1])
    case 'resets_in_m':  return _('resets in %dm').format(m.args[0])
    case 'updated_now':  return _('updated just now')
    case 'updated_m':    return _('updated %dm ago').format(m.args[0])
    case 'updated_h':    return _('updated %dh ago').format(m.args[0])
    }
    return ''
}

function nowSec() {
    return Math.floor(GLib.get_real_time() / 1000000)
}

// A single usage window: label, filled bar, percentage, and reset countdown.
const UsageBar = GObject.registerClass(
class UsageBar extends St.BoxLayout {
    _init(label) {
        super._init({vertical: true, style_class: 'claude-usage-bar'})
        this._row = new St.BoxLayout({style_class: 'claude-usage-bar-row'})
        this.add_child(this._row)

        this._name = new St.Label({text: label, style_class: 'claude-usage-bar-name'})
        this._row.add_child(this._name)

        // St has no progress bar; a fixed-width trough with a styled fill is
        // the standard shell idiom.
        this._trough = new St.Widget({style_class: 'claude-usage-trough'})
        this._fill = new St.Widget({style_class: 'claude-usage-fill'})
        this._trough.add_child(this._fill)
        this._row.add_child(this._trough)

        this._pct = new St.Label({style_class: 'claude-usage-pct'})
        this._row.add_child(this._pct)

        this._reset = new St.Label({style_class: 'claude-usage-reset'})
        this.add_child(this._reset)
    }

    setWindow(w) {
        const v = usagePct(w)
        this.visible = v !== null
        if (v === null)
            return
        this._pct.text = `${v}%`
        // The trough is 120px wide; the fill mirrors the percentage.
        this._fill.style = `width: ${Math.round(120 * v / 100)}px;`
        const r = msg(resetText(w, nowSec()))
        this._reset.text = r
        this._reset.visible = r !== ''
    }
})

export {UsageBar}

// One managed account: name, active marker, freshness, a switch button for
// inactive accounts, and its two usage bars.
const AccountBlock = GObject.registerClass({
    Signals: {'switch-requested': {param_types: [GObject.TYPE_STRING]}},
}, class AccountBlock extends St.BoxLayout {
    _init() {
        super._init({vertical: true, style_class: 'claude-account'})

        const header = new St.BoxLayout({style_class: 'claude-account-header'})
        this.add_child(header)

        this._name = new St.Label({style_class: 'claude-account-name'})
        header.add_child(this._name)

        this._active = new St.Label({text: _('active'), style_class: 'claude-account-active'})
        header.add_child(this._active)

        this._updated = new St.Label({style_class: 'claude-account-updated'})
        header.add_child(this._updated)

        this._switch = new St.Button({
            label: _('Switch'),
            style_class: 'claude-switch-button',
            x_align: Clutter.ActorAlign.END,
        })
        this._switch.connect('clicked', () => {
            if (this._accountName)
                this.emit('switch-requested', this._accountName)
        })
        header.add_child(this._switch)

        this._five = new UsageBar(_('5-hour'))
        this._seven = new UsageBar(_('Weekly'))
        this.add_child(this._five)
        this.add_child(this._seven)

        this._noData = new St.Label({
            text: _('no usage data yet'),
            style_class: 'claude-account-nodata',
        })
        this.add_child(this._noData)
    }

    setAccount(account, busy) {
        this._accountName = account.name
        this._name.text = displayName(account)
        this._active.visible = account.active === true
        // Hidden for the already-active account; disabled while a fetch or an
        // earlier switch is still in flight.
        this._switch.visible = account.active !== true && !!account.name
        this._switch.reactive = !busy
        this._switch.opacity = busy ? 128 : 255

        const u = msg(updatedText(account.polled_at, nowSec()))
        this._updated.text = u
        this._updated.visible = u !== ''

        const hasData = account.has_data !== false
        this._five.visible = hasData
        this._seven.visible = hasData
        this._noData.visible = !hasData
        if (hasData) {
            this._five.setWindow(account.five_hour)
            this._seven.setWindow(account.seven_day)
        }
    }
})

export const PopupContent = GObject.registerClass({
    Signals: {
        'refresh-requested': {},
        'switch-requested': {param_types: [GObject.TYPE_STRING]},
    },
}, class PopupContent extends St.BoxLayout {
    _init() {
        super._init({vertical: true, style_class: 'claude-popup'})

        this._heading = new St.Label({style_class: 'claude-popup-heading'})
        this.add_child(this._heading)

        this._sessionBox = new St.BoxLayout({vertical: true})
        this.add_child(this._sessionBox)

        this._noSessions = new St.Label({
            text: _('No active sessions'),
            style_class: 'claude-popup-dim',
        })
        this.add_child(this._noSessions)

        const usageHeader = new St.BoxLayout({style_class: 'claude-popup-usage-header'})
        this.add_child(usageHeader)
        usageHeader.add_child(new St.Label({
            text: _('Usage limits'),
            style_class: 'claude-popup-heading',
        }))
        this._refresh = new St.Button({
            style_class: 'claude-refresh-button',
            child: new St.Icon({icon_name: 'view-refresh-symbolic', icon_size: 16}),
        })
        this._refresh.connect('clicked', () => this.emit('refresh-requested'))
        usageHeader.add_child(this._refresh)

        // Single-account mode (no token-slayer).
        this._five = new UsageBar(_('5-hour'))
        this._seven = new UsageBar(_('Weekly'))
        this.add_child(this._five)
        this.add_child(this._seven)

        // Multi-account mode; one block per managed account.
        this._accountBox = new St.BoxLayout({vertical: true})
        this.add_child(this._accountBox)
        this._accountBlocks = []

        this._busy = false
    }

    setAgg(agg) {
        this._heading.text = _('Claude Code — %d active').format(agg.active_count)

        this._sessionBox.destroy_all_children()
        for (const s of agg.sessions) {
            const row = new St.BoxLayout({style_class: 'claude-session-row'})
            const name = (s.cwd || '').split('/').pop() ||
                (s.session_id || '').substring(0, 8)
            row.add_child(new St.Label({text: name}))
            const detail = s.state + (s.tool ? ` · ${toolLabelShort(s.tool)}` : '') +
                (s.state === 'idle' ? '' : '…')
            row.add_child(new St.Label({
                text: detail,
                style_class: 'claude-popup-dim',
                x_align: Clutter.ActorAlign.END,
                x_expand: true,
            }))
            this._sessionBox.add_child(row)
        }
        this._noSessions.visible = agg.active_count === 0
    }

    setUsage(usage) {
        const multi = usage.multi === true
        this._five.visible = !multi
        this._seven.visible = !multi
        this._accountBox.visible = multi

        if (!multi) {
            this._five.setWindow(usage.five_hour)
            this._seven.setWindow(usage.seven_day)
            return
        }

        const accounts = usage.accounts || []
        // Reuse blocks across refreshes so switch buttons keep their identity.
        while (this._accountBlocks.length < accounts.length) {
            const block = new AccountBlock()
            block.connect('switch-requested',
                (_b, name) => this.emit('switch-requested', name))
            this._accountBlocks.push(block)
            this._accountBox.add_child(block)
        }
        for (let i = 0; i < this._accountBlocks.length; i++) {
            const block = this._accountBlocks[i]
            block.visible = i < accounts.length
            if (i < accounts.length)
                block.setAccount(accounts[i], this._busy)
        }
    }

    setFetching(busy) {
        this._busy = busy
        this._refresh.reactive = !busy
        this._refresh.opacity = busy ? 128 : 255
    }
})
