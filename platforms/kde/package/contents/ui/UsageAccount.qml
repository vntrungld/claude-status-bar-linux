import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami
import "../shared/labels.mjs" as Labels
import "../shared/usage.mjs" as Usage

// One managed account: a header (name · email, active chip, freshness, and a
// switch button for inactive accounts) above the reused UsageBars. Rendered
// per-account by FullView in token-slayer (multi-account) mode.
ColumnLayout {
    id: acct
    property var account: ({})
    // True while a usage fetch/switch is in flight; disables the switch button
    // so a second switch can't be fired before the first result lands.
    property bool busy: false

    // Ask FullView (→ applet root) to make this account active.
    signal switchRequested(string target)

    Layout.fillWidth: true
    spacing: 2

    // Per-account "updated Xm ago" from polled_at (epoch seconds).
    property int nowSec: Math.floor(Date.now() / 1000)
    Timer { interval: 30000; repeat: true; running: true
            onTriggered: acct.nowSec = Math.floor(Date.now() / 1000) }

    // Shared helpers return {id, args}; each frontend owns its own wording.
    function msg(m) {
        if (!m) return ""
        switch (m.id) {
        case "updated_now": return i18n("updated just now")
        case "updated_m":   return i18n("updated %1m ago", m.args[0])
        case "updated_h":   return i18n("updated %1h ago", m.args[0])
        }
        return ""
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing
        PlasmaComponents.Label { text: Labels.displayName(acct.account); font.bold: true }
        PlasmaComponents.Label {
            // Only show the full email when a distinct alias is already shown.
            visible: !!acct.account.alias && !!acct.account.email
            text: "· " + (acct.account.email || "")
            opacity: 0.6
            elide: Text.ElideRight
            Layout.fillWidth: true
        }
        Item { Layout.fillWidth: true; visible: !(!!acct.account.alias && !!acct.account.email) }
        PlasmaComponents.Label {
            visible: acct.account.active === true
            text: i18n("active")
            color: Kirigami.Theme.highlightColor
            font: Kirigami.Theme.smallFont
        }
        PlasmaComponents.Label {
            text: acct.msg(Usage.updatedText(acct.account.polled_at, acct.nowSec))
            visible: text !== ""
            opacity: 0.6
            font: Kirigami.Theme.smallFont
        }
        // Switch to this account (hidden for the already-active one).
        PlasmaComponents.ToolButton {
            visible: acct.account.active !== true && !!acct.account.name
            enabled: !acct.busy
            icon.name: "system-switch-user"
            text: i18n("Switch")
            display: QQC2.AbstractButton.TextBesideIcon
            font: Kirigami.Theme.smallFont
            onClicked: acct.switchRequested(acct.account.name)
            QQC2.ToolTip.visible: hovered
            QQC2.ToolTip.text: i18n("Switch to %1", Labels.displayName(acct.account))
        }
    }

    UsageBars {
        Layout.fillWidth: true
        visible: acct.account.has_data !== false
        usage: acct.account
    }
    PlasmaComponents.Label {
        visible: acct.account.has_data === false
        text: i18n("no usage data yet")
        opacity: 0.6
        font: Kirigami.Theme.smallFont
    }
}
