import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami
import "../shared/usage.mjs" as Usage

ColumnLayout {
    id: bars
    Layout.fillWidth: true
    spacing: 4

    property var usage: ({ status: "loading", five_hour: {}, seven_day: {} })

    // Ticks so the "resets in …" countdown stays roughly current without a re-fetch.
    property int nowSec: Math.floor(Date.now() / 1000)
    Timer { interval: 30000; repeat: true; running: true; onTriggered: bars.nowSec = Math.floor(Date.now() / 1000) }

    // Shared helpers return {id, args}; each frontend owns its own wording.
    function msg(m) {
        if (!m) return ""
        switch (m.id) {
        case "resetting":    return i18n("resetting…")
        case "resets_in_dh": return i18n("resets in %1d %2h", m.args[0], m.args[1])
        case "resets_in_hm": return i18n("resets in %1h %2m", m.args[0], m.args[1])
        case "resets_in_m":  return i18n("resets in %1m", m.args[0])
        }
        return ""
    }

    PlasmaComponents.Label {
        visible: usage.status !== "ok"
        text: usage.status === "reauth" ? i18n("Sign in to Claude to see usage")
            : usage.status === "rate_limited" ? i18n("Usage rate-limited — showing last known")
            : usage.status === "error" ? i18n("Usage unavailable")
            : i18n("Loading usage…")
        opacity: 0.7
    }
    Repeater {
        model: [{ label: i18n("5-hour"), w: usage.five_hour },
                { label: i18n("Weekly"), w: usage.seven_day }]
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 0
            visible: Usage.usagePct(modelData.w) !== null
            RowLayout {
                Layout.fillWidth: true
                PlasmaComponents.Label { text: modelData.label; Layout.preferredWidth: 70 }
                PlasmaComponents.ProgressBar {
                    Layout.fillWidth: true
                    from: 0; to: 100; value: Usage.usagePct(modelData.w) || 0
                }
                PlasmaComponents.Label { text: (Usage.usagePct(modelData.w) || 0) + "%" }
            }
            PlasmaComponents.Label {
                text: bars.msg(Usage.resetText(modelData.w, bars.nowSec))
                visible: text !== ""
                opacity: 0.6
                font: Kirigami.Theme.smallFont
            }
        }
    }
}
