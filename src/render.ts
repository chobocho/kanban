// Renders the active board into the DOM. The renderer only builds elements and
// delegates every mutation to the provided handlers, keeping it free of state
// and storage concerns. Data attributes drive the drag-and-drop controller.

import { Board, Card, Column, Label } from './types.js';
import { getLanguage, t } from './i18n.js';
import { CardSortKey, checklistProgress } from './model.js';
import { FilterState, cardMatchesFilter, isFilterActive } from './filter.js';

export interface RenderHandlers {
  addCard(colId: string): void;
  editCard(colId: string, cardId: string, text: string): void;
  archiveCard(colId: string, cardId: string): void;
  cycleCardColor(colId: string, cardId: string): void;
  openCard(colId: string, cardId: string): void;
  addColumn(): void;
  renameColumn(colId: string, title: string): void;
  archiveColumn(colId: string): void;
  sortColumn(colId: string, by: CardSortKey): void;
  copyColumn(colId: string): void;
  moveAllCards(fromColId: string, toColId: string): void;
  addCardsBulk(colId: string): void;
}

/** Card accent colors cycled by the palette button (empty = no accent). */
export const CARD_COLORS = ['', '#ef5350', '#ffa726', '#ffee58', '#66bb6a', '#42a5f5', '#ab47bc'];

/** A due date is "soon" when it falls within this window from now (24h). */
const DUE_SOON_MS = 24 * 60 * 60 * 1000;

/** Classify a card's due date for badge styling. */
function dueStatus(card: Card): 'done' | 'overdue' | 'soon' | 'upcoming' {
  if (card.dueDone) return 'done';
  const remaining = (card.dueAt ?? 0) - Date.now();
  if (remaining < 0) return 'overdue';
  if (remaining < DUE_SOON_MS) return 'soon';
  return 'upcoming';
}

