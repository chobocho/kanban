// Tiny zero-dependency test harness so tests run under plain `node` without
// any external framework, honoring the "no external libraries" rule.
const tests = [];
export function test(name, fn) {
    tests.push({ name, fn });
}
export function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
export function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message} (expected ${String(expected)}, got ${String(actual)})`);
    }
}
/** Run all registered tests and exit with a non-zero code on failure. */
export function run() {
    let passed = 0;
    const failures = [];
    for (const tc of tests) {
        try {
            tc.fn();
            passed += 1;
            console.log(`  ok   ${tc.name}`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            failures.push(`${tc.name}: ${msg}`);
            console.log(`  FAIL ${tc.name} - ${msg}`);
        }
    }
    console.log(`\n${passed}/${tests.length} passed`);
    if (failures.length > 0) {
        process.exit(1);
    }
}
