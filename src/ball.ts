import * as THREE from 'three';
import { ASSIST, BALL, HOOP, PHYS } from './config';
import { basketballTexture } from './textures';
import type { Hoop } from './hoop';
import type { World } from './surface';

/**
 * The basketball.
 *
 * Contact resolution is deliberately hand-rolled rather than farmed out to a
 * physics engine. There are only four things the ball can hit -- a height-field
 * surface, the rim torus, the backboard box and the pole cylinder -- and doing
 * them explicitly means each one gets its own restitution and its own sound,
 * which is most of what makes a near-miss legible.
 */

export type BallState = 'held' | 'live' | 'dead';

export interface ShotResult {
  made: boolean;
  swish: boolean;
  /** Horizontal metres from release point to the rim. */
  distance: number;
  /** Peak height above the ground reached in flight. */
  apex: number;
  /** True if the shooter was airborne at release. */
  airborne: boolean;
  /** True if released while riding the board. */
  riding: boolean;
}

export interface BallEvents {
  onSurface?: (impact: number) => void;
  onRim?: (impact: number) => void;
  onBackboard?: (impact: number) => void;
  onScore?: (result: ShotResult) => void;
  onDead?: () => void;
}

const TRAIL_POINTS = 90;

const _n = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _before = new THREE.Vector3();

export class Ball {
  readonly mesh: THREE.Mesh;
  readonly trail: THREE.Line;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  state: BallState = 'held';

  /** Snapshot of the shot in progress, completed when the ball dies. */
  private shot: ShotResult = {
    made: false,
    swish: true,
    distance: 0,
    apex: 0,
    airborne: false,
    riding: false,
  };
  private flightTime = 0;
  private prevY = 0;
  private scored = false;
  private trailPts: number[] = [];
  private restTime = 0;
  private spin = 0;

