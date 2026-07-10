// Calendar view: aggregates every dated card from every board into one month
// grid. A card with both a start and a due date is shown as a day-by-day range
// bar; cards with a single date show as point entries. The date math is pure
// (and unit-tested); the modal below renders it with plain DOM, reusing the
// shared modal shell.

import { Board } from './types.js';
import { t, tf } from './i18n.js';
import { openShell } from './modal.js';

/** What a calendar entry represents: a start/due point or a range day. */
export type CalendarEntryKind = 'start' | 'due' | 'range';

/** Where a range entry's day sits within its span (bar shape). */
export type RangeSegment = 'single' | 'start' | 'middle' | 'end';

/** One per-day calendar occurrence, with enough context to jump to its card. */
export interface CalendarEntry {
  boardId: string;
  boardName: string;
  columnId: string;
  columnTitle: string;
  cardId: string;
  cardText: string;
  /** Sort key within a day: the event time (points) or the start (ranges). */
  at: number;
  kind: CalendarEntryKind;
  /** Set on range entries only; null for point entries. */
  segment: RangeSegment | null;
  /** The card's due timestamp when it has one (used for the overdue check). */
  dueAt: number | null;
  /** Whether the card's due date is marked complete. */
  dueDone: boolean;
  /** The card's accent color (hex) or '' for the default. */
  color: string;
}

/** Local-time day key (YYYY-MM-DD) used to bucket entries into grid cells. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of the day containing the timestamp. */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Collect every dated card on every board into per-day entries. A card with
 * both dates expands into a range entry on each day from its start day through
 * its due day (a reversed pair falls back to two points); a single date yields
 * one point entry. Templates are blueprints, not scheduled work, so they are
 * skipped. Within a day, range bars sort before points, then by time.
 */
export function buildDayEntries(boards: Board[]): Map<string, CalendarEntry[]> {
  const byDay = new Map<string, CalendarEntry[]>();
  const push = (key: string, entry: CalendarEntry): void => {
    const bucket = byDay.get(key);
    if (bucket) bucket.push(entry);
    else byDay.set(key, [entry]);
  };

  for (const board of boards) {
    for (const column of board.columns) {
      for (const card of column.cards) {
        if (card.isTemplate) continue;
        const base = {
          boardId: board.id,
          boardName: board.name,
          columnId: column.id,
          columnTitle: column.title,
          cardId: card.id,
          cardText: card.text,
          dueAt: card.dueAt,
          dueDone: card.dueDone,
          color: card.color,
        };
        const { startAt, dueAt } = card;
        if (startAt != null && dueAt != null && startOfDay(dueAt) >= startOfDay(startAt)) {
          const firstDay = startOfDay(startAt);
          const lastDay = startOfDay(dueAt);
          for (
            let d = new Date(firstDay);
            d.getTime() <= lastDay;
            d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
          ) {
            const isFirst = d.getTime() === firstDay;
            const isLast = d.getTime() === lastDay;
            const segment: RangeSegment =
              isFirst && isLast ? 'single' : isFirst ? 'start' : isLast ? 'end' : 'middle';
            push(dayKey(d.getTime()), { ...base, at: startAt, kind: 'range', segment });
          }
        } else {
          if (startAt != null) {
            push(dayKey(startAt), { ...base, at: startAt, kind: 'start', segment: null });
          }
          if (dueAt != null) {
            push(dayKey(dueAt), { ...base, at: dueAt, kind: 'due', segment: null });
          }
        }
      }
    }
  }

  for (const bucket of byDay.values()) {
    bucket.sort(
      (a, b) => Number(a.kind !== 'range') - Number(b.kind !== 'range') || a.at - b.at,
    );
  }
  return byDay;
}

/** One day cell of the month grid. */
export interface CalendarCell {
  /** Local midnight of the day. */
  ts: number;
  /** The day's {@link dayKey}. */
  key: string;
  /** Day of month (1-based). */
  day: number;
  /** False for the leading/trailing days that pad the first/last week. */
  inMonth: boolean;
}

/**
 * Build the day cells for a month (0-based), as whole Sunday-first weeks: from
 * the Sunday on/before the 1st through the Saturday on/after the last day.
 * Out-of-range months roll over per Date semantics (month 12 = next January).
 */
export function buildMonthGrid(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + (6 - last.getDay()));

  const cells: CalendarCell[] = [];
  for (
    let d = start;
    d.getTime() <= end.getTime();
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  ) {
    cells.push({
      ts: d.getTime(),
      key: dayKey(d.getTime()),
      day: d.getDate(),
      inMonth: d.getMonth() === first.getMonth() && d.getFullYear() === first.getFullYear(),
    });
  }
  return cells;
}

/** Localized title for a month view, e.g. "2026년 7월" / "July 2026". */
function monthTitle(year: number, month: number): string {
  const names = t('monthNames').split(',');
  return tf('monthTitle', [String(year), names[month] ?? '']);
}

/**
 * Open the all-boards calendar: a month grid where each cell lists the cards
 * starting, due or in progress that day. Clicking an entry invokes `onOpenCard`
 * (which is expected to switch boards if needed and open the card) and closes
 * the view. Resolves when the dialog closes.
 */
