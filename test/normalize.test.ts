// Unit tests for defensive normalization in src/normalize.ts.

import { test, assert, assertEqual } from './harness.js';
import { normalizeAppData } from '../src/normalize.js';

test('null input yields default data', () => {
  const data = normalizeAppData(null);
  assert(data.boards.length >= 1, 'has a board');
  assertEqual(data.version, 2, 'version set');
});

test('garbage input yields default data', () => {
  const data = normalizeAppData(42 as unknown);
  assert(data.boards.length >= 1, 'has a board');
});

test('empty boards array yields default data', () => {
  const data = normalizeAppData({ boards: [] });
  assert(data.boards.length >= 1, 'repaired');
});

test('partial board is repaired with defaults', () => {
  const data = normalizeAppData({
    boards: [{ name: 'X', columns: [{ title: 'C', cards: [{ text: 'hi' }] }] }],
  });
  assertEqual(data.boards[0].name, 'X', 'name kept');
  assertEqual(data.boards[0].columns[0].cards[0].text, 'hi', 'card text kept');
  assert(typeof data.boards[0].id === 'string', 'id generated');
  assert(typeof data.boards[0].columns[0].cards[0].color === 'string', 'color defaulted');
  assertEqual(data.boards[0].columns[0].cards[0].description, '', 'description defaulted');
  assertEqual(data.boards[0].columns[0].cards[0].labelIds.length, 0, 'labelIds defaulted');
  assert(data.boards[0].labels.length > 0, 'labels seeded for legacy board');
  assertEqual(data.boards[0].columns[0].cards[0].dueAt, null, 'dueAt defaulted to null');
  assertEqual(data.boards[0].columns[0].cards[0].dueDone, false, 'dueDone defaulted');
  assertEqual(data.boards[0].columns[0].cards[0].checklists.length, 0, 'checklists defaulted');
  assert(Array.isArray(data.boards[0].archived), 'archived defaulted to array');
  assertEqual(data.boards[0].archived.length, 0, 'archived empty by default');
  assert(Array.isArray(data.boards[0].archivedColumns), 'archivedColumns defaulted to array');
  assertEqual(data.boards[0].archivedColumns.length, 0, 'archivedColumns empty by default');
});

test('valid archived columns are kept and junk entries dropped', () => {
  const data = normalizeAppData({
    boards: [
      {
        id: 'b1',
        name: 'A',
        columns: [],
        archivedColumns: [
          { column: { id: 'k', title: 'Kept', cards: [{ text: 'x' }] }, index: 2, archivedAt: 9 },
          { index: 0 }, // no column -> dropped
          5,
        ],
      },
    ],
  });
  assertEqual(data.boards[0].archivedColumns.length, 1, 'only the valid list kept');
  assertEqual(data.boards[0].archivedColumns[0].column.title, 'Kept', 'list title kept');
  assertEqual(data.boards[0].archivedColumns[0].column.cards[0].text, 'x', 'nested card kept');
});

test('valid archived cards are kept and junk entries dropped', () => {
  const data = normalizeAppData({
    boards: [
      {
        id: 'b1',
        name: 'A',
        columns: [{ id: 'c1', title: 'C', cards: [] }],
        archived: [
          { card: { id: 'k1', text: 'kept' }, columnId: 'c1', archivedAt: 5 },
          { columnId: 'c1' }, // no card -> dropped
          'garbage',
        ],
      },
    ],
  });
  assertEqual(data.boards[0].archived.length, 1, 'only the valid entry kept');
  assertEqual(data.boards[0].archived[0].card.text, 'kept', 'archived card text kept');
  assertEqual(data.boards[0].archived[0].columnId, 'c1', 'origin column kept');
});

test('board background is kept and defaulted when missing', () => {
  const data = normalizeAppData({
    boards: [
      { id: 'b1', name: 'A', columns: [], background: '#519839' },
      { id: 'b2', name: 'B', columns: [] },
    ],
  });
  assertEqual(data.boards[0].background, '#519839', 'stored background kept');
  assertEqual(data.boards[1].background, '', 'missing background defaults to empty');
});

