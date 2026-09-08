import * as THREE from 'three';
import { buildPieceGeometry, pieceMaterial, type PieceDef } from './pieces';

/**
 * The world's collision model.
 *
 * Placed pieces are height fields in their own rotated local frame, so the
 * whole thing reduces to: transform a world point into each piece's local
 * space, evaluate its profile, and keep the highest surface that the mover is
 * actually allowed to be standing on.
 *
 * Anything taller than the mover can step onto is treated as a wall instead,
 * which is what stops you strolling through a six-metre deck while still
 * letting you ride smoothly up a ramp face.
 */

export interface Placed {
  uid: number;
  def: PieceDef;
  x: number;
  z: number;
  /** Rotation about world Y, radians. */
  yaw: number;
  /** Vertical offset, so pieces can be stacked onto decks. */
  baseY: number;
  mesh: THREE.Mesh;
}

export interface Contact {
  y: number;
  normal: THREE.Vector3;
  piece: Placed | null;
}

const GROUND_NORMAL = new THREE.Vector3(0, 1, 0);

let nextUid = 1;

export class World {
  readonly group = new THREE.Group();
  readonly pieces: Placed[] = [];
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();

  constructor(readonly bounds: { halfWidth: number; halfDepth: number }) {}

  private geometryFor(def: PieceDef): THREE.BufferGeometry {
    let g = this.geoCache.get(def.id);
    if (!g) {
      g = buildPieceGeometry(def);
      this.geoCache.set(def.id, g);
    }
    return g;
  }

  place(def: PieceDef, x: number, z: number, yaw = 0, baseY = 0): Placed {
    const mesh = new THREE.Mesh(this.geometryFor(def), pieceMaterial(def.material));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const p: Placed = { uid: nextUid++, def, x, z, yaw, baseY, mesh };
    mesh.userData.uid = p.uid;
    this.syncMesh(p);
    this.group.add(mesh);
    this.pieces.push(p);
    return p;
  }

  syncMesh(p: Placed) {
    p.mesh.position.set(p.x, p.baseY, p.z);
    p.mesh.rotation.y = p.yaw;
  }

  remove(p: Placed) {
    const i = this.pieces.indexOf(p);
    if (i >= 0) this.pieces.splice(i, 1);
    this.group.remove(p.mesh);
  }

  clear() {
    for (const p of this.pieces) this.group.remove(p.mesh);
    this.pieces.length = 0;
  }

  /** World point -> piece-local coordinates. */
  private toLocal(p: Placed, x: number, z: number, out: { lx: number; lz: number }) {
    const dx = x - p.x;
    const dz = z - p.z;
    const c = Math.cos(-p.yaw);
    const s = Math.sin(-p.yaw);
    out.lx = dx * c - dz * s;
    out.lz = dx * s + dz * c;
  }

  /** Surface height of a piece at a local point, or null if outside its footprint. */
  private localHeight(p: Placed, lx: number, lz: number, pad = 0): number | null {
    const { width, length, height, profile } = p.def;
    if (Math.abs(lx) > width / 2 + pad) return null;
    if (Math.abs(lz) > length / 2 + pad) return null;
    const t = Math.min(1, Math.max(0, (lz + length / 2) / length));
    return p.baseY + height * profile(t);
  }

  /** Outward surface normal of a piece at a local Z, rotated into world space. */
  private normalAt(p: Placed, lz: number, out: THREE.Vector3): THREE.Vector3 {
    const { length, height, profile } = p.def;
    const t = Math.min(1, Math.max(0, (lz + length / 2) / length));
    const d = 0.004;
    const t0 = Math.max(0, t - d);
    const t1 = Math.min(1, t + d);
    const dy = height * (profile(t1) - profile(t0));
    const dz = (t1 - t0) * length;
    const len = Math.hypot(dz, dy) || 1;
    // Local normal is (0, dz, -dy) normalised; rotate about Y by yaw.
    const ny = dz / len;
    const nz = -dy / len;
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    return out.set(nz * s, ny, nz * c).normalize();
  }

  /**
   * Highest supporting surface at (x, z) that sits at or below `ceiling`.
   *
   * Pass the mover's position from *before* integration as the ceiling so that
   * something falling fast still catches the surface it passed through instead
   * of tunnelling to the lawn.
   */
  sample(x: number, z: number, ceiling: number, out?: Contact): Contact {
    const result: Contact = out ?? { y: 0, normal: new THREE.Vector3(), piece: null };
    result.y = 0;
    result.normal.copy(GROUND_NORMAL);
    result.piece = null;
    const loc = { lx: 0, lz: 0 };
    for (const p of this.pieces) {
      this.toLocal(p, x, z, loc);
      const h = this.localHeight(p, loc.lx, loc.lz);
      if (h === null) continue;
      if (h > ceiling + 1e-3) continue;
      if (h <= result.y) continue;
      result.y = h;
      result.piece = p;
      this.normalAt(p, loc.lz, result.normal);
    }
    return result;
  }

  /**
   * Push a mover out of anything it cannot climb.
   *
   * `feetY` is where the mover's feet are; anything rising more than `step`
   * above that within `radius` counts as a wall. Resolution is along the axis
   * of least penetration in the piece's local frame, which for boxy pieces is
   * exactly right and for ramps only ever triggers on the steep back/side
   * faces you would not have ridden anyway.
   */
  resolveWalls(pos: THREE.Vector3, radius: number, feetY: number, step: number) {
    const loc = { lx: 0, lz: 0 };
    for (const p of this.pieces) {
      this.toLocal(p, pos.x, pos.z, loc);
      const hw = p.def.width / 2 + radius;
      const hl = p.def.length / 2 + radius;
      if (Math.abs(loc.lx) > hw || Math.abs(loc.lz) > hl) continue;

      // Height of the piece at the *clamped* point, i.e. the nearest bit of
      // actual surface -- using the padded point would read past the lip.
      const clampedZ = Math.min(p.def.length / 2, Math.max(-p.def.length / 2, loc.lz));
      const h = this.localHeight(p, 0, clampedZ);
      if (h === null || h <= feetY + step) continue;

      const penX = hw - Math.abs(loc.lx);
      const penZ = hl - Math.abs(loc.lz);
      const c = Math.cos(p.yaw);
      const s = Math.sin(p.yaw);
      if (penX < penZ) {
        const push = penX * Math.sign(loc.lx || 1);
        // Local +X rotated into world.
        pos.x += push * c;
        pos.z += push * -s;
      } else {
        const push = penZ * Math.sign(loc.lz || 1);
        // Local +Z rotated into world.
        pos.x += push * s;
        pos.z += push * c;
      }
    }
  }

  /** Keep movers inside the fence line. */
  clampToYard(pos: THREE.Vector3, radius = 0.4) {
    const hx = this.bounds.halfWidth - radius;
    const hz = this.bounds.halfDepth - radius;
    pos.x = Math.min(hx, Math.max(-hx, pos.x));
    pos.z = Math.min(hz, Math.max(-hz, pos.z));
  }

  serialize(): string {
    return JSON.stringify(
      this.pieces.map((p) => ({
        d: p.def.id,
        x: +p.x.toFixed(3),
        z: +p.z.toFixed(3),
        r: +p.yaw.toFixed(4),
        b: +p.baseY.toFixed(3),
      })),
    );
  }
}
