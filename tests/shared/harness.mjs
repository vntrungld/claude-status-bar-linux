// Dependency-free assertions, runnable under `gjs -m` and `node`.
// console.log is the only output primitive both engines share.
let total = 0
let failures = 0

// Strict recursive deep-equal. JSON.stringify is unsuitable for the actual
// comparison: it collapses NaN to the same string as null, and it silently
// drops object keys whose value is undefined (so {id:'x', args:undefined}
// would compare equal to {id:'x'}). Object.is distinguishes NaN from null
// and from undefined, and comparing own-enumerable-key sets (not just
// values) catches the present-but-undefined case.
function deepEqual(a, b) {
    if (Object.is(a, b)) return true
    if (a === null || b === null) return false
    if (typeof a !== 'object' || typeof b !== 'object') return false

    const aIsArray = Array.isArray(a)
    const bIsArray = Array.isArray(b)
    if (aIsArray !== bIsArray) return false

    if (aIsArray) {
        if (a.length !== b.length) return false
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false
        }
        return true
    }

    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    for (const k of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false
        if (!deepEqual(a[k], b[k])) return false
    }
    return true
}

// Readable rendering for failure messages only — never used for the
// comparison itself. JSON.stringify alone would print NaN and undefined
// as misleading text ("null" / dropped keys), so special-case them here.
function show(v) {
    if (typeof v === 'number' && Number.isNaN(v)) return 'NaN'
    if (v === undefined) return 'undefined'
    try {
        return JSON.stringify(v)
    } catch (e) {
        return String(v)
    }
}

export function eq(actual, expected, label) {
    total++
    if (!deepEqual(actual, expected)) {
        failures++
        console.log(`FAIL ${label}\n  expected: ${show(expected)}\n  actual:   ${show(actual)}`)
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
