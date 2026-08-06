// The right-to-left brightness sweep across the status word. Pure maths, shared
// so both frontends shimmer at the same rate and with the same falloff.

// Dim base, brightening to full at the sweeping highlight.
export function shimmerOpacity(index, head) {
    return 0.4 + 0.6 * Math.max(0, 1 - Math.abs(index - head) / 2.4)
}

// Longer words take proportionally longer to sweep, with a floor so short
// labels do not strobe.
export function shimmerDuration(n) {
    return Math.max(700, n * 130)
}
