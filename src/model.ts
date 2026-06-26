// Pure board operations. These functions contain the core business logic and
// are intentionally free of any DOM or storage concerns so they can be unit
// tested in isolation (see test/model.test.ts).

import { AppData, Board, Card, Column, Label, SCHEMA_VERSION } from './types.js';
import { makeId } from './id.js';

/** Default label palette seeded on every new board (Trello-like colors). */
export const LABEL_COLORS = ['#61bd4f', '#f2d600', '#ff9f1a', '#eb5a46', '#c377e0', '#0079bf'];

/** Create a label with the given name and color. */
export function createLabel(name: string, color: string): Label {
  return { id: makeId('label'), name, color };
}

/** Build the default, unnamed color labels for a fresh board. */
export function defaultLabels(): Label[] {
  return LABEL_COLORS.map((color) => createLabel('', color));
}

/** Create an empty card with the given text. */
export function createCard(text: string): Card {
  return {
    id: makeId('card'),
    text,
    description: '',
    labelIds: [],
    dueAt: null,
    dueDone: false,
    color: '',
    createdAt: Date.now(),
  };
}

/** Create an empty column with the given title. */
export function createColumn(title: string): Column {
  return { id: makeId('col'), title, cards: [] };
}

/** Create a board, optionally seeded with the given columns. */
export function createBoard(name: string, columns: Column[] = []): Board {
  const now = Date.now();
  return {
    id: makeId('board'),
    name,
    columns,
    labels: defaultLabels(),
    archived: [],
    createdAt: now,
    updatedAt: now,
  };
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
  patch: Partial<Pick<Card, 'text' | 'description' | 'dueAt' | 'dueDone' | 'color'>>,
): boolean {
  const column = findColumn(board, columnId);
  if (!column) return false;
  const card = column.cards.find((c) => c.id === cardId);
  if (!card) return false;
  if (patch.text !== undefined) card.text = patch.text;
  if (patch.description !== undefined) card.description = patch.description;
  if (patch.dueAt !== undefined) card.dueAt = patch.dueAt;
  if (patch.dueDone !== undefined) card.dueDone = patch.dueDone;
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
 * Move a card out of its column into the board archive. The origin column id is
 * kept so the card can later be restored to where it came from.
 */
export function archiveCard(board: Board, columnId: string, cardId: string): boolean {
  const column = findColumn(board, columnId);
  if (!column) return false;
  const index = column.cards.findIndex((c) => c.id === cardId);
  if (index < 0) return false;
  const [card] = column.cards.splice(index, 1);
  board.archived.unshift({ card, columnId, archivedAt: Date.now() });
  touch(board);
  return true;
}

/**
 * Restore an archived card to its origin column, or to the first column if the
 * origin no longer exists. Returns false if nothing could receive the card.
 */
export function restoreCard(board: Board, cardId: string): boolean {
  const index = board.archived.findIndex((a) => a.card.id === cardId);
  if (index < 0) return false;
  const target = findColumn(board, board.archived[index].columnId) ?? board.columns[0];
  if (!target) return false; // no column to restore into; leave it archived
  const [entry] = board.archived.splice(index, 1);
  target.cards.push(entry.card);
  touch(board);
  return true;
}

/** Permanently remove an archived card. This cannot be undone. */
export function deleteArchivedCard(board: Board, cardId: string): boolean {
  const index = board.archived.findIndex((a) => a.card.id === cardId);
  if (index < 0) return false;
  board.archived.splice(index, 1);
  touch(board);
  return true;
}

/** Append a new label to the board's shared label set and return it. */
export function addLabel(board: Board, name: string, color: string): Label {
  const label = createLabel(name, color);
  board.labels.push(label);
  touch(board);
  return label;
}

/** Patch a board label's name and/or color. */
export function updateLabel(
  board: Board,
  labelId: string,
  patch: Partial<Pick<Label, 'name' | 'color'>>,
): boolean {
  const label = board.labels.find((l) => l.id === labelId);
  if (!label) return false;
  if (patch.name !== undefined) label.name = patch.name;
  if (patch.color !== undefined) label.color = patch.color;
  touch(board);
  return true;
}

/** Delete a board label and strip it from every card that referenced it. */
export function removeLabel(board: Board, labelId: string): boolean {
  const index = board.labels.findIndex((l) => l.id === labelId);
  if (index < 0) return false;
  board.labels.splice(index, 1);
  for (const column of board.columns) {
    for (const card of column.cards) {
      const at = card.labelIds.indexOf(labelId);
      if (at >= 0) card.labelIds.splice(at, 1);
    }
  }
  touch(board);
  return true;
}

/** Toggle a label on a card: add it if absent, remove it if present. */
export function toggleCardLabel(
  board: Board,
  columnId: string,
  cardId: string,
  labelId: string,
): boolean {
  if (!board.labels.some((l) => l.id === labelId)) return false;
  const column = findColumn(board, columnId);
  const card = column?.cards.find((c) => c.id === cardId);
  if (!card) return false;
  const at = card.labelIds.indexOf(labelId);
  if (at >= 0) card.labelIds.splice(at, 1);
  else card.labelIds.push(labelId);
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
