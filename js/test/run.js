// Test entry point. Importing the test modules registers their cases; then we
// run them all. Invoked via `node js/test/run.js` after `tsc`.
import './model.test.js';
import './normalize.test.js';
import { run } from './harness.js';
run();
