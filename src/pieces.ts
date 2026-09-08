import * as THREE from 'three';
import { plywoodTexture } from './textures';

/**
 * Buildable pieces.
 *
 * A piece is defined by one thing: a `profile(t)` curve returning a normalised
 * height in [0,1] as you travel along the piece's local +Z axis from t=0 (back
 * edge) to t=1 (front lip). That single function generates *both* the visible
 * mesh and the surface the physics samples, so the ramp you see and the ramp
 * you ride can never disagree.
 *
 * Every piece is symmetric in local X, which is why the surface height depends
 * only on Z. That keeps the sampler cheap enough to call several times a frame
 * for the skater and every live ball.
 */

export interface PieceDef {
  id: string;
  name: string;
  glyph: string;
  /** Extent along local X. */
  width: number;
  /** Extent along local Z. */
  length: number;
  /** Height at profile()===1. */
  height: number;
  /** Normalised height in [0,1] for t in [0,1]. */
  profile: (t: number) => number;
  /** Segments used to loft the mesh. Curved pieces need more. */
  segments: number;
  material: 'wood' | 'metal';
  blurb: string;
}

const linear = (t: number) => t;
const flat = () => 1;
/** Quarter-pipe transition: gentle at the base, near-vertical at the lip. */
const transition = (t: number) => 1 - Math.sqrt(Math.max(0, 1 - t * t));
/** Up, flat, down. */
const funbox = (t: number) => {
  if (t < 0.26) return t / 0.26;
  if (t > 0.74) return (1 - t) / 0.26;
  return 1;
};
/** Launch ramp with a slight kick at the lip -- eases in, steepens late. */
const kicked = (t: number) => t * t * (0.58 + 0.42 * t);

export const PIECES: PieceDef[] = [
  {
    id: 'kicker',
    name: 'Kicker',
    glyph: '🛝',
    width: 3,
    length: 4.2,
    height: 1.15,
    profile: kicked,
    segments: 14,
    material: 'wood',
    blurb: 'Little pop. Good for tapping one in off a roll-past.',
  },
  {
    id: 'launch',
    name: 'Launch Ramp',
    glyph: '📐',
    width: 3.6,
    length: 9,
    height: 3.4,
    profile: kicked,
    segments: 20,
    material: 'wood',
    blurb: 'The workhorse. Enough air to get level with the rim.',
  },
  {
    id: 'mega',
    name: 'Mega Ramp',
    glyph: '🗼',
    width: 5.5,
    length: 28,
    height: 13,
    profile: kicked,
    segments: 40,
    material: 'wood',
    blurb: 'Absurd. Point it at the hoop from across the yard and commit.',
  },
  {
    id: 'quarter',
    name: 'Quarter Pipe',
    glyph: '🌊',
    width: 4.4,
    length: 3.6,
    height: 3.4,
    profile: transition,
    segments: 26,
    material: 'wood',
    blurb: 'Vertical lip. Throws you straight up rather than out.',
  },
  {
    id: 'bigquarter',
    name: 'Big Transition',
    glyph: '🏄',
    width: 6,
    length: 7,
    height: 7,
    profile: transition,
    segments: 34,
    material: 'wood',
    blurb: 'Serious vert. You will need speed to make it to the top.',
  },
  {
    id: 'platform',
    name: 'Platform',
    glyph: '🟫',
    width: 5,
    length: 5,
    height: 1.7,
    profile: flat,
    segments: 2,
    material: 'wood',
    blurb: 'Flat deck. Stack ramps on it with Raise to build a run.',
  },
  {
    id: 'deck',
    name: 'High Deck',
    glyph: '🏗️',
    width: 8,
    length: 8,
    height: 6,
    profile: flat,
    segments: 2,
    material: 'wood',
    blurb: 'Somewhere to drop in from. Pair it with a roll-in.',
  },
  {
    id: 'rollin',
    name: 'Roll-In',
    glyph: '📉',
    width: 3.6,
    length: 10,
    height: 6,
    profile: (t) => transition(1 - t),
    segments: 24,
    material: 'wood',
    blurb: 'Descends. Feed it from a High Deck to get real speed.',
  },
  {
    id: 'funbox',
    name: 'Fun Box',
    glyph: '📦',
    width: 4.2,
    length: 9,
    height: 1.1,
    profile: funbox,
    segments: 18,
    material: 'wood',
    blurb: 'Up, across, down. Nice for a casual mid-air release.',
  },
  {
    id: 'rail',
    name: 'Grind Rail',
    glyph: '🚉',
    width: 0.5,
    length: 9,
    height: 0.62,
    profile: flat,
    segments: 2,
    material: 'metal',
    blurb: 'Narrow. Land on it and hold your line.',
  },
  {
    id: 'wedge',
    name: 'Steep Wedge',
    glyph: '📏',
    width: 3.2,
    length: 3.6,
    height: 2.6,
    profile: linear,
    segments: 10,
    material: 'wood',
    blurb: 'Nearly 40 degrees. Brutal, but the arc it gives is beautiful.',
  },
];

export const PIECE_BY_ID = new Map(PIECES.map((p) => [p.id, p]));

/**
 * Loft the profile into a closed solid: top surface, two side skirts, both end
 * caps and a floor. UVs run along the length so the plywood grain follows the
 * direction of travel.
 */
