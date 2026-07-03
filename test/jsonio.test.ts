// Unit tests for single-board JSON parsing in src/jsonio.ts.

import { test, assert, assertEqual } from './harness.js';
import { parseBoardJson } from '../src/jsonio.js';

test('parseBoardJson reads a wrapped board export', () => {
  const board = parseBoardJson(
    JSON.stringify({ kanbanBoard: 1, board: { id: 'b1', name: 'X', columns: [] } }),
  );
  assertEqual(board.name, 'X', 'board name kept');
});

test('parseBoardJson accepts a bare board object', () => {
  const board = parseBoardJson(
    JSON.stringify({ id: 'b1', name: 'Bare', columns: [{ title: 'C', cards: [] }] }),
  );
  assertEqual(board.name, 'Bare', 'name kept');
  assertEqual(board.columns.length, 1, 'columns kept');
});

test('parseBoardJson rejects whole-app exports and invalid JSON', () => {
  let threw = false;
  try {
    parseBoardJson(JSON.stringify({ boards: [], activeBoardId: null }));
  } catch {
    threw = true;
  }
  assert(threw, 'app-data file rejected for board import');

  threw = false;
  try {
    parseBoardJson('not json at all');
  } catch {
    threw = true;
  }
  assert(threw, 'invalid JSON rejected');
});
