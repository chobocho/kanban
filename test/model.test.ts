// Unit tests for the pure board operations in src/model.ts.

import { test, assert, assertEqual } from './harness.js';
import {
  createDefaultData,
  createBoard,
  createColumn,
  addColumn,
  renameColumn,
  removeColumn,
  moveColumn,
  addCard,
  updateCard,
  removeCard,
  moveCard,
  getActiveBoard,
} from '../src/model.js';

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
  const card = addCard(board, colId, 'a')!;
  assert(updateCard(board, colId, card.id, { text: 'b', color: '#f00' }), 'update ok');
  assertEqual(board.columns[0].cards[0].text, 'b', 'text patched');
  assertEqual(board.columns[0].cards[0].color, '#f00', 'color patched');
});

test('updateCard patches description independently', () => {
  const board = createBoard('b', [createColumn('A')]);
  const colId = board.columns[0].id;
  const card = addCard(board, colId, 'a')!;
  assertEqual(card.description, '', 'new card has empty description');
  assert(updateCard(board, colId, card.id, { description: 'details' }), 'update ok');
  assertEqual(board.columns[0].cards[0].description, 'details', 'description patched');
  assertEqual(board.columns[0].cards[0].text, 'a', 'text untouched');
});

test('removeCard deletes a card', () => {
  const board = createBoard('b', [createColumn('A')]);
  const colId = board.columns[0].id;
  const card = addCard(board, colId, 'a')!;
  assert(removeCard(board, colId, card.id), 'remove ok');
  assertEqual(board.columns[0].cards.length, 0, 'empty');
});

test('moveCard moves between columns at the given index', () => {
  const board = createBoard('b', [createColumn('A'), createColumn('B')]);
  const a = board.columns[0].id;
  const b = board.columns[1].id;
  const c1 = addCard(board, a, 'c1')!;
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
  const c1 = addCard(board, a, 'c1')!;
  addCard(board, a, 'c2');
  addCard(board, a, 'c3');
  // toIndex is interpreted against the list AFTER the card is removed, so
  // moving c1 to index 1 places it between c2 and c3.
  assert(moveCard(board, a, c1.id, a, 1), 'move c1 between c2 and c3');
  assertEqual(board.columns[0].cards.map((c) => c.text).join(''), 'c2c1c3', 'reordered');
});

test('getActiveBoard returns the active board', () => {
  const data = createDefaultData();
  const board = getActiveBoard(data);
  assert(board !== undefined, 'found');
  assertEqual(board!.id, data.activeBoardId, 'matches active id');
});
