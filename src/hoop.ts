import * as THREE from 'three';
import { HOOP } from './config';
import { backboardTexture } from './textures';

/**
 * The hoop: pole, backboard, rim, and a net that actually moves.
 *
 * The net is a small spring lattice (12 strands x 6 rings). It costs almost
 * nothing to simulate and it is doing a disproportionate amount of the work in
 * making a make feel good -- the snap of the net is most of the payoff.
 */

const STRANDS = 12;
const RINGS = 6;
const NET_DROP = 0.42;

interface NetNode {
  base: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
}

export class Hoop {
  readonly group = new THREE.Group();
  /** Centre of the rim circle, in world space. */
  readonly rimCentre = new THREE.Vector3(HOOP.x, HOOP.rimHeight, HOOP.z);
  /** Axis-aligned bounds of the backboard, used for ball collision. */
  readonly backboard: THREE.Box3;
  readonly poleRadius = 0.06;
  readonly poleX = HOOP.x;
  readonly poleZ = HOOP.z - HOOP.backboardOffset - 0.28;

  private net!: THREE.LineSegments;
  private nodes: NetNode[][] = [];
  private rimMesh!: THREE.Mesh;
  private rimFlash = 0;

  constructor() {
    this.buildPole();
    this.backboard = this.buildBackboard();
    this.buildRim();
    this.buildNet();
  }

  private buildPole() {
    const metal = new THREE.MeshStandardMaterial({
      color: 0x6f7a80,
      roughness: 0.55,
      metalness: 0.7,
    });
    const topY = HOOP.rimHeight + HOOP.backboardHeight * 0.62;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(this.poleRadius, this.poleRadius * 1.35, topY, 12),
      metal,
    );
    pole.position.set(this.poleX, topY / 2, this.poleZ);
    pole.castShadow = true;
    this.group.add(pole);

