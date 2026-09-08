import { CAM } from './config';

/**
 * Input, unified across touch and keyboard.
 *
 * The stick is reported in *camera-relative* screen space (x right, y up) and
 * converted here into world directions using the camera's fixed yaw. Because
 * the camera never rotates, "push up" always means the same world direction,
 * which is the whole reason the fixed angle was worth choosing.
 */

/** Yaw of the camera's ground-plane forward vector. */
const CAM_YAW = Math.atan2(-CAM.offset.x, -CAM.offset.z);
const FWD_X = Math.sin(CAM_YAW);
const FWD_Z = Math.cos(CAM_YAW);
const RIGHT_X = -Math.cos(CAM_YAW);
const RIGHT_Z = Math.sin(CAM_YAW);

const STICK_RADIUS = 58;

export class Input {
  /** World-space stick direction, each component -1..1. */
  x = 0;
  z = 0;

  private jumpEdge = false;
  private boardEdge = false;
  private shootEdge = false;

  private keys = new Set<string>();
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };

  /** Set false by the game while the build UI owns the screen. */
  enabled = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onAnyInteraction: () => void,
  ) {
    this.bindKeyboard();
    this.bindStick();
    this.bindButtons();
    this.bindCanvasTap();
  }

  // ------------------------------------------------------------- bindings ---

  private bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      this.onAnyInteraction();
      if (!this.enabled) return;
      if (k === ' ') {
        e.preventDefault();
        this.jumpEdge = true;
      }
      if (k === 'e') this.boardEdge = true;
      if (k === 'j' || k === 'enter') this.shootEdge = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private bindStick() {
    const zone = document.getElementById('stick-zone');
    const base = document.getElementById('stick-base');
    const nub = document.getElementById('stick-nub');
    if (!zone || !base || !nub) return;

    const place = (clientX: number, clientY: number) => {
      const r = zone.getBoundingClientRect();
      base.style.left = `${clientX - r.left}px`;
      base.style.bottom = `${r.bottom - clientY}px`;
    };

    zone.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.enabled) return;
        this.onAnyInteraction();
        this.stickId = e.pointerId;
        this.stickOrigin = { x: e.clientX, y: e.clientY };
        this.stickVec = { x: 0, y: 0 };
        place(e.clientX, e.clientY);
        base.classList.add('on');
        nub.style.transform = 'translate(0px, 0px)';
        zone.setPointerCapture(e.pointerId);
        e.preventDefault();
      },
      { passive: false },
    );

    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS;
        dy = (dy / len) * STICK_RADIUS;
      }
      nub.style.transform = `translate(${dx}px, ${dy}px)`;
      // Screen y grows downward; the stick's "up" is -y.
      this.stickVec = { x: dx / STICK_RADIUS, y: -dy / STICK_RADIUS };
    });

    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stickVec = { x: 0, y: 0 };
      base.classList.remove('on');
      nub.style.transform = 'translate(0px, 0px)';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  private bindButtons() {
    const hook = (id: string, fn: () => void) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(
        'pointerdown',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.onAnyInteraction();
          if (this.enabled) fn();
        },
        { passive: false },
      );
    };
    hook('btn-jump', () => (this.jumpEdge = true));
    hook('btn-board', () => (this.boardEdge = true));
    hook('btn-shoot', () => (this.shootEdge = true));
  }

  /** Tapping open space shoots, which is how most people will actually play. */
  private bindCanvasTap() {
    let downAt = 0;
    let downPos = { x: 0, y: 0 };
    this.canvas.addEventListener('pointerdown', (e) => {
      downAt = performance.now();
      downPos = { x: e.clientX, y: e.clientY };
      this.onAnyInteraction();
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!this.enabled) return;
      const dt = performance.now() - downAt;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      if (dt < 300 && moved < 14) this.shootEdge = true;
    });
  }

  // -------------------------------------------------------------- sampling ---

  /** Recompute the world-space stick. Call once per frame before reading x/z. */
  sample() {
    let sx = this.stickVec.x;
    let sy = this.stickVec.y;

    if (this.keys.has('a') || this.keys.has('arrowleft')) sx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) sx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) sy += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) sy -= 1;

    const len = Math.hypot(sx, sy);
    if (len > 1) {
      sx /= len;
      sy /= len;
    }

    this.x = sy * FWD_X + sx * RIGHT_X;
    this.z = sy * FWD_Z + sx * RIGHT_Z;
  }

  takeJump(): boolean {
    const v = this.jumpEdge;
    this.jumpEdge = false;
    return v;
  }

  takeBoard(): boolean {
    const v = this.boardEdge;
    this.boardEdge = false;
    return v;
  }

  takeShoot(): boolean {
    const v = this.shootEdge;
    this.shootEdge = false;
    return v;
  }

  clearEdges() {
    this.jumpEdge = false;
    this.boardEdge = false;
    this.shootEdge = false;
  }
}