export function openCalendar(
  boards: Board[],
  onOpenCard: (boardId: string, columnId: string, cardId: string) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const { dialog, close } = openShell('calendar-view', () => resolve());

    const now = new Date();
    const todayKey = dayKey(now.getTime());
    let year = now.getFullYear();
    let month = now.getMonth();

    const byDay = buildDayEntries(boards);
    // With a single board the board name on every chip would be noise.
    const showBoardName = boards.length > 1;

    // --- Header: previous/next month, title, and a "today" shortcut. ---
    const head = document.createElement('div');
    head.className = 'calendar-head';

    const makeNavBtn = (cls: string, glyph: string, titleKey: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `calendar-nav-btn ${cls}`;
      btn.textContent = glyph;
      btn.title = t(titleKey);
      return btn;
    };
    const prevBtn = makeNavBtn('calendar-nav-prev', '◀', 'prevMonth');
    const nextBtn = makeNavBtn('calendar-nav-next', '▶', 'nextMonth');
    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'calendar-nav-btn calendar-nav-today';
    todayBtn.textContent = t('calendarToday');

    const title = document.createElement('div');
    title.className = 'calendar-title';

    head.append(prevBtn, title, nextBtn, todayBtn);
    dialog.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';
    dialog.appendChild(grid);

    const emptyNote = document.createElement('div');
    emptyNote.className = 'calendar-empty';
    emptyNote.textContent = t('calendarEmpty');
    dialog.appendChild(emptyNote);

    /** The icon shown on an entry chip (none on middle range segments). */
    const entryIcon = (entry: CalendarEntry): string => {
      if (entry.kind === 'start' || entry.segment === 'start') return '🚩';
      if (entry.segment === 'single') return entry.dueDone ? '✅' : '🕒';
      return entry.dueDone ? '✅' : '⏰'; // due point or range end
    };

    /** Build one clickable entry chip (a point or one day of a range bar). */
    const renderEntry = (entry: CalendarEntry): HTMLElement => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'calendar-event';
      if (entry.kind === 'range') chip.classList.add('is-range', `is-seg-${entry.segment}`);
      // Done/overdue state colors the whole bar, but never a start point.
      if (entry.kind !== 'start') {
        if (entry.dueDone) chip.classList.add('is-done');
        else if (entry.dueAt != null && entry.dueAt < Date.now()) chip.classList.add('is-overdue');
      }

      const kindName =
        entry.kind === 'range'
          ? t('calendarPeriod')
          : t(entry.kind === 'start' ? 'startDate' : 'dueDate');
      chip.title = `${kindName} · ${entry.boardName} / ${entry.columnTitle}\n${entry.cardText}`;

      // Middle segments are thin connector bars: color only, no text.
      if (entry.kind === 'range' && entry.segment === 'middle') {
        if (entry.color) chip.style.background = entry.color;
      } else {
        // The end segment keeps a transparent stripe so the bar reads as one.
        if (entry.color && entry.segment !== 'end') chip.style.borderLeftColor = entry.color;
        if (showBoardName) {
          const boardTag = document.createElement('span');
          boardTag.className = 'calendar-event-board';
          boardTag.textContent = entry.boardName;
          chip.appendChild(boardTag);
        }
        const text = document.createElement('span');
        text.className = 'calendar-event-text';
        text.textContent = `${entryIcon(entry)} ${entry.cardText}`;
        chip.appendChild(text);
      }

      chip.addEventListener('click', () => {
        onOpenCard(entry.boardId, entry.columnId, entry.cardId);
        close();
      });
      return chip;
    };

    const render = (): void => {
      title.textContent = monthTitle(year, month);
      grid.replaceChildren();

      for (const name of t('weekdaysShort').split(',')) {
        const headCell = document.createElement('div');
        headCell.className = 'calendar-weekday';
        headCell.textContent = name;
        grid.appendChild(headCell);
      }

      let monthHasEvents = false;
      for (const cell of buildMonthGrid(year, month)) {
        const cellEl = document.createElement('div');
        cellEl.className = 'calendar-cell';
        if (!cell.inMonth) cellEl.classList.add('is-outside');
        if (cell.key === todayKey) cellEl.classList.add('is-today');

        const num = document.createElement('div');
        num.className = 'calendar-day-num';
        num.textContent = String(cell.day);
        cellEl.appendChild(num);

        for (const entry of byDay.get(cell.key) ?? []) {
          if (cell.inMonth) monthHasEvents = true;
          cellEl.appendChild(renderEntry(entry));
        }
        grid.appendChild(cellEl);
      }
      emptyNote.hidden = monthHasEvents;
    };

    const shiftMonth = (delta: number): void => {
      const shifted = new Date(year, month + delta, 1);
      year = shifted.getFullYear();
      month = shifted.getMonth();
      render();
    };
    prevBtn.addEventListener('click', () => shiftMonth(-1));
    nextBtn.addEventListener('click', () => shiftMonth(1));
    todayBtn.addEventListener('click', () => {
      year = now.getFullYear();
      month = now.getMonth();
      render();
    });

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-btn modal-ok';
    closeBtn.textContent = t('close');
    closeBtn.addEventListener('click', () => close());
    actions.appendChild(closeBtn);
    dialog.appendChild(actions);

    render();
    closeBtn.focus();
  });
}
