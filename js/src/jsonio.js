// Import/export of the whole application state as a single JSON document.
// Importing always runs through normalization so a malformed file cannot break
// the app.
import { normalizeAppData, normalizeBoard } from './normalize.js';
/** Trigger a browser download of `text` as a JSON file named `filename`. */
function downloadTextFile(text, filename) {
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
/** Read a File chosen by the user and resolve to its text content. */
function readTextFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}
/** Download the entire app state as a JSON file. */
export function downloadJson(data, filename = 'kanban-data.json') {
    downloadTextFile(JSON.stringify(data, null, 2), filename);
}
/** Download one board (Trello-style per-board export) as a JSON file. */
export function downloadBoardJson(board) {
    downloadTextFile(JSON.stringify({ kanbanBoard: 1, board }, null, 2), `${board.name || 'board'}.json`);
}
/**
 * Parse a single-board JSON export (wrapped `{ board: … }` or a bare board
 * object). Whole-app exports are rejected so they are not mangled into a
 * nonsense board; import those via the regular JSON import instead.
 */
export function parseBoardJson(text) {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object')
        throw new Error('not a board file');
    if (raw.board && typeof raw.board === 'object')
        return normalizeBoard(raw.board);
    if (Array.isArray(raw.boards))
        throw new Error('app data, not a single board');
    return normalizeBoard(raw);
}
/** Read a File chosen by the user and resolve to a valid single Board. */
export function readBoardJsonFile(file) {
    return readTextFile(file).then(parseBoardJson);
}
/** Parse JSON text into a valid AppData. Throws if the text is not JSON. */
export function parseJson(text) {
    const raw = JSON.parse(text);
    return normalizeAppData(raw);
}
/** Read a File chosen by the user and resolve to a valid AppData. */
export function readJsonFile(file) {
    return readTextFile(file).then(parseJson);
}
