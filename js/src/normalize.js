// Defensive normalization of arbitrary/untrusted data into a valid AppData.
// The app must keep working even if the stored DB is corrupted or an imported
// JSON file is malformed, so every field is validated and repaired here.
import { SCHEMA_VERSION, } from './types.js';
import { createBoard, createColumn, createDefaultData, defaultLabels } from './model.js';
import { makeId } from './id.js';
function asString(value, fallback) {
    return typeof value === 'string' ? value : fallback;
}
function asNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function normalizeLabel(raw) {
    const obj = (raw ?? {});
    return {
        id: asString(obj.id, makeId('label')),
        name: asString(obj.name, ''),
        color: asString(obj.color, ''),
    };
}
function normalizeChecklistItem(raw) {
    const obj = (raw ?? {});
    return {
        id: asString(obj.id, makeId('chk')),
        text: asString(obj.text, ''),
        done: obj.done === true,
    };
}
function normalizeComment(raw) {
    const obj = (raw ?? {});
    return {
        id: asString(obj.id, makeId('cmt')),
        text: asString(obj.text, ''),
        createdAt: asNumber(obj.createdAt, Date.now()),
    };
}
/** An attachment without image data is useless, so such entries are dropped. */
function normalizeAttachment(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const obj = raw;
    if (typeof obj.dataUrl !== 'string' || obj.dataUrl === '')
        return null;
    return {
        id: asString(obj.id, makeId('att')),
        name: asString(obj.name, ''),
        dataUrl: obj.dataUrl,
        createdAt: asNumber(obj.createdAt, Date.now()),
    };
}
function normalizeCard(raw) {
    const obj = (raw ?? {});
    const labelIds = Array.isArray(obj.labelIds)
        ? obj.labelIds.filter((id) => typeof id === 'string')
        : [];
    const checklist = Array.isArray(obj.checklist)
        ? obj.checklist.map(normalizeChecklistItem)
        : [];
    const comments = Array.isArray(obj.comments) ? obj.comments.map(normalizeComment) : [];
    const attachments = Array.isArray(obj.attachments)
        ? obj.attachments.map(normalizeAttachment).filter((a) => a !== null)
        : [];
    return {
        id: asString(obj.id, makeId('card')),
        text: asString(obj.text, ''),
        description: asString(obj.description, ''),
        labelIds,
        checklist,
        comments,
        attachments,
        startAt: typeof obj.startAt === 'number' && Number.isFinite(obj.startAt) ? obj.startAt : null,
        dueAt: typeof obj.dueAt === 'number' && Number.isFinite(obj.dueAt) ? obj.dueAt : null,
        dueDone: obj.dueDone === true,
        color: asString(obj.color, ''),
        createdAt: asNumber(obj.createdAt, Date.now()),
    };
}
function normalizeArchived(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const obj = raw;
    if (!obj.card || typeof obj.card !== 'object')
        return null; // junk entry, skip
    return {
        card: normalizeCard(obj.card),
        columnId: asString(obj.columnId, ''),
        archivedAt: asNumber(obj.archivedAt, Date.now()),
    };
}
function normalizeArchivedColumn(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const obj = raw;
    if (!obj.column || typeof obj.column !== 'object')
        return null; // junk entry, skip
    return {
        column: normalizeColumn(obj.column),
        index: asNumber(obj.index, 0),
        archivedAt: asNumber(obj.archivedAt, Date.now()),
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
    // Keep stored labels, or seed defaults for boards saved before labels existed.
    const labels = Array.isArray(obj.labels) ? obj.labels.map(normalizeLabel) : [];
    board.labels = labels.length > 0 ? labels : defaultLabels();
    board.archived = Array.isArray(obj.archived)
        ? obj.archived.map(normalizeArchived).filter((a) => a !== null)
        : [];
    board.background = asString(obj.background, '');
    board.archivedColumns = Array.isArray(obj.archivedColumns)
        ? obj.archivedColumns
            .map(normalizeArchivedColumn)
            .filter((a) => a !== null)
        : [];
    // Drop any card label references that no longer point at a real label,
    // covering live cards, archived cards and cards inside archived lists.
    const known = new Set(board.labels.map((l) => l.id));
    const clean = (card) => {
        card.labelIds = card.labelIds.filter((id) => known.has(id));
    };
    for (const column of board.columns)
        column.cards.forEach(clean);
    for (const entry of board.archived)
        clean(entry.card);
    for (const entry of board.archivedColumns)
        entry.column.cards.forEach(clean);
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
