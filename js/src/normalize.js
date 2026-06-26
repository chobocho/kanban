// Defensive normalization of arbitrary/untrusted data into a valid AppData.
// The app must keep working even if the stored DB is corrupted or an imported
// JSON file is malformed, so every field is validated and repaired here.
import { SCHEMA_VERSION } from './types.js';
import { createBoard, createColumn, createDefaultData } from './model.js';
import { makeId } from './id.js';
function asString(value, fallback) {
    return typeof value === 'string' ? value : fallback;
}
function asNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function normalizeCard(raw) {
    const obj = (raw ?? {});
    return {
        id: asString(obj.id, makeId('card')),
        text: asString(obj.text, ''),
        description: asString(obj.description, ''),
        color: asString(obj.color, ''),
        createdAt: asNumber(obj.createdAt, Date.now()),
    };
}
function normalizeColumn(raw) {
    const obj = (raw ?? {});
    const cards = Array.isArray(obj.cards) ? obj.cards.map(normalizeCard) : [];
    const column = createColumn(asString(obj.title, ''));
    column.id = asString(obj.id, column.id);
    column.cards = cards;
    return column;
}
function normalizeBoard(raw) {
    const obj = (raw ?? {});
    const columns = Array.isArray(obj.columns) ? obj.columns.map(normalizeColumn) : [];
    const board = createBoard(asString(obj.name, 'Board'), columns);
    board.id = asString(obj.id, board.id);
    board.createdAt = asNumber(obj.createdAt, board.createdAt);
    board.updatedAt = asNumber(obj.updatedAt, board.updatedAt);
    return board;
}
function normalizeLang(value) {
    return value === 'en' ? 'en' : 'ko';
}
/**
 * Coerce any value into a valid {@link AppData}. Never throws. If nothing
 * usable is present, a fresh default state is returned.
 */
export function normalizeAppData(raw) {
    if (!raw || typeof raw !== 'object')
        return createDefaultData();
    const obj = raw;
    const boards = Array.isArray(obj.boards) ? obj.boards.map(normalizeBoard) : [];
    if (boards.length === 0)
        return createDefaultData();
    let activeBoardId = typeof obj.activeBoardId === 'string' ? obj.activeBoardId : null;
    if (!boards.some((b) => b.id === activeBoardId)) {
        activeBoardId = boards[0].id;
    }
    const settings = (obj.settings ?? {});
    const zoom = asNumber(settings.zoom, 1);
    return {
        version: SCHEMA_VERSION,
        boards,
        activeBoardId,
        settings: {
            lang: normalizeLang(settings.lang),
            zoom: Math.max(0.4, Math.min(zoom, 2.5)),
        },
    };
}
