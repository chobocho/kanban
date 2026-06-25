// Pointer-based drag and drop for cards and columns. Works with both mouse and
// touch (Pointer Events). A floating clone follows the pointer and a live
// placeholder shows the drop position, giving a Trello-like feel. The board is
// re-rendered by the app after each drop, so transient DOM edits here are safe.
const DRAG_THRESHOLD = 6;
export class DragController {
    constructor(root, cb) {
        this.pointerId = null;
        this.mode = null;
        this.dragging = false;
        this.startX = 0;
        this.startY = 0;
        this.sourceEl = null;
        this.clone = null;
        this.placeholder = null;
        this.cardId = '';
        this.fromColId = '';
        this.fromIndex = -1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.root = root;
        this.cb = cb;
        root.addEventListener('pointerdown', (e) => this.onDown(e));
        root.addEventListener('pointermove', (e) => this.onMove(e));
        root.addEventListener('pointerup', (e) => this.onUp(e));
        root.addEventListener('pointercancel', () => this.cancel());
    }
    onDown(e) {
        if (this.pointerId !== null || e.button !== 0)
            return;
        const target = e.target;
        // Ignore interactive controls so editing/buttons still work.
        if (target.closest('button, textarea, input, select, [contenteditable="true"]'))
            return;
        const handle = target.closest('[data-col-handle]');
        const card = target.closest('[data-card-id]');
        if (card) {
            this.mode = 'card';
            this.sourceEl = card;
            this.cardId = card.dataset.cardId ?? '';
            this.fromColId = card.dataset.colId ?? '';
        }
        else if (handle) {
            const column = handle.closest('[data-col-id]');
            if (!column)
                return;
            this.mode = 'column';
            this.sourceEl = column;
            this.fromColId = column.dataset.colId ?? '';
            this.fromIndex = Number(column.dataset.colIndex ?? -1);
        }
        else {
            return;
        }
        this.pointerId = e.pointerId;
        this.startX = e.clientX;
        this.startY = e.clientY;
    }
    onMove(e) {
        if (this.pointerId !== e.pointerId || !this.sourceEl)
            return;
        if (!this.dragging) {
            const moved = Math.hypot(e.clientX - this.startX, e.clientY - this.startY);
            if (moved < DRAG_THRESHOLD)
                return;
            if (this.cb.isBlocked()) {
                this.reset();
                return;
            }
            this.begin(e);
        }
        if (!this.dragging || !this.clone)
            return;
        e.preventDefault();
        this.clone.style.left = `${e.clientX - this.offsetX}px`;
        this.clone.style.top = `${e.clientY - this.offsetY}px`;
        if (this.mode === 'card')
            this.updateCardPlaceholder(e);
        else
            this.updateColumnPlaceholder(e);
    }
    begin(e) {
        if (!this.sourceEl)
            return;
        this.dragging = true;
        this.root.setPointerCapture(e.pointerId);
        const rect = this.sourceEl.getBoundingClientRect();
        this.offsetX = e.clientX - rect.left;
        this.offsetY = e.clientY - rect.top;
        // Floating clone follows the pointer; pointer-events none so it does not
        // interfere with elementFromPoint hit testing.
        const clone = this.sourceEl.cloneNode(true);
        clone.classList.add('drag-clone');
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;
        clone.style.left = `${rect.left}px`;
        clone.style.top = `${rect.top}px`;
        document.body.appendChild(clone);
        this.clone = clone;
        // Placeholder where the item will drop.
        const placeholder = document.createElement('div');
        placeholder.className = this.mode === 'card' ? 'card-placeholder' : 'column-placeholder';
        placeholder.style.height = `${rect.height}px`;
        placeholder.style.width = `${rect.width}px`;
        this.placeholder = placeholder;
        this.sourceEl.style.display = 'none';
        this.sourceEl.after(placeholder);
    }
    updateCardPlaceholder(e) {
        const list = this.listAtPoint(e.clientX, e.clientY);
        if (!list || !this.placeholder)
            return;
        const cards = Array.from(list.querySelectorAll('[data-card-id]')).filter((c) => c.style.display !== 'none');
        let inserted = false;
        for (const card of cards) {
            const box = card.getBoundingClientRect();
            if (e.clientY < box.top + box.height / 2) {
                list.insertBefore(this.placeholder, card);
                inserted = true;
                break;
            }
        }
        if (!inserted)
            list.appendChild(this.placeholder);
    }
    updateColumnPlaceholder(e) {
        if (!this.placeholder)
            return;
        const columns = Array.from(this.root.querySelectorAll('[data-col-id]')).filter((c) => c.style.display !== 'none');
        let inserted = false;
        for (const col of columns) {
            const box = col.getBoundingClientRect();
            if (e.clientX < box.left + box.width / 2) {
                col.before(this.placeholder);
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            const addBtn = this.root.querySelector('[data-add-column]');
            if (addBtn)
                addBtn.before(this.placeholder);
            else
                this.root.appendChild(this.placeholder);
        }
    }
    listAtPoint(x, y) {
        const el = document.elementFromPoint(x, y);
        if (!el)
            return null;
        const column = el.closest('[data-col-id]');
        if (!column)
            return null;
        return column.querySelector('[data-cards]');
    }
    onUp(e) {
        if (this.pointerId !== e.pointerId)
            return;
        if (!this.dragging) {
            this.reset();
            return;
        }
        if (this.mode === 'card')
            this.dropCard();
        else
            this.dropColumn();
        this.cleanup();
        this.reset();
    }
    dropCard() {
        if (!this.placeholder)
            return;
        const list = this.placeholder.closest('[data-cards]');
        if (!list)
            return;
        const toColId = list.closest('[data-col-id]')?.dataset.colId ?? '';
        const siblings = Array.from(list.children).filter((c) => c === this.placeholder || c.matches('[data-card-id]'));
        const toIndex = siblings.indexOf(this.placeholder);
        this.cb.moveCard(this.fromColId, this.cardId, toColId, toIndex);
    }
    dropColumn() {
        if (!this.placeholder || !this.placeholder.parentElement)
            return;
        const siblings = Array.from(this.placeholder.parentElement.children).filter((c) => c === this.placeholder || c.matches('[data-col-id]'));
        const toIndex = siblings.indexOf(this.placeholder);
        this.cb.moveColumn(this.fromIndex, toIndex);
    }
    cleanup() {
        this.clone?.remove();
        this.placeholder?.remove();
        if (this.sourceEl)
            this.sourceEl.style.display = '';
    }
    cancel() {
        this.cleanup();
        this.reset();
    }
    reset() {
        this.pointerId = null;
        this.mode = null;
        this.dragging = false;
        this.sourceEl = null;
        this.clone = null;
        this.placeholder = null;
        this.cardId = '';
        this.fromColId = '';
        this.fromIndex = -1;
    }
}
