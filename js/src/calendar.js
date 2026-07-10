// Calendar view: aggregates every dated card from every board into one month
// grid. The date math is pure (and unit-tested); the modal below renders it
// with plain DOM, reusing the shared modal shell.
import { t, tf } from './i18n.js';
import { openShell } from './modal.js';
/**
 * Collect the start/due dates of every card on every board (a card with both
 * dates yields two events). Templates are blueprints, not scheduled work, so
 * they are skipped. The result is sorted by time ascending.
 */
export function collectCalendarEvents(boards) {
    const events = [];
    for (const board of boards) {
        for (const column of board.columns) {
            for (const card of column.cards) {
                if (card.isTemplate)
                    continue;
                const base = {
                    boardId: board.id,
                    boardName: board.name,
                    columnId: column.id,
                    columnTitle: column.title,
                    cardId: card.id,
                    cardText: card.text,
                    dueDone: card.dueDone,
                    color: card.color,
                };
                if (card.startAt != null)
                    events.push({ ...base, at: card.startAt, kind: 'start' });
                if (card.dueAt != null)
                    events.push({ ...base, at: card.dueAt, kind: 'due' });
            }
        }
    }
    return events.sort((a, b) => a.at - b.at);
}
/** Local-time day key (YYYY-MM-DD) used to bucket events into grid cells. */
export function dayKey(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Bucket events by local day; only days that have events appear in the map. */
export function groupEventsByDay(events) {
    const byDay = new Map();
    for (const event of events) {
        const key = dayKey(event.at);
        const bucket = byDay.get(key);
        if (bucket)
            bucket.push(event);
        else
            byDay.set(key, [event]);
    }
    return byDay;
}
/**
 * Build the day cells for a month (0-based), as whole Sunday-first weeks: from
 * the Sunday on/before the 1st through the Saturday on/after the last day.
 * Out-of-range months roll over per Date semantics (month 12 = next January).
 */
export function buildMonthGrid(year, month) {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + (6 - last.getDay()));
    const cells = [];
    for (let d = start; d.getTime() <= end.getTime(); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
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
function monthTitle(year, month) {
    const names = t('monthNames').split(',');
    return tf('monthTitle', [String(year), names[month] ?? '']);
}
/**
 * Open the all-boards calendar: a month grid where each cell lists the cards
 * starting or due that day. Clicking an entry invokes `onOpenCard` (which is
 * expected to switch boards if needed and open the card) and closes the view.
 * Resolves when the dialog closes.
 */
export function openCalendar(boards, onOpenCard) {
    return new Promise((resolve) => {
        const { dialog, close } = openShell('calendar-view', () => resolve());
        const now = new Date();
        const todayKey = dayKey(now.getTime());
        let year = now.getFullYear();
        let month = now.getMonth();
        const byDay = groupEventsByDay(collectCalendarEvents(boards));
        // With a single board the board name on every chip would be noise.
        const showBoardName = boards.length > 1;
        // --- Header: previous/next month, title, and a "today" shortcut. ---
        const head = document.createElement('div');
        head.className = 'calendar-head';
        const makeNavBtn = (cls, glyph, titleKey) => {
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
        /** Build one clickable event chip. */
        const renderEvent = (event) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'calendar-event';
            if (event.kind === 'due') {
                if (event.dueDone)
                    chip.classList.add('is-done');
                else if (event.at < Date.now())
                    chip.classList.add('is-overdue');
            }
            if (event.color)
                chip.style.borderLeftColor = event.color;
            const icon = event.kind === 'start' ? '🚩' : event.dueDone ? '✅' : '⏰';
            const kindName = t(event.kind === 'start' ? 'startDate' : 'dueDate');
            chip.title = `${icon} ${kindName} · ${event.boardName} / ${event.columnTitle}\n${event.cardText}`;
            if (showBoardName) {
                const boardTag = document.createElement('span');
                boardTag.className = 'calendar-event-board';
                boardTag.textContent = event.boardName;
                chip.appendChild(boardTag);
            }
            const text = document.createElement('span');
            text.className = 'calendar-event-text';
            text.textContent = `${icon} ${event.cardText}`;
            chip.appendChild(text);
            chip.addEventListener('click', () => {
                onOpenCard(event.boardId, event.columnId, event.cardId);
                close();
            });
            return chip;
        };
        const render = () => {
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
                if (!cell.inMonth)
                    cellEl.classList.add('is-outside');
                if (cell.key === todayKey)
                    cellEl.classList.add('is-today');
                const num = document.createElement('div');
                num.className = 'calendar-day-num';
                num.textContent = String(cell.day);
                cellEl.appendChild(num);
                for (const event of byDay.get(cell.key) ?? []) {
                    if (cell.inMonth)
                        monthHasEvents = true;
                    cellEl.appendChild(renderEvent(event));
                }
                grid.appendChild(cellEl);
            }
            emptyNote.hidden = monthHasEvents;
        };
        const shiftMonth = (delta) => {
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
