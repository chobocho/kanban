// Unit tests for defensive normalization in src/normalize.ts.
import { test, assert, assertEqual } from './harness.js';
import { normalizeAppData } from '../src/normalize.js';
test('null input yields default data', () => {
    const data = normalizeAppData(null);
    assert(data.boards.length >= 1, 'has a board');
    assertEqual(data.version, 1, 'version set');
});
test('garbage input yields default data', () => {
    const data = normalizeAppData(42);
    assert(data.boards.length >= 1, 'has a board');
});
test('empty boards array yields default data', () => {
    const data = normalizeAppData({ boards: [] });
    assert(data.boards.length >= 1, 'repaired');
});
test('partial board is repaired with defaults', () => {
    const data = normalizeAppData({
        boards: [{ name: 'X', columns: [{ title: 'C', cards: [{ text: 'hi' }] }] }],
    });
    assertEqual(data.boards[0].name, 'X', 'name kept');
    assertEqual(data.boards[0].columns[0].cards[0].text, 'hi', 'card text kept');
    assert(typeof data.boards[0].id === 'string', 'id generated');
    assert(typeof data.boards[0].columns[0].cards[0].color === 'string', 'color defaulted');
});
test('invalid activeBoardId falls back to first board', () => {
    const data = normalizeAppData({
        boards: [{ id: 'b1', name: 'A', columns: [] }],
        activeBoardId: 'does-not-exist',
    });
    assertEqual(data.activeBoardId, 'b1', 'fell back to first');
});
test('language and zoom are sanitized', () => {
    const data = normalizeAppData({
        boards: [{ id: 'b1', name: 'A', columns: [] }],
        settings: { lang: 'fr', zoom: 99 },
    });
    assertEqual(data.settings.lang, 'ko', 'invalid lang -> ko');
    assert(data.settings.zoom <= 2.5, 'zoom clamped');
});
test('non-array columns and cards are coerced to empty', () => {
    const data = normalizeAppData({
        boards: [{ id: 'b1', name: 'A', columns: 'nope' }],
    });
    assert(Array.isArray(data.boards[0].columns), 'columns is array');
    assertEqual(data.boards[0].columns.length, 0, 'empty columns');
});
