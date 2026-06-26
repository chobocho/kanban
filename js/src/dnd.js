// Pointer-based drag and drop for cards and columns. Works with both mouse and
// touch (Pointer Events). A floating clone follows the pointer and a live
// placeholder shows the drop position, giving a Trello-like feel. The board is
// re-rendered by the app after each drop, so transient DOM edits here are safe.
//
// Touch needs special care: the board and each card list are scrollable, so the
// browser would otherwise treat a finger drag as a scroll (and fire
// pointercancel, aborting the drag). To keep both gestures usable, touch drags
// begin on a short press-and-hold; a quick swipe still scrolls. Once a touch
// drag is active a non-passive touchmove handler suppresses native scrolling,
// which a pointermove preventDefault alone cannot do.
const DRAG_THRESHOLD = 6;
// Press-and-hold duration before a touch drag begins.
const TOUCH_HOLD_MS = 200;
// If the finger travels more than this before the hold fires, it is a scroll.
const TOUCH_SCROLL_CANCEL = 10;
export class DragController {
    constructor(root, cb) {
        this.pointerId = null;
        this.pointerType = '';
        this.mode = null;
        this.dragging = false;
        this.startX = 0;
        this.startY = 0;
        this.lastX = 0;
        this.lastY = 0;
        // setTimeout handle for the touch press-and-hold (0 when inactive).
        this.holdTimer = 0;
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
        // While a touch drag is active, stop the browser from scrolling the board
        // or a card list. Must be non-passive so preventDefault takes effect.
        root.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    }
    onDown(e) {
        // A second pointer (e.g. the start of a pinch) appears: abandon any drag or
        // pending hold so the zoom controller can take over cleanly.
        if (this.pointerId !== null) {
            this.cancel();
            return;
        }
        if (e.button !== 0)
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
        this.pointerType = e.pointerType;
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        // Touch: wait for a short hold so quick swipes can still scroll. Mouse/pen
        // start dragging as soon as the pointer moves past the small threshold.
        if (e.pointerType === 'touch') {
            this.holdTimer = setTimeout(() => this.onHold(), TOUCH_HOLD_MS);
        }
    }
    /** The touch press-and-hold elapsed: promote the candidate to a drag. */
    onHold() {
        this.holdTimer = 0;
        if (this.pointerId === null || this.dragging || !this.sourceEl)
            return;
        if (this.cb.isBlocked()) {
            this.reset();
            return;
        }
        this.begin(this.pointerId, this.lastX, this.lastY);
        this.positionClone(this.lastX, this.lastY);
        if (this.mode === 'card')
            this.updateCardPlaceholder(this.lastX, this.lastY);
        else
            this.updateColumnPlaceholder(this.lastX, this.lastY);
    }
    onMove(e) {
        if (this.pointerId !== e.pointerId || !this.sourceEl)
            return;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        if (!this.dragging) {
            const moved = Math.hypot(e.clientX - this.startX, e.clientY - this.startY);
            if (this.pointerType === 'touch') {
                // Movement before the hold fires means the user is scrolling, not
                // dragging: drop the candidate and let the browser scroll.
                if (moved > TOUCH_SCROLL_CANCEL)
                    this.reset();
                return;
            }
            if (moved < DRAG_THRESHOLD)
                return;
            if (this.cb.isBlocked()) {
                this.reset();
                return;
            }
            this.begin(e.pointerId, e.clientX, e.clientY);
        }
        if (!this.dragging || !this.clone)
            return;
        e.preventDefault();
        this.positionClone(e.clientX, e.clientY);
        if (this.mode === 'card')
            this.updateCardPlaceholder(e.clientX, e.clientY);
        else
            this.updateColumnPlaceholder(e.clientX, e.clientY);
    }
    /** Suppress native scrolling while a touch drag is in progress. */
    onTouchMove(e) {
        if (this.dragging)
            e.preventDefault();
    }
    begin(pointerId, x, y) {
        if (!this.sourceEl)
            return;
        this.dragging = true;
        this.root.setPointerCapture(pointerId);
        const rect = this.sourceEl.getBoundingClientRect();
        this.offsetX = x - rect.left;
        this.offsetY = y - rect.top;
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
    positionClone(x, y) {
        if (!this.clone)
            return;
        this.clone.style.left = `${x - this.offsetX}px`;
        this.clone.style.top = `${y - this.offsetY}px`;
    }
    updateCardPlaceholder(x, y) {
        const list = this.listAtPoint(x, y);
        if (!list || !this.placeholder)
            return;
        const cards = Array.from(list.querySelectorAll('[data-card-id]')).filter((c) => c.style.display !== 'none');
        let inserted = false;
        for (const card of cards) {
            const box = card.getBoundingClientRect();
            if (y < box.top + box.height / 2) {
                list.insertBefore(this.placeholder, card);
                inserted = true;
                break;
            }
        }
        if (!inserted)
            list.appendChild(this.placeholder);
    }
    updateColumnPlaceholder(x, _y) {
        if (!this.placeholder)
            return;
        const columns = Array.from(this.root.querySelectorAll('[data-col-id]')).filter((c) => c.style.display !== 'none');
        let inserted = false;
        for (const col of columns) {
            const box = col.getBoundingClientRect();
            if (x < box.left + box.width / 2) {
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
        if (this.holdTimer) {
            clearTimeout(this.holdTimer);
            this.holdTimer = 0;
        }
        this.pointerId = null;
        this.pointerType = '';
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
