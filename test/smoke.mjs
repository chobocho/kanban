// Browser smoke test (dev-only, uses Playwright). Serves the project with a
// tiny static server and drives a headless Chromium to verify the app boots,
// renders, and reacts to user actions without runtime errors.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, rel === '/' ? 'index.html' : rel);
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    res.end(data);
  });
});

function assert(cond, msg) { if (!cond) { throw new Error('FAIL: ' + msg); } console.log('  ok  ' + msg); }

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(base + '/index.html');
  await page.waitForSelector('.column', { timeout: 5000 });

  const columns = await page.locator('.column').count();
  assert(columns === 3, `renders 3 default columns (got ${columns})`);

  // With no edits yet, undo and redo are unavailable.
  assert(await page.locator('#undoBtn').isDisabled(), 'undo disabled before any edit');
  assert(await page.locator('#redoBtn').isDisabled(), 'redo disabled before any edit');

  // Add a card to the first column.
  await page.locator('.column').first().locator('.add-card-btn').click();
  await page.waitForTimeout(100);
  const cards = await page.locator('.column').first().locator('.card').count();
  assert(cards === 1, `add-card adds a card (got ${cards})`);

  // Add a column.
  await page.locator('[data-add-column]').click();
  await page.waitForTimeout(100);
  const cols2 = await page.locator('.column').count();
  assert(cols2 === 4, `add-column adds a list (got ${cols2})`);

  // Undo reverts the column add; redo restores it (toolbar icon buttons).
  assert(!(await page.locator('#undoBtn').isDisabled()), 'undo enabled after edits');
  await page.locator('#undoBtn').click();
  await page.waitForTimeout(100);
  const colsUndo = await page.locator('.column').count();
  assert(colsUndo === 3, `undo reverts add-column (got ${colsUndo})`);
  await page.locator('#redoBtn').click();
  await page.waitForTimeout(100);
  const colsRedo = await page.locator('.column').count();
  assert(colsRedo === 4, `redo restores add-column (got ${colsRedo})`);

  // The overflow menu opens and holds the secondary controls.
  await page.locator('#menuBtn').click();
  await page.waitForSelector('#menuPanel:not([hidden])', { timeout: 3000 });
  assert(true, 'overflow menu opens');

  // Language switch to English updates labels (menu closes on change).
  await page.selectOption('#langSelect', 'en');
  await page.waitForTimeout(100);
  const addColText = await page.locator('[data-add-column]').textContent();
  assert(addColText.trim() === '➕', `add-column shows an emoji icon (got "${addColText}")`);
  const addColTitle = await page.locator('[data-add-column]').getAttribute('title');
  assert(addColTitle.includes('Add list'), `language switch updates tooltip (got "${addColTitle}")`);
  await page.locator('#menuBtn').click();
  const newBoardLabel = await page.locator('#newBoardBtn .menu-label').textContent();
  assert(newBoardLabel.trim() === 'New board', `menu label localized (got "${newBoardLabel}")`);

  // Zoom button (in the menu) changes the scale transform.
  await page.locator('#zoomInBtn').click();
  const transform = await page.locator('#boardScale').evaluate((el) => el.style.transform);
  assert(/scale\(/.test(transform), `zoom applies a transform (got "${transform}")`);

  // Reload to verify persistence (IndexedDB) restores the added card/column.
  await page.reload();
  await page.waitForSelector('.column', { timeout: 5000 });
  await page.waitForTimeout(200);
  const colsAfter = await page.locator('.column').count();
  assert(colsAfter === 4, `state persists across reload (got ${colsAfter})`);

  // Drag the card from the first column into the second (empty) column.
  const card = page.locator('.column').nth(0).locator('.card').first();
  const target = page.locator('.column').nth(1);
  const cb = await card.boundingBox();
  const tb = await target.boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2 - 20, { steps: 5 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 60, { steps: 10 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 70, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const c0 = await page.locator('.column').nth(0).locator('.card').count();
  const c1 = await page.locator('.column').nth(1).locator('.card').count();
  assert(c0 === 0 && c1 === 1, `drag-and-drop moves card across columns (got ${c0}/${c1})`);

  // Card detail modal: open a card, add a description, save, and verify the
  // badge appears and the text round-trips on reopen.
  const detailCard = page.locator('.column').nth(1).locator('.card').first();
  await detailCard.hover();
  await detailCard.locator('.icon-btn[title="Open card details"]').click();
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  await page.locator('.card-detail-desc').fill('detailed notes');
  await page.locator('.card-detail .modal-ok').click();
  await page.waitForTimeout(100);
  const badges = await page.locator('.column').nth(1).locator('.card-badge').count();
  assert(badges === 1, `saving a description shows a card badge (got ${badges})`);

  await detailCard.hover();
  await detailCard.locator('.icon-btn[title="Open card details"]').click();
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  const descVal = await page.locator('.card-detail-desc').inputValue();
  assert(descVal === 'detailed notes', `description round-trips on reopen (got "${descVal}")`);

  // Assign the first label from the detail modal; it applies immediately.
  await page.locator('.card-detail-label-chip').first().click();
  await page.waitForTimeout(100);
  // Set a start date and a far-future due date, then save (applies on Save).
  await page.locator('.card-detail-due-input').first().fill('2030-12-31T09:00');
  await page.locator('.card-detail-due-input').last().fill('2031-01-02T10:30');
  await page.locator('.card-detail .modal-ok').click();
  await page.waitForTimeout(100);
  const labelChips = await page.locator('.column').nth(1).locator('.card-label').count();
  assert(labelChips === 1, `assigning a label shows a chip on the card (got ${labelChips})`);
  const dueBadge = await page.locator('.column').nth(1).locator('.card-due').count();
  assert(dueBadge === 1, `setting a due date shows a due badge (got ${dueBadge})`);
  const dueBadgeText = await page.locator('.column').nth(1).locator('.card-due').textContent();
  assert(dueBadgeText.includes('~'), `start+due shows a date range badge (got "${dueBadgeText}")`);

  // Create a checklist, add an item (applies immediately), check the badge.
  await detailCard.hover();
  await detailCard.locator('.icon-btn[title="Open card details"]').click();
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  await page.locator('.checklist-group-add').click();
  await page.waitForTimeout(100);
  await page.locator('.modal-overlay').last().locator('.modal-ok').click();
  await page.waitForTimeout(100);
  const groups = await page.locator('.checklist-group').count();
  assert(groups === 1, `checklist group is created (got ${groups})`);
  await page.locator('.checklist-add-input').fill('first step');
  await page.locator('.checklist-add-btn').click();
  await page.waitForTimeout(100);
  const items = await page.locator('.checklist-item').count();
  assert(items === 1, `checklist item is added (got ${items})`);
  // Reorder: add a second item and move it above the first.
  await page.locator('.checklist-add-input').fill('second step');
  await page.locator('.checklist-add-btn').click();
  await page.waitForTimeout(100);
  await page.locator('.checklist-item').nth(1).locator('[title="Move up"]').click();
  await page.waitForTimeout(100);
  const firstItemText = await page
    .locator('.checklist-item').first().locator('.checklist-item-text').inputValue();
  assert(firstItemText === 'second step', `checklist item moves up (got "${firstItemText}")`);
  await page.locator('.checklist-item').first().locator('[title="Delete"]').click();
  await page.waitForTimeout(100);
  await page.locator('.card-detail .modal-cancel').click();
  await page.waitForTimeout(100);
  const checkBadge = await page.locator('.column').nth(1).locator('.card-check').textContent();
  assert(checkBadge.includes('0/1'), `checklist badge shows progress (got "${checkBadge}")`);

  // The badge toggles the checklist inline on the card front.
  await page.locator('.column').nth(1).locator('.card-check').click();
  await page.waitForTimeout(100);
  const inlineItems = await page.locator('.column').nth(1).locator('.card-check-item').count();
  assert(inlineItems === 1, `badge click expands the checklist on the card (got ${inlineItems})`);
  await page.locator('.column').nth(1).locator('.card-check-item').first().click();
  await page.waitForTimeout(100);
  const badgeAfterDone = await page.locator('.column').nth(1).locator('.card-check').textContent();
  assert(badgeAfterDone.includes('1/1'), `inline item click marks it done (got "${badgeAfterDone}")`);
  await page.locator('.column').nth(1).locator('.card-check').click();
  await page.waitForTimeout(100);
  const collapsedItems = await page.locator('.column').nth(1).locator('.card-check-item').count();
  assert(collapsedItems === 0, `badge click collapses the checklist again (got ${collapsedItems})`);

  // Reopen and confirm the start/due dates round-trip into the pickers.
  await detailCard.hover();
  await detailCard.locator('.icon-btn[title="Open card details"]').click();
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  const startVal = await page.locator('.card-detail-due-input').first().inputValue();
  assert(startVal === '2030-12-31T09:00', `start date round-trips (got "${startVal}")`);
  const dueVal = await page.locator('.card-detail-due-input').last().inputValue();
  assert(dueVal === '2031-01-02T10:30', `due date round-trips (got "${dueVal}")`);
  await page.locator('.card-detail .modal-cancel').click();
  await page.waitForTimeout(100);

  // Calendar view: opens on the current month with a Sunday-first grid.
  await page.locator('#calendarBtn').click();
  await page.waitForSelector('.calendar-view', { timeout: 3000 });
  const weekdays = await page.locator('.calendar-weekday').count();
  assert(weekdays === 7, `calendar shows 7 weekday headers (got ${weekdays})`);
  const dayCells = await page.locator('.calendar-cell').count();
  assert(dayCells >= 28 && dayCells % 7 === 0, `calendar grid is whole weeks (got ${dayCells})`);
  const todayCells = await page.locator('.calendar-cell.is-today').count();
  assert(todayCells === 1, `calendar highlights today (got ${todayCells})`);

  // Weekend accents: Sunday/Saturday headers and one day number per week.
  const sunHead = await page.locator('.calendar-weekday.is-sun').count();
  const satHead = await page.locator('.calendar-weekday.is-sat').count();
  assert(sunHead === 1 && satHead === 1, `weekend headers are accented (got ${sunHead}/${satHead})`);
  const sunNums = await page.locator('.calendar-day-num.is-sun').count();
  const satNums = await page.locator('.calendar-day-num.is-sat').count();
  assert(
    sunNums === dayCells / 7 && satNums === dayCells / 7,
    `weekend day numbers are accented once per week (got ${sunNums}/${satNums})`,
  );

  // Month navigation: prev changes the title, today returns to the start.
  const calTitleStart = await page.locator('.calendar-title').textContent();
  await page.locator('.calendar-nav-prev').click();
  const calTitlePrev = await page.locator('.calendar-title').textContent();
  assert(calTitlePrev !== calTitleStart, `prev-month changes the title (got "${calTitlePrev}")`);
  await page.locator('.calendar-nav-today').click();
  const calTitleBack = await page.locator('.calendar-title').textContent();
  assert(calTitleBack === calTitleStart, `today returns to the current month (got "${calTitleBack}")`);

  // Week view: exactly 7 tall cells, week-by-week navigation, then back.
  await page.locator('.calendar-mode-week').click();
  const weekCells = await page.locator('.calendar-grid.is-week .calendar-cell').count();
  assert(weekCells === 7, `week view shows exactly 7 day cells (got ${weekCells})`);
  const weekTodayCells = await page.locator('.calendar-cell.is-today').count();
  assert(weekTodayCells === 1, `week view highlights today (got ${weekTodayCells})`);
  const weekTitle1 = await page.locator('.calendar-title').textContent();
  await page.locator('.calendar-nav-next').click();
  const weekTitle2 = await page.locator('.calendar-title').textContent();
  assert(weekTitle2 !== weekTitle1, `next moves by one week (got "${weekTitle2}")`);
  await page.locator('.calendar-nav-today').click();
  const weekTitle3 = await page.locator('.calendar-title').textContent();
  assert(weekTitle3 === weekTitle1, `today returns to the current week (got "${weekTitle3}")`);
  await page.locator('.calendar-mode-month').click();
  const monthTitleBack = await page.locator('.calendar-title').textContent();
  assert(monthTitleBack === calTitleStart, `month toggle restores the month view (got "${monthTitleBack}")`);

  // Clicking a day cell prompts for a title and creates a card due that day.
  const dayCell = page.locator('.calendar-cell:not(.is-outside)').nth(14); // the 15th
  await dayCell.click();
  await page.waitForSelector('.modal-input', { timeout: 3000 });
  await page.locator('.modal-input').fill('calendar card');
  await page.locator('.modal-overlay').last().locator('.modal-ok').click();
  await page.waitForTimeout(100);
  const addedChips = await dayCell.locator('.calendar-event').count();
  assert(addedChips === 1, `day-cell click creates a card on that day (got ${addedChips})`);

  // Drag the new chip three days forward; the due date follows the drop cell.
  const dragChip = dayCell.locator('.calendar-event').first();
  const dropCell = page.locator('.calendar-cell:not(.is-outside)').nth(17); // the 18th
  const chipBox = await dragChip.boundingBox();
  const dropBox = await dropCell.boundingBox();
  await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2 + 15, { steps: 4 });
  await page.mouse.move(dropBox.x + dropBox.width / 2, dropBox.y + dropBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const chipsAtSource = await page.locator('.calendar-cell:not(.is-outside)').nth(14).locator('.calendar-event').count();
  const chipsAtTarget = await dropCell.locator('.calendar-event').count();
  assert(chipsAtSource === 0 && chipsAtTarget === 1, `dragging a chip moves it to the drop day (got ${chipsAtSource}/${chipsAtTarget})`);
  assert((await page.locator('.card-detail').count()) === 0, 'finishing a drag does not open the card detail');

  // Mark the calendar-created card done, then hide/show it with the toggle.
  await page.locator('.calendar-view .modal-ok').click();
  await page.waitForTimeout(100);
  const calCardOnBoard = page.locator('.card', { hasText: 'calendar card' });
  await calCardOnBoard.hover();
  await calCardOnBoard.locator('.icon-btn[title="Open card details"]').click();
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  await page.locator('.card-detail-due-done input').check();
  await page.locator('.card-detail .modal-ok').click();
  await page.waitForTimeout(100);
  await page.locator('#calendarBtn').click();
  await page.waitForSelector('.calendar-view', { timeout: 3000 });
  const doneChips = await page.locator('.calendar-event.is-done').count();
  assert(doneChips === 1, `done card shows as a done chip (got ${doneChips})`);
  await page.locator('.calendar-hide-done input').check();
  const hiddenChips = await page.locator('.calendar-event').count();
  assert(hiddenChips === 0, `hide-done removes completed chips (got ${hiddenChips})`);
  await page.locator('.calendar-hide-done input').uncheck();
  const shownChips = await page.locator('.calendar-event.is-done').count();
  assert(shownChips === 1, `unchecking shows completed chips again (got ${shownChips})`);

  // Walk forward to the card's start/due month; its chip opens the card detail.
  let calEvents = 0;
  for (let i = 0; i < 80 && calEvents === 0; i++) {
    await page.locator('.calendar-nav-next').click();
    calEvents = await page.locator('.calendar-event').count();
  }
  assert(calEvents >= 1, `navigating months reaches the dated card (got ${calEvents})`);
  // The card has both dates, so it renders as a range bar with a start segment.
  const rangeStarts = await page.locator('.calendar-event.is-seg-start').count();
  assert(rangeStarts === 1, `start+due card shows a range start segment (got ${rangeStarts})`);
  const rangeSegs = await page.locator('.calendar-event.is-range').count();
  assert(rangeSegs >= 2, `range spans multiple day segments (got ${rangeSegs})`);
  await page.locator('.calendar-event').first().click();
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  assert((await page.locator('.calendar-view').count()) === 0, 'picking an event closes the calendar');
  await page.locator('.card-detail .modal-cancel').click();
  await page.waitForTimeout(100);

  // The calendar-created card landed on the board; three undos (done mark,
  // date move, then the add) remove it so later card counts stay unchanged.
  const cardsWithCalCard = await page.locator('.card').count();
  assert(cardsWithCalCard === 2, `calendar-created card is on the board (got ${cardsWithCalCard})`);
  for (let i = 0; i < 3; i++) {
    await page.locator('#undoBtn').click();
    await page.waitForTimeout(100);
  }
  const cardsAfterUndo = await page.locator('.card').count();
  assert(cardsAfterUndo === 1, `undo removes the calendar-created card (got ${cardsAfterUndo})`);

  // Search/filter: a matching keyword keeps the card; a non-match hides it.
  await page.locator('#filterInput').fill('detailed');
  await page.waitForTimeout(100);
  const matchVisible = await page.locator('.card').count();
  assert(matchVisible === 1, `keyword keeps the matching card (got ${matchVisible})`);
  assert(!(await page.locator('#filterClearBtn').isHidden()), 'clear-filter button shows when filtering');
  await page.locator('#filterInput').fill('zzz-no-such-card');
  await page.waitForTimeout(100);
  const noneVisible = await page.locator('.card').count();
  assert(noneVisible === 0, `non-matching keyword hides all cards (got ${noneVisible})`);
  await page.locator('#filterClearBtn').click();
  await page.waitForTimeout(100);
  const restored = await page.locator('.card').count();
  assert(restored === 1, `clearing the filter restores cards (got ${restored})`);

  // Archive: the card leaves the board, shows up in the archive, and restores.
  const cardToArchive = page.locator('.column').nth(1).locator('.card').first();
  await cardToArchive.hover();
  await cardToArchive.locator('.icon-btn[title="Archive"]').click();
  await page.waitForTimeout(100);
  const afterArchive = await page.locator('.card').count();
  assert(afterArchive === 0, `archiving removes the card from the board (got ${afterArchive})`);

  await page.locator('#menuBtn').click();
  await page.locator('#archiveBtn').click();
  await page.waitForSelector('.card-archive', { timeout: 3000 });
  const archivedRows = await page.locator('.archive-row').count();
  assert(archivedRows === 1, `archived card appears in the archive (got ${archivedRows})`);
  await page.locator('.archive-restore').first().click();
  await page.waitForTimeout(100);
  assert((await page.locator('.archive-empty').count()) === 1, 'archive is empty after restore');
  await page.locator('.card-archive .modal-ok').click();
  await page.waitForTimeout(100);
  const afterRestore = await page.locator('.card').count();
  assert(afterRestore === 1, `restoring brings the card back (got ${afterRestore})`);

  // Archive a whole list via its ⋯ menu, then restore it from the archive view.
  const beforeCols = await page.locator('.column').count();
  await page.locator('.column').first().locator('.column-menu-btn').click();
  await page.locator('.column').first().locator('.column-menu-item', { hasText: 'Archive' }).click();
  await page.waitForTimeout(100);
  const afterArchiveCols = await page.locator('.column').count();
  assert(afterArchiveCols === beforeCols - 1, `archiving a list removes it (got ${afterArchiveCols})`);

  await page.locator('#menuBtn').click();
  await page.locator('#archiveBtn').click();
  await page.waitForSelector('.card-archive', { timeout: 3000 });
  const listSection = await page.locator('.archive-section-title').count();
  assert(listSection >= 1, `archived list shows a section (got ${listSection})`);
  await page.locator('.archive-restore').first().click();
  await page.waitForTimeout(100);
  await page.locator('.card-archive .modal-ok').click();
  await page.waitForTimeout(100);
  const restoredCols = await page.locator('.column').count();
  assert(restoredCols === beforeCols, `restoring brings the list back (got ${restoredCols})`);

  // Custom modal (replaces native prompt): create a board via the dialog.
  const boardsBefore = await page.locator('#boardSelect option').count();
  await page.locator('#menuBtn').click();
  await page.locator('#newBoardBtn').click();
  await page.waitForSelector('.modal-dialog', { timeout: 3000 });
  assert(true, 'custom modal opens for new board (no native prompt)');
  await page.locator('.modal-input').fill('Project X');
  await page.locator('.modal-ok').click();
  await page.waitForTimeout(100);
  const boardsAfter = await page.locator('#boardSelect option').count();
  assert(boardsAfter === boardsBefore + 1, `custom prompt creates a board (got ${boardsAfter})`);
  const activeName = await page.locator('#boardSelect').inputValue();
  const selectedText = await page.locator(`#boardSelect option[value="${activeName}"]`).textContent();
  assert(selectedText === 'Project X', `new board uses entered name (got "${selectedText}")`);

  // Cancelling the modal makes no change.
  await page.locator('#menuBtn').click();
  await page.locator('#newBoardBtn').click();
  await page.waitForSelector('.modal-dialog', { timeout: 3000 });
  await page.locator('.modal-cancel').click();
  await page.waitForTimeout(100);
  const boardsCancel = await page.locator('#boardSelect option').count();
  assert(boardsCancel === boardsAfter, `cancelling the modal makes no change (got ${boardsCancel})`);

  // --- List ⋯ menu and card actions (on the fresh "Project X" board) ---------
  // Copy list: duplicates the first list right after the original.
  const pxCols = await page.locator('.column').count();
  await page.locator('.column').first().locator('.column-menu-btn').click();
  await page.locator('.column').first().locator('.column-menu-item', { hasText: 'Copy list' }).click();
  await page.waitForTimeout(100);
  const colsCopied = await page.locator('.column').count();
  assert(colsCopied === pxCols + 1, `copy list duplicates the list (got ${colsCopied})`);

  // Card count badge reflects the number of cards in the list.
  await page.locator('.column').first().locator('.add-card-btn').click();
  await page.locator('.column').first().locator('.add-card-btn').click();
  await page.waitForTimeout(100);
  const countBadge = await page.locator('.column').first().locator('.column-count').textContent();
  assert(countBadge === '2', `column header shows the card count (got "${countBadge}")`);

  // Move all cards to another list via the ⋯ menu.
  await page.locator('.column').first().locator('.column-menu-btn').click();
  await page.locator('.column').first().locator('.column-menu-item', { hasText: 'In Progress' }).click();
  await page.waitForTimeout(100);
  const srcCount = await page.locator('.column').nth(0).locator('.card').count();
  const dstCount = await page.locator('.column').nth(2).locator('.card').count();
  assert(srcCount === 0 && dstCount === 2, `move all cards empties the source (got ${srcCount}/${dstCount})`);

  // Comments: add one from the card detail modal and check the 💬 badge.
  const commentCard = page.locator('.column').nth(2).locator('.card').first();
  await commentCard.hover();
  await commentCard.locator('.icon-btn[title="Open card details"]').click();
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  // Comments live in a collapsed section; open it first.
  assert(await page.locator('.card-detail-comments').isHidden(), 'comments start collapsed');
  await page.locator('.section-comments').click();
  await page.locator('.comment-add-input').fill('looks good');
  await page.locator('.comment-add .comment-add-btn').click();
  await page.waitForTimeout(100);
  const commentItems = await page.locator('.comment-item').count();
  assert(commentItems === 1, `comment is added in the modal (got ${commentItems})`);
  await page.locator('.card-detail .modal-cancel').click();
  await page.waitForTimeout(100);
  const commentBadge = await page.locator('.column').nth(2).locator('.card-badge', { hasText: '💬' }).count();
  assert(commentBadge === 1, `comment badge appears on the card (got ${commentBadge})`);

  // Copy card: the detail modal's copy action duplicates the card.
  await commentCard.hover();
  await commentCard.locator('.icon-btn[title="Open card details"]').click();
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  await page.locator('.card-detail-op-btn', { hasText: 'Copy card' }).click();
  await page.waitForTimeout(100);
  const afterCopy = await page.locator('.column').nth(2).locator('.card').count();
  assert(afterCopy === 3, `copy card duplicates the card (got ${afterCopy})`);

  // Card templates: mark a card as a template, then stamp a new card from it.
  await commentCard.hover();
  await commentCard.locator('.icon-btn[title="Open card details"]').click();
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  await page.locator('.card-detail-op-btn', { hasText: 'Make template' }).click();
  await page.waitForTimeout(100);
  const tplBadge = await commentCard.locator('.card-template').count();
  assert(tplBadge === 1, `template badge appears on the card (got ${tplBadge})`);
  await commentCard.hover();
  await commentCard.locator('.icon-btn[title="Open card details"]').click();
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  await page.locator('.card-detail-op-btn', { hasText: 'Create card from template' }).click();
  await page.waitForTimeout(100);
  const afterStamp = await page.locator('.column').nth(2).locator('.card').count();
  assert(afterStamp === 4, `template stamps a new card (got ${afterStamp})`);
  const stampedTpl = await page
    .locator('.column').nth(2).locator('.card').last().locator('.card-template').count();
  assert(stampedTpl === 0, `stamped card is not a template (got ${stampedTpl})`);

  // Attachments: upload a tiny PNG, see the list row, cover image and badge.
  await commentCard.hover();
  await commentCard.locator('.icon-btn[title="Open card details"]').click();
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  // Attachments live in a collapsed section; open it first.
  await page.locator('.section-attachments').click();
  const pngBuf = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page
    .locator('.card-detail-attachments input[type=file]')
    .setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: pngBuf });
  await page.waitForTimeout(200);
  const attRows = await page.locator('.attachment-item').count();
  assert(attRows === 1, `attachment appears in the modal list (got ${attRows})`);
  await page.locator('.card-detail .modal-cancel').click();
  await page.waitForTimeout(100);
  const coverCount = await commentCard.locator('.card-cover').count();
  assert(coverCount === 1, `first attachment shows as the card cover (got ${coverCount})`);
  const attBadge = await commentCard.locator('.card-badge', { hasText: '📎' }).count();
  assert(attBadge === 1, `attachment badge appears on the card (got ${attBadge})`);

  // Label management: rows with edit buttons appear only in manage mode.
  await commentCard.hover();
  await commentCard.locator('.icon-btn[title="Open card details"]').click();
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  assert(
    (await page.locator('.card-detail-label-row').count()) === 0,
    'compact label view shows chips without edit rows',
  );
  await page.locator('.card-detail-label-manage').click();
  await page.waitForTimeout(100);
  const labelRows = await page.locator('.card-detail-label-row').count();
  assert(labelRows > 0, `manage mode lists label rows (got ${labelRows})`);
  await page.locator('.card-detail-label-add').click();
  await page.waitForTimeout(100);
  await page.locator('.modal-overlay').last().locator('.modal-input').fill('Urgent');
  await page.locator('.modal-overlay').last().locator('.modal-ok').click();
  await page.locator('.modal-overlay').last().locator('.card-detail-swatch').nth(2).click();
  await page.waitForTimeout(100);
  const labelRowsAdded = await page.locator('.card-detail-label-row').count();
  assert(labelRowsAdded === labelRows + 1, `adding a label appends a row (got ${labelRowsAdded})`);
  await page.locator('.card-detail-label-row').last().locator('[title="Delete"]').click();
  await page.locator('.modal-overlay').last().locator('.modal-ok').click();
  await page.waitForTimeout(100);
  const labelRowsRemoved = await page.locator('.card-detail-label-row').count();
  assert(labelRowsRemoved === labelRows, `deleting a label removes its row (got ${labelRowsRemoved})`);
  await page.locator('.card-detail .modal-cancel').click();
  await page.waitForTimeout(100);

  // Board background: picking a palette color updates the theme variable.
  await page.locator('#menuBtn').click();
  await page.locator('#bgColorBtn').click();
  await page.waitForSelector('.card-detail-colors', { timeout: 3000 });
  await page.locator('.card-detail-swatch').nth(1).click();
  await page.waitForTimeout(100);
  const bgVar = await page.evaluate(() => document.documentElement.style.getPropertyValue('--bg'));
  assert(bgVar === '#0079bf', `board background applies a theme color (got "${bgVar}")`);

  // Activity log: earlier actions on this board appear as localized lines.
  await page.locator('#menuBtn').click();
  await page.locator('#activityBtn').click();
  await page.waitForSelector('.activity-row', { timeout: 3000 });
  const activityRows = await page.locator('.activity-row').count();
  assert(activityRows >= 3, `activity log lists recent actions (got ${activityRows})`);
  const moveAllLine = await page.locator('.activity-text', { hasText: 'Moved all cards' }).count();
  assert(moveAllLine >= 1, `move-all action was logged (got ${moveAllLine})`);
  await page.locator('.card-archive .modal-ok').click();
  await page.waitForTimeout(100);

  // Bulk add: one card per line via the list menu's multi-line prompt.
  const bulkCol = page.locator('.column').nth(3); // "Done" list, still empty
  const bulkBefore = await bulkCol.locator('.card').count();
  await bulkCol.locator('.column-menu-btn').click();
  await bulkCol.locator('.column-menu-item', { hasText: 'Add multiple cards' }).click();
  await page.waitForSelector('.modal-textarea', { timeout: 3000 });
  await page.locator('.modal-textarea').fill('alpha\nbeta\n\n  gamma  ');
  await page.locator('.modal-overlay').last().locator('.modal-ok').click();
  await page.waitForTimeout(100);
  const bulkAfter = await bulkCol.locator('.card').count();
  assert(bulkAfter === bulkBefore + 3, `bulk add creates one card per line (got ${bulkAfter})`);

  // Markdown: a saved description renders as a preview; clicking it edits.
  const mdCard = bulkCol.locator('.card').first(); // "alpha"
  await mdCard.hover();
  await mdCard.locator('.icon-btn[title="Open card details"]').click();
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  await page.locator('.card-detail-desc').fill('# Title\n- item one\n**bold**');
  await page.locator('.card-detail .modal-ok').click();
  await page.waitForTimeout(100);
  await mdCard.hover();
  await mdCard.locator('.icon-btn[title="Open card details"]').click();
  await page.waitForSelector('.card-detail-desc-preview', { timeout: 3000 });
  const mdH1 = await page.locator('.card-detail-desc-preview h1').textContent();
  assert(mdH1 === 'Title', `markdown heading renders in the preview (got "${mdH1}")`);
  const mdLi = await page.locator('.card-detail-desc-preview li').count();
  assert(mdLi === 1, `markdown list renders in the preview (got ${mdLi})`);
  await page.locator('.card-detail-desc-preview').click();
  const descVisible = await page.locator('.card-detail-desc').isVisible();
  assert(descVisible, 'clicking the preview switches to the editor');
  await page.locator('.card-detail .modal-cancel').click();
  await page.waitForTimeout(100);

  // Keyboard navigation: arrows move focus between cards, Enter opens detail.
  await bulkCol.locator('.card').first().focus();
  await page.keyboard.press('ArrowDown');
  const focusedText = await page.evaluate(
    () => document.activeElement?.querySelector('.card-text')?.textContent,
  );
  assert(focusedText === 'beta', `ArrowDown focuses the next card (got "${focusedText}")`);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.card-detail', { timeout: 3000 });
  const kbTitle = await page.locator('.card-detail-title').inputValue();
  assert(kbTitle === 'alpha', `Enter opens the focused card's detail (got "${kbTitle}")`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  // Theme: forcing dark mode flips the html data-theme attribute.
  await page.locator('#menuBtn').click();
  await page.selectOption('#themeSelect', 'dark');
  await page.waitForTimeout(100);
  const themeAttr = await page.evaluate(() => document.documentElement.dataset.theme);
  assert(themeAttr === 'dark', `dark theme is applied to the document (got "${themeAttr}")`);
  await page.locator('#menuBtn').click();
  await page.selectOption('#themeSelect', 'light');
  await page.waitForTimeout(100);
  const themeBack = await page.evaluate(() => document.documentElement.dataset.theme);
  assert(themeBack === 'light', `light theme restores (got "${themeBack}")`);

  // Board star: starring moves the board to the front of the selector.
  await page.locator('#starBtn').click();
  await page.waitForTimeout(100);
  const starTxt = (await page.locator('#starBtn').textContent()).trim();
  assert(starTxt === '⭐', `star button reflects the starred state (got "${starTxt}")`);
  const firstOpt = await page.locator('#boardSelect option').first().textContent();
  assert(firstOpt === '⭐ Project X', `starred board is listed first (got "${firstOpt}")`);

  // Copy board: duplicates the active board under the suggested name.
  const boardsBeforeCopy = await page.locator('#boardSelect option').count();
  await page.locator('#menuBtn').click();
  await page.locator('#copyBoardBtn').click();
  await page.waitForTimeout(100);
  await page.locator('.modal-overlay').last().locator('.modal-ok').click();
  await page.waitForTimeout(100);
  const boardsAfterCopy = await page.locator('#boardSelect option').count();
  assert(boardsAfterCopy === boardsBeforeCopy + 1, `copy board adds a board (got ${boardsAfterCopy})`);
  const copyId = await page.locator('#boardSelect').inputValue();
  const copyName = await page.locator(`#boardSelect option[value="${copyId}"]`).textContent();
  assert(copyName === 'Project X (copy)', `copy uses the suggested name (got "${copyName}")`);
  // Return to the original board for the following checks.
  await page.locator('#menuBtn').click();
  await page.locator('#deleteBoardBtn').click();
  await page.waitForSelector('.modal-dialog', { timeout: 3000 });
  await page.locator('.modal-overlay').last().locator('.modal-ok').click();
  await page.waitForTimeout(100);

  // Board export: downloads the active board as a JSON file.
  await page.locator('#menuBtn').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#exportBoardBtn').click(),
  ]);
  assert(
    download.suggestedFilename().endsWith('.json'),
    `board export downloads a JSON file (got "${download.suggestedFilename()}")`,
  );

  // Board import: a single-board JSON file becomes a new, active board.
  const boardsBeforeImport = await page.locator('#boardSelect option').count();
  await page.locator('#menuBtn').click();
  await page.locator('#importBoardInput').setInputFiles({
    name: 'imported.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        kanbanBoard: 1,
        board: { name: 'Imported Board', columns: [{ title: 'L', cards: [{ text: 'hi' }] }] },
      }),
    ),
  });
  await page.waitForTimeout(200);
  const boardsAfterImport = await page.locator('#boardSelect option').count();
  assert(
    boardsAfterImport === boardsBeforeImport + 1,
    `board import adds a board (got ${boardsAfterImport})`,
  );
  const importedId = await page.locator('#boardSelect').inputValue();
  const importedName = await page
    .locator(`#boardSelect option[value="${importedId}"]`)
    .textContent();
  assert(importedName === 'Imported Board', `imported board is active (got "${importedName}")`);
  const importedCards = await page.locator('.card').count();
  assert(importedCards === 1, `imported board shows its cards (got ${importedCards})`);

  assert(errors.length === 0, `no runtime errors (${JSON.stringify(errors)})`);

  // --- Touch drag-and-drop (foldable / phone) ---------------------------------
  // Cards and lists are scrollable, so a touch drag must begin on a press-and-
  // hold (a quick swipe scrolls instead). Verify both with real touch events.
  const tctx = await browser.newContext({ viewport: { width: 884, height: 1104 }, hasTouch: true, isMobile: true });
  const tpage = await tctx.newPage();
  const terrors = [];
  tpage.on('pageerror', (e) => terrors.push(e.message));
  tpage.on('console', (m) => { if (m.type() === 'error') terrors.push(m.text()); });
  // A fresh context has isolated storage, so the default 3-column board loads.
  await tpage.goto(base + '/index.html');
  await tpage.waitForSelector('.column', { timeout: 5000 });
  await tpage.locator('.column').first().locator('.add-card-btn').click();
  await tpage.waitForTimeout(150);

  const tcard = tpage.locator('.column').nth(0).locator('.card').first();
  const ttarget = tpage.locator('.column').nth(1);
  const tcb = await tcard.boundingBox();
  const ttb = await ttarget.boundingBox();
  const cdp = await tctx.newCDPSession(tpage);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const cx = tcb.x + tcb.width / 2, cy = tcb.y + tcb.height / 2;
  const ex = ttb.x + ttb.width / 2, ey = ttb.y + 60;

  // Press-and-hold, then drag into the second column.
  await tp('touchStart', cx, cy);
  await tpage.waitForTimeout(260);
  for (let i = 1; i <= 12; i++) { await tp('touchMove', cx + (ex - cx) * i / 12, cy + (ey - cy) * i / 12); await tpage.waitForTimeout(16); }
  await tp('touchEnd', ex, ey);
  await tpage.waitForTimeout(250);
  const tc0 = await tpage.locator('.column').nth(0).locator('.card').count();
  const tc1 = await tpage.locator('.column').nth(1).locator('.card').count();
  assert(tc0 === 0 && tc1 === 1, `touch hold-then-drag moves card across columns (got ${tc0}/${tc1})`);

  // A quick swipe on the card must NOT move it (it is a scroll gesture).
  const sb = await tpage.locator('.column').nth(1).locator('.card').first().boundingBox();
  const sx = sb.x + sb.width / 2, sy = sb.y + sb.height / 2;
  await tp('touchStart', sx, sy);
  for (let i = 1; i <= 8; i++) { await tp('touchMove', sx, sy - 12 * i); await tpage.waitForTimeout(8); }
  await tp('touchEnd', sx, sy - 96);
  await tpage.waitForTimeout(200);
  const sc1 = await tpage.locator('.column').nth(1).locator('.card').count();
  assert(sc1 === 1, `quick swipe scrolls instead of dragging (card stays, got ${sc1})`);
  assert(terrors.length === 0, `no runtime errors during touch (${JSON.stringify(terrors)})`);

  // --- Release bundle (single-file artifact) ----------------------------------
  // The bundler rewrites ES modules with regexes, so boot the built
  // release/index.html too and make sure the app actually works from it.
  const rctx = await browser.newContext();
  const rpage = await rctx.newPage();
  const rerrors = [];
  rpage.on('pageerror', (e) => rerrors.push(e.message));
  rpage.on('console', (m) => { if (m.type() === 'error') rerrors.push(m.text()); });
  await rpage.goto(base + '/release/index.html');
  await rpage.waitForSelector('.column', { timeout: 5000 });
  const rcols = await rpage.locator('.column').count();
  assert(rcols === 3, `release bundle renders the default board (got ${rcols})`);
  await rpage.locator('.column').first().locator('.add-card-btn').click();
  await rpage.waitForTimeout(150);
  const rcards = await rpage.locator('.card').count();
  assert(rcards === 1, `release bundle can add a card (got ${rcards})`);
  await rpage.locator('.card').first().locator('.icon-btn[title="카드 상세 열기"]').click();
  await rpage.waitForSelector('.card-detail', { timeout: 3000 });
  await rpage.keyboard.press('Escape');
  assert(true, 'release bundle opens the card detail modal');
  assert(rerrors.length === 0, `release bundle has no runtime errors (${JSON.stringify(rerrors)})`);
  await rctx.close();

  console.log('\nsmoke: all checks passed');
} finally {
  await browser.close();
  server.close();
}
