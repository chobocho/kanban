// Tiny zero-dependency test harness so tests run under plain `node` without
// any external framework, honoring the "no external libraries" rule.

// Minimal ambient declaration so the harness compiles without @types/node.
declare const process: { exit(code: number): void };

interface TestCase {
  name: string;
  fn: () => void;
}

const tests: TestCase[] = [];

export function test(name: string, fn: () => void): void {
  tests.push({ name, fn });
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

/** Run all registered tests and exit with a non-zero code on failure. */
export function run(): void {
  let passed = 0;
  const failures: string[] = [];
  for (const tc of tests) {
    try {
      tc.fn();
      passed += 1;
      console.log(`  ok   ${tc.name}`);
    } catch (err) {
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
