import QtQuick
import "../../shared/aggregate.mjs" as Aggregate
import "../../shared/labels.mjs" as Labels
import "../../shared/usage.mjs" as Usage
import "../../shared/shimmer.mjs" as Shimmer

// Proves Qt's QML engine parses and executes every shared module. A module that
// drifts into syntax Qt rejects fails here rather than in the running widget.
Item {
    Component.onCompleted: {
        var checks = [
            Aggregate.STALE_SECS === 900,
            Aggregate.aggregate([{state: "waiting", updated_at: 1000}], 1000).state === "waiting",
            Aggregate.aggregate([{state: "thinking", started_at: 1000.5, updated_at: 1000}], 1000).started_at === 1000.5,
            Labels.toolLabel("Bash") === "Running",
            Labels.toolLabelShort("Edit") === "Edit",
            Labels.clawdAnim("tool", "Bash") === "building",
            Labels.fmt(65) === "1m 5s",
            Labels.displayName({email: "a@b.com"}) === "a",
            Labels.THINKING_WORDS.length > 1,
            Usage.usagePctText({utilization: 42.4}) === "42%",
            Usage.usageDotColor({utilization: 80}) === "#e05252",
            Usage.resetText({resets_at: new Date(190000 * 1000).toISOString()}, 100000).id === "resets_in_dh",
            Usage.updatedText(1000, 1200).id === "updated_m",
            Usage.POLL_INTERVAL_MS === 300000,
            Usage.shouldFastRetry("error") === true,
            Shimmer.shimmerOpacity(3, 3) === 1.0,
            Shimmer.shimmerDuration(10) === 1300
        ]
        for (var i = 0; i < checks.length; i++) {
            if (!checks[i]) {
                // Exit code encodes which assertion failed: 10 + index.
                Qt.exit(10 + i)
                return
            }
        }
        Qt.exit(0)
    }
}
