// Pure board operations. These functions contain the core business logic and
// are intentionally free of any DOM or storage concerns so they can be unit
// tested in isolation (see test/model.test.ts).

import {
  ActivityEntry,
  AppData,
  Attachment,
  Board,
  Card,
  Checklist,
  ChecklistItem,
  Column,
  Label,
  SCHEMA_VERSION,
} from './types.js';
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
    checklists: [],
    checklistsOpen: false,
    comments: [],
    attachments: [],
    startAt: null,
    dueAt: null,
    dueDone: false,
    color: '',
    isTemplate: false,
    createdAt: Date.now(),
  };
}

/**
 * Deep-copy a card with fresh ids. Content travels with the copy (labels,
 * checklist state, attachments, dates, color, template flag) but comments do
 * not, matching Trello's copy behavior.
 */
function cloneCard(source: Card): Card {
  return {
    id: makeId('card'),
    text: source.text,
    description: source.description,
    labelIds: source.labelIds.slice(),
    checklists: source.checklists.map((c) => ({
      id: makeId('cl'),
      name: c.name,
      items: c.items.map((i) => ({ id: makeId('chk'), text: i.text, done: i.done })),
    })),
    checklistsOpen: source.checklistsOpen,
    comments: [],
    attachments: source.attachments.map((a) => ({
      id: makeId('att'),
      name: a.name,
      dataUrl: a.dataUrl,
      createdAt: a.createdAt,
    })),
    startAt: source.startAt,
    dueAt: source.dueAt,
    dueDone: source.dueDone,
    color: source.color,
    isTemplate: source.isTemplate,
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
    archivedColumns: [],
    background: '',
    starred: false,
    activity: [],
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
    settings: { lang: 'ko', zoom: 1, theme: 'auto' },
  };
}

/** Trello-like board background palette (empty = default theme color). */
export const BOARD_BACKGROUNDS = [
  '',
  '#0079bf',
  '#d29034',
  '#519839',
  '#b04632',
  '#89609e',
  '#cd5a91',
  '#00aecc',
  '#838c91',
];

/** Change the board's background color. Returns false when nothing changed. */
export function setBoardBackground(board: Board, color: string): boolean {
  if (board.background === color) return false;
  board.background = color;
  touch(board);
  return true;
}

/** Mark a board as modified now. */
export function touch(board: Board): void {
  board.updatedAt = Date.now();
}

export function findColumn(board: Board, columnId: string): Column | undefined {
  return board.columns.find((c) => c.id === columnId);
}

export function findCard(board: Board, columnId: string, cardId: string): Card | undefined {
  return findColumn(board, columnId)?.cards.find((c) => c.id === cardId);
}

/** Completed and total checklist items on a card, across all its checklists. */
export function checklistProgress(card: Card): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const checklist of card.checklists) {
    done += checklist.items.filter((i) => i.done).length;
    total += checklist.items.length;
  }
  return { done, total };
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

/** Supported orderings for {@link sortColumnCards}. */
export type CardSortKey = 'name' | 'created' | 'due';

/**
 * Sort a column's cards: by name (alphabetical), creation date (newest first)
 * or due date (earliest first, cards without a due date last). Stable.
 */
export function sortColumnCards(board: Board, columnId: string, by: CardSortKey): boolean {
  const column = findColumn(board, columnId);
  if (!column) return false;
  const compare: (a: Card, b: Card) => number =
    by === 'name'
      ? (a, b) => a.text.localeCompare(b.text)
      : by === 'created'
        ? (a, b) => b.createdAt - a.createdAt
        : (a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER);
  column.cards.sort(compare);
  touch(board);
  return true;
}

/**
 * Insert a copy of a whole list right after the original (Trello's "copy
 * list"). Every card is duplicated with fresh ids; comments are not copied.
 */
export function duplicateColumn(board: Board, columnId: string): Column | null {
  const index = board.columns.findIndex((c) => c.id === columnId);
  if (index < 0) return null;
  const source = board.columns[index];
  const copy = createColumn(source.title);
  copy.cards = source.cards.map(cloneCard);
  board.columns.splice(index + 1, 0, copy);
  touch(board);
  return copy;
}