/** Short, locale-aware due-date label, e.g. "6/30 14:00". */
function formatDueShort(ts: number): string {
  const locale = getLanguage() === 'en' ? 'en-US' : 'ko-KR';
  return new Date(ts).toLocaleString(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Maximum visible height of an inline editor, in text lines. */
const INLINE_EDIT_MAX_LINES = 10;

/** Resize a textarea to fit its content, capped at `maxLines` lines. */
function autoGrow(textarea: HTMLTextAreaElement, maxLines: number): void {
  const style = getComputedStyle(textarea);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const verticalBorder = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const maxHeight = lineHeight * maxLines + verticalPadding + verticalBorder;

  // Shrink first so the textarea can grow *and* shrink with the content.
  textarea.style.height = 'auto';
  // scrollHeight covers content + padding; add the border for box-sizing: border-box.
  const needed = textarea.scrollHeight + verticalBorder;
  textarea.style.height = `${Math.min(needed, maxHeight)}px`;
  textarea.style.overflowY = needed > maxHeight ? 'auto' : 'hidden';
}

/** Replace a text element with a textarea (plus submit/cancel buttons) for
 *  inline editing. Enter inserts a newline; commit is explicit via the ✓ button
 *  (or by tapping away), so the editor works without a physical keyboard. */
function startInlineEdit(
  host: HTMLElement,
  initial: string,
  onSave: (value: string) => void,
): void {
  const wrap = el('div', 'inline-edit-wrap');
  const textarea = el('textarea', 'inline-edit');
  textarea.value = initial;

  const actions = el('div', 'inline-edit-actions');
  const cancelBtn = el('button', 'inline-edit-btn inline-edit-cancel', '✕');
  cancelBtn.title = t('cancel');
  const okBtn = el('button', 'inline-edit-btn inline-edit-ok', '✓');
  okBtn.title = t('save');
  actions.append(cancelBtn, okBtn);

  wrap.append(textarea, actions);
  host.replaceWith(wrap);
  textarea.focus();
  // Place the caret at the end instead of selecting all text, so focusing the
  // editor does not highlight the whole memo as a block.
  const end = textarea.value.length;
  textarea.setSelectionRange(end, end);
  autoGrow(textarea, INLINE_EDIT_MAX_LINES);

  // Grow/shrink as the user types (covers typing, pasting and newlines).
  textarea.addEventListener('input', () => autoGrow(textarea, INLINE_EDIT_MAX_LINES));

  let done = false;
  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    if (commit) onSave(textarea.value.trim());
    else onSave(initial); // re-render restores original
  };

  // Commit when focus leaves the whole editor (e.g. tapping another card), but
  // not when it moves to one of our own buttons.
  textarea.addEventListener('blur', (e) => {
    const next = e.relatedTarget;
    if (next instanceof Node && wrap.contains(next)) return;
    finish(true);
  });
  textarea.addEventListener('keydown', (e) => {
    // Enter inserts a newline (native); only Escape exits, discarding edits.
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });

  // Keep the textarea focused while a button is pressed so its blur handler does
  // not commit before the button's own action runs (matters on touch devices).
  cancelBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  okBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  cancelBtn.addEventListener('click', () => finish(false));
  okBtn.addEventListener('click', () => finish(true));
}

function renderCard(
  card: Card,
  column: Column,
  labels: Map<string, Label>,
  handlers: RenderHandlers,
): HTMLElement {
  const node = el('div', 'card');
  node.dataset.cardId = card.id;
  node.dataset.colId = column.id;
  // Focusable for keyboard navigation (arrows move, Enter/Space opens).
  node.tabIndex = 0;
  if (card.color) {
    const stripe = el('span', 'card-stripe');
    stripe.style.background = card.color;
    node.appendChild(stripe);
  }

  // The first attachment doubles as the card's cover image (Trello-style).
  if (card.attachments.length > 0) {
    const cover = el('img', 'card-cover');
    cover.src = card.attachments[0].dataUrl;
    cover.alt = card.attachments[0].name;
    cover.draggable = false;
    node.appendChild(cover);
  }

  // Assigned labels render as colored chips above the card text.
  const cardLabels = card.labelIds.map((id) => labels.get(id)).filter((l): l is Label => !!l);
  if (cardLabels.length > 0) {
    const labelRow = el('div', 'card-labels');
    for (const label of cardLabels) {
      const chip = el('span', 'card-label', label.name || '');
      chip.style.background = label.color;
      if (label.name) chip.title = label.name;
      labelRow.appendChild(chip);
    }
    node.appendChild(labelRow);
  }

  const text = el('div', 'card-text', card.text || ' ');
  text.addEventListener('click', () => {
    startInlineEdit(text, card.text, (value) => handlers.editCard(column.id, card.id, value));
  });
  node.appendChild(text);

  // Badges row: due date (if any) and a description hint (Trello-style).
  const badges = el('div', 'card-badges');
  if (card.isTemplate) {
    const tpl = el('span', 'card-badge card-template', `📋 ${t('template')}`);
    badges.appendChild(tpl);
  }
  if (card.dueAt != null) {
    const status = dueStatus(card);
    // With a start date the badge shows the whole range (Trello-style).
    const range =
      card.startAt != null
        ? `${formatDueShort(card.startAt)} ~ ${formatDueShort(card.dueAt)}`
        : formatDueShort(card.dueAt);
    const due = el('span', `card-badge card-due is-${status}`, `🕒 ${range}`);
    due.title = t('dueDate');
    badges.appendChild(due);
  } else if (card.startAt != null) {
    const start = el('span', 'card-badge', `▶️ ${formatDueShort(card.startAt)}`);
    start.title = t('startDate');
    badges.appendChild(start);
  }
  if (card.description.trim()) {
    const note = el('span', 'card-badge', '📝');
    note.title = t('description');
    badges.appendChild(note);
  }
  if (card.attachments.length > 0) {
    const att = el('span', 'card-badge', `📎 ${card.attachments.length}`);
    att.title = t('attachments');
    badges.appendChild(att);
  }
  if (card.comments.length > 0) {
    const cmt = el('span', 'card-badge', `💬 ${card.comments.length}`);
    cmt.title = t('comments');
    badges.appendChild(cmt);
  }
  const progress = checklistProgress(card);
  if (progress.total > 0) {
    const complete = progress.done === progress.total;
    const chk = el('span', 'card-badge card-check', `☑️ ${progress.done}/${progress.total}`);
    if (complete) chk.classList.add('is-complete');
    chk.title = t('checklist');
    badges.appendChild(chk);
  }
  if (badges.children.length > 0) node.appendChild(badges);

  const actions = el('div', 'card-actions');
  const openBtn = el('button', 'icon-btn', '🔍');
  openBtn.title = t('openCard');
  openBtn.addEventListener('click', () => handlers.openCard(column.id, card.id));
  const colorBtn = el('button', 'icon-btn', '🎨');
  colorBtn.title = t('color');
  colorBtn.addEventListener('click', () => handlers.cycleCardColor(column.id, card.id));
  const archiveBtn = el('button', 'icon-btn', '🗄️');
  archiveBtn.title = t('archive');
  archiveBtn.addEventListener('click', () => handlers.archiveCard(column.id, card.id));
  actions.append(openBtn, colorBtn, archiveBtn);
  node.appendChild(actions);
  return node;
}

/** Build the list's ⋯ menu: sort, copy, move all cards, archive. */
function renderColumnMenu(
  column: Column,
  allColumns: Column[],
  handlers: RenderHandlers,
): HTMLElement {
  const wrap = el('div', 'column-menu-wrap');
  const toggle = el('button', 'icon-btn column-menu-btn', '⋯');
  toggle.title = t('listMenu');
  const menu = el('div', 'column-menu');
  menu.hidden = true;
  wrap.append(toggle, menu);

  // Close when a pointer goes down anywhere outside the menu and its toggle.
  const onOutside = (e: Event): void => {
    if (!wrap.contains(e.target as Node)) closeMenu();
  };
  const closeMenu = (): void => {
    menu.hidden = true;
    document.removeEventListener('pointerdown', onOutside, true);
  };
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    if (!menu.hidden) document.addEventListener('pointerdown', onOutside, true);
    else document.removeEventListener('pointerdown', onOutside, true);
  });

  const addItem = (label: string, onPick: () => void): void => {
    const item = el('button', 'column-menu-item', label);
    item.addEventListener('click', () => {
      closeMenu();
      onPick();
    });
    menu.appendChild(item);
  };

  menu.appendChild(el('div', 'column-menu-title', t('sortBy')));
  addItem(`🔤 ${t('sortByName')}`, () => handlers.sortColumn(column.id, 'name'));
  addItem(`🕘 ${t('sortByCreated')}`, () => handlers.sortColumn(column.id, 'created'));
  addItem(`🕒 ${t('sortByDue')}`, () => handlers.sortColumn(column.id, 'due'));

  menu.appendChild(el('div', 'column-menu-title', t('actions')));
  addItem(`📝 ${t('addCardsBulk')}`, () => handlers.addCardsBulk(column.id));
  addItem(`📑 ${t('copyList')}`, () => handlers.copyColumn(column.id));
  addItem(`🗄️ ${t('archive')}`, () => handlers.archiveColumn(column.id));

  const others = allColumns.filter((c) => c.id !== column.id);
  if (others.length > 0 && column.cards.length > 0) {
    menu.appendChild(el('div', 'column-menu-title', t('moveAllCardsTo')));
    for (const other of others) {
      addItem(`➡️ ${other.title || ' '}`, () => handlers.moveAllCards(column.id, other.id));
    }
  }
  return wrap;
}

