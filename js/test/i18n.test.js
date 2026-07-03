// Unit tests for the i18n template formatter in src/i18n.ts.
import { test, assertEqual } from './harness.js';
import { formatTemplate } from '../src/i18n.js';
test('formatTemplate replaces indexed placeholders', () => {
    assertEqual(formatTemplate('Moved "{0}" from {1} to {2}', ['card', 'A', 'B']), 'Moved "card" from A to B', 'all placeholders replaced');
});
test('formatTemplate handles repeated and missing placeholders', () => {
    assertEqual(formatTemplate('{0} & {0}', ['x']), 'x & x', 'repeated placeholder replaced');
    assertEqual(formatTemplate('{0} + {1}', ['x']), 'x + ', 'missing param becomes empty');
    assertEqual(formatTemplate('no placeholders', []), 'no placeholders', 'plain text untouched');
});
