// Unit tests for the pure board operations in src/model.ts.
import { test, assert, assertEqual } from './harness.js';
import { createDefaultData, createBoard, createColumn, addColumn, renameColumn, removeColumn, moveColumn, addCard, updateCard, removeCard, moveCard, getActiveBoard, addLabel, updateLabel, removeLabel, toggleCardLabel, } from '../src/model.js';
test('createDefaultData has one board with three columns', () => {
    const data = createDefaultData();
    assertEqual(data.boards.length, 1, 'board count');
    assertEqual(data.boards[0].columns.length, 3, 'column count');
    assertEqual(data.activeBoardId, data.boards[0].id, 'active board id');
});
test('addColumn appends a column', () => {
    const board = createBoard('b');
    addColumn(board, 'A');
    addColumn(board, 'B');
    assertEqual(board.columns.length, 2, 'columns');
    assertEqual(board.columns[1].title, 'B', 'second title');
});
test('renameColumn updates title and rejects unknown id', () => {
    const board = createBoard('b', [createColumn('Old')]);
    const id = board.columns[0].id;
    assert(renameColumn(board, id, 'New'), 'rename returns true');
    assertEqual(board.columns[0].title, 'New', 'new title');
    assert(!renameColumn(board, 'missing', 'X'), 'unknown rename returns false');
});
test('removeColumn deletes the column', () => {
    const board = createBoard('b', [createColumn('A'), createColumn('B')]);
    const id = board.columns[0].id;
    assert(removeColumn(board, id), 'remove returns true');
    assertEqual(board.columns.length, 1, 'one left');
    assertEqual(board.columns[0].title, 'B', 'B remains');
});
test('moveColumn reorders and clamps', () => {
    const board = createBoard('b', [createColumn('A'), createColumn('B'), createColumn('C')]);
    assert(moveColumn(board, 0, 2), 'move A to end');
    assertEqual(board.columns.map((c) => c.title).join(''), 'BCA', 'order BCA');
    assert(!moveColumn(board, 1, 1), 'no-op move returns false');
});
test('addCard adds to the right column and rejects missing column', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'hello');
    assert(card !== null, 'card created');
    assertEqual(board.columns[0].cards.length, 1, 'one card');
    assertEqual(addCard(board, 'nope', 'x'), null, 'missing column returns null');
});
test('updateCard patches text and color', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    assert(updateCard(board, colId, card.id, { text: 'b', color: '#f00' }), 'update ok');
    assertEqual(board.columns[0].cards[0].text, 'b', 'text patched');
    assertEqual(board.columns[0].cards[0].color, '#f00', 'color patched');
});
test('updateCard patches description independently', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    assertEqual(card.description, '', 'new card has empty description');
    assert(updateCard(board, colId, card.id, { description: 'details' }), 'update ok');
    assertEqual(board.columns[0].cards[0].description, 'details', 'description patched');
    assertEqual(board.columns[0].cards[0].text, 'a', 'text untouched');
});
test('updateCard sets and clears the due date', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    assertEqual(card.dueAt, null, 'new card has no due date');
    assertEqual(card.dueDone, false, 'new card is not complete');
    assert(updateCard(board, colId, card.id, { dueAt: 1000, dueDone: true }), 'update ok');
    assertEqual(board.columns[0].cards[0].dueAt, 1000, 'due date set');
    assertEqual(board.columns[0].cards[0].dueDone, true, 'marked complete');
    assert(updateCard(board, colId, card.id, { dueAt: null }), 'clear ok');
    assertEqual(board.columns[0].cards[0].dueAt, null, 'due date cleared');
});
test('removeCard deletes a card', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    assert(removeCard(board, colId, card.id), 'remove ok');
    assertEqual(board.columns[0].cards.length, 0, 'empty');
});
test('moveCard moves between columns at the given index', () => {
    const board = createBoard('b', [createColumn('A'), createColumn('B')]);
    const a = board.columns[0].id;
    const b = board.columns[1].id;
    const c1 = addCard(board, a, 'c1');
    addCard(board, a, 'c2');
    addCard(board, b, 'x');
    assert(moveCard(board, a, c1.id, b, 0), 'move c1 to front of B');
    assertEqual(board.columns[0].cards.length, 1, 'A has one');
    assertEqual(board.columns[1].cards[0].text, 'c1', 'B front is c1');
    assertEqual(board.columns[1].cards.length, 2, 'B has two');
});
test('moveCard within the same column reorders', () => {
    const board = createBoard('b', [createColumn('A')]);
    const a = board.columns[0].id;
    const c1 = addCard(board, a, 'c1');
    addCard(board, a, 'c2');
    addCard(board, a, 'c3');
    // toIndex is interpreted against the list AFTER the card is removed, so
    // moving c1 to index 1 places it between c2 and c3.
    assert(moveCard(board, a, c1.id, a, 1), 'move c1 between c2 and c3');
    assertEqual(board.columns[0].cards.map((c) => c.text).join(''), 'c2c1c3', 'reordered');
});
test('new boards and cards start with default labels and no assignments', () => {
    const board = createBoard('b', [createColumn('A')]);
    assert(board.labels.length === 6, 'six default labels seeded');
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    assertEqual(card.labelIds.length, 0, 'card starts with no labels');
});
test('toggleCardLabel adds then removes a label', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    const labelId = board.labels[0].id;
    assert(toggleCardLabel(board, colId, card.id, labelId), 'toggle on ok');
    assertEqual(card.labelIds.join(''), labelId, 'label assigned');
    assert(toggleCardLabel(board, colId, card.id, labelId), 'toggle off ok');
    assertEqual(card.labelIds.length, 0, 'label removed');
    assert(!toggleCardLabel(board, colId, card.id, 'nope'), 'unknown label rejected');
});
test('updateLabel renames a label', () => {
    const board = createBoard('b');
    const labelId = board.labels[0].id;
    assert(updateLabel(board, labelId, { name: 'Bug' }), 'update ok');
    assertEqual(board.labels[0].name, 'Bug', 'name patched');
    assert(!updateLabel(board, 'missing', { name: 'x' }), 'unknown label rejected');
});
test('removeLabel deletes it and strips it from cards', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    const labelId = board.labels[0].id;
    toggleCardLabel(board, colId, card.id, labelId);
    const before = board.labels.length;
    assert(removeLabel(board, labelId), 'remove ok');
    assertEqual(board.labels.length, before - 1, 'label count drops');
    assertEqual(card.labelIds.length, 0, 'reference stripped from card');
});
test('addLabel appends a board label', () => {
    const board = createBoard('b');
    const before = board.labels.length;
    const label = addLabel(board, 'Urgent', '#000000');
    assertEqual(board.labels.length, before + 1, 'label appended');
    assertEqual(board.labels[board.labels.length - 1].id, label.id, 'returns new label');
});
test('getActiveBoard returns the active board', () => {
    const data = createDefaultData();
    const board = getActiveBoard(data);
    assert(board !== undefined, 'found');
    assertEqual(board.id, data.activeBoardId, 'matches active id');
});
