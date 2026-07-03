// Import/export of the whole application state as a single JSON document.
// Importing always runs through normalization so a malformed file cannot break
// the app.

import { AppData, Board } from './types.js';
import { normalizeAppData, normalizeBoard } from './normalize.js';

/** Download the entire app state as a JSON file. */
export function downloadJson(data: AppData, filename = 'kanban-data.json'): void {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Download one board (Trello-style per-board export) as a JSON file. */
export function downloadBoardJson(board: Board): void {
  const text = JSON.stringify({ kanbanBoard: 1, board }, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${board.name || 'board'}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Parse a single-board JSON export (wrapped `{ board: … }` or a bare board
 * object). Whole-app exports are rejected so they are not mangled into a
 * nonsense board; import those via the regular JSON import instead.
 */
export function parseBoardJson(text: string): Board {
  const raw = JSON.parse(text) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') throw new Error('not a board file');
  if (raw.board && typeof raw.board === 'object') return normalizeBoard(raw.board);
  if (Array.isArray(raw.boards)) throw new Error('app data, not a single board');
  return normalizeBoard(raw);
}

/** Read a File chosen by the user and resolve to a valid single Board. */
export function readBoardJsonFile(file: File): Promise<Board> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseBoardJson(String(reader.result)));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Parse JSON text into a valid AppData. Throws if the text is not JSON. */
export function parseJson(text: string): AppData {
  const raw = JSON.parse(text);
  return normalizeAppData(raw);
}

/** Read a File chosen by the user and resolve to a valid AppData. */
export function readJsonFile(file: File): Promise<AppData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseJson(String(reader.result)));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
