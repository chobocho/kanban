// Pure board operations. These functions contain the core business logic and
// are intentionally free of any DOM or storage concerns so they can be unit
// tested in isolation (see test/model.test.ts).

import { AppData, Board, Card, Column, SCHEMA_VERSION } from './types.js';
import { makeId } from './id.js';

/** Create an empty card with the given text. */
export function createCard(text: string): Card {
  return { id: makeId('card'), text, color: '', createdAt: Date.now() };
}

/** Create an empty column with the given title. */
export function createColumn(title: string): Column {
  return { id: makeId('col'), title, cards: [] };
}

/** Create a board, optionally seeded with the given columns. */
export function createBoard(name: string, columns: Column[] = []): Board {
  const now = Date.now();
  return { id: makeId('board'), name, columns, createdAt: now, updatedAt: now };
}

/** Build a fresh application state with one sample board. */
export function createDefaultData(): AppData {
  const board = createBoard('My Board', [
    createColumn('To Do'),
    createColumn('In Progress'),
    createColumn('Done'),
  ]);
  return {
    version: SCHEMA_VERSION,
    boards: [board],
    activeBoardId: board.id,
    settings: { lang: 'ko', zoom: 1 },
  };
}

/** Mark a board as modified now. */
export function touch(board: Board): void {
  board.updatedAt = Date.now();
}

export function findColumn(board: Board, columnId: string): Column | undefined {
  return board.columns.find((c) => c.id === columnId);
}

/** Append a new column and return it. */
export function addColumn(board: Board, title: string): Column {
  const column = createColumn(title);
  board.columns.push(column);
  touch(board);
  return column;
}

export function renameColumn(board: Board, columnId: string, title: string): boolean {
  const column = findColumn(board, columnId);
  if (!column) return false;
  column.title = title;
  touch(board);
  return true;
}

export function removeColumn(board: Board, columnId: string): boolean {
  const index = board.columns.findIndex((c) => c.id === columnId);
  if (index < 0) return false;
  board.columns.splice(index, 1);
  touch(board);
  return true;
}

/** Move a column from one position to another (clamped to valid range). */
export function moveColumn(board: Board, fromIndex: number, toIndex: number): boolean {
  const len = board.columns.length;
  if (fromIndex < 0 || fromIndex >= len) return false;
  const target = Math.max(0, Math.min(toIndex, len - 1));
  if (target === fromIndex) return false;
  const [moved] = board.columns.splice(fromIndex, 1);
  board.columns.splice(target, 0, moved);
  touch(board);
  return true;
}

/** Add a card to a column and return it, or null if the column is missing. */
export function addCard(board: Board, columnId: string, text: string): Card | null {
  const column = findColumn(board, columnId);
  if (!column) return null;
  const card = createCard(text);
  column.cards.push(card);
  touch(board);
  return card;
}

export function updateCard(
  board: Board,
  columnId: string,
  cardId: string,
  patch: Partial<Pick<Card, 'text' | 'color'>>,
): boolean {
  const column = findColumn(board, columnId);
  if (!column) return false;
  const card = column.cards.find((c) => c.id === cardId);
  if (!card) return false;
  if (patch.text !== undefined) card.text = patch.text;
  if (patch.color !== undefined) card.color = patch.color;
  touch(board);
  return true;
}

export function removeCard(board: Board, columnId: string, cardId: string): boolean {
  const column = findColumn(board, columnId);
  if (!column) return false;
  const index = column.cards.findIndex((c) => c.id === cardId);
  if (index < 0) return false;
  column.cards.splice(index, 1);
  touch(board);
  return true;
}

/**
 * Move a card to another column (or within the same column) at the given index.
 * `toIndex` is clamped into the destination column's valid range.
 */
export function moveCard(
  board: Board,
  fromColumnId: string,
  cardId: string,
  toColumnId: string,
  toIndex: number,
): boolean {
  const fromColumn = findColumn(board, fromColumnId);
  const toColumn = findColumn(board, toColumnId);
  if (!fromColumn || !toColumn) return false;
  const cardIndex = fromColumn.cards.findIndex((c) => c.id === cardId);
  if (cardIndex < 0) return false;

  const [card] = fromColumn.cards.splice(cardIndex, 1);
  const clamped = Math.max(0, Math.min(toIndex, toColumn.cards.length));
  toColumn.cards.splice(clamped, 0, card);
  touch(board);
  return true;
}

export function getActiveBoard(data: AppData): Board | undefined {
  return data.boards.find((b) => b.id === data.activeBoardId);
}
