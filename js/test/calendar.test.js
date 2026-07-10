// Unit tests for the pure calendar-view logic in src/calendar.ts.
import { test, assert, assertEqual } from './harness.js';
import { buildDayEntries, buildMonthGrid, buildWeekGrid, computeDropPatch, dayKey, weekTitle, } from '../src/calendar.js';
import { setLanguage } from '../src/i18n.js';
/** Build a card with sane defaults, overridden by the patch. */
function card(patch) {
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
function board(id, name, columns) {
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
/** Wrap cards into a single-board, single-column fixture. */
function boardOf(...cards) {
    return [board('b', 'Board', [{ id: 'col', title: 'List', cards }])];
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
test('buildWeekGrid returns the Sunday-first week containing the day', () => {
    const cells = buildWeekGrid(new Date(2026, 6, 10).getTime()); // Friday, July 10 2026
    assertEqual(cells.length, 7, 'a week has 7 cells');
    assertEqual(new Date(cells[0].ts).getDay(), 0, 'week starts on Sunday');
    assertEqual(cells[0].key, '2026-07-05', 'first cell is the preceding Sunday');
    assertEqual(cells[6].key, '2026-07-11', 'last cell is the following Saturday');
    assert(cells.every((c) => c.inMonth), 'every week cell counts as in view');
});
test('buildWeekGrid spans month boundaries', () => {
    const cells = buildWeekGrid(new Date(2026, 6, 1).getTime()); // Wednesday, July 1 2026
    assertEqual(cells[0].key, '2026-06-28', 'week reaches back into June');
    assertEqual(cells[6].key, '2026-07-04', 'week ends in July');
});
test('weekTitle localizes the week range', () => {
    const ts = new Date(2026, 6, 10).getTime();
    setLanguage('ko');
    assertEqual(weekTitle(ts), '2026년 7월 5일 ~ 2026년 7월 11일', 'Korean week title');
    setLanguage('en');
    assertEqual(weekTitle(ts), 'July 5, 2026 ~ July 11, 2026', 'English week title');
    setLanguage('ko'); // restore the default for other tests
});
test('buildDayEntries turns start-only and due-only cards into point entries', () => {
    const start = new Date(2026, 6, 3, 9, 0).getTime();
    const due = new Date(2026, 6, 5, 18, 0).getTime();
    const boards = [
        board('b1', 'Work', [
            {
                id: 'col1',
                title: 'To Do',
                cards: [
                    card({ id: 'a', text: 'starts', startAt: start }),
                    card({ id: 'b', text: 'none' }),
                    card({ id: 'tpl', text: 'template', dueAt: due, isTemplate: true }),
                ],
            },
        ]),
        board('b2', 'Home', [
            {
                id: 'col2',
                title: 'Doing',
                cards: [card({ id: 'd', text: 'due only', dueAt: due, dueDone: true })],
            },
        ]),
    ];
    const byDay = buildDayEntries(boards);
    assertEqual(byDay.size, 2, 'undated and template cards yield no entries');
    const startEntry = byDay.get('2026-07-03')?.[0];
    assertEqual(startEntry?.kind, 'start', 'start-only card yields a start point');
    assertEqual(startEntry?.segment, null, 'point entries carry no segment');
    const dueEntry = byDay.get('2026-07-05')?.[0];
    assertEqual(dueEntry?.kind, 'due', 'due-only card yields a due point');
    assertEqual(dueEntry?.boardName, 'Home', 'entry carries its board name');
    assertEqual(dueEntry?.columnTitle, 'Doing', 'entry carries its column title');
    assert(dueEntry?.dueDone === true, 'entry carries the due-done flag');
});
test('buildDayEntries expands a start+due card into a day-by-day range', () => {
    const startAt = new Date(2026, 6, 3, 9, 0).getTime();
    const dueAt = new Date(2026, 6, 6, 18, 0).getTime();
    const byDay = buildDayEntries(boardOf(card({ id: 'r', text: 'range', startAt, dueAt })));
    assertEqual(byDay.size, 4, 'range covers each day from start through due');
    const segments = ['2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06'].map((key) => byDay.get(key)?.[0]?.segment);
    assertEqual(segments.join(','), 'start,middle,middle,end', 'segments mark the bar shape');
    const first = byDay.get('2026-07-03')[0];
    assertEqual(first.kind, 'range', 'expanded entries are range entries');
    assertEqual(first.dueAt, dueAt, 'range entries keep the due timestamp for overdue checks');
});
test('buildDayEntries marks a same-day start+due as a single-segment range', () => {
    const startAt = new Date(2026, 6, 10, 9, 0).getTime();
    const dueAt = new Date(2026, 6, 10, 18, 0).getTime();
    const byDay = buildDayEntries(boardOf(card({ id: 's', text: 'one day', startAt, dueAt })));
    assertEqual(byDay.size, 1, 'same-day range occupies one day');
    assertEqual(byDay.get('2026-07-10')?.[0]?.segment, 'single', 'segment is single');
});
test('buildDayEntries falls back to points when the due day precedes the start day', () => {
    const startAt = new Date(2026, 6, 10).getTime();
    const dueAt = new Date(2026, 6, 8).getTime();
    const byDay = buildDayEntries(boardOf(card({ id: 'x', text: 'reversed', startAt, dueAt })));
    assertEqual(byDay.get('2026-07-10')?.[0]?.kind, 'start', 'start renders as a point');
    assertEqual(byDay.get('2026-07-08')?.[0]?.kind, 'due', 'due renders as a point');
});
/** Build a drop-patch entry with dummy card context. */
function dropEntry(patch) {
    return {
        boardId: 'b',
        boardName: 'B',
        columnId: 'col',
        columnTitle: 'T',
        cardId: 'c',
        cardText: 'card',
        at: 0,
        kind: 'due',
        segment: null,
        dueAt: null,
        dueDone: false,
        color: '',
        ...patch,
    };
}
/** Local timestamp helper for July 2026. */
function july(day, hour = 0, minute = 0) {
    return new Date(2026, 6, day, hour, minute).getTime();
}
test('computeDropPatch moves point entries to the target day keeping the time', () => {
    const due = dropEntry({ kind: 'due', at: july(9, 18, 30), dueAt: july(9, 18, 30) });
    const duePatch = computeDropPatch(due, july(9), july(12));
    assertEqual(duePatch?.dueAt, july(12, 18, 30), 'due point moves and keeps 18:30');
    assert(duePatch != null && !('startAt' in duePatch), 'due move leaves the start untouched');
    const start = dropEntry({ kind: 'start', at: july(9, 8, 0) });
    const startPatch = computeDropPatch(start, july(9), july(5));
    assertEqual(startPatch?.startAt, july(5, 8, 0), 'start point moves backward keeping 08:00');
    assertEqual(computeDropPatch(due, july(9), july(9)), null, 'same-day drop is a no-op');
});
test('computeDropPatch shifts a whole range when dragged by a middle day', () => {
    const range = dropEntry({
        kind: 'range',
        segment: 'middle',
        at: july(3, 9, 0),
        dueAt: july(6, 18, 0),
    });
    const patch = computeDropPatch(range, july(4), july(11));
    assertEqual(patch?.startAt, july(10, 9, 0), 'start shifts by the same number of days');
    assertEqual(patch?.dueAt, july(13, 18, 0), 'due shifts too, preserving the duration');
});
test('computeDropPatch resizes a range via its start/end segments', () => {
    const startSeg = dropEntry({
        kind: 'range',
        segment: 'start',
        at: july(3, 9, 0),
        dueAt: july(6, 18, 0),
    });
    const grow = computeDropPatch(startSeg, july(3), july(5));
    assertEqual(grow?.startAt, july(5, 9, 0), 'dragging the start segment moves the start');
    assert(grow != null && !('dueAt' in grow), 'start-segment drag leaves the due untouched');
    assertEqual(computeDropPatch(startSeg, july(3), july(8)), null, 'start past due is rejected');
    const endSeg = dropEntry({
        kind: 'range',
        segment: 'end',
        at: july(3, 9, 0),
        dueAt: july(6, 18, 0),
    });
    const shrink = computeDropPatch(endSeg, july(6), july(4));
    assertEqual(shrink?.dueAt, july(4, 18, 0), 'dragging the end segment moves the due');
    assertEqual(computeDropPatch(endSeg, july(6), july(1)), null, 'due before start is rejected');
});
test('buildDayEntries sorts ranges before points within a day', () => {
    const day9 = new Date(2026, 6, 9, 8, 0).getTime();
    const startAt = new Date(2026, 6, 8).getTime();
    const dueAt = new Date(2026, 6, 10).getTime();
    const byDay = buildDayEntries(boardOf(card({ id: 'p', text: 'point', dueAt: day9 }), card({ id: 'r', text: 'range', startAt, dueAt })));
    const kinds = byDay.get('2026-07-09')?.map((e) => e.kind);
    assertEqual(kinds?.join(','), 'range,due', 'range bars stack above point entries');
});
