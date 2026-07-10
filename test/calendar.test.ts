// Unit tests for the pure calendar-view logic in src/calendar.ts.

import { test, assert, assertEqual } from './harness.js';
import {
  buildMonthGrid,
  collectCalendarEvents,
  dayKey,
  groupEventsByDay,
} from '../src/calendar.js';
import { Board, Card } from '../src/types.js';

/** Build a card with sane defaults, overridden by the patch. */
function card(patch: Partial<Card>): Card {
  return {
    id: 'c',
    text: '',
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
    createdAt: 0,
    ...patch,
  };
}

/** Build a board holding the given columns, with sane defaults elsewhere. */
function board(id: string, name: string, columns: Board['columns']): Board {
  return {
    id,
    name,
    columns,
    labels: [],
    archived: [],
    archivedColumns: [],
    background: '',
    starred: false,
    activity: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

test('dayKey formats a local date with zero padding', () => {
  const ts = new Date(2026, 0, 5, 23, 59).getTime();
  assertEqual(dayKey(ts), '2026-01-05', 'dayKey pads month and day');
});

test('buildMonthGrid covers the month in whole Sunday-first weeks', () => {
  const cells = buildMonthGrid(2026, 6); // July 2026
  assertEqual(cells.length % 7, 0, 'grid is a whole number of weeks');
  assertEqual(new Date(cells[0].ts).getDay(), 0, 'grid starts on a Sunday');
  assertEqual(new Date(cells[cells.length - 1].ts).getDay(), 6, 'grid ends on a Saturday');
  const inMonth = cells.filter((c) => c.inMonth);
  assertEqual(inMonth.length, 31, 'July has 31 in-month cells');
  assertEqual(inMonth[0].day, 1, 'first in-month cell is the 1st');
  assertEqual(inMonth[30].day, 31, 'last in-month cell is the 31st');
  assert(cells.every((c) => c.key === dayKey(c.ts)), 'each cell key matches its timestamp');
});

test('buildMonthGrid handles February and out-of-range month rollover', () => {
  const feb = buildMonthGrid(2026, 1); // February 2026 (not a leap year)
  assertEqual(feb.filter((c) => c.inMonth).length, 28, 'February 2026 has 28 days');
  // Month 12 rolls over to January of the next year (Date semantics).
  const rolled = buildMonthGrid(2026, 12);
  const jan = buildMonthGrid(2027, 0);
  assertEqual(rolled[0].key, jan[0].key, 'month 12 equals January of the next year');
});

test('collectCalendarEvents gathers start/due dates across all boards', () => {
  const boards = [
    board('b1', 'Work', [
      {
        id: 'col1',
        title: 'To Do',
        cards: [
          card({ id: 'a', text: 'both', startAt: 2000, dueAt: 5000 }),
          card({ id: 'b', text: 'none' }),
          card({ id: 'tpl', text: 'template', dueAt: 1000, isTemplate: true }),
        ],
      },
    ]),
    board('b2', 'Home', [
      {
        id: 'col2',
        title: 'Doing',
        cards: [card({ id: 'd', text: 'due only', dueAt: 1500, dueDone: true })],
      },
    ]),
  ];
  const events = collectCalendarEvents(boards);
  assertEqual(events.length, 3, 'both-dates card yields 2 events, template/undated none');
  assertEqual(
    events.map((e) => `${e.cardId}:${e.kind}`).join(','),
    'd:due,a:start,a:due',
    'events are sorted by time ascending',
  );
  const due = events[0];
  assertEqual(due.boardName, 'Home', 'event carries its board name');
  assertEqual(due.columnTitle, 'Doing', 'event carries its column title');
  assert(due.dueDone, 'event carries the due-done flag');
});

test('groupEventsByDay buckets events by their local day', () => {
  const sameDayA = new Date(2026, 6, 10, 9, 0).getTime();
  const sameDayB = new Date(2026, 6, 10, 18, 0).getTime();
  const otherDay = new Date(2026, 6, 11, 0, 0).getTime();
  const boards = [
    board('b', 'B', [
      {
        id: 'col',
        title: 'T',
        cards: [
          card({ id: 'x', text: 'x', startAt: sameDayA, dueAt: sameDayB }),
          card({ id: 'y', text: 'y', dueAt: otherDay }),
        ],
      },
    ]),
  ];
  const byDay = groupEventsByDay(collectCalendarEvents(boards));
  assertEqual(byDay.get('2026-07-10')?.length, 2, 'same-day events share a bucket');
  assertEqual(byDay.get('2026-07-11')?.length, 1, 'other-day event gets its own bucket');
  assertEqual(byDay.size, 2, 'only days with events appear');
});
