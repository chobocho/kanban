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
/** Replace a text element with a textarea for inline editing. */
function startInlineEdit(host, initial, onSave) {
    const textarea = el('textarea', 'inline-edit');
    textarea.value = initial;
    host.replaceWith(textarea);
    textarea.focus();
    textarea.select();
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
    colorBtn.title = 'color';
    colorBtn.addEventListener('click', () => handlers.cycleCardColor(column.id, card.id));
    const delBtn = el('button', 'icon-btn', '✕');
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
    const delBtn = el('button', 'icon-btn', '✕');
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
    const addBtn = el('button', 'add-card-btn', t('addCard'));
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
    const addColumn = el('button', 'add-column', t('addColumn'));
    addColumn.dataset.addColumn = '';
    addColumn.addEventListener('click', () => handlers.addColumn());
    container.appendChild(addColumn);
}
