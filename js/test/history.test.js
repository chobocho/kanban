// Unit tests for the generic undo/redo History in src/history.ts.
import { test, assert, assertEqual } from './harness.js';
import { History } from '../src/history.js';
test('empty history cannot undo or redo', () => {
    const h = new History(8);
    assert(!h.canUndo(), 'no undo initially');
    assert(!h.canRedo(), 'no redo initially');
    assertEqual(h.undo(1), null, 'undo on empty returns null');
    assertEqual(h.redo(1), null, 'redo on empty returns null');
});
test('record enables undo and undo returns the previous state', () => {
    const h = new History(8);
    h.record(0); // state was 0 before changing to 1
    assert(h.canUndo(), 'can undo after record');
    assertEqual(h.undo(1), 0, 'undo returns previous state');
    assert(!h.canUndo(), 'no more undo');
    assert(h.canRedo(), 'can redo after undo');
});
test('redo returns the state left behind by undo', () => {
    const h = new History(8);
    h.record(0);
    assertEqual(h.undo(1), 0, 'undo to 0');
    assertEqual(h.redo(0), 1, 'redo back to 1');
    assert(!h.canRedo(), 'no more redo');
    assert(h.canUndo(), 'can undo again');
});
test('record after undo discards redo history', () => {
    const h = new History(8);
    h.record(0);
    h.undo(1); // future now holds 1
    assert(h.canRedo(), 'redo available before new record');
    h.record(0); // new change forks the timeline
    assert(!h.canRedo(), 'redo discarded after new record');
});
test('history is capped at maxDepth steps', () => {
    const h = new History(8);
    // Record 10 prior states (0..9); only the last 8 should be retained.
    for (let i = 0; i < 10; i += 1)
        h.record(i);
    let current = 10;
    const undone = [];
    while (h.canUndo()) {
        const prev = h.undo(current);
        undone.push(prev);
        current = prev;
    }
    assertEqual(undone.length, 8, 'exactly 8 undo steps retained');
    assertEqual(undone[0], 9, 'most recent step first');
    assertEqual(undone[7], 2, 'oldest retained step is 2 (0 and 1 dropped)');
});
test('clear forgets all history', () => {
    const h = new History(8);
    h.record(0);
    h.undo(1);
    h.clear();
    assert(!h.canUndo(), 'no undo after clear');
    assert(!h.canRedo(), 'no redo after clear');
});
test('constructor rejects a non-positive maxDepth', () => {
    let threw = false;
    try {
        new History(0);
    }
    catch {
        threw = true;
    }
    assert(threw, 'maxDepth of 0 throws');
});
