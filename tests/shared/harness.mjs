// Dependency-free assertions, runnable under `gjs -m` and `node`.
// console.log is the only output primitive both engines share.
let total = 0
let failures = 0

export function eq(actual, expected, label) {
    total++
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a !== e) {
        failures++
        console.log(`FAIL ${label}\n  expected: ${e}\n  actual:   ${a}`)
    }
}

export function ok(cond, label) {
    total++
    if (!cond) {
        failures++
        console.log(`FAIL ${label}`)
    }
}

export function report() {
    console.log(`${total - failures}/${total} shared assertions passed`)
    return failures
}