    // Concrete footing, because this thing has been here twenty years.
    const foot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.36, 0.16, 14),
      new THREE.MeshStandardMaterial({ color: 0xa8a294, roughness: 0.95 }),
    );
    foot.position.set(this.poleX, 0.07, this.poleZ);
    foot.receiveShadow = true;
    this.group.add(foot);

    // Arm out to the backboard.
    const armLen = HOOP.backboardOffset + 0.2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, armLen), metal);
    arm.position.set(this.poleX, HOOP.rimHeight + 0.34, this.poleZ + armLen / 2);
    arm.castShadow = true;
    this.group.add(arm);

    // Diagonal brace.
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.62), metal);
    brace.position.set(this.poleX, HOOP.rimHeight - 0.02, this.poleZ + 0.22);
    brace.rotation.x = -0.72;
    this.group.add(brace);
  }

  private buildBackboard(): THREE.Box3 {
    const w = HOOP.backboardWidth;
    const h = HOOP.backboardHeight;
    const thickness = 0.06;
    const z = HOOP.z - HOOP.backboardOffset;
    // Sit the board so the rim meets it near the bottom of the shooter's square.
    const cy = HOOP.rimHeight + h * 0.34;

    const tex = backboardTexture();
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, thickness),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72 }),
    );
    board.position.set(HOOP.x, cy, z - thickness / 2);
    board.castShadow = true;
    board.receiveShadow = true;
    this.group.add(board);

    return new THREE.Box3(
      new THREE.Vector3(HOOP.x - w / 2, cy - h / 2, z - thickness),
      new THREE.Vector3(HOOP.x + w / 2, cy + h / 2, z),
    );
  }

  private buildRim() {
    this.rimMesh = new THREE.Mesh(
      new THREE.TorusGeometry(HOOP.rimRadius, HOOP.rimTube, 8, 28),
      new THREE.MeshStandardMaterial({
        color: 0xe2673b,
        roughness: 0.42,
        metalness: 0.6,
        emissive: 0x000000,
      }),
    );
    this.rimMesh.rotation.x = -Math.PI / 2;
    this.rimMesh.position.copy(this.rimCentre);
    this.rimMesh.castShadow = true;
    this.group.add(this.rimMesh);

    // Little bracket joining rim to board.
    const bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.05, HOOP.backboardOffset - HOOP.rimRadius + 0.06),
      new THREE.MeshStandardMaterial({ color: 0xe2673b, roughness: 0.5, metalness: 0.6 }),
    );
    bracket.position.set(
      HOOP.x,
      HOOP.rimHeight,
      HOOP.z - HOOP.rimRadius - (HOOP.backboardOffset - HOOP.rimRadius) / 2,
    );
    this.group.add(bracket);
  }

  private buildNet() {
    for (let i = 0; i < RINGS; i++) {
      const row: NetNode[] = [];
      const f = i / (RINGS - 1);
      // Taper in toward the bottom, the way a real net hangs.
      const r = HOOP.rimRadius * (1 - 0.42 * f * f);
      const y = HOOP.rimHeight - NET_DROP * f;
      for (let j = 0; j < STRANDS; j++) {
        const a = (j / STRANDS) * Math.PI * 2;
        const base = new THREE.Vector3(
          this.rimCentre.x + Math.cos(a) * r,
          y,
          this.rimCentre.z + Math.sin(a) * r,
        );
        row.push({ base, pos: base.clone(), vel: new THREE.Vector3() });
      }
      this.nodes.push(row);
    }

    const segCount = RINGS * STRANDS + (RINGS - 1) * STRANDS;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segCount * 6), 3));
    this.net = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0xf3ece0, transparent: true, opacity: 0.92 }),
    );
    this.net.frustumCulled = false;
    this.group.add(this.net);
    this.writeNetGeometry();
  }

  private writeNetGeometry() {
    const attr = this.net.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = attr.array as Float32Array;
    let k = 0;
    const put = (v: THREE.Vector3) => {
      a[k++] = v.x;
      a[k++] = v.y;
      a[k++] = v.z;
    };
    // Horizontal rings
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < STRANDS; j++) {
        put(this.nodes[i]![j]!.pos);
        put(this.nodes[i]![(j + 1) % STRANDS]!.pos);
      }
    }
    // Vertical strands
    for (let i = 0; i < RINGS - 1; i++) {
      for (let j = 0; j < STRANDS; j++) {
        put(this.nodes[i]![j]!.pos);
        put(this.nodes[i + 1]![j]!.pos);
      }
    }
    attr.needsUpdate = true;
  }

  /** Shove the net outward where the ball is passing through it. */
  disturb(ballPos: THREE.Vector3, ballVel: THREE.Vector3, radius: number) {
    for (let i = 1; i < RINGS; i++) {
      for (const n of this.nodes[i]!) {
        const dx = n.pos.x - ballPos.x;
        const dy = n.pos.y - ballPos.y;
        const dz = n.pos.z - ballPos.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > radius + 0.16) continue;
        const push = (radius + 0.16 - d) * 14;
        const inv = 1 / (d || 1e-4);
        n.vel.x += dx * inv * push;
        n.vel.z += dz * inv * push;
        n.vel.y += Math.min(0, ballVel.y) * 0.16;
      }
    }
  }

  /** Brief warm glow on the rim after contact, so near-misses read clearly. */
  flashRim() {
    this.rimFlash = 1;
  }

  update(dt: number) {
    const stiffness = 96;
    const damping = 7.5;
    let moving = false;
    for (let i = 1; i < RINGS; i++) {
      for (const n of this.nodes[i]!) {
        const ox = n.base.x - n.pos.x;
        const oy = n.base.y - n.pos.y;
        const oz = n.base.z - n.pos.z;
        n.vel.x += ox * stiffness * dt;
        n.vel.y += oy * stiffness * dt;
        n.vel.z += oz * stiffness * dt;
        const d = Math.max(0, 1 - damping * dt);
        n.vel.multiplyScalar(d);
        n.pos.x += n.vel.x * dt;
        n.pos.y += n.vel.y * dt;
        n.pos.z += n.vel.z * dt;
        if (n.vel.lengthSq() > 1e-5) moving = true;
      }
    }
    if (moving) this.writeNetGeometry();

    if (this.rimFlash > 0) {
      this.rimFlash = Math.max(0, this.rimFlash - dt * 2.4);
      const m = this.rimMesh.material as THREE.MeshStandardMaterial;
      m.emissive.setRGB(this.rimFlash * 0.55, this.rimFlash * 0.22, 0);
    }
  }
}
