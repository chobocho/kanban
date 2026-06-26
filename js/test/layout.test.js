// Unit tests for the pure layout math in src/layout.ts. The DOM-bound
// LayoutController is exercised in the browser; here we verify the height
// calculation that drives column reflow on foldable / resizing screens.
import { test, assertEqual } from './harness.js';
import { availableColumnHeight } from '../src/layout.js';
test('available height subtracts the surface padding', () => {
    assertEqual(availableColumnHeight(1000, 16, 16), 968, 'unfolded tall surface');
});
test('available height adapts to a shorter (folded) surface', () => {
    assertEqual(availableColumnHeight(640, 16, 16), 608, 'folded cover screen');
});
test('available height never goes negative when the surface collapses', () => {
    assertEqual(availableColumnHeight(10, 16, 16), 0, 'collapsed surface clamps to 0');
});
test('zero padding leaves the full surface height', () => {
    assertEqual(availableColumnHeight(800, 0, 0), 800, 'no padding');
});