/** Move every card of one list to the end of another (Trello's "move all"). */
export function moveAllCards(board: Board, fromColumnId: string, toColumnId: string): boolean {
  if (fromColumnId === toColumnId) return false;
  const from = findColumn(board, fromColumnId);
  const to = findColumn(board, toColumnId);
  if (!from || !to || from.cards.length === 0) return false;
  to.cards.push(...from.cards);
  from.cards = [];
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
  patch: Partial<
    Pick<
      Card,
      'text' | 'description' | 'startAt' | 'dueAt' | 'dueDone' | 'color' | 'isTemplate' | 'checklistsOpen'
    >
  >,
): boolean {
  const column = findColumn(board, columnId);
  if (!column) return false;
  const card = column.cards.find((c) => c.id === cardId);
  if (!card) return false;
  if (patch.text !== undefined) card.text = patch.text;
  if (patch.description !== undefined) card.description = patch.description;
  if (patch.startAt !== undefined) card.startAt = patch.startAt;
  if (patch.dueAt !== undefined) card.dueAt = patch.dueAt;
  if (patch.dueDone !== undefined) card.dueDone = patch.dueDone;
  if (patch.color !== undefined) card.color = patch.color;
  if (patch.isTemplate !== undefined) card.isTemplate = patch.isTemplate;
  if (patch.checklistsOpen !== undefined) card.checklistsOpen = patch.checklistsOpen;
  touch(board);
  return true;
}

/**
 * Create one card per non-empty line of `text`, appended in order (Trello's
 * multi-line paste). Returns the created cards; empty when nothing was made.
 */
