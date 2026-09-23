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

    Kirigami.FormLayout {
        QQC2.CheckBox {
            id: usageCheck
            Kirigami.FormData.label: i18n("Usage:")
            text: i18n("Show 5-hour and weekly usage % on the panel")
        }
    }
}