test('board activity is kept, junk dropped, and defaulted when missing', () => {
  const data = normalizeAppData({
    boards: [
      {
        id: 'b1',
        name: 'A',
        columns: [],
        activity: [
          { id: 'e1', kind: 'activityCardAdd', params: ['x', 'To Do', 7], createdAt: 5 },
          { id: 'e2', params: [] }, // no kind -> dropped
          'junk',
        ],
      },
      { id: 'b2', name: 'B', columns: [] },
    ],
  });
  const activity = data.boards[0].activity;
  assertEqual(activity.length, 1, 'only the valid entry kept');
  assertEqual(activity[0].kind, 'activityCardAdd', 'kind kept');
  assertEqual(activity[0].params.join(','), 'x,To Do', 'string params kept, junk params dropped');
  assertEqual(activity[0].createdAt, 5, 'timestamp kept');
  assertEqual(data.boards[1].activity.length, 0, 'missing activity defaults to empty');
});

test('board starred flag is kept and defaulted when missing', () => {
  const data = normalizeAppData({
    boards: [
      { id: 'b1', name: 'A', columns: [], starred: true },
      { id: 'b2', name: 'B', columns: [] },
    ],
  });
  assertEqual(data.boards[0].starred, true, 'stored star kept');
  assertEqual(data.boards[1].starred, false, 'missing star defaults to false');
});

test('attachments are kept, junk dropped, and defaulted when missing', () => {
  const data = normalizeAppData({
    boards: [
      {
        id: 'b1',
        name: 'A',
        columns: [
          {
            title: 'C',
            cards: [
              {
                text: 'x',
                attachments: [
                  { id: 'a1', name: 'pic.png', dataUrl: 'data:image/png;base64,AA', createdAt: 3 },
                  { id: 'a2', name: 'broken' }, // no dataUrl -> dropped
                  'junk',
                ],
              },
              { text: 'y' },
            ],
          },
        ],
      },
    ],
  });
  const [withAtt, without] = data.boards[0].columns[0].cards;
  assertEqual(withAtt.attachments.length, 1, 'only the valid attachment kept');
  assertEqual(withAtt.attachments[0].name, 'pic.png', 'name kept');
  assertEqual(without.attachments.length, 0, 'missing attachments default to empty');
});

