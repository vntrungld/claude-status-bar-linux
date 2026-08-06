// Entry point: imports every shared test module, then exits non-zero on failure.
import { report } from './harness.mjs'

const failures = report()

if (typeof process !== 'undefined') {
    process.exit(failures === 0 ? 0 : 1)
} else {
    const System = (await import('system')).default
    System.exit(failures === 0 ? 0 : 1)
}
