// Keeps each column's max-height in sync with the *actually visible* board area
// so the board reflows correctly across foldable postures (folded <-> unfolded),
// orientation changes and toolbar line-wrapping — without assuming a fixed
// toolbar height. The available height is published as a CSS custom property
// (`--column-max-h`) that the stylesheet consumes, replacing the brittle
// `calc(100vh - 120px)` magic constant.
/**
 * Visible column height = the board surface's inner height minus its own
 * vertical padding. Pure and DOM-free so it can be unit-tested directly. Never
 * returns a negative value (a collapsed surface yields 0).
 */
export function availableColumnHeight(surfaceHeight, paddingTop, paddingBottom) {
    return Math.max(0, surfaceHeight - paddingTop - paddingBottom);
}
export class LayoutController {
    constructor(surface, columns, view) {
        this.frame = 0;
        this.surface = surface;
        this.columns = columns;
        this.view = view;
        this.attach();
    }
    attach() {
        const schedule = () => this.schedule();
        this.view.addEventListener('resize', schedule);
        this.view.addEventListener('orientationchange', schedule);
        // A ResizeObserver catches foldable posture changes (which may not emit a
        // window `resize`) and toolbar wrapping that shrinks the surface, keeping
        // the measurement correct without any hardcoded toolbar height.
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(schedule).observe(this.surface);
        }
        this.update();
    }
    /** Coalesce bursts of resize events into a single measurement per frame. */
    schedule() {
        if (this.frame)
            return;
        this.frame = this.view.requestAnimationFrame(() => {
            this.frame = 0;
            this.update();
        });
    }
    update() {
        const style = this.view.getComputedStyle(this.surface);
        const available = availableColumnHeight(this.surface.clientHeight, parseFloat(style.paddingTop) || 0, parseFloat(style.paddingBottom) || 0);
        this.columns.style.setProperty('--column-max-h', `${available}px`);
    }
}