test('legacy single checklist migrates into one checklist group', () => {
  const data = normalizeAppData({
    boards: [
      {
        id: 'b1',
        name: 'A',
        columns: [
          {
            title: 'C',
            cards: [
              { text: 'old', checklist: [{ id: 'i1', text: 'step', done: true }] },
              {
                text: 'new',
                checklists: [
                  { id: 'cl1', name: 'Named', items: [{ id: 'i2', text: 'x', done: false }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  const [legacy, modern] = data.boards[0].columns[0].cards;
  assertEqual(legacy.checklists.length, 1, 'legacy list wrapped into one group');
  assertEqual(legacy.checklists[0].items[0].text, 'step', 'legacy item text kept');
  assertEqual(legacy.checklists[0].items[0].done, true, 'legacy done state kept');
  assertEqual(modern.checklists[0].name, 'Named', 'modern checklist name kept');
  assertEqual(modern.checklists[0].items.length, 1, 'modern items kept');
});

test('comments are kept and defaulted when missing', () => {
  const data = normalizeAppData({
    boards: [
      {
        id: 'b1',
        name: 'A',
        columns: [
          {
            title: 'C',
            cards: [
              { text: 'x', comments: [{ id: 'm1', text: 'hi', createdAt: 7 }, 'junk'] },
              { text: 'y' },
            ],
          },
        ],
      },
    ],
  });
  const [withComments, without] = data.boards[0].columns[0].cards;
  assertEqual(withComments.comments.length, 2, 'entries normalized (junk repaired)');
  assertEqual(withComments.comments[0].text, 'hi', 'comment text kept');
  assertEqual(withComments.comments[0].createdAt, 7, 'comment timestamp kept');
  assertEqual(without.comments.length, 0, 'missing comments default to empty');
});

test('a valid stored due date is preserved', () => {
  const data = normalizeAppData({
    boards: [
      { id: 'b1', name: 'A', columns: [{ title: 'C', cards: [{ text: 'x', dueAt: 1234, dueDone: true }] }] },
    ],
  });
  const card = data.boards[0].columns[0].cards[0];
  assertEqual(card.dueAt, 1234, 'due date kept');
  assertEqual(card.dueDone, true, 'dueDone kept');
});

test('checklistsOpen is kept when true and defaulted to false otherwise', () => {
  const data = normalizeAppData({
    boards: [
      {
        id: 'b1',
        name: 'A',
        columns: [
          {
            title: 'C',
            cards: [{ text: 'x', checklistsOpen: true }, { text: 'y' }, { text: 'z', checklistsOpen: 'junk' }],
          },
        ],
      },
    ],
  });
  const [open, missing, junk] = data.boards[0].columns[0].cards;
  assertEqual(open.checklistsOpen, true, 'true kept');
  assertEqual(missing.checklistsOpen, false, 'missing defaults to false');
  assertEqual(junk.checklistsOpen, false, 'junk value repaired to false');
});

test('start date is kept and defaulted when missing', () => {
  const data = normalizeAppData({
    boards: [
      {
        id: 'b1',
        name: 'A',
        columns: [{ title: 'C', cards: [{ text: 'x', startAt: 777 }, { text: 'y' }] }],
      },
    ],
  });
  const [withStart, without] = data.boards[0].columns[0].cards;
  assertEqual(withStart.startAt, 777, 'start date kept');
  assertEqual(without.startAt, null, 'missing start date defaults to null');
});

test('stored labels are kept and dangling card references are dropped', () => {
  const data = normalizeAppData({
    boards: [
      {
        id: 'b1',
        name: 'A',
        labels: [{ id: 'L1', name: 'Bug', color: '#f00' }],
        columns: [{ title: 'C', cards: [{ text: 'x', labelIds: ['L1', 'ghost'] }] }],
      },
    ],
  });
  assertEqual(data.boards[0].labels.length, 1, 'one stored label kept');
  assertEqual(data.boards[0].labels[0].name, 'Bug', 'label name kept');
  const labelIds = data.boards[0].columns[0].cards[0].labelIds;
  assertEqual(labelIds.join(''), 'L1', 'valid ref kept, dangling ref dropped');
});

test('invalid activeBoardId falls back to first board', () => {
  const data = normalizeAppData({
    boards: [{ id: 'b1', name: 'A', columns: [] }],
    activeBoardId: 'does-not-exist',
  });
  assertEqual(data.activeBoardId, 'b1', 'fell back to first');
});

test('language and zoom are sanitized', () => {
  const data = normalizeAppData({
    boards: [{ id: 'b1', name: 'A', columns: [] }],
    settings: { lang: 'fr', zoom: 99 },
  });
  assertEqual(data.settings.lang, 'ko', 'invalid lang -> ko');
  assert(data.settings.zoom <= 2.5, 'zoom clamped');
});

test('theme is kept when valid and sanitized otherwise', () => {
  const dark = normalizeAppData({
    boards: [{ id: 'b1', name: 'A', columns: [] }],
    settings: { theme: 'dark' },
  });
  assertEqual(dark.settings.theme, 'dark', 'valid theme kept');
  const junk = normalizeAppData({
    boards: [{ id: 'b1', name: 'A', columns: [] }],
    settings: { theme: 'purple' },
  });
  assertEqual(junk.settings.theme, 'auto', 'invalid theme falls back to auto');
  const missing = normalizeAppData({ boards: [{ id: 'b1', name: 'A', columns: [] }] });
  assertEqual(missing.settings.theme, 'auto', 'missing theme defaults to auto');
});

test('calendarHideDone is kept when boolean and defaults to false', () => {
  const on = normalizeAppData({
    boards: [{ id: 'b1', name: 'A', columns: [] }],
    settings: { calendarHideDone: true },
  });
  assertEqual(on.settings.calendarHideDone, true, 'true is kept');
  const junk = normalizeAppData({
    boards: [{ id: 'b1', name: 'A', columns: [] }],
    settings: { calendarHideDone: 'yes' },
  });
  assertEqual(junk.settings.calendarHideDone, false, 'non-boolean falls back to false');
  const missing = normalizeAppData({ boards: [{ id: 'b1', name: 'A', columns: [] }] });
  assertEqual(missing.settings.calendarHideDone, false, 'missing defaults to false');
});

test('non-array columns and cards are coerced to empty', () => {
  const data = normalizeAppData({
    boards: [{ id: 'b1', name: 'A', columns: 'nope' }],
  });
  assert(Array.isArray(data.boards[0].columns), 'columns is array');
  assertEqual(data.boards[0].columns.length, 0, 'empty columns');
});
