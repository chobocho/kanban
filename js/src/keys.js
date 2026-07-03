// Keyboard navigation between cards. Cards are focusable (tabindex=0, set by
// the renderer); this controller moves focus with the arrow keys and opens the
// card detail with Enter/Space. It delegates on the columns container, so it
// survives every re-render without re-wiring.
/** Visible cards of the column that contains `card`, in DOM order. */
function cardsOf(column) {
    return Array.from(column.querySelectorAll('[data-card-id]'));
}
export class KeyboardNavigator {
    constructor(root, openCard) {
        this.root = root;
        this.openCard = openCard;
        root.addEventListener('keydown', (e) => this.onKey(e));
    }
    onKey(e) {
        const target = e.target;
        // Only act when the card element itself is focused; leave inner controls
        // (inline editors, buttons) to their native keyboard behavior.
        const card = target?.closest('[data-card-id]');
        if (!card || target !== card)
            return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.openCard(card.dataset.colId ?? '', card.dataset.cardId ?? '');
            return;
        }
        let next;
        const column = card.closest('.column');
        if (!column)
            return;
        const siblings = cardsOf(column);
        const index = siblings.indexOf(card);
        if (e.key === 'ArrowDown') {
            next = siblings[index + 1];
        }
        else if (e.key === 'ArrowUp') {
            next = siblings[index - 1];
        }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            // Jump to the card at the same height in the neighboring column,
            // clamped to that column's last card. Empty columns are skipped.
            const columns = Array.from(this.root.querySelectorAll('.column'));
            const step = e.key === 'ArrowRight' ? 1 : -1;
            for (let at = columns.indexOf(column) + step; at >= 0 && at < columns.length && !next; at += step) {
                const neighbors = cardsOf(columns[at]);
                next = neighbors[Math.min(index, neighbors.length - 1)];
            }
        }
        else {
            return;
        }
        if (next) {
            e.preventDefault();
            next.focus();
        }
    }
}