export function addCardsFromText(board: Board, columnId: string, text: string): Card[] {
  const column = findColumn(board, columnId);
  if (!column) return [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const cards = lines.map((line) => createCard(line));
  if (cards.length === 0) return [];
  column.cards.push(...cards);
  touch(board);
  return cards;
}

/** Insert a copy of a card right after the original (Trello's "copy card"). */
export function duplicateCard(board: Board, columnId: string, cardId: string): Card | null {
  const column = findColumn(board, columnId);
  if (!column) return null;
  const index = column.cards.findIndex((c) => c.id === cardId);
  if (index < 0) return null;
  const copy = cloneCard(column.cards[index]);
  column.cards.splice(index + 1, 0, copy);
  touch(board);
  return copy;
}

/**
 * Create a regular card from a template card, appended to the end of the same
 * list. The template itself stays in place.
 */
export function createCardFromTemplate(
  board: Board,
  columnId: string,
  cardId: string,
): Card | null {
  const column = findColumn(board, columnId);
  const source = column?.cards.find((c) => c.id === cardId);
  if (!column || !source) return null;
  const card = cloneCard(source);
  card.isTemplate = false;
  column.cards.push(card);
  touch(board);
  return card;
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
 * Exact deep copy of columns for undo snapshots. Unlike a JSON round-trip this
 * shares immutable strings (notably multi-megabyte attachment data URLs) by
 * reference, so snapshotting stays cheap however large the images are.
 */
export function snapshotColumns(columns: Column[]): Column[] {
  return columns.map((column) => ({
    ...column,
    cards: column.cards.map((card) => ({
      ...card,
      labelIds: [...card.labelIds],
      checklists: card.checklists.map((cl) => ({
        ...cl,
        items: cl.items.map((item) => ({ ...item })),
      })),
      comments: card.comments.map((comment) => ({ ...comment })),
      attachments: card.attachments.map((attachment) => ({ ...attachment })),
    })),
  }));
}

/** Look up one of a card's checklists. */
function findChecklist(
  board: Board,
  columnId: string,
  cardId: string,
  checklistId: string,
): Checklist | undefined {
  return findCard(board, columnId, cardId)?.checklists.find((c) => c.id === checklistId);
}

/** Append a new (empty) named checklist to a card. */
export function addChecklist(
  board: Board,
  columnId: string,
  cardId: string,
  name: string,
): Checklist | null {
  const card = findCard(board, columnId, cardId);
  if (!card) return null;
  const checklist: Checklist = { id: makeId('cl'), name, items: [] };
  card.checklists.push(checklist);
  touch(board);
  return checklist;
}

/** Rename one of a card's checklists. */
export function renameChecklist(
  board: Board,
  columnId: string,
  cardId: string,
  checklistId: string,
  name: string,
): boolean {
  const checklist = findChecklist(board, columnId, cardId, checklistId);
  if (!checklist) return false;
  checklist.name = name;
  touch(board);
  return true;
}

/** Delete a whole checklist (and its items) from a card. */
export function removeChecklist(
  board: Board,
  columnId: string,
  cardId: string,
  checklistId: string,
): boolean {
  const card = findCard(board, columnId, cardId);
  if (!card) return false;
  const index = card.checklists.findIndex((c) => c.id === checklistId);
  if (index < 0) return false;
  card.checklists.splice(index, 1);
  touch(board);
  return true;
}

/** Append an item to one of a card's checklists. Ignores blank text. */
export function addChecklistItem(
  board: Board,
  columnId: string,
  cardId: string,
  checklistId: string,
  text: string,
): boolean {
  const trimmed = text.trim();
  const checklist = findChecklist(board, columnId, cardId, checklistId);
  if (!checklist || !trimmed) return false;
  checklist.items.push({ id: makeId('chk'), text: trimmed, done: false });
  touch(board);
  return true;
}

/** Patch a checklist item's done flag and/or text. */
export function updateChecklistItem(
  board: Board,
  columnId: string,
  cardId: string,
  checklistId: string,
  itemId: string,
  patch: Partial<Pick<ChecklistItem, 'text' | 'done'>>,
): boolean {
  const checklist = findChecklist(board, columnId, cardId, checklistId);
  const item = checklist?.items.find((i) => i.id === itemId);
  if (!item) return false;
  if (patch.text !== undefined) item.text = patch.text;
  if (patch.done !== undefined) item.done = patch.done;
  touch(board);
  return true;
}

/** Flip a checklist item's done state. */
export function toggleChecklistItem(
  board: Board,
  columnId: string,
  cardId: string,
  checklistId: string,
  itemId: string,
): boolean {
  const item = findChecklist(board, columnId, cardId, checklistId)?.items.find(
    (i) => i.id === itemId,
  );
  if (!item) return false;
  item.done = !item.done;
  touch(board);
  return true;
}

/** Move a checklist item one step up (-1) or down (+1). False at the edges. */
export function moveChecklistItem(
  board: Board,
  columnId: string,
  cardId: string,
  checklistId: string,
  itemId: string,
  direction: -1 | 1,
): boolean {
  const checklist = findChecklist(board, columnId, cardId, checklistId);
  if (!checklist) return false;
  const index = checklist.items.findIndex((i) => i.id === itemId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= checklist.items.length) return false;
  const [item] = checklist.items.splice(index, 1);
  checklist.items.splice(target, 0, item);
  touch(board);
  return true;
}

/** Remove an item from one of a card's checklists. */
export function removeChecklistItem(
  board: Board,
  columnId: string,
  cardId: string,
  checklistId: string,
  itemId: string,
): boolean {
  const checklist = findChecklist(board, columnId, cardId, checklistId);
  if (!checklist) return false;
  const index = checklist.items.findIndex((i) => i.id === itemId);
  if (index < 0) return false;
  checklist.items.splice(index, 1);
  touch(board);
  return true;
}

/** Attach an image (as a data URL) to a card. Rejects an empty data URL. */
export function addAttachment(
  board: Board,
  columnId: string,
  cardId: string,
  name: string,
  dataUrl: string,
): Attachment | null {
  const card = findCard(board, columnId, cardId);
  if (!card || !dataUrl) return null;
  const attachment: Attachment = { id: makeId('att'), name, dataUrl, createdAt: Date.now() };
  card.attachments.push(attachment);
  touch(board);
  return attachment;
}

/** Delete an attachment from a card. */
export function removeAttachment(
  board: Board,
  columnId: string,
  cardId: string,
  attachmentId: string,
): boolean {
  const card = findCard(board, columnId, cardId);
  if (!card) return false;
  const index = card.attachments.findIndex((a) => a.id === attachmentId);
  if (index < 0) return false;
  card.attachments.splice(index, 1);
  touch(board);
  return true;
}

/** Prepend a comment to a card (newest first). Ignores blank text. */
export function addComment(board: Board, columnId: string, cardId: string, text: string): boolean {
  const trimmed = text.trim();
  const card = findCard(board, columnId, cardId);
  if (!card || !trimmed) return false;
  card.comments.unshift({ id: makeId('cmt'), text: trimmed, createdAt: Date.now() });
  touch(board);
  return true;
}

/** Replace a comment's text. Blank text is rejected (use removeComment instead). */
export function updateComment(
  board: Board,
  columnId: string,
  cardId: string,
  commentId: string,
  text: string,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const card = findCard(board, columnId, cardId);
  const comment = card?.comments.find((c) => c.id === commentId);
  if (!comment) return false;
  comment.text = trimmed;
  touch(board);
  return true;
}

/** Delete a comment from a card. */
export function removeComment(
  board: Board,
  columnId: string,
  cardId: string,
  commentId: string,
): boolean {
  const card = findCard(board, columnId, cardId);
  if (!card) return false;
  const index = card.comments.findIndex((c) => c.id === commentId);
  if (index < 0) return false;
  card.comments.splice(index, 1);
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

/** Move a whole list (with its cards) into the archive, keeping its position. */
export function archiveColumn(board: Board, columnId: string): boolean {
  const index = board.columns.findIndex((c) => c.id === columnId);
  if (index < 0) return false;
  const [column] = board.columns.splice(index, 1);
  board.archivedColumns.unshift({ column, index, archivedAt: Date.now() });
  touch(board);
  return true;
}

/** Restore an archived list near its original position (clamped into range). */
export function restoreColumn(board: Board, columnId: string): boolean {
  const i = board.archivedColumns.findIndex((a) => a.column.id === columnId);
  if (i < 0) return false;
  const [entry] = board.archivedColumns.splice(i, 1);
  const at = Math.max(0, Math.min(entry.index, board.columns.length));
  board.columns.splice(at, 0, entry.column);
  touch(board);
  return true;
}

/** Permanently remove an archived list. This cannot be undone. */
export function deleteArchivedColumn(board: Board, columnId: string): boolean {
  const i = board.archivedColumns.findIndex((a) => a.column.id === columnId);
  if (i < 0) return false;
  board.archivedColumns.splice(i, 1);
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

/** Maximum number of activity entries kept per board. */
export const ACTIVITY_LIMIT = 50;

/**
 * Record an activity entry (newest first). `kind` is the i18n key of the
 * message template; `params` fill its placeholders at render time.
 */
export function logActivity(board: Board, kind: string, params: string[]): void {
  const entry: ActivityEntry = { id: makeId('act'), kind, params, createdAt: Date.now() };
  board.activity.unshift(entry);
  if (board.activity.length > ACTIVITY_LIMIT) board.activity.length = ACTIVITY_LIMIT;
  touch(board);
}

/**
 * Deep-copy a whole board (Trello's "copy board") with the given name, insert
 * it right after the original and make it active. The copy starts unstarred
 * and with an empty activity log, since that history belongs to the original.
 */
export function duplicateBoard(data: AppData, boardId: string, name: string): Board | null {
  const index = data.boards.findIndex((b) => b.id === boardId);
  if (index < 0) return null;
  const copy = JSON.parse(JSON.stringify(data.boards[index])) as Board;
  copy.id = makeId('board');
  copy.name = name;
  copy.starred = false;
  copy.activity = [];
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  data.boards.splice(index + 1, 0, copy);
  data.activeBoardId = copy.id;
  return copy;
}

/**
 * Add an imported board and make it active. A board id that already exists is
 * regenerated so the import can never clobber an existing board.
 */
export function importBoard(data: AppData, board: Board): Board {
  if (data.boards.some((b) => b.id === board.id)) board.id = makeId('board');
  data.boards.push(board);
  data.activeBoardId = board.id;
  touch(board);
  return board;
}

/** Flip a board's starred flag. */
export function toggleBoardStar(board: Board): void {
  board.starred = !board.starred;
  touch(board);
}

/**
 * Boards for display: starred ones first, insertion order kept within each
 * group. The stored order is never mutated.
 */
export function sortedBoards(data: AppData): Board[] {
  return [...data.boards.filter((b) => b.starred), ...data.boards.filter((b) => !b.starred)];
}
