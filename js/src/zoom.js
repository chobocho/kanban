// Zoom controller: supports two-finger pinch zoom, Ctrl/Cmd + mouse wheel, and
// explicit zoom buttons. The scale is applied as a CSS transform on a target
// element. No external library is used.
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
const STEP = 0.1;
export class ZoomController {
    constructor(target, surface, onChange) {
        this.scale = 1;
        // Active pointers for pinch detection.
        this.pointers = new Map();
        this.pinchStartDistance = 0;
        this.pinchStartScale = 1;
        this.target = target;
        this.surface = surface;
        this.onChange = onChange;
        this.attach();
    }
    /** True while a two-finger pinch is in progress (so drag-and-drop can yield). */
    isPinching() {
        return this.pointers.size >= 2;
    }
    getScale() {
        return this.scale;
    }
    setScale(value) {
        this.scale = Math.max(MIN_ZOOM, Math.min(value, MAX_ZOOM));
        this.target.style.transform = `scale(${this.scale})`;
        this.target.style.transformOrigin = 'top left';
        this.onChange(this.scale);
    }
    zoomIn() {
        this.setScale(this.scale + STEP);
    }
    zoomOut() {
        this.setScale(this.scale - STEP);
    }
    reset() {
        this.setScale(1);
    }
    attach() {
        this.surface.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        this.surface.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        this.surface.addEventListener('pointermove', (e) => this.onPointerMove(e));
        this.surface.addEventListener('pointerup', (e) => this.onPointerUp(e));
        this.surface.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    }
    onWheel(e) {
        if (!e.ctrlKey && !e.metaKey)
            return;
        e.preventDefault();
        this.setScale(this.scale - Math.sign(e.deltaY) * STEP);
    }
    onPointerDown(e) {
        if (e.pointerType !== 'touch')
            return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 2) {
            this.pinchStartDistance = this.currentDistance();
            this.pinchStartScale = this.scale;
        }
    }
    onPointerMove(e) {
        if (e.pointerType !== 'touch')
            return;
        if (!this.pointers.has(e.pointerId))
            return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 2 && this.pinchStartDistance > 0) {
            e.preventDefault();
            const ratio = this.currentDistance() / this.pinchStartDistance;
            this.setScale(this.pinchStartScale * ratio);
        }
    }
    onPointerUp(e) {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2)
            this.pinchStartDistance = 0;
    }
    currentDistance() {
        const pts = Array.from(this.pointers.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        return Math.hypot(dx, dy);
    }
}
