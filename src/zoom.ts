// Zoom controller: supports two-finger pinch zoom, Ctrl/Cmd + mouse wheel, and
// explicit zoom buttons. The scale is applied as a CSS transform on a target
// element. No external library is used.

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
const STEP = 0.1;

export class ZoomController {
  private scale = 1;
  private readonly target: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly onChange: (scale: number) => void;

  // Active pointers for pinch detection.
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchStartDistance = 0;
  private pinchStartScale = 1;

  constructor(target: HTMLElement, surface: HTMLElement, onChange: (scale: number) => void) {
    this.target = target;
    this.surface = surface;
    this.onChange = onChange;
    this.attach();
  }

  /** True while a two-finger pinch is in progress (so drag-and-drop can yield). */
  isPinching(): boolean {
    return this.pointers.size >= 2;
  }

  getScale(): number {
    return this.scale;
  }

  setScale(value: number): void {
    this.scale = Math.max(MIN_ZOOM, Math.min(value, MAX_ZOOM));
    this.target.style.transform = `scale(${this.scale})`;
    this.target.style.transformOrigin = 'top left';
    this.onChange(this.scale);
  }

  zoomIn(): void {
    this.setScale(this.scale + STEP);
  }

  zoomOut(): void {
    this.setScale(this.scale - STEP);
  }

  reset(): void {
    this.setScale(1);
  }

  private attach(): void {
    this.surface.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.surface.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.surface.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.surface.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.surface.addEventListener('pointercancel', (e) => this.onPointerUp(e));
  }

  private onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    this.setScale(this.scale - Math.sign(e.deltaY) * STEP);
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      this.pinchStartDistance = this.currentDistance();
      this.pinchStartScale = this.scale;
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && this.pinchStartDistance > 0) {
      e.preventDefault();
      const ratio = this.currentDistance() / this.pinchStartDistance;
      this.setScale(this.pinchStartScale * ratio);
    }
  }

  private onPointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStartDistance = 0;
  }

  private currentDistance(): number {
    const pts = Array.from(this.pointers.values());
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    return Math.hypot(dx, dy);
  }
}