function renderColumn(
  column: Column,
  index: number,
  allColumns: Column[],
  labels: Map<string, Label>,
  filter: FilterState,
  now: number,
  handlers: RenderHandlers,
): HTMLElement {
  const node = el('div', 'column');
  node.dataset.colId = column.id;
  node.dataset.colIndex = String(index);

  const filtering = isFilterActive(filter);
  const visibleCards = filtering
    ? column.cards.filter((card) => cardMatchesFilter(card, filter, now))
    : column.cards;

  const header = el('div', 'column-header');
  header.dataset.colHandle = '';
  const title = el('div', 'column-title', column.title || ' ');
  title.addEventListener('click', () => {
    startInlineEdit(title, column.title, (value) => handlers.renameColumn(column.id, value));
  });
  header.append(title);
  // Card count; while filtering, show how many of the column's cards match.
  const count = filtering
    ? `${visibleCards.length}/${column.cards.length}`
    : String(column.cards.length);
  header.append(el('span', 'column-count', count));
  header.append(renderColumnMenu(column, allColumns, handlers));

  const list = el('div', 'cards-list');
  list.dataset.cards = '';
  if (visibleCards.length === 0) {
    const hint = filtering ? t('noMatchingCards') : t('emptyColumn');
    list.appendChild(el('div', 'empty-hint', hint));
  }
  for (const card of visibleCards) {
    list.appendChild(renderCard(card, column, labels, handlers));
  }

  const footer = el('div', 'column-footer');
  const addBtn = el('button', 'add-card-btn', '➕');
  addBtn.title = t('addCard');
  addBtn.addEventListener('click', () => handlers.addCard(column.id));
  footer.appendChild(addBtn);

  node.append(header, list, footer);
  return node;
}

/** Render the whole board into `container`, clearing previous content. */
export function renderBoard(
  container: HTMLElement,
  board: Board,
  filter: FilterState,
  handlers: RenderHandlers,
): void {
  container.replaceChildren();
  const labels = new Map(board.labels.map((label) => [label.id, label]));
  const now = Date.now();
  board.columns.forEach((column, index) => {
    container.appendChild(
      renderColumn(column, index, board.columns, labels, filter, now, handlers),
    );
  });

  const addColumn = el('button', 'add-column', '➕');
  addColumn.title = t('addColumn');
  addColumn.dataset.addColumn = '';
  addColumn.addEventListener('click', () => handlers.addColumn());
  container.appendChild(addColumn);
}
