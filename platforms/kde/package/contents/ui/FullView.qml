import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami
import "../shared/labels.mjs" as Labels
import "../shared/usage.mjs" as Usage

// Root is an Item with explicit preferred size — Plasma sizes the popup from
// these hints. A bare Layout root without preferredWidth/Height collapses the
// popup to nothing.
Item {
    id: fullRoot

    Layout.minimumWidth: Kirigami.Units.gridUnit * 14
    Layout.minimumHeight: Kirigami.Units.gridUnit * 11
    Layout.preferredWidth: Kirigami.Units.gridUnit * 18
    Layout.preferredHeight: Kirigami.Units.gridUnit * 15

    // Passed in from main.qml (Task 5/6); child files can't reach the applet root
    property var agg: ({ active_count: 0, sessions: [] })
    property var usage: ({ status: "loading", five_hour: {}, seven_day: {} })
    property bool usageFetching: false

    // Ask the applet root to re-fetch usage now (wired in main.qml).
    signal refreshRequested()

    // Ask the applet root to switch the active account to `target` (an account
    // name/email); the root runs token-slayer and refreshes usage.
    signal switchRequested(string target)

    // "last updated" hint; nowSec ticks so it stays roughly current.
    property int nowSec: Math.floor(Date.now() / 1000)
    Timer { interval: 30000; repeat: true; running: true; onTriggered: fullRoot.nowSec = Math.floor(Date.now() / 1000) }

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

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Kirigami.Units.smallSpacing
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents.Label {
            text: i18n("Claude Code — %1 active", fullRoot.agg.active_count)
            font.bold: true
        }

        Repeater {
            model: fullRoot.agg.sessions
            RowLayout {
                Layout.fillWidth: true
                PlasmaComponents.Label {
                    text: (modelData.cwd || "").split("/").pop() || (modelData.session_id || "").substring(0, 8)
                }
                Item { Layout.fillWidth: true }
                PlasmaComponents.Label {
                    text: modelData.state + (modelData.tool ? " · " + Labels.toolLabelShort(modelData.tool) : "")
                          + (modelData.state === "idle" ? "" : "…")
                    opacity: 0.8
                }
            }
        }

        PlasmaComponents.Label {
            visible: fullRoot.agg.active_count === 0
            text: i18n("No active sessions")
            opacity: 0.6
        }

        // Push usage to the bottom in single-account mode; in multi-account
        // (token-slayer) mode the account list takes the space (and scrolls).
        Item { Layout.fillHeight: fullRoot.usage.multi !== true }

        Kirigami.Separator { Layout.fillWidth: true }
        RowLayout {
            Layout.fillWidth: true
            spacing: Kirigami.Units.smallSpacing
            PlasmaComponents.Label { text: i18n("Usage limits"); font.bold: true }
            PlasmaComponents.Label {
                text: fullRoot.msg(Usage.updatedText(fullRoot.usage.fetched_at, fullRoot.nowSec))
                visible: text !== "" && fullRoot.usage.multi !== true
                opacity: 0.6
                font: Kirigami.Theme.smallFont
            }
            Item { Layout.fillWidth: true }
            // Refresh button, swapped for a spinner while a fetch is in flight.
            Item {
                Layout.preferredWidth: Kirigami.Units.iconSizes.smallMedium
                Layout.preferredHeight: Kirigami.Units.iconSizes.smallMedium
                PlasmaComponents.ToolButton {
                    anchors.fill: parent
                    visible: !fullRoot.usageFetching
                    icon.name: "view-refresh"
                    display: QQC2.AbstractButton.IconOnly
                    text: i18n("Refresh usage now")
                    onClicked: fullRoot.refreshRequested()
                    QQC2.ToolTip.visible: hovered
                    QQC2.ToolTip.text: text
                }
                PlasmaComponents.BusyIndicator {
                    anchors.fill: parent
                    visible: fullRoot.usageFetching
                    running: visible
                }
            }
        }
        // Single-account (no token-slayer): unchanged.
        UsageBars {
            visible: fullRoot.usage.multi !== true
            usage: fullRoot.usage
            Layout.fillWidth: true
        }
        // Multi-account (token-slayer): one block per managed account, each with
        // a switch button; scrolls if tall.
        QQC2.ScrollView {
            id: acctScroll
            visible: fullRoot.usage.multi === true
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            ColumnLayout {
                width: acctScroll.availableWidth
                spacing: Kirigami.Units.largeSpacing
                Repeater {
                    model: fullRoot.usage.accounts || []
                    UsageAccount {
                        account: modelData
                        busy: fullRoot.usageFetching
                        Layout.fillWidth: true
                        onSwitchRequested: (target) => fullRoot.switchRequested(target)
                    }
                }
            }
        }
    }
}
