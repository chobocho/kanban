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
    assertEqual(data.boards[0].columns[0].cards[0].description, '', 'description defaulted');
    assertEqual(data.boards[0].columns[0].cards[0].labelIds.length, 0, 'labelIds defaulted');
    assert(data.boards[0].labels.length > 0, 'labels seeded for legacy board');
    assertEqual(data.boards[0].columns[0].cards[0].dueAt, null, 'dueAt defaulted to null');
    assertEqual(data.boards[0].columns[0].cards[0].dueDone, false, 'dueDone defaulted');
});
test('a valid stored due date is preserved', () => {
    const data = normalizeAppData({
        boards: [
            { id: 'b1', name: 'A', columns: [{ title: 'C', cards: [{ text: 'x', dueAt: 1234, dueDone: true }] }] },
        ],
    });
    const card = data.boards[0].columns[0].cards[0];
    assertEqual(card.dueAt, 1234, 'due date kept');
    assertEqual(card.dueDone, true, 'dueDone kept');
});
test('stored labels are kept and dangling card references are dropped', () => {
    const data = normalizeAppData({
        boards: [
            {
                id: 'b1',
                name: 'A',
                labels: [{ id: 'L1', name: 'Bug', color: '#f00' }],
                columns: [{ title: 'C', cards: [{ text: 'x', labelIds: ['L1', 'ghost'] }] }],
            },
        ],
    });
    assertEqual(data.boards[0].labels.length, 1, 'one stored label kept');
    assertEqual(data.boards[0].labels[0].name, 'Bug', 'label name kept');
    const labelIds = data.boards[0].columns[0].cards[0].labelIds;
    assertEqual(labelIds.join(''), 'L1', 'valid ref kept, dangling ref dropped');
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
