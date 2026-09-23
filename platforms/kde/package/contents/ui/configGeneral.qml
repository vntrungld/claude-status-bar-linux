import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.kcmutils as KCM

// Plasma 6 config pages must be a KCM page: a bare layout root is never placed
// in the dialog's scene and plasmashell warns about the missing `title`.
KCM.SimpleKCM {
    id: cfgRoot
    property alias cfg_showUsageOnPanel: usageCheck.checked
    property bool cfg_showUsageOnPanelDefault: true
    property alias cfg_reduceAnimation: reduceAnimCheck.checked
    property bool cfg_reduceAnimationDefault: false

    Kirigami.FormLayout {
        QQC2.CheckBox {
            id: usageCheck
            Kirigami.FormData.label: i18n("Usage:")
            text: i18n("Show 5-hour and weekly usage % on the panel")
        }

        QQC2.CheckBox {
            id: reduceAnimCheck
            Kirigami.FormData.label: i18n("Animation:")
            text: i18n("Reduce animation (lower frame rate)")
        }
        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 22
            wrapMode: Text.WordWrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: i18n("Plays Clawd and the status shimmer at about 4 fps instead of 12 to save a little CPU.")
        }
    }
}
