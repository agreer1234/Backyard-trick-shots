import * as THREE from 'three';
import { BOARD, FOOT, PHYS, THROW } from './config';
import { sfx } from './audio';
import type { Contact, World } from './surface';

/**
 * The character, on foot and on the board.
 *
 * Both modes share one physics core: velocity is a full 3D vector, and while
 * grounded it is projected onto the tangent plane of whatever surface is
 * underfoot. That single decision is what makes ramps work -- riding up a face
 * naturally converts forward speed into upward speed, and when the surface
 * runs out at the lip you simply keep the velocity you had. Nothing special
 * fires to "launch" you; you just stop being supported.
 */

export interface SkaterInput {
  /** Camera-relative stick, each component -1..1. */
  x: number;
  z: number;
  /** Edge-triggered this frame. */
  jump: boolean;
  toggleBoard: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = new THREE.Vector3(0, -PHYS.gravity, 0);

const _f = new THREE.Vector3();
const _l = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _gt = new THREE.Vector3();

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Skater {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3(0, 0, 14);
  readonly vel = new THREE.Vector3();
  yaw = Math.PI;
  grounded = true;
  riding = false;
  /** Set on the frame the skater lands, in m/s of absorbed impact. */
  landImpact = 0;
  /** Metres of air under the feet, for HUD flourishes. */
  airHeight = 0;

  private contact: Contact = { y: 0, normal: new THREE.Vector3(0, 1, 0), piece: null };
  private walkPhase = 0;
  private lean = 0;
  private crouch = 0;
  private airTime = 0;
  private stepTimer = 0;

  // Rig. `tilt` carries the surface pitch/roll; `body` carries the stance
  // rotation. They must be separate nodes, or turning sideways into a riding
  // stance would swap which axis the slope tilt acts on.
  private tilt!: THREE.Group;
  private body!: THREE.Group;
  private torso!: THREE.Group;
  private head!: THREE.Group;
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private board!: THREE.Group;

  constructor() {
    this.buildRig();
    this.tilt = new THREE.Group();
    this.tilt.add(this.body);
    this.tilt.add(this.board);
    this.root.add(this.tilt);
  }

  // ---------------------------------------------------------------- rig ---

  private buildRig() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xd8a07a, roughness: 0.85 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0xe4654f, roughness: 0.9 });
    const jeans = new THREE.MeshStandardMaterial({ color: 0x4a6b96, roughness: 0.95 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0xf1ece2, roughness: 0.9 });
    const cap = new THREE.MeshStandardMaterial({ color: 0x3d7a5c, roughness: 0.9 });

    const box = (
      w: number,
      h: number,
      d: number,
      mat: THREE.Material,
      y = 0,
      x = 0,
      z = 0,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };

    this.body = new THREE.Group();
    this.torso = new THREE.Group();
    this.torso.position.y = 0.88;
    this.torso.add(box(0.44, 0.56, 0.26, shirt, 0.28));
    this.body.add(this.torso);

    this.head = new THREE.Group();
    this.head.position.y = 0.62;
    this.head.add(box(0.27, 0.29, 0.27, skin, 0.14));
    const brim = box(0.29, 0.05, 0.32, cap, 0.28, 0, 0.04);
    this.head.add(brim);
    this.head.add(box(0.285, 0.11, 0.285, cap, 0.325));
    this.torso.add(this.head);

    // Arms pivot at the shoulder, so rotating the group swings the whole arm.
    this.armL = new THREE.Group();
    this.armL.position.set(-0.29, 0.5, 0);
    this.armL.add(box(0.13, 0.5, 0.13, shirt, -0.25));
    this.armL.add(box(0.12, 0.12, 0.12, skin, -0.53));
    this.torso.add(this.armL);

    this.armR = new THREE.Group();
    this.armR.position.set(0.29, 0.5, 0);
    this.armR.add(box(0.13, 0.5, 0.13, shirt, -0.25));
    this.armR.add(box(0.12, 0.12, 0.12, skin, -0.53));
    this.torso.add(this.armR);

    this.legL = new THREE.Group();
    this.legL.position.set(-0.13, 0.88, 0);
    this.legL.add(box(0.17, 0.6, 0.17, jeans, -0.3));
    this.legL.add(box(0.19, 0.11, 0.29, shoe, -0.65, 0, 0.05));
    this.body.add(this.legL);

    this.legR = new THREE.Group();
    this.legR.position.set(0.13, 0.88, 0);
    this.legR.add(box(0.17, 0.6, 0.17, jeans, -0.3));
    this.legR.add(box(0.19, 0.11, 0.29, shoe, -0.65, 0, 0.05));
    this.body.add(this.legR);

    this.board = this.buildBoard();
  }

  private buildBoard(): THREE.Group {
    const g = new THREE.Group();
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x2f2a33, roughness: 0.72 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x1c1a1e, roughness: 1 });
    const truckMat = new THREE.MeshStandardMaterial({
      color: 0xb8bdc2,
      roughness: 0.4,
      metalness: 0.75,
    });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0xf0e6cf, roughness: 0.6 });

    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.028, 0.82), deckMat);
    deck.position.y = 0.075;
    deck.castShadow = true;
    g.add(deck);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.225, 0.006, 0.78), gripMat);
    grip.position.y = 0.093;
    g.add(grip);

    // Upturned nose and tail.
    for (const s of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.026, 0.14), deckMat);
      tip.position.set(0, 0.086, s * 0.45);
      tip.rotation.x = s * -0.42;
      tip.castShadow = true;
      g.add(tip);
    }

    for (const s of [-1, 1]) {
      const truck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.05), truckMat);
      truck.position.set(0, 0.052, s * 0.26);
      g.add(truck);
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.036, 10), wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(sx * 0.1, 0.034, s * 0.26);
        g.add(w);
      }
    }
    return g;
  }

  // ------------------------------------------------------------- physics ---

  /** World-space point the ball sits at while carried, and leaves from. */
  handPoint(out: THREE.Vector3): THREE.Vector3 {
    const f = Math.sin(this.yaw);
    const g = Math.cos(this.yaw);
    const h = THROW.holdHeight - this.crouch * 0.3;
    return out.set(
      this.pos.x + f * THROW.holdForward,
      this.pos.y + h,
      this.pos.z + g * THROW.holdForward,
    );
  }

  /** Unit direction the ball is thrown along, including the fixed launch angle. */
  throwDirection(out: THREE.Vector3): THREE.Vector3 {
    const horiz = Math.cos(THROW.angle);
    return out
      .set(Math.sin(this.yaw) * horiz, Math.sin(THROW.angle), Math.cos(this.yaw) * horiz)
      .normalize();
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  update(dt: number, input: SkaterInput, world: World) {
    this.landImpact = 0;
    if (input.toggleBoard) {
      this.riding = !this.riding;
      sfx.mount(this.riding);
      if (this.riding) {
        // Hopping on preserves your walking momentum, just capped sensibly.
        const s = this.speed;
        if (s > BOARD.topSpeed) this.vel.multiplyScalar(BOARD.topSpeed / s);
      }
    }

    const prevY = this.pos.y;
    const wasGrounded = this.grounded;

    const stickLen = Math.min(1, Math.hypot(input.x, input.z));
    const hasInput = stickLen > 0.12;

    if (this.riding) this.rideStep(dt, input, stickLen, hasInput);
    else this.footStep(dt, input, stickLen, hasInput);

    if (input.jump && this.grounded) this.pop();

    // Integrate, then find the ground we should be standing on. Using the
    // pre-integration height as the ceiling means a fast fall still catches
    // the surface it swept through instead of dropping through it.
    this.pos.addScaledVector(this.vel, dt);
    world.clampToYard(this.pos, 0.45);

    const stepUp = this.grounded ? 0.42 : 0.02;
    const ceiling = Math.max(prevY, this.pos.y) + stepUp;
    world.sample(this.pos.x, this.pos.z, ceiling, this.contact);

    // Walls: anything more than a step above the feet blocks instead of lifts.
    world.resolveWalls(this.pos, 0.34, this.pos.y, 0.45);
    world.sample(this.pos.x, this.pos.z, ceiling, this.contact);

    if (this.pos.y <= this.contact.y + 1e-3) {
      this.pos.y = this.contact.y;
      if (!wasGrounded) this.land();
      this.grounded = true;
      this.airTime = 0;
      this.airHeight = 0;
    } else {
      this.grounded = false;
      this.airTime += dt;
      this.airHeight = this.pos.y - this.contact.y;
    }

    if (this.grounded) {
      // Kill motion into the surface and let gravity act along the slope.
      const n = this.contact.normal;
      const into = this.vel.dot(n);
      if (into < 0) this.vel.addScaledVector(n, -into);
      _gt.copy(GRAVITY).addScaledVector(n, -GRAVITY.dot(n));
      this.vel.addScaledVector(_gt, dt);
    } else {
      this.vel.addScaledVector(GRAVITY, dt);
    }

    this.animate(dt);
  }

  private pop() {
    const n = this.contact.normal;
    const power = this.riding ? BOARD.ollieSpeed : FOOT.jumpSpeed;
    const bias = this.riding ? BOARD.ollieUpBias : 0;
    this.vel.addScaledVector(n, power);
    this.vel.y += bias;
    this.grounded = false;
    this.pos.y += 0.02;
    this.crouch = -0.35;
    sfx.pop();
  }

  private land() {
    const n = this.contact.normal;
    const into = -this.vel.dot(n);
    this.landImpact = Math.max(0, into);
    if (this.riding && into > 1) {
      // Landing flat costs less than landing across the slope.
      const mismatch = Math.acos(Math.min(1, Math.max(-1, n.dot(UP))));
      const loss = Math.min(0.55, (into * 0.012 + mismatch * BOARD.landingBite * 0.05));
      this.vel.multiplyScalar(1 - loss);
    }
    this.crouch = Math.min(0.5, this.landImpact * 0.055);
    sfx.land(Math.min(1, this.landImpact / 9));
  }

  /** Build the tangent-plane basis for the current surface and this heading. */
  private basis() {
    const n = this.grounded ? this.contact.normal : UP;
    _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _f.addScaledVector(n, -_f.dot(n));
    if (_f.lengthSq() < 1e-6) _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _f.normalize();
    _l.crossVectors(n, _f).normalize();
    return n;
  }

  private footStep(dt: number, input: SkaterInput, stickLen: number, hasInput: boolean) {
    const n = this.basis();

    if (hasInput) {
      const target = Math.atan2(input.x, input.z);
      this.yaw += shortestAngle(this.yaw, target) * Math.min(1, FOOT.turnRate * dt);
    }

    // Recompute forward after turning so acceleration follows the new heading.
    this.basis();

    const accel = this.grounded ? FOOT.accel : FOOT.accel * FOOT.airControl;
    if (hasInput) {
      this.vel.addScaledVector(_f, accel * stickLen * dt);
    } else if (this.grounded) {
      // Plant your feet: bleed off tangential speed quickly.
      _tmp.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
      const s = _tmp.length();
      if (s > 0) {
        const drop = Math.min(s, FOOT.brake * dt);
        this.vel.addScaledVector(_tmp, -drop / s);
      }
    }

    // Speed cap applies to the tangential component only.
    _tmp.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
    const s = _tmp.length();
    const cap = this.grounded ? FOOT.topSpeed : FOOT.topSpeed * 1.6;
    if (s > cap) this.vel.addScaledVector(_tmp, (cap - s) / s);
  }

  private rideStep(dt: number, input: SkaterInput, stickLen: number, hasInput: boolean) {
    const n = this.basis();
    const fwdSpeed = this.vel.dot(_f);

    if (hasInput) {
      const target = Math.atan2(input.x, input.z);
      const delta = shortestAngle(this.yaw, target);
      // Turning tightens at low speed and widens at speed, like a real board.
      const t = Math.min(1, Math.abs(fwdSpeed) / BOARD.turnFalloffSpeed);
      const rate = BOARD.turnRateLow + (BOARD.turnRateHigh - BOARD.turnRateLow) * t;
      const authority = this.grounded ? 1 : BOARD.airControl * 3.2;
      const step = Math.min(Math.abs(delta), rate * authority * dt) * Math.sign(delta);
      this.yaw += step;
      this.lean += (Math.max(-1, Math.min(1, (step / dt) * 0.28)) - this.lean) * Math.min(1, dt * 8);
    } else {
      this.lean += (0 - this.lean) * Math.min(1, dt * 5);
    }

    this.basis();

    if (this.grounded) {
      // Push when the stick agrees with where you are already pointing.
      const wantForward = hasInput ? Math.cos(shortestAngle(this.yaw, Math.atan2(input.x, input.z))) : 0;
      if (hasInput && wantForward > 0.2) {
        this.vel.addScaledVector(_f, BOARD.pushAccel * stickLen * wantForward * dt);
      } else if (hasInput && wantForward < -0.3) {
        const brake = Math.min(Math.abs(fwdSpeed), BOARD.brake * dt);
        this.vel.addScaledVector(_f, -Math.sign(fwdSpeed) * brake);
      }

      // Rolling resistance, and lateral grip: wheels do not slide sideways.
      const lat = this.vel.dot(_l);
      this.vel.addScaledVector(_l, -lat * Math.min(1, dt * 11));
      const fs = this.vel.dot(_f);
      const rr = Math.min(Math.abs(fs), BOARD.roll * dt);
      this.vel.addScaledVector(_f, -Math.sign(fs) * rr);
    } else if (hasInput) {
      this.vel.addScaledVector(_f, BOARD.pushAccel * BOARD.airControl * stickLen * dt);
    }

    _tmp.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
    const s = _tmp.length();
    if (s > BOARD.topSpeed) this.vel.addScaledVector(_tmp, (BOARD.topSpeed - s) / s);
  }

  // ----------------------------------------------------------- animation ---

  private animate(dt: number) {
    this.root.position.copy(this.pos);
    this.crouch += (0 - this.crouch) * Math.min(1, dt * 6);

    // Tilt the whole body to match the surface, so ramps do not look like ice.
    // `tilt` sits under `root`, which already carries the yaw, so the surface
    // normal has to be brought into that rotated frame first.
    const n = this.grounded ? this.contact.normal : UP;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const nx = n.x * cy - n.z * sy;
    const nz = n.x * sy + n.z * cy;
    const targetPitch = this.grounded ? Math.atan2(-nz, n.y) : Math.min(0.4, this.vel.y * -0.03);
    const targetRoll = this.grounded ? Math.atan2(nx, n.y) : 0;

    if (this.riding) {
      // Riding stance: body turned across the board, knees bent, arms out.
      this.root.rotation.y = this.yaw;
      this.body.rotation.y += (Math.PI * 0.42 - this.body.rotation.y) * Math.min(1, dt * 9);
      this.body.position.y = -this.crouch * 0.28 + 0.115;

      this.legL.rotation.x = -0.36;
      this.legR.rotation.x = 0.3;
      this.legL.rotation.z = 0.12;
      this.legR.rotation.z = -0.1;
      this.armL.rotation.x = -0.5 + this.lean * 0.5;
      this.armR.rotation.x = -0.3 - this.lean * 0.5;
      this.armL.rotation.z = -0.75;
      this.armR.rotation.z = 0.6;
      this.torso.rotation.x = 0.24 + this.crouch * 0.5;
      this.torso.rotation.z = this.lean * 0.22;
      this.head.rotation.y = -Math.PI * 0.42;

      this.board.visible = true;
      this.board.position.set(0, 0, 0);
      this.board.rotation.set(0, 0, 0);
      // Slight board tilt into the turn.
      this.board.rotation.z = -this.lean * 0.2;
      if (!this.grounded) {
        this.board.rotation.x = Math.max(-0.5, Math.min(0.5, -this.vel.y * 0.035));
      } else {
        this.board.rotation.x = 0;
      }

      const sp = Math.min(1, this.speed / BOARD.topSpeed);
      sfx.roll(sp, this.grounded);
    } else {
      this.root.rotation.y = this.yaw;
      this.body.rotation.y += (0 - this.body.rotation.y) * Math.min(1, dt * 9);
      this.body.position.y = -this.crouch * 0.3;

      const sp = this.speed;
      if (this.grounded && sp > 0.2) {
        this.walkPhase += dt * (2.6 + sp * 1.9);
        const swing = Math.min(1, sp / FOOT.topSpeed) * 0.82;
        this.legL.rotation.x = Math.sin(this.walkPhase) * swing;
        this.legR.rotation.x = -Math.sin(this.walkPhase) * swing;
        this.armL.rotation.x = -Math.sin(this.walkPhase) * swing * 0.75;
        this.armR.rotation.x = Math.sin(this.walkPhase) * swing * 0.75;
        this.torso.rotation.x = 0.06 + Math.min(0.16, sp * 0.02);

        // Footfall ticks on each stride.
        this.stepTimer -= dt * (2.6 + sp * 1.9);
        if (this.stepTimer <= 0) {
          this.stepTimer = Math.PI;
          sfx.step();
        }
      } else if (this.grounded) {
        this.walkPhase = 0;
        const ease = Math.min(1, dt * 8);
        this.legL.rotation.x += (0 - this.legL.rotation.x) * ease;
        this.legR.rotation.x += (0 - this.legR.rotation.x) * ease;
        this.armL.rotation.x += (0 - this.armL.rotation.x) * ease;
        this.armR.rotation.x += (0 - this.armR.rotation.x) * ease;
        this.torso.rotation.x += (0 - this.torso.rotation.x) * ease;
      } else {
        // Airborne on foot: tuck.
        const ease = Math.min(1, dt * 7);
        this.legL.rotation.x += (-0.55 - this.legL.rotation.x) * ease;
        this.legR.rotation.x += (0.3 - this.legR.rotation.x) * ease;
        this.armL.rotation.x += (-1.5 - this.armL.rotation.x) * ease;
        this.armR.rotation.x += (-1.5 - this.armR.rotation.x) * ease;
      }
      this.armL.rotation.z = -0.1;
      this.armR.rotation.z = 0.1;
      this.torso.rotation.z = 0;
      this.head.rotation.y = 0;

      // Board tucked under the arm while walking.
      this.board.visible = true;
      this.board.position.set(-0.34, 0.86, 0.02);
      this.board.rotation.set(0.1, 0, Math.PI / 2 - 0.22);

      sfx.roll(0, false);
    }

    // Slope tilt lives above the stance rotation so pitch stays pitch.
    this.tilt.rotation.x += (targetPitch - this.tilt.rotation.x) * Math.min(1, dt * 10);
    this.tilt.rotation.z += (targetRoll - this.tilt.rotation.z) * Math.min(1, dt * 10);
  }
}
