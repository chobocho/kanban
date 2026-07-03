// Unit tests for the pure board operations in src/model.ts.
import { test, assert, assertEqual } from './harness.js';
import { createDefaultData, createBoard, createColumn, addColumn, renameColumn, removeColumn, moveColumn, addCard, updateCard, removeCard, moveCard, getActiveBoard, addLabel, updateLabel, removeLabel, toggleCardLabel, archiveCard, restoreCard, deleteArchivedCard, archiveColumn, restoreColumn, deleteArchivedColumn, addChecklist, renameChecklist, removeChecklist, addChecklistItem, toggleChecklistItem, snapshotColumns, updateChecklistItem, removeChecklistItem, moveChecklistItem, checklistProgress, addComment, updateComment, removeComment, duplicateCard, sortColumnCards, duplicateColumn, moveAllCards, setBoardBackground, addAttachment, removeAttachment, createCardFromTemplate, toggleBoardStar, sortedBoards, logActivity, ACTIVITY_LIMIT, addCardsFromText, importBoard, duplicateBoard, } from '../src/model.js';
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
test('updateCard sets and clears the start date', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    assertEqual(card.startAt, null, 'new card has no start date');
    assert(updateCard(board, colId, card.id, { startAt: 500 }), 'update ok');
    assertEqual(board.columns[0].cards[0].startAt, 500, 'start date set');
    assert(updateCard(board, colId, card.id, { startAt: null }), 'clear ok');
    assertEqual(board.columns[0].cards[0].startAt, null, 'start date cleared');
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
test('updateLabel changes a label color independently of the name', () => {
    const board = createBoard('b');
    const labelId = board.labels[0].id;
    updateLabel(board, labelId, { name: 'Bug' });
    assert(updateLabel(board, labelId, { color: '#123456' }), 'update ok');
    assertEqual(board.labels[0].color, '#123456', 'color patched');
    assertEqual(board.labels[0].name, 'Bug', 'name untouched');
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
test('archiveCard moves a card into the board archive', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    assert(archiveCard(board, colId, card.id), 'archive ok');
    assertEqual(board.columns[0].cards.length, 0, 'removed from column');
    assertEqual(board.archived.length, 1, 'added to archive');
    assertEqual(board.archived[0].card.id, card.id, 'same card archived');
    assert(!archiveCard(board, colId, 'missing'), 'unknown card rejected');
});
test('restoreCard returns a card to its origin column', () => {
    const board = createBoard('b', [createColumn('A'), createColumn('B')]);
    const colId = board.columns[1].id;
    const card = addCard(board, colId, 'a');
    archiveCard(board, colId, card.id);
    assert(restoreCard(board, card.id), 'restore ok');
    assertEqual(board.archived.length, 0, 'removed from archive');
    assertEqual(board.columns[1].cards[0].id, card.id, 'back in origin column');
});
test('restoreCard falls back to the first column when origin is gone', () => {
    const board = createBoard('b', [createColumn('A'), createColumn('B')]);
    const colId = board.columns[1].id;
    const card = addCard(board, colId, 'a');
    archiveCard(board, colId, card.id);
    removeColumn(board, colId); // delete the origin column
    assert(restoreCard(board, card.id), 'restore ok');
    assertEqual(board.columns[0].cards[0].id, card.id, 'restored into first column');
});
test('deleteArchivedCard permanently removes an archived card', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    archiveCard(board, colId, card.id);
    assert(deleteArchivedCard(board, card.id), 'delete ok');
    assertEqual(board.archived.length, 0, 'archive empty');
    assert(!restoreCard(board, card.id), 'cannot restore a purged card');
});
test('archiveColumn moves a whole list (with cards) into the archive', () => {
    const board = createBoard('b', [createColumn('A'), createColumn('B')]);
    const colId = board.columns[0].id;
    addCard(board, colId, 'c1');
    assert(archiveColumn(board, colId), 'archive ok');
    assertEqual(board.columns.length, 1, 'column removed');
    assertEqual(board.archivedColumns.length, 1, 'added to column archive');
    assertEqual(board.archivedColumns[0].column.cards.length, 1, 'cards travel with the list');
    assert(!archiveColumn(board, 'missing'), 'unknown column rejected');
});
test('restoreColumn returns a list near its original position', () => {
    const board = createBoard('b', [createColumn('A'), createColumn('B'), createColumn('C')]);
    const midId = board.columns[1].id;
    archiveColumn(board, midId); // was at index 1
    assertEqual(board.columns.map((c) => c.title).join(''), 'AC', 'B removed');
    assert(restoreColumn(board, midId), 'restore ok');
    assertEqual(board.columns.map((c) => c.title).join(''), 'ABC', 'B restored to index 1');
    assertEqual(board.archivedColumns.length, 0, 'archive cleared');
});
test('deleteArchivedColumn permanently removes an archived list', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    archiveColumn(board, colId);
    assert(deleteArchivedColumn(board, colId), 'delete ok');
    assertEqual(board.archivedColumns.length, 0, 'archive empty');
    assert(!restoreColumn(board, colId), 'cannot restore a purged list');
});
test('checklist items add, toggle, rename, remove and report progress', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    assertEqual(card.checklists.length, 0, 'starts with no checklists');
    const cl = addChecklist(board, colId, card.id, 'Steps');
    assert(cl !== null, 'checklist created');
    assertEqual(card.checklists[0].name, 'Steps', 'name stored');
    assert(addChecklistItem(board, colId, card.id, cl.id, 'step 1'), 'add ok');
    assert(!addChecklistItem(board, colId, card.id, cl.id, '   '), 'blank item rejected');
    assert(addChecklistItem(board, colId, card.id, cl.id, 'step 2'), 'add 2 ok');
    assertEqual(cl.items.length, 2, 'two items');
    let prog = checklistProgress(card);
    assertEqual(`${prog.done}/${prog.total}`, '0/2', 'nothing done yet');
    const firstId = cl.items[0].id;
    assert(updateChecklistItem(board, colId, card.id, cl.id, firstId, { done: true }), 'toggle ok');
    prog = checklistProgress(card);
    assertEqual(`${prog.done}/${prog.total}`, '1/2', 'one done');
    assert(updateChecklistItem(board, colId, card.id, cl.id, firstId, { text: 'renamed' }), 'rename ok');
    assertEqual(cl.items[0].text, 'renamed', 'text patched');
    assert(removeChecklistItem(board, colId, card.id, cl.id, firstId), 'remove ok');
    assertEqual(cl.items.length, 1, 'one left');
    assert(!removeChecklistItem(board, colId, card.id, cl.id, 'missing'), 'unknown item rejected');
});
test('toggleChecklistItem flips the done state', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    const cl = addChecklist(board, colId, card.id, 'Steps');
    addChecklistItem(board, colId, card.id, cl.id, 'step');
    const itemId = cl.items[0].id;
    assert(toggleChecklistItem(board, colId, card.id, cl.id, itemId), 'toggle on ok');
    assertEqual(cl.items[0].done, true, 'now done');
    assert(toggleChecklistItem(board, colId, card.id, cl.id, itemId), 'toggle off ok');
    assertEqual(cl.items[0].done, false, 'back to open');
    assert(!toggleChecklistItem(board, colId, card.id, cl.id, 'missing'), 'unknown item rejected');
});
test('snapshotColumns deep-copies structure but shares attachment strings', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    const cl = addChecklist(board, colId, card.id, 'Steps');
    addChecklistItem(board, colId, card.id, cl.id, 'step');
    addComment(board, colId, card.id, 'note');
    addAttachment(board, colId, card.id, 'pic.png', 'data:image/png;base64,AAAA');
    const snap = snapshotColumns(board.columns);
    assertEqual(snap[0].cards[0].text, 'a', 'content copied');
    assert(snap[0] !== board.columns[0], 'column object is a copy');
    assert(snap[0].cards[0] !== card, 'card object is a copy');
    assert(snap[0].cards[0].checklists[0].items[0] !== cl.items[0], 'items are copies');
    assert(snap[0].cards[0].attachments[0].dataUrl === card.attachments[0].dataUrl, 'attachment data URL string is shared, not re-serialized');
    // Mutating the live board must not affect the snapshot.
    card.text = 'changed';
    cl.items[0].done = true;
    card.labelIds.push('x');
    assertEqual(snap[0].cards[0].text, 'a', 'snapshot text isolated');
    assertEqual(snap[0].cards[0].checklists[0].items[0].done, false, 'snapshot item isolated');
    assertEqual(snap[0].cards[0].labelIds.length, 0, 'snapshot labelIds isolated');
});
test('multiple checklists: rename, delete and aggregated progress', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    const first = addChecklist(board, colId, card.id, 'One');
    const second = addChecklist(board, colId, card.id, 'Two');
    assertEqual(card.checklists.length, 2, 'two checklists');
    addChecklistItem(board, colId, card.id, first.id, 'a');
    addChecklistItem(board, colId, card.id, second.id, 'b');
    addChecklistItem(board, colId, card.id, second.id, 'c');
    updateChecklistItem(board, colId, card.id, second.id, second.items[0].id, { done: true });
    const prog = checklistProgress(card);
    assertEqual(`${prog.done}/${prog.total}`, '1/3', 'progress aggregates across checklists');
    assert(renameChecklist(board, colId, card.id, second.id, 'Renamed'), 'rename ok');
    assertEqual(card.checklists[1].name, 'Renamed', 'name patched');
    assert(!renameChecklist(board, colId, card.id, 'missing', 'x'), 'unknown checklist rejected');
    assert(removeChecklist(board, colId, card.id, first.id), 'delete ok');
    assertEqual(card.checklists.length, 1, 'one checklist left');
    assert(!removeChecklist(board, colId, card.id, 'missing'), 'unknown delete rejected');
});
test('comments add newest-first, edit, remove and reject blanks', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    assertEqual(card.comments.length, 0, 'starts empty');
    assert(addComment(board, colId, card.id, 'first'), 'add ok');
    assert(!addComment(board, colId, card.id, '   '), 'blank comment rejected');
    assert(addComment(board, colId, card.id, 'second'), 'add 2 ok');
    assertEqual(card.comments.length, 2, 'two comments');
    assertEqual(card.comments[0].text, 'second', 'newest comment first');
    const id = card.comments[0].id;
    assert(updateComment(board, colId, card.id, id, 'edited'), 'edit ok');
    assertEqual(card.comments[0].text, 'edited', 'text patched');
    assert(!updateComment(board, colId, card.id, id, '  '), 'blank edit rejected');
    assertEqual(card.comments[0].text, 'edited', 'blank edit kept old text');
    assert(!updateComment(board, colId, card.id, 'missing', 'x'), 'unknown comment rejected');
    assert(removeComment(board, colId, card.id, id), 'remove ok');
    assertEqual(card.comments.length, 1, 'one left');
    assert(!removeComment(board, colId, card.id, 'missing'), 'unknown remove rejected');
});
test('duplicateCard copies content with fresh ids, right after the original', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'original');
    addCard(board, colId, 'tail');
    updateCard(board, colId, card.id, {
        description: 'desc',
        startAt: 4000,
        dueAt: 5000,
        dueDone: true,
        color: '#f00',
    });
    toggleCardLabel(board, colId, card.id, board.labels[0].id);
    const dupCl = addChecklist(board, colId, card.id, 'Steps');
    addChecklistItem(board, colId, card.id, dupCl.id, 'step');
    updateChecklistItem(board, colId, card.id, dupCl.id, dupCl.items[0].id, { done: true });
    addComment(board, colId, card.id, 'note');
    const copy = duplicateCard(board, colId, card.id);
    assert(copy !== null, 'copy created');
    assertEqual(board.columns[0].cards.map((c) => c.text).join(','), 'original,original,tail', 'inserted after original');
    assert(copy.id !== card.id, 'fresh card id');
    assertEqual(copy.description, 'desc', 'description copied');
    assertEqual(copy.startAt, 4000, 'start date copied');
    assertEqual(copy.dueAt, 5000, 'due date copied');
    assertEqual(copy.dueDone, true, 'due state copied');
    assertEqual(copy.color, '#f00', 'color copied');
    assertEqual(copy.labelIds.join(''), card.labelIds.join(''), 'labels copied');
    assertEqual(copy.checklists.length, 1, 'checklist copied');
    assertEqual(copy.checklists[0].items[0].done, true, 'checklist state copied');
    assert(copy.checklists[0].id !== dupCl.id, 'fresh checklist id');
    assert(copy.checklists[0].items[0].id !== dupCl.items[0].id, 'fresh checklist item id');
    assertEqual(copy.comments.length, 0, 'comments are not copied');
    assertEqual(duplicateCard(board, colId, 'missing'), null, 'unknown card rejected');
});
test('sortColumnCards sorts by name, creation date and due date', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const b = addCard(board, colId, 'banana');
    const a = addCard(board, colId, 'apple');
    const c = addCard(board, colId, 'cherry');
    a.createdAt = 100;
    b.createdAt = 300;
    c.createdAt = 200;
    updateCard(board, colId, a.id, { dueAt: 5000 });
    updateCard(board, colId, c.id, { dueAt: 1000 });
    assert(sortColumnCards(board, colId, 'name'), 'sort by name ok');
    assertEqual(board.columns[0].cards.map((x) => x.text).join(','), 'apple,banana,cherry', 'alphabetical');
    assert(sortColumnCards(board, colId, 'created'), 'sort by created ok');
    assertEqual(board.columns[0].cards.map((x) => x.text).join(','), 'banana,cherry,apple', 'newest first');
    assert(sortColumnCards(board, colId, 'due'), 'sort by due ok');
    assertEqual(board.columns[0].cards.map((x) => x.text).join(','), 'cherry,apple,banana', 'earliest due first, no due date last');
    assert(!sortColumnCards(board, 'missing', 'name'), 'unknown column rejected');
});
test('duplicateColumn copies the list and its cards with fresh ids', () => {
    const board = createBoard('b', [createColumn('A'), createColumn('B')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'x');
    const cl = addChecklist(board, colId, card.id, 'Steps');
    addChecklistItem(board, colId, card.id, cl.id, 'step');
    const copy = duplicateColumn(board, colId);
    assert(copy !== null, 'copy created');
    assertEqual(board.columns.map((c) => c.title).join(','), 'A,A,B', 'inserted after original');
    assert(copy.id !== colId, 'fresh column id');
    assertEqual(copy.cards.length, 1, 'cards copied');
    assert(copy.cards[0].id !== card.id, 'fresh card id');
    assertEqual(copy.cards[0].text, 'x', 'card content copied');
    assertEqual(copy.cards[0].checklists[0].items.length, 1, 'checklist copied');
    assertEqual(duplicateColumn(board, 'missing'), null, 'unknown column rejected');
});
test('moveAllCards appends every card to the target list', () => {
    const board = createBoard('b', [createColumn('A'), createColumn('B')]);
    const a = board.columns[0].id;
    const b = board.columns[1].id;
    addCard(board, a, 'c1');
    addCard(board, a, 'c2');
    addCard(board, b, 'x');
    assert(moveAllCards(board, a, b), 'move ok');
    assertEqual(board.columns[0].cards.length, 0, 'source emptied');
    assertEqual(board.columns[1].cards.map((c) => c.text).join(','), 'x,c1,c2', 'appended in order');
    assert(!moveAllCards(board, a, a), 'same column rejected');
    assert(!moveAllCards(board, 'missing', b), 'unknown source rejected');
});
test('attachments add, remove and reject an empty data url', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    assertEqual(card.attachments.length, 0, 'starts empty');
    const att = addAttachment(board, colId, card.id, 'pic.png', 'data:image/png;base64,AAAA');
    assert(att !== null, 'add ok');
    assertEqual(card.attachments.length, 1, 'one attachment');
    assertEqual(card.attachments[0].name, 'pic.png', 'name stored');
    assertEqual(addAttachment(board, colId, card.id, 'x', ''), null, 'empty data url rejected');
    assertEqual(addAttachment(board, 'missing', card.id, 'x', 'data:'), null, 'unknown column rejected');
    assert(removeAttachment(board, colId, card.id, att.id), 'remove ok');
    assertEqual(card.attachments.length, 0, 'empty again');
    assert(!removeAttachment(board, colId, card.id, 'missing'), 'unknown attachment rejected');
});
test('duplicateCard copies attachments with fresh ids', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    addAttachment(board, colId, card.id, 'pic.png', 'data:image/png;base64,AAAA');
    const copy = duplicateCard(board, colId, card.id);
    assertEqual(copy.attachments.length, 1, 'attachment copied');
    assertEqual(copy.attachments[0].dataUrl, 'data:image/png;base64,AAAA', 'data copied');
    assert(copy.attachments[0].id !== card.attachments[0].id, 'fresh attachment id');
});
test('card templates: flag toggles and creating from a template appends a copy', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'tpl');
    addCard(board, colId, 'tail');
    assertEqual(card.isTemplate, false, 'new card is not a template');
    assert(updateCard(board, colId, card.id, { isTemplate: true }), 'flag set ok');
    assertEqual(card.isTemplate, true, 'card is now a template');
    const tplCl = addChecklist(board, colId, card.id, 'Steps');
    addChecklistItem(board, colId, card.id, tplCl.id, 'step');
    toggleCardLabel(board, colId, card.id, board.labels[0].id);
    const made = createCardFromTemplate(board, colId, card.id);
    assert(made !== null, 'card created from template');
    assertEqual(board.columns[0].cards.length, 3, 'appended to the list');
    assertEqual(board.columns[0].cards[2].id, made.id, 'appended at the end');
    assertEqual(made.isTemplate, false, 'created card is not a template');
    assert(made.id !== card.id, 'fresh id');
    assertEqual(made.text, 'tpl', 'text copied');
    assertEqual(made.checklists[0].items.length, 1, 'checklist copied');
    assertEqual(made.labelIds.length, 1, 'labels copied');
    assertEqual(createCardFromTemplate(board, colId, 'missing'), null, 'unknown card rejected');
});
test('duplicateCard keeps the template flag', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'tpl');
    updateCard(board, colId, card.id, { isTemplate: true });
    const copy = duplicateCard(board, colId, card.id);
    assertEqual(copy.isTemplate, true, 'copy is also a template');
});
test('setBoardBackground sets, clears and skips no-op changes', () => {
    const board = createBoard('b');
    assertEqual(board.background, '', 'new board has the default background');
    assert(setBoardBackground(board, '#0079bf'), 'set ok');
    assertEqual(board.background, '#0079bf', 'background stored');
    assert(!setBoardBackground(board, '#0079bf'), 'same color is a no-op');
    assert(setBoardBackground(board, ''), 'clear ok');
    assertEqual(board.background, '', 'back to default');
});
test('toggleBoardStar flips the starred flag', () => {
    const board = createBoard('b');
    assertEqual(board.starred, false, 'new board is not starred');
    toggleBoardStar(board);
    assertEqual(board.starred, true, 'starred after toggle');
    toggleBoardStar(board);
    assertEqual(board.starred, false, 'unstarred after second toggle');
});
test('sortedBoards lists starred boards first, keeping order within groups', () => {
    const data = createDefaultData();
    data.boards = [createBoard('A'), createBoard('B'), createBoard('C'), createBoard('D')];
    toggleBoardStar(data.boards[1]); // B
    toggleBoardStar(data.boards[3]); // D
    const names = sortedBoards(data).map((b) => b.name).join(',');
    assertEqual(names, 'B,D,A,C', 'starred first, insertion order preserved');
    assertEqual(data.boards.map((b) => b.name).join(','), 'A,B,C,D', 'stored order untouched');
});
test('addCardsFromText makes one card per non-empty line', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    addCard(board, colId, 'existing');
    const cards = addCardsFromText(board, colId, 'one\r\n  two  \n\n   \nthree\n');
    assertEqual(cards.length, 3, 'three cards created');
    assertEqual(board.columns[0].cards.map((c) => c.text).join(','), 'existing,one,two,three', 'appended in order, trimmed, blanks skipped');
    assertEqual(addCardsFromText(board, colId, '   \n \n').length, 0, 'blank text makes nothing');
    assertEqual(addCardsFromText(board, 'missing', 'x').length, 0, 'unknown column makes nothing');
});
test('logActivity keeps newest-first entries capped at the limit', () => {
    const board = createBoard('b');
    assertEqual(board.activity.length, 0, 'starts empty');
    logActivity(board, 'activityCardAdd', ['first', 'To Do']);
    logActivity(board, 'activityCardAdd', ['second', 'To Do']);
    assertEqual(board.activity.length, 2, 'two entries');
    assertEqual(board.activity[0].params[0], 'second', 'newest entry first');
    assertEqual(board.activity[0].kind, 'activityCardAdd', 'kind stored');
    for (let i = 0; i < ACTIVITY_LIMIT + 10; i++) {
        logActivity(board, 'activityCardAdd', [`bulk ${i}`, 'To Do']);
    }
    assertEqual(board.activity.length, ACTIVITY_LIMIT, 'capped at the limit');
    assertEqual(board.activity[0].params[0], `bulk ${ACTIVITY_LIMIT + 9}`, 'latest kept');
});
test('importBoard appends, activates and avoids id collisions', () => {
    const data = createDefaultData();
    const incoming = createBoard('Imported');
    const imported = importBoard(data, incoming);
    assertEqual(data.boards.length, 2, 'board appended');
    assertEqual(data.activeBoardId, imported.id, 'imported board becomes active');
    // Importing a board whose id already exists gets a fresh id.
    const clone = JSON.parse(JSON.stringify(imported));
    const again = importBoard(data, clone);
    assertEqual(data.boards.length, 3, 'second copy appended');
    assert(again.id !== imported.id, 'colliding id regenerated');
});
test('moveChecklistItem shifts an item and stops at the edges', () => {
    const board = createBoard('b', [createColumn('A')]);
    const colId = board.columns[0].id;
    const card = addCard(board, colId, 'a');
    const cl = addChecklist(board, colId, card.id, 'Steps');
    addChecklistItem(board, colId, card.id, cl.id, 'one');
    addChecklistItem(board, colId, card.id, cl.id, 'two');
    addChecklistItem(board, colId, card.id, cl.id, 'three');
    const texts = () => cl.items.map((i) => i.text).join(',');
    const secondId = cl.items[1].id;
    assert(moveChecklistItem(board, colId, card.id, cl.id, secondId, -1), 'move up ok');
    assertEqual(texts(), 'two,one,three', 'moved above the first item');
    assert(!moveChecklistItem(board, colId, card.id, cl.id, secondId, -1), 'top edge rejected');
    assert(moveChecklistItem(board, colId, card.id, cl.id, secondId, 1), 'move down ok');
    assert(moveChecklistItem(board, colId, card.id, cl.id, secondId, 1), 'move down again ok');
    assertEqual(texts(), 'one,three,two', 'moved to the end');
    assert(!moveChecklistItem(board, colId, card.id, cl.id, secondId, 1), 'bottom edge rejected');
    assert(!moveChecklistItem(board, colId, card.id, cl.id, 'missing', 1), 'unknown item rejected');
});
test('duplicateBoard deep-copies content and activates the copy', () => {
    const data = createDefaultData();
    const source = data.boards[0];
    const colId = source.columns[0].id;
    addCard(data.boards[0], colId, 'original card');
    toggleBoardStar(source);
    logActivity(source, 'activityCardAdd', ['x', 'y']);
    const copy = duplicateBoard(data, source.id, 'My Copy');
    assert(copy !== null, 'copy created');
    assertEqual(data.boards.length, 2, 'copy appended');
    assertEqual(data.boards[1].id, copy.id, 'inserted after the original');
    assertEqual(data.activeBoardId, copy.id, 'copy becomes active');
    assert(copy.id !== source.id, 'fresh board id');
    assertEqual(copy.name, 'My Copy', 'given name applied');
    assertEqual(copy.columns[0].cards[0].text, 'original card', 'cards copied');
    assertEqual(copy.starred, false, 'copy starts unstarred');
    assertEqual(copy.activity.length, 0, 'activity log not inherited');
    copy.columns[0].cards[0].text = 'changed';
    assertEqual(source.columns[0].cards[0].text, 'original card', 'deep copy, original untouched');
    assertEqual(duplicateBoard(data, 'missing', 'x'), null, 'unknown board rejected');
});
test('getActiveBoard returns the active board', () => {
    const data = createDefaultData();
    const board = getActiveBoard(data);
    assert(board !== undefined, 'found');
    assertEqual(board.id, data.activeBoardId, 'matches active id');
});