export function buildPieceGeometry(def: PieceDef): THREE.BufferGeometry {
  const { width: w, length: L, height: h, segments: N } = def;
  const hw = w / 2;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];

  const yAt = (t: number) => h * def.profile(Math.min(1, Math.max(0, t)));
  const zAt = (t: number) => -L / 2 + t * L;

  // Surface normal from the numerical derivative of the profile.
  const normalAt = (t: number): [number, number, number] => {
    const d = 0.5 / N;
    const dy = yAt(t + d) - yAt(t - d);
    const dz = (Math.min(1, t + d) - Math.max(0, t - d)) * L;
    const len = Math.hypot(dz, dy) || 1;
    // Tangent (0, dy, dz) -> normal (0, dz, -dy)
    return [0, dz / len, -dy / len];
  };

  const tri = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    n: [number, number, number],
    uva: [number, number],
    uvb: [number, number],
    uvc: [number, number],
  ) => {
    pos.push(...a, ...b, ...c);
    nor.push(...n, ...n, ...n);
    uv.push(...uva, ...uvb, ...uvc);
  };

  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    n: [number, number, number],
    uvScale: [number, number] = [1, 1],
  ) => {
    tri(a, b, c, n, [0, 0], [uvScale[0], 0], [uvScale[0], uvScale[1]]);
    tri(a, c, d, n, [0, 0], [uvScale[0], uvScale[1]], [0, uvScale[1]]);
  };

  // --- Top surface -------------------------------------------------------
  const uRepeat = Math.max(1, L / 2.4);
  for (let i = 0; i < N; i++) {
    const t0 = i / N;
    const t1 = (i + 1) / N;
    const y0 = yAt(t0);
    const y1 = yAt(t1);
    const z0 = zAt(t0);
    const z1 = zAt(t1);
    const n0 = normalAt(t0);
    const n1 = normalAt(t1);
    const v0 = t0 * uRepeat;
    const v1 = t1 * uRepeat;
    const uw = Math.max(1, w / 2.4);
    // Two triangles, per-vertex normals so curved transitions shade smoothly.
    // Wound counter-clockwise as seen from above, or the deck gets culled and
    // you end up looking straight through the ramp at its own back faces.
    pos.push(-hw, y0, z0, hw, y1, z1, hw, y0, z0);
    nor.push(...n0, ...n1, ...n0);
    uv.push(0, v0, uw, v1, uw, v0);
    pos.push(-hw, y0, z0, -hw, y1, z1, hw, y1, z1);
    nor.push(...n0, ...n1, ...n1);
    uv.push(0, v0, 0, v1, uw, v1);
  }

  // --- Side skirts -------------------------------------------------------
  for (const sx of [-1, 1] as const) {
    const n: [number, number, number] = [sx, 0, 0];
    for (let i = 0; i < N; i++) {
      const t0 = i / N;
      const t1 = (i + 1) / N;
      const y0 = yAt(t0);
      const y1 = yAt(t1);
      const z0 = zAt(t0);
      const z1 = zAt(t1);
      const a: [number, number, number] = [sx * hw, 0, z0];
      const b: [number, number, number] = [sx * hw, y0, z0];
      const c: [number, number, number] = [sx * hw, y1, z1];
      const d: [number, number, number] = [sx * hw, 0, z1];
      // Wind so the outward face is the visible one on each side.
      if (sx > 0) {
        tri(a, b, c, n, [t0 * uRepeat, 0], [t0 * uRepeat, y0 / 2], [t1 * uRepeat, y1 / 2]);
        tri(a, c, d, n, [t0 * uRepeat, 0], [t1 * uRepeat, y1 / 2], [t1 * uRepeat, 0]);
      } else {
        tri(a, c, b, n, [t0 * uRepeat, 0], [t1 * uRepeat, y1 / 2], [t0 * uRepeat, y0 / 2]);
        tri(a, d, c, n, [t0 * uRepeat, 0], [t1 * uRepeat, 0], [t1 * uRepeat, y1 / 2]);
      }
    }
  }

  // --- End caps ----------------------------------------------------------
  const yBack = yAt(0);
  if (yBack > 1e-4) {
    quad(
      [hw, 0, -L / 2],
      [-hw, 0, -L / 2],
      [-hw, yBack, -L / 2],
      [hw, yBack, -L / 2],
      [0, 0, -1],
      [w / 2.4, yBack / 2.4],
    );
  }
  const yFront = yAt(1);
  if (yFront > 1e-4) {
    quad(
      [-hw, 0, L / 2],
      [hw, 0, L / 2],
      [hw, yFront, L / 2],
      [-hw, yFront, L / 2],
      [0, 0, 1],
      [w / 2.4, yFront / 2.4],
    );
  }

  // --- Floor -------------------------------------------------------------
  quad(
    [-hw, 0, -L / 2],
    [hw, 0, -L / 2],
    [hw, 0, L / 2],
    [-hw, 0, L / 2],
    [0, -1, 0],
    [w / 2.4, L / 2.4],
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

let woodMat: THREE.MeshStandardMaterial | null = null;
let metalMat: THREE.MeshStandardMaterial | null = null;

export function pieceMaterial(kind: PieceDef['material']): THREE.MeshStandardMaterial {
  if (kind === 'metal') {
    metalMat ??= new THREE.MeshStandardMaterial({
      color: 0xb9c0c6,
      roughness: 0.32,
      metalness: 0.85,
    });
    return metalMat;
  }
  woodMat ??= new THREE.MeshStandardMaterial({
    map: plywoodTexture(),
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0.0,
  });
  return woodMat;
}