  constructor(private readonly events: BallEvents = {}) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius, 20, 14),
      new THREE.MeshStandardMaterial({ map: basketballTexture(), roughness: 0.82 }),
    );
    this.mesh.castShadow = true;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3));
    geo.setDrawRange(0, 0);
    this.trail = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0.5 }),
    );
    this.trail.frustumCulled = false;
    this.trail.visible = false;
  }

  /** Park the ball in the shooter's hands. */
  hold(at: THREE.Vector3) {
    this.state = 'held';
    this.pos.copy(at);
    this.vel.set(0, 0, 0);
    this.mesh.position.copy(at);
    this.trail.visible = false;
    this.trailPts.length = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }

  /** Follow the hand while carried. */
  carry(at: THREE.Vector3, dt: number) {
    this.pos.copy(at);
    this.mesh.position.copy(at);
    this.mesh.rotation.x += dt * 0.6;
  }

  launch(from: THREE.Vector3, velocity: THREE.Vector3, ctx: { airborne: boolean; riding: boolean }) {
    this.state = 'live';
    this.pos.copy(from);
    this.vel.copy(velocity);
    this.prevY = from.y;
    this.flightTime = 0;
    this.restTime = 0;
    this.scored = false;
    this.spin = 1;
    const dx = from.x - HOOP.x;
    const dz = from.z - HOOP.z;
    this.shot = {
      made: false,
      swish: true,
      distance: Math.hypot(dx, dz),
      apex: from.y,
      airborne: ctx.airborne,
      riding: ctx.riding,
    };
    this.trailPts.length = 0;
    this.trail.visible = true;
    this.pushTrail();
  }

  get currentShot(): ShotResult {
    return this.shot;
  }

  /** Horizontal distance from the rim, for the clutch-time check. */
  distanceToRim(): number {
    return Math.hypot(this.pos.x - HOOP.x, this.pos.z - HOOP.z);
  }

  private pushTrail() {
    this.trailPts.push(this.pos.x, this.pos.y, this.pos.z);
    if (this.trailPts.length > TRAIL_POINTS * 3) this.trailPts.splice(0, 3);
    const attr = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    (attr.array as Float32Array).set(this.trailPts);
    attr.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this.trailPts.length / 3);
  }

  update(dt: number, world: World, hoop: Hoop) {
    if (this.state !== 'live') return;

    this.flightTime += dt;
    this.prevY = this.pos.y;
    _before.copy(this.pos);

    // --- Forces -----------------------------------------------------------
    const speed = this.vel.length();
    if (speed > 0) {
      // Quadratic drag, which is what gives long shots their soft hang.
      const d = BALL.drag * speed * speed * dt;
      this.vel.addScaledVector(this.vel, -Math.min(1, d / speed));
    }
    // Backspin lift: subtle, but it keeps big arcs from feeling like rocks.
    const horiz = Math.hypot(this.vel.x, this.vel.z);
    this.vel.y += BALL.spinLift * this.spin * horiz * dt * 0.08;
    this.spin *= Math.max(0, 1 - dt * 0.35);
    this.vel.y -= PHYS.gravity * dt;
    this.applyAssist(dt);

    this.pos.addScaledVector(this.vel, dt);
    this.shot.apex = Math.max(this.shot.apex, this.pos.y);

    // --- Hoop hardware ----------------------------------------------------
    this.collideRim(hoop);
    this.collideBackboard(hoop);
    this.collidePole(hoop);
    this.checkScore(hoop);

    // The net only reacts once the ball is inside its vertical span.
    const dRim = this.distanceToRim();
    if (dRim < HOOP.rimRadius + 0.3 && this.pos.y < HOOP.rimHeight + 0.2 && this.pos.y > HOOP.rimHeight - 0.7) {
      hoop.disturb(this.pos, this.vel, BALL.radius);
    }

    // --- World surfaces ---------------------------------------------------
    this.collideWorld(dt, world);

    world.clampToYard(this.pos, BALL.radius);
    this.mesh.position.copy(this.pos);

    // Roll the mesh so it visibly spins in the direction of travel.
    if (speed > 0.01) {
      _tmp.set(this.vel.z, 0, -this.vel.x).normalize();
      this.mesh.rotateOnWorldAxis(_tmp, (speed * dt) / BALL.radius);
    }

    this.pushTrail();

    // --- Death ------------------------------------------------------------
    const moving = this.vel.lengthSq() > BALL.sleepSpeed * BALL.sleepSpeed;
    this.restTime = moving ? 0 : this.restTime + dt;
    if (this.restTime > 0.7 || this.flightTime > BALL.maxFlightTime) {
      this.state = 'dead';
      this.events.onDead?.();
    }
  }

  /**
   * Predictive shot assist.
   *
   * Ballistically project where the ball will cross rim height, and if that
   * point is nearly in, apply the constant acceleration that would close the
   * gap -- capped, so only a genuinely close shot gets fixed. A proximity-based
   * nudge does not work here: a ball doing 26 m/s is within a couple of metres
   * of the rim for barely a tenth of a second, far too briefly to matter.
   */
  private applyAssist(dt: number) {
    if (this.vel.y >= 0) return;
    const above = this.pos.y - HOOP.rimHeight;
    if (above <= 0) return;

    // Time until it falls through rim height, ignoring drag.
    const t = (-this.vel.y + Math.sqrt(this.vel.y * this.vel.y + 2 * PHYS.gravity * above)) / PHYS.gravity;
    if (!(t > 0.02) || t > ASSIST.lead) return;

    const mx = HOOP.x - (this.pos.x + this.vel.x * t);
    const mz = HOOP.z - (this.pos.z + this.vel.z * t);
    const miss = Math.hypot(mx, mz);
    if (miss < 1e-4 || miss > ASSIST.window) return;

    // a = 2s/t^2 closes a gap of s in time t from rest.
    const need = (2 * miss) / (t * t);
    const a = Math.min(need, ASSIST.maxAccel) * dt;
    this.vel.x += (mx / miss) * a;
    this.vel.z += (mz / miss) * a;
  }

  private collideRim(hoop: Hoop) {
    const c = hoop.rimCentre;
    const dx = this.pos.x - c.x;
    const dz = this.pos.z - c.z;
    const radial = Math.hypot(dx, dz);
    if (radial < 1e-5) return;
    if (Math.abs(this.pos.y - c.y) > HOOP.rimTube + BALL.radius + 0.05) return;
    if (Math.abs(radial - HOOP.rimRadius) > HOOP.rimTube + BALL.radius + 0.05) return;

    // Nearest point on the rim circle.
    const qx = c.x + (dx / radial) * HOOP.rimRadius;
    const qz = c.z + (dz / radial) * HOOP.rimRadius;
    _n.set(this.pos.x - qx, this.pos.y - c.y, this.pos.z - qz);
    const dist = _n.length();
    const minDist = BALL.radius + HOOP.rimTube;
    if (dist >= minDist || dist < 1e-6) return;

    _n.multiplyScalar(1 / dist);
    const impact = -this.vel.dot(_n);
    if (impact > 0) {
      this.vel.addScaledVector(_n, impact * (1 + BALL.rimRestitution));
      // Rim contact scrubs a little tangential speed too, so rattles settle in.
      this.vel.multiplyScalar(0.92);
      this.events.onRim?.(Math.min(1, impact / 7));
      hoop.flashRim();
    }
    this.pos.addScaledVector(_n, minDist - dist);
    this.shot.swish = false;
  }

  private collideBackboard(hoop: Hoop) {
    const b = hoop.backboard;
    // Closest point on the box to the ball centre.
    const cx = Math.min(b.max.x, Math.max(b.min.x, this.pos.x));
    const cy = Math.min(b.max.y, Math.max(b.min.y, this.pos.y));
    const cz = Math.min(b.max.z, Math.max(b.min.z, this.pos.z));
    _n.set(this.pos.x - cx, this.pos.y - cy, this.pos.z - cz);
    const dist = _n.length();
    if (dist >= BALL.radius) return;

    if (dist < 1e-6) {
      // Centre inside the box: eject along +Z, the yard-facing side.
      _n.set(0, 0, 1);
      this.pos.z = b.max.z + BALL.radius;
    } else {
      _n.multiplyScalar(1 / dist);
      this.pos.addScaledVector(_n, BALL.radius - dist);
    }
    const impact = -this.vel.dot(_n);
    if (impact > 0) {
      this.vel.addScaledVector(_n, impact * (1 + BALL.backboardRestitution));
      this.vel.multiplyScalar(0.94);
      this.events.onBackboard?.(Math.min(1, impact / 8));
    }
    this.shot.swish = false;
  }

  private collidePole(hoop: Hoop) {
    const dx = this.pos.x - hoop.poleX;
    const dz = this.pos.z - hoop.poleZ;
    const d = Math.hypot(dx, dz);
    const minD = BALL.radius + hoop.poleRadius;
    if (d >= minD || d < 1e-6) return;
    if (this.pos.y > HOOP.rimHeight + 0.6) return;
    _n.set(dx / d, 0, dz / d);
    this.pos.x = hoop.poleX + _n.x * minD;
    this.pos.z = hoop.poleZ + _n.z * minD;
    const impact = -this.vel.dot(_n);
    if (impact > 0) {
      this.vel.addScaledVector(_n, impact * 1.45);
      this.events.onBackboard?.(Math.min(1, impact / 10));
    }
    this.shot.swish = false;
  }

  private checkScore(hoop: Hoop) {
    if (this.scored) return;
    const c = hoop.rimCentre;
    if (this.prevY <= c.y || this.pos.y > c.y) return;
    if (this.vel.y >= 0) return;
    // Interpolate where the ball crossed the rim plane rather than testing the
    // post-step position, which at speed can already be well past the hoop.
    const t = (this.prevY - c.y) / Math.max(1e-6, this.prevY - this.pos.y);
    const px = _before.x + (this.pos.x - _before.x) * t;
    const pz = _before.z + (this.pos.z - _before.z) * t;
    const radial = Math.hypot(px - c.x, pz - c.z);
    if (radial > HOOP.rimRadius - BALL.radius * 0.35) return;

    this.scored = true;
    this.shot.made = true;
    this.events.onScore?.(this.shot);
  }

  private collideWorld(dt: number, world: World) {
    const bottomBefore = _before.y - BALL.radius;
    const bottomNow = this.pos.y - BALL.radius;
    const ceiling = Math.max(bottomBefore, bottomNow) + 0.02;
    const c = world.sample(this.pos.x, this.pos.z, ceiling);

    if (bottomNow <= c.y) {
      this.pos.y = c.y + BALL.radius;
      const n = c.normal;
      const into = -this.vel.dot(n);
      if (into > 0) {
        const bounce = into * (1 + BALL.restitution);
        this.vel.addScaledVector(n, bounce);
        if (into > 0.45) this.events.onSurface?.(Math.min(1, into / 9));
      }
      // Friction along the surface.
      _tmp.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
      const tang = _tmp.length();
      if (tang > 0) {
        const drop = Math.min(tang, BALL.groundFriction * dt);
        this.vel.addScaledVector(_tmp, -drop / tang);
      }
    }

    // Walls: anything the ball's underside cannot clear pushes it back out.
    _tmp.copy(this.pos);
    world.resolveWalls(this.pos, BALL.radius, this.pos.y - BALL.radius, 0.0);
    _tmp.subVectors(this.pos, _tmp);
    if (_tmp.lengthSq() > 1e-8) {
      _tmp.normalize();
      const into = -this.vel.dot(_tmp);
      if (into > 0) {
        this.vel.addScaledVector(_tmp, into * (1 + BALL.restitution * 0.8));
        if (into > 0.6) this.events.onSurface?.(Math.min(1, into / 9));
      }
    }
  }
}
