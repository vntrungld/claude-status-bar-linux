import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.plasmoid
import "../shared/labels.mjs" as Labels
import "../shared/usage.mjs" as Usage
import "../shared/shimmer.mjs" as Shimmer

MouseArea {
    id: compact
    Layout.minimumWidth: row.implicitWidth
    // The click is wired from main.qml (onClicked: root.expanded = ...), where
    // the PlasmoidItem is in scope. In Plasma 6 `expanded` lives on the
    // PlasmoidItem, not on the `plasmoid` context property.

    property var agg: ({ state: "idle", tool: null, started_at: null, active_count: 0, waiting_count: 0, sessions: [] })
    property var usage: ({ status: "loading", five_hour: {}, seven_day: {} })

    // Playful "thinking" verbs. A fresh word is chosen each time a session
    // enters the thinking state and held for that phase, avoiding an
    // immediate repeat — Claude-Code-CLI style.
    property string thinkingWord: Labels.THINKING_WORDS[0]
    property string prevState: ""
    onAggChanged: {
        var s = agg.state
        if (s === "thinking" && prevState !== "thinking")
            thinkingWord = Labels.pickThinkingWord(thinkingWord, Math.random)
        prevState = s
    }

    // Sprite sheet metadata, loaded once. Frame counts differ per animation, so
    // AnimatedSprite needs the right frameCount for whichever sheet is showing.
    property var clawdMeta: ({})
    Component.onCompleted: {
        var xhr = new XMLHttpRequest()
        xhr.open("GET", Qt.resolvedUrl("../shared/clawd/frames.json"), false)
        xhr.send()
        if (xhr.status === 200 || xhr.status === 0)
            compact.clawdMeta = JSON.parse(xhr.responseText)
    }
    readonly property string clawdName: Labels.clawdAnim(agg.state, agg.tool)
    readonly property var clawdInfo:
        clawdMeta[clawdName] || ({ frames: 1, width: 128, height: 128, interval_ms: 83 })

    property int elapsed: 0
    // Sampled 4×/s (not 1×): a 1 s timer beats against the 1 s display quantum,
    // so Qt jitter walks the sample phase across the second boundary and one
    // displayed second occasionally stalls to ~2 s. Flooring the *difference*
    // (vs. difference of floors) keeps the count honest against a float
    // started_at instead of running up to a second ahead.
    Timer {
        interval: 250; repeat: true
        running: agg.started_at !== null
        triggeredOnStart: true
        onTriggered: elapsed = Math.max(0, Math.floor(Date.now()/1000 - agg.started_at))
    }

    // Usage readout helpers: a coloured dot per window (green <50, yellow
    // 50–80, red >=80) plus the percentage.
    property int dotSize: Math.max(6, Math.round(compact.height * 0.26))

    RowLayout {
        id: row
        anchors.fill: parent
        spacing: 4
        AnimatedSprite {
            id: clawd
            Layout.alignment: Qt.AlignVCenter
            // Square, sized to panel thickness (compact.height is set by the
            // panel, so this does not feed back into the row's implicit width).
            Layout.preferredHeight: Math.max(16, compact.height)
            Layout.preferredWidth: Layout.preferredHeight
            width: Layout.preferredWidth
            height: Layout.preferredHeight
            smooth: true
            running: true
            loops: AnimatedSprite.Infinite
            // Animated Clawd chosen by activity state / current tool, played
            // from the shared sprite sheets so GNOME renders the same frames.
            source: Qt.resolvedUrl("../shared/clawd/" + compact.clawdName + ".png")
            frameCount: compact.clawdInfo.frames
            frameWidth: compact.clawdInfo.width
            frameHeight: compact.clawdInfo.height
            frameDuration: compact.clawdInfo.interval_ms

            // Yellow "awaiting permission" dot on top of the notification anim.
            Rectangle {
                visible: agg.state === "waiting"
                width: Math.round(parent.height * 0.3)
                height: width
                radius: width / 2
                color: "#f5c451"
                border.color: "#40000000"
                border.width: 1
                anchors.right: parent.right
                anchors.bottom: parent.bottom
            }
        }
        // Text next to Clawd, shown only while thinking/using a tool, with a
        // right-to-left brightness shimmer across the characters.
        Row {
            id: animText
            Layout.alignment: Qt.AlignVCenter
            visible: agg.state === "thinking" || agg.state === "tool"
            // Every status word ends with an ellipsis (Claude-CLI style).
            readonly property string content: (agg.state === "tool" ? Labels.toolLabel(agg.tool)
                                                                     : thinkingWord) + "…"
            readonly property int n: content.length
            property real head: 0   // highlight position: high->low = right->left
            NumberAnimation on head {
                running: animText.visible && animText.n > 0
                from: animText.n + 2; to: -2
                duration: Shimmer.shimmerDuration(animText.n); loops: Animation.Infinite
            }
            Repeater {
                model: animText.n
                PlasmaComponents.Label {
                    text: { var c = animText.content.charAt(index); return c === " " ? " " : c }
                    opacity: Shimmer.shimmerOpacity(index, animText.head)
                }
            }
        }
        PlasmaComponents.Label {
            visible: agg.started_at !== null
            text: Labels.fmt(compact.elapsed)
        }
        Item { Layout.fillWidth: true }   // spacer pushes usage to the right
        RowLayout {
            id: usageBox
            visible: plasmoid.configuration.showUsageOnPanel
            opacity: usage.status === "ok" ? 1.0 : 0.5
            spacing: 3

            // 5-hour window
            Rectangle {
                Layout.alignment: Qt.AlignVCenter
                width: compact.dotSize; height: compact.dotSize; radius: width / 2
                color: Usage.usageDotColor(usage.five_hour)
            }
            PlasmaComponents.Label { text: Usage.usagePctText(usage.five_hour) }

            // Weekly (~72h) window
            Rectangle {
                Layout.alignment: Qt.AlignVCenter
                Layout.leftMargin: 4
                width: compact.dotSize; height: compact.dotSize; radius: width / 2
                color: Usage.usageDotColor(usage.seven_day)
            }
            PlasmaComponents.Label { text: Usage.usagePctText(usage.seven_day) }
        }
    }
}
