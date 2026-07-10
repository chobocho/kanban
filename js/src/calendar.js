// Calendar view: aggregates every dated card from every board into one month
// grid. A card with both a start and a due date is shown as a day-by-day range
// bar; cards with a single date show as point entries. The date math is pure
// (and unit-tested); the modal below renders it with plain DOM, reusing the
// shared modal shell.
import { t, tf } from './i18n.js';
import { customPrompt, openShell } from './modal.js';
/** Local-time day key (YYYY-MM-DD) used to bucket entries into grid cells. */
export function dayKey(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Local midnight of the day containing the timestamp. */
function startOfDay(ts) {
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
export function buildDayEntries(boards) {
    const byDay = new Map();
    const push = (key, entry) => {
        const bucket = byDay.get(key);
        if (bucket)
            bucket.push(entry);
        else
            byDay.set(key, [entry]);
    };
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
                    dueAt: card.dueAt,
                    dueDone: card.dueDone,
                    color: card.color,
                };
                const { startAt, dueAt } = card;
                if (startAt != null && dueAt != null && startOfDay(dueAt) >= startOfDay(startAt)) {
                    const firstDay = startOfDay(startAt);
                    const lastDay = startOfDay(dueAt);
                    for (let d = new Date(firstDay); d.getTime() <= lastDay; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
                        const isFirst = d.getTime() === firstDay;
                        const isLast = d.getTime() === lastDay;
                        const segment = isFirst && isLast ? 'single' : isFirst ? 'start' : isLast ? 'end' : 'middle';
                        push(dayKey(d.getTime()), { ...base, at: startAt, kind: 'range', segment });
                    }
                }
                else {
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
        bucket.sort((a, b) => Number(a.kind !== 'range') - Number(b.kind !== 'range') || a.at - b.at);
    }
    return byDay;
}
const DAY_MS = 24 * 60 * 60 * 1000;
/** Move a timestamp by whole days, preserving its local time of day. */
function addDays(ts, days) {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
}
/**
 * Compute the date change for dragging an entry from its day onto another day.
 * Points move their own date; a range's start/end segment moves just that end
 * (rejected with null when the ends would cross); a middle or single segment
 * shifts the whole range, preserving its duration. Times of day are kept.
 * Returns null when nothing should change.
 */
export function computeDropPatch(entry, sourceDayTs, targetDayTs) {
    // Both inputs are local midnights, so rounding absorbs any DST hour skew.
    const delta = Math.round((targetDayTs - sourceDayTs) / DAY_MS);
    if (delta === 0)
        return null;
    if (entry.kind === 'start')
        return { startAt: addDays(entry.at, delta) };
    if (entry.kind === 'due')
        return { dueAt: addDays(entry.at, delta) };
    const startAt = entry.at;
    const dueAt = entry.dueAt; // ranges always carry both dates
    if (entry.segment === 'start') {
        const next = addDays(startAt, delta);
        return startOfDay(next) <= startOfDay(dueAt) ? { startAt: next } : null;
    }
    if (entry.segment === 'end') {
        const next = addDays(dueAt, delta);
        return startOfDay(next) >= startOfDay(startAt) ? { dueAt: next } : null;
    }
    return { startAt: addDays(startAt, delta), dueAt: addDays(dueAt, delta) };
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
/** Build the 7 day cells of the Sunday-first week containing the timestamp. */
export function buildWeekGrid(ts) {
    const d = new Date(ts);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
    const cells = [];
    for (let i = 0; i < 7; i++) {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        // Every cell of a week view is part of the view, unlike month padding days.
        cells.push({ ts: day.getTime(), key: dayKey(day.getTime()), day: day.getDate(), inMonth: true });
    }
    return cells;
}
/** Localized title for a month view, e.g. "2026년 7월" / "July 2026". */
function monthTitle(year, month) {
    const names = t('monthNames').split(',');
    return tf('monthTitle', [String(year), names[month] ?? '']);
}
/** Localized "year month day" label, e.g. "2026년 7월 5일" / "July 5, 2026". */
function monthDayLong(d) {
    const names = t('monthNames').split(',');
    return tf('monthDayLong', [String(d.getFullYear()), names[d.getMonth()] ?? '', String(d.getDate())]);
}
/**
 * Localized title for the week containing the timestamp, spelled out as a full
 * first-day ~ last-day range so month/year boundaries stay unambiguous.
 */
export function weekTitle(ts) {
    const cells = buildWeekGrid(ts);
    return `${monthDayLong(new Date(cells[0].ts))} ~ ${monthDayLong(new Date(cells[6].ts))}`;
}
/**
 * Open the all-boards calendar: a month grid where each cell lists the cards
 * starting, due or in progress that day. Clicking an entry opens its card and
 * closes the view; clicking a day cell's empty area asks for a title and
 * creates a card due that day; dragging an entry onto another day moves the
 * card's dates. `hideDone` starts the "hide completed" toggle, whose changes
 * are reported back for persistence. Resolves when the dialog closes.
 */
export function openCalendar(boards, hideDone, cb) {
    return new Promise((resolve) => {
        const { dialog, close } = openShell('calendar-view', () => resolve());
        const now = new Date();
        const todayKey = dayKey(now.getTime());
        /** Month or week granularity; the anchor day selects which one is shown. */
        let mode = 'month';
        let anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let byDay = buildDayEntries(boards);
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
        // --- Month/week granularity toggle. ---
        const modeToggle = document.createElement('div');
        modeToggle.className = 'calendar-mode-toggle';
        const makeModeBtn = (target, labelKey) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `calendar-mode-btn calendar-mode-${target}`;
            btn.textContent = t(labelKey);
            btn.addEventListener('click', () => {
                if (mode === target)
                    return;
                mode = target;
                render();
            });
            return btn;
        };
        const monthModeBtn = makeModeBtn('month', 'monthView');
        const weekModeBtn = makeModeBtn('week', 'weekView');
        modeToggle.append(monthModeBtn, weekModeBtn);
        // --- "Hide completed cards" toggle (persisted via the callback). ---
        const hideDoneLabel = document.createElement('label');
        hideDoneLabel.className = 'calendar-hide-done';
        const hideDoneCheck = document.createElement('input');
        hideDoneCheck.type = 'checkbox';
        hideDoneCheck.checked = hideDone;
        hideDoneCheck.addEventListener('change', () => {
            hideDone = hideDoneCheck.checked;
            cb.onToggleHideDone(hideDone);
            render();
        });
        hideDoneLabel.append(hideDoneCheck, document.createTextNode(t('calendarHideDone')));
        head.append(prevBtn, title, nextBtn, todayBtn, modeToggle, hideDoneLabel);
        dialog.appendChild(head);
        const grid = document.createElement('div');
        grid.className = 'calendar-grid';
        dialog.appendChild(grid);
        const emptyNote = document.createElement('div');
        emptyNote.className = 'calendar-empty';
        emptyNote.textContent = t('calendarEmpty');
        dialog.appendChild(emptyNote);
        /** The icon shown on an entry chip (none on middle range segments). */
        const entryIcon = (entry) => {
            if (entry.kind === 'start' || entry.segment === 'start')
                return '🚩';
            if (entry.segment === 'single')
                return entry.dueDone ? '✅' : '🕒';
            return entry.dueDone ? '✅' : '⏰'; // due point or range end
        };
        // A finished drag fires a click on the dragged chip right after pointerup;
        // this flag swallows that one click so the card detail does not open.
        let suppressClick = false;
        /** Re-read the boards and repaint (after an add or a date move). */
        const refreshEntries = () => {
            byDay = buildDayEntries(boards);
            render();
        };
        /**
         * Pointer-based drag of an entry chip onto another day cell. A real drag
         * starts only after a small movement threshold, so plain clicks/taps keep
         * opening the card.
         */
        const startDrag = (e, chip, entry, sourceDayTs) => {
            const fromX = e.clientX;
            const fromY = e.clientY;
            let dragging = false;
            let dropCell = null;
            const onMove = (ev) => {
                if (!dragging) {
                    if (Math.hypot(ev.clientX - fromX, ev.clientY - fromY) < 6)
                        return;
                    dragging = true;
                    chip.classList.add('is-dragging');
                }
                const under = document
                    .elementFromPoint(ev.clientX, ev.clientY)
                    ?.closest('.calendar-cell');
                if (under !== dropCell) {
                    dropCell?.classList.remove('is-drop-target');
                    dropCell = under ?? null;
                    dropCell?.classList.add('is-drop-target');
                }
            };
            const finish = (drop) => {
                chip.removeEventListener('pointermove', onMove);
                chip.classList.remove('is-dragging');
                dropCell?.classList.remove('is-drop-target');
                if (!dragging)
                    return;
                // Swallow the click this drag produces; a dropped chip may be replaced
                // by the re-render (no click at all), so the flag also self-clears.
                suppressClick = true;
                window.setTimeout(() => {
                    suppressClick = false;
                }, 0);
                const targetTs = drop && dropCell ? Number(dropCell.dataset.dayTs) : NaN;
                if (!Number.isFinite(targetTs))
                    return;
                const patch = computeDropPatch(entry, sourceDayTs, targetTs);
                if (!patch)
                    return;
                cb.onMoveCard(entry.boardId, entry.columnId, entry.cardId, patch);
                refreshEntries();
            };
            chip.setPointerCapture(e.pointerId);
            chip.addEventListener('pointermove', onMove);
            chip.addEventListener('pointerup', () => finish(true), { once: true });
            chip.addEventListener('pointercancel', () => finish(false), { once: true });
        };
        /** Build one clickable entry chip (a point or one day of a range bar). */
        const renderEntry = (entry, sourceDayTs) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'calendar-event';
            if (entry.kind === 'range')
                chip.classList.add('is-range', `is-seg-${entry.segment}`);
            // Done/overdue state colors the whole bar, but never a start point.
            if (entry.kind !== 'start') {
                if (entry.dueDone)
                    chip.classList.add('is-done');
                else if (entry.dueAt != null && entry.dueAt < Date.now())
                    chip.classList.add('is-overdue');
            }
            const kindName = entry.kind === 'range'
                ? t('calendarPeriod')
                : t(entry.kind === 'start' ? 'startDate' : 'dueDate');
            chip.title = `${kindName} · ${entry.boardName} / ${entry.columnTitle}\n${entry.cardText}`;
            // Middle segments are thin connector bars: color only, no text.
            if (entry.kind === 'range' && entry.segment === 'middle') {
                if (entry.color)
                    chip.style.background = entry.color;
            }
            else {
                // The end segment keeps a transparent stripe so the bar reads as one.
                if (entry.color && entry.segment !== 'end')
                    chip.style.borderLeftColor = entry.color;
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
            chip.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse' && e.button !== 0)
                    return;
                startDrag(e, chip, entry, sourceDayTs);
            });
            chip.addEventListener('click', () => {
                if (suppressClick)
                    return;
                cb.onOpenCard(entry.boardId, entry.columnId, entry.cardId);
                close();
            });
            return chip;
        };
        const render = () => {
            const isWeek = mode === 'week';
            title.textContent = isWeek
                ? weekTitle(anchor.getTime())
                : monthTitle(anchor.getFullYear(), anchor.getMonth());
            monthModeBtn.classList.toggle('is-active', !isWeek);
            weekModeBtn.classList.toggle('is-active', isWeek);
            grid.classList.toggle('is-week', isWeek);
            grid.replaceChildren();
            t('weekdaysShort')
                .split(',')
                .forEach((name, day) => {
                const headCell = document.createElement('div');
                headCell.className = 'calendar-weekday';
                // Weekend accents: Sunday red, Saturday blue (Korean calendar style).
                if (day === 0)
                    headCell.classList.add('is-sun');
                else if (day === 6)
                    headCell.classList.add('is-sat');
                headCell.textContent = name;
                grid.appendChild(headCell);
            });
            const cells = isWeek
                ? buildWeekGrid(anchor.getTime())
                : buildMonthGrid(anchor.getFullYear(), anchor.getMonth());
            let viewHasEvents = false;
            for (const cell of cells) {
                const cellEl = document.createElement('div');
                cellEl.className = 'calendar-cell';
                if (!cell.inMonth)
                    cellEl.classList.add('is-outside');
                if (cell.key === todayKey)
                    cellEl.classList.add('is-today');
                cellEl.title = t('calendarAddCard');
                // Day timestamp for drag-and-drop target lookup.
                cellEl.dataset.dayTs = String(cell.ts);
                // Clicking the cell's empty area (not an entry chip) creates a card
                // due on that day; the boards are re-read so the chip shows up.
                cellEl.addEventListener('click', (e) => {
                    if (e.target.closest('.calendar-event'))
                        return;
                    void customPrompt(t('calendarAddCardPrompt'), t('newCardText')).then((text) => {
                        if (text === null)
                            return;
                        cb.onAddCard(cell.ts, text.trim() || t('newCardText'));
                        refreshEntries();
                    });
                });
                const num = document.createElement('div');
                num.className = 'calendar-day-num';
                // Weekend accents: Sunday red, Saturday blue (Korean calendar style).
                const weekday = new Date(cell.ts).getDay();
                if (weekday === 0)
                    num.classList.add('is-sun');
                else if (weekday === 6)
                    num.classList.add('is-sat');
                // A week can straddle two months, so week cells carry the month too.
                num.textContent = isWeek
                    ? `${new Date(cell.ts).getMonth() + 1}/${cell.day}`
                    : String(cell.day);
                cellEl.appendChild(num);
                for (const entry of byDay.get(cell.key) ?? []) {
                    if (hideDone && entry.dueDone)
                        continue;
                    if (cell.inMonth)
                        viewHasEvents = true;
                    cellEl.appendChild(renderEntry(entry, cell.ts));
                }
                grid.appendChild(cellEl);
            }
            emptyNote.hidden = viewHasEvents;
        };
        // Previous/next moves by one month or one week, matching the mode.
        const shift = (delta) => {
            anchor =
                mode === 'month'
                    ? new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1)
                    : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + delta * 7);
            render();
        };
        prevBtn.addEventListener('click', () => shift(-1));
        nextBtn.addEventListener('click', () => shift(1));
        todayBtn.addEventListener('click', () => {
            anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
