// Renders the active board into the DOM. The renderer only builds elements and
// delegates every mutation to the provided handlers, keeping it free of state
// and storage concerns. Data attributes drive the drag-and-drop controller.
import { t } from './i18n.js';
/** Card accent colors cycled by the palette button (empty = no accent). */
export const CARD_COLORS = ['', '#ef5350', '#ffa726', '#ffee58', '#66bb6a', '#42a5f5', '#ab47bc'];
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
/** Maximum visible height of an inline editor, in text lines. */
const INLINE_EDIT_MAX_LINES = 20;
/** Resize a textarea to fit its content, capped at `maxLines` lines. */
function autoGrow(textarea, maxLines) {
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
/** Replace a text element with a textarea for inline editing. */
function startInlineEdit(host, initial, onSave) {
    const textarea = el('textarea', 'inline-edit');
    textarea.value = initial;
    host.replaceWith(textarea);
    textarea.focus();
    textarea.select();
    autoGrow(textarea, INLINE_EDIT_MAX_LINES);
    // Grow/shrink as the user types (covers typing, pasting and Shift+Enter).
    textarea.addEventListener('input', () => autoGrow(textarea, INLINE_EDIT_MAX_LINES));
    let done = false;
    const finish = (commit) => {
        if (done)
            return;
        done = true;
        if (commit)
            onSave(textarea.value.trim());
        else
            onSave(initial); // re-render restores original
    };
    textarea.addEventListener('blur', () => finish(true));
    textarea.addEventListener('keydown', (e) => {
        // Enter commits; Shift+Enter inserts a newline (handled natively).
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            finish(true);
        }
        else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
        }
    });
}
function renderCard(card, column, handlers) {
    const node = el('div', 'card');
    node.dataset.cardId = card.id;
    node.dataset.colId = column.id;
    if (card.color) {
        const stripe = el('span', 'card-stripe');
        stripe.style.background = card.color;
        node.appendChild(stripe);
    }
    const text = el('div', 'card-text', card.text || ' ');
    text.addEventListener('click', () => {
        startInlineEdit(text, card.text, (value) => handlers.editCard(column.id, card.id, value));
    });
    node.appendChild(text);
    const actions = el('div', 'card-actions');
    const colorBtn = el('button', 'icon-btn', '🎨');
    colorBtn.title = t('color');
    colorBtn.addEventListener('click', () => handlers.cycleCardColor(column.id, card.id));
    const delBtn = el('button', 'icon-btn', '🗑️');
    delBtn.title = t('delete');
    delBtn.addEventListener('click', () => handlers.deleteCard(column.id, card.id));
    actions.append(colorBtn, delBtn);
    node.appendChild(actions);
    return node;
}
function renderColumn(column, index, handlers) {
    const node = el('div', 'column');
    node.dataset.colId = column.id;
    node.dataset.colIndex = String(index);
    const header = el('div', 'column-header');
    header.dataset.colHandle = '';
    const title = el('div', 'column-title', column.title || ' ');
    title.addEventListener('click', () => {
        startInlineEdit(title, column.title, (value) => handlers.renameColumn(column.id, value));
    });
    const delBtn = el('button', 'icon-btn', '🗑️');
    delBtn.title = t('delete');
    delBtn.addEventListener('click', () => handlers.deleteColumn(column.id));
    header.append(title, delBtn);
    const list = el('div', 'cards-list');
    list.dataset.cards = '';
    if (column.cards.length === 0) {
        list.appendChild(el('div', 'empty-hint', t('emptyColumn')));
    }
    for (const card of column.cards) {
        list.appendChild(renderCard(card, column, handlers));
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
export function renderBoard(container, board, handlers) {
    container.replaceChildren();
    board.columns.forEach((column, index) => {
        container.appendChild(renderColumn(column, index, handlers));
    });
    const addColumn = el('button', 'add-column', '➕');
    addColumn.title = t('addColumn');
    addColumn.dataset.addColumn = '';
    addColumn.addEventListener('click', () => handlers.addColumn());
    container.appendChild(addColumn);
}
