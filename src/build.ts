import * as THREE from 'three';
import { PIECES, PIECE_BY_ID, type PieceDef } from './pieces';
import type { Placed, World } from './surface';
import { YARD } from './config';
import { sfx } from './audio';

const STORE_KEY = 'bts.yard.v1';

/**
 * Build mode.
 *
 * Placement rules are intentionally permissive: pieces may overlap, stack, and
 * point anywhere. This is a sandbox, and the fun comes from precarious
 * nonsense, so the only thing actually enforced is staying inside the fence.
 *
 * Tapping a piece already in the world selects it; tapping open ground drops a
 * new one. Dragging pans the camera, which is what makes the far end of the
 * yard reachable at all.
 */
export class BuildMode {
  active = false;
  /** Camera look-at target while building; the game reads this. */
  readonly panTarget = new THREE.Vector3(0, 0, 0);
  /** Extra dolly distance while building. */
  zoom = 1.35;

  private selectedDef: PieceDef | null = null;
  private selected: Placed | null = null;
  private outline: THREE.BoxHelper | null = null;
  private ray = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private pointerDown = false;
  private movedFar = false;
  private draggingPiece = false;
  private lastPointer = { x: 0, y: 0 };
  private downPointer = { x: 0, y: 0 };
  private pinchDist = 0;
  private activePointers = new Map<number, { x: number; y: number }>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly world: World,
    private readonly scene: THREE.Scene,
  ) {
    this.buildPalette();
    this.bindActions();
    this.bindCanvas();
  }

  // ------------------------------------------------------------------ UI ---

  private buildPalette() {
    const host = document.getElementById('build-palette');
    const hint = document.getElementById('build-hint');
    if (!host) return;
    for (const def of PIECES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'piece';
      b.innerHTML = `<span class="piece-glyph">${def.glyph}</span><span class="piece-name">${def.name}</span>`;
      b.addEventListener('click', () => {
        this.selectedDef = this.selectedDef?.id === def.id ? null : def;
        for (const el of host.querySelectorAll('.piece')) el.classList.remove('sel');
        if (this.selectedDef) b.classList.add('sel');
        if (hint) {
          hint.textContent = this.selectedDef
            ? `${def.name} — ${def.blurb}`
            : 'Pick a piece, then tap the ground to drop it. Tap a placed piece to select it.';
        }
      });
      host.appendChild(b);
    }
  }

  private bindActions() {
    const on = (id: string, fn: () => void) => {
      document.getElementById(id)?.addEventListener('click', fn);
    };
    on('btn-rotate', () => {
      if (!this.selected) return;
      this.selected.yaw += Math.PI / 8;
      this.world.syncMesh(this.selected);
      this.refreshOutline();
      this.save();
      sfx.place();
    });
    on('btn-raise', () => this.nudgeHeight(0.4));
    on('btn-lower', () => this.nudgeHeight(-0.4));
    on('btn-delete', () => {
      if (!this.selected) return;
      this.world.remove(this.selected);
      this.select(null);
      this.save();
    });
    on('btn-clear', () => {
      this.world.clear();
      this.select(null);
      this.save();
    });
  }

  private nudgeHeight(dy: number) {
    if (!this.selected) return;
    this.selected.baseY = Math.max(0, Math.min(24, this.selected.baseY + dy));
    this.world.syncMesh(this.selected);
    this.refreshOutline();
    this.save();
    sfx.place();
  }

  private updateActionState() {
    const has = this.selected !== null;
    for (const id of ['btn-rotate', 'btn-raise', 'btn-lower', 'btn-delete']) {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (el) el.disabled = !has;
    }
  }

  // -------------------------------------------------------------- picking ---

  private ndc(e: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
  }

  private pickPiece(e: { clientX: number; clientY: number }): {
    piece: Placed;
    point: THREE.Vector3;
  } | null {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const hits = this.ray.intersectObjects(
      this.world.pieces.map((p) => p.mesh),
      false,
    );
    const hit = hits[0];
    if (!hit) return null;
    const uid = hit.object.userData.uid as number | undefined;
    const piece = this.world.pieces.find((p) => p.uid === uid);
    return piece ? { piece, point: hit.point } : null;
  }

  private pickGround(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.groundPlane, out);
  }

  private select(p: Placed | null) {
    this.selected = p;
    if (this.outline) {
      this.scene.remove(this.outline);
      this.outline.dispose();
      this.outline = null;
    }
    if (p) {
      this.outline = new THREE.BoxHelper(p.mesh, 0xffb545);
      (this.outline.material as THREE.LineBasicMaterial).depthTest = false;
      this.scene.add(this.outline);
    }
    this.updateActionState();
  }

  private refreshOutline() {
    this.outline?.update();
  }

  // --------------------------------------------------------------- canvas ---

  private bindCanvas() {
    this.canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.active) return;
        this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.activePointers.size === 2) {
          const [a, b] = [...this.activePointers.values()];
          this.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          return;
        }
        this.pointerDown = true;
        this.movedFar = false;
        this.downPointer = { x: e.clientX, y: e.clientY };
        this.lastPointer = { x: e.clientX, y: e.clientY };
        // Grabbing the already-selected piece starts a drag rather than a pan.
        const hit = this.pickPiece(e);
        this.draggingPiece = hit !== null && hit.piece === this.selected;
      },
      { passive: true },
    );

    this.canvas.addEventListener(
      'pointermove',
      (e) => {
        if (!this.active) return;
        if (this.activePointers.has(e.pointerId)) {
          this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
        if (this.activePointers.size === 2) {
          const [a, b] = [...this.activePointers.values()];
          const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          if (this.pinchDist > 0) {
            this.zoom = Math.max(0.5, Math.min(5, this.zoom * (this.pinchDist / d)));
          }
          this.pinchDist = d;
          return;
        }
        if (!this.pointerDown) return;

        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        if (Math.hypot(e.clientX - this.downPointer.x, e.clientY - this.downPointer.y) > 8) {
          this.movedFar = true;
        }
        if (!this.movedFar) return;

        if (this.draggingPiece && this.selected) {
          const g = this.pickGround(e);
          if (g) {
            this.selected.x = g.x;
            this.selected.z = g.z;
            this.clampPiece(this.selected);
            this.world.syncMesh(this.selected);
            this.refreshOutline();
          }
        } else {
          this.pan(dx, dy);
        }
      },
      { passive: true },
    );

    const up = (e: PointerEvent) => {
      if (!this.active) return;
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2) this.pinchDist = 0;
      if (!this.pointerDown) return;
      this.pointerDown = false;
      if (this.draggingPiece && this.movedFar) {
        this.save();
        this.draggingPiece = false;
        return;
      }
      this.draggingPiece = false;
      if (this.movedFar) return;
      this.handleTap(e);
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        this.zoom = Math.max(0.5, Math.min(5, this.zoom * (1 + Math.sign(e.deltaY) * 0.12)));
      },
      { passive: false },
    );
  }

  /** Screen drag -> movement across the ground plane, in camera-facing axes. */
  private pan(dxPx: number, dyPx: number) {
    const scale = 0.055 * this.zoom;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    this.panTarget.addScaledVector(right, dxPx * scale);
    this.panTarget.addScaledVector(fwd, dyPx * scale);
    this.panTarget.x = Math.max(-YARD.halfWidth, Math.min(YARD.halfWidth, this.panTarget.x));
    this.panTarget.z = Math.max(-YARD.halfDepth, Math.min(YARD.halfDepth, this.panTarget.z));
  }

  private clampPiece(p: Placed) {
    const r = Math.max(p.def.width, p.def.length) / 2;
    p.x = Math.max(-YARD.halfWidth + r, Math.min(YARD.halfWidth - r, p.x));
    p.z = Math.max(-YARD.halfDepth + r, Math.min(YARD.halfDepth - r, p.z));
  }

  private handleTap(e: PointerEvent) {
    const hit = this.pickPiece(e);

    if (this.selectedDef) {
      // Dropping onto an existing piece stacks on top of where you tapped.
      const ground = this.pickGround(e);
      const at = hit?.point ?? ground;
      if (!at) return;
      const baseY = hit ? Math.max(0, hit.point.y) : 0;
      const p = this.world.place(this.selectedDef, at.x, at.z, 0, baseY);
      this.clampPiece(p);
      this.world.syncMesh(p);
      this.select(p);
      this.save();
      sfx.place();
      return;
    }

    this.select(hit?.piece ?? null);
  }

  // ------------------------------------------------------------ lifecycle ---

  setActive(on: boolean, focus: THREE.Vector3) {
    this.active = on;
    if (on) {
      this.panTarget.copy(focus);
      this.panTarget.y = 0;
      this.updateActionState();
    } else {
      this.select(null);
      this.selectedDef = null;
      for (const el of document.querySelectorAll('.piece')) el.classList.remove('sel');
    }
  }

  // -------------------------------------------------------------- storage ---

  save() {
    try {
      localStorage.setItem(STORE_KEY, this.world.serialize());
    } catch {
      // Private browsing or a full quota: the yard just will not persist.
    }
  }

  /** Returns true if a saved yard was restored. */
  load(): boolean {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch {
      return false;
    }
    if (!raw) return false;
    try {
      const rows = JSON.parse(raw) as { d: string; x: number; z: number; r: number; b: number }[];
      if (!Array.isArray(rows) || rows.length === 0) return false;
      for (const row of rows) {
        const def = PIECE_BY_ID.get(row.d);
        if (!def) continue;
        this.world.place(def, row.x, row.z, row.r, row.b);
      }
      return true;
    } catch {
      return false;
    }
  }
}
