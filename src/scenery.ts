import * as THREE from 'three';
import { YARD } from './config';
import { concreteTexture, fenceTexture, grassTexture, sidingTexture, stripeTexture } from './textures';

/**
 * The backyard itself. None of this is collidable -- the fence is enforced by
 * a clamp in World, and the house sits behind the hoop where you cannot reach
 * it. It exists purely so the place feels lived in.
 */

/** Deterministic scatter, so your yard looks identical every time you open it. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface Scenery {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
}

function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(400, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x5f9ed4) },
      mid: { value: new THREE.Color(0xbedcec) },
      bottom: { value: new THREE.Color(0xf6d9a8) },
    },
    vertexShader: `
      varying float vH;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vH = normalize(wp.xyz).y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
      varying float vH;
      void main() {
        float h = clamp(vH, -1.0, 1.0);
        vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.65)) : mix(mid, bottom, pow(-h, 0.4));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

function makeTree(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 4.5 + rnd() * 4;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.28, h, 7),
    new THREE.MeshStandardMaterial({ color: 0x6b4f38, roughness: 0.95 }),
  );
  trunk.position.y = h / 2;
  trunk.castShadow = true;
  g.add(trunk);

  const leafMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.26 + rnd() * 0.05, 0.42, 0.34 + rnd() * 0.1),
    roughness: 1,
    flatShading: true,
  });
  const blobs = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < blobs; i++) {
    const r = 1.5 + rnd() * 1.3;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafMat);
    blob.position.set((rnd() - 0.5) * 2.2, h + (rnd() - 0.3) * 1.6, (rnd() - 0.5) * 2.2);
    blob.castShadow = true;
    g.add(blob);
  }
  return g;
}

function makeHouse(): THREE.Group {
  const g = new THREE.Group();
  const w = 20;
  const d = 11;
  const h = 6.4;

  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ map: sidingTexture(), roughness: 0.9 }),
  );
  walls.position.y = h / 2;
  walls.castShadow = true;
  walls.receiveShadow = true;
  g.add(walls);

  // Gable roof: a rotated box each side.
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x6b5346, roughness: 0.94 });
  const slope = 3.4;
  for (const s of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w + 1.1, 0.24, slope * 1.55), roofMat);
    panel.position.set(0, h + slope / 2, (s * d) / 4);
    panel.rotation.x = s * -0.62;
    panel.castShadow = true;
    g.add(panel);
  }

  // Windows facing the yard, lit warm because it is getting late.
  const glass = new THREE.MeshStandardMaterial({
    color: 0xffe6b0,
    emissive: 0xffcf85,
    emissiveIntensity: 0.55,
    roughness: 0.25,
  });
  const frame = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.8 });
  for (const x of [-6.5, -2.2, 5.4]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.5, 0.12), glass);
    win.position.set(x, 3.4, d / 2 + 0.03);
    g.add(win);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.95, 1.75, 0.08), frame);
    trim.position.set(x, 3.4, d / 2 + 0.01);
    g.add(trim);
  }

  // Back door + a step.
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 2.2, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x4d6b52, roughness: 0.75 }),
  );
  door.position.set(1.6, 1.1, d / 2 + 0.03);
  g.add(door);

  return g;
}

function makeShed(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(4, 2.7, 3.2),
    new THREE.MeshStandardMaterial({ map: fenceTexture(), roughness: 0.92 }),
  );
  body.position.y = 1.35;
  body.castShadow = true;
  g.add(body);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(4.5, 0.2, 3.7),
    new THREE.MeshStandardMaterial({ color: 0x5a4a3e, roughness: 0.95 }),
  );
  roof.position.y = 2.82;
  roof.rotation.x = 0.09;
  roof.castShadow = true;
  g.add(roof);
  return g;
}

export function buildScenery(): Scenery {
  const group = new THREE.Group();
  const rnd = seeded(1337);

  group.add(makeSky());

  // --- Lawn ---------------------------------------------------------------
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(YARD.halfWidth * 2 + 60, YARD.halfDepth * 2 + 60),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }),
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.receiveShadow = true;
  group.add(lawn);

  const stripes = new THREE.Mesh(
    new THREE.PlaneGeometry(YARD.halfWidth * 2, YARD.halfDepth * 2),
    new THREE.MeshBasicMaterial({
      map: stripeTexture(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
  stripes.rotation.x = -Math.PI / 2;
  stripes.position.y = 0.004;
  group.add(stripes);

  // --- Patio under the hoop ----------------------------------------------
  const patio = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 13),
    new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95 }),
  );
  patio.rotation.x = -Math.PI / 2;
  patio.position.set(0, 0.008, -38);
  patio.receiveShadow = true;
  group.add(patio);

  // --- Fence --------------------------------------------------------------
  const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTexture(), roughness: 0.94 });
  const fenceH = 1.85;
  const mkFence = (w: number, x: number, z: number, ry: number) => {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, fenceH, 0.12), fenceMat);
    panel.position.set(x, fenceH / 2, z);
    panel.rotation.y = ry;
    panel.castShadow = true;
    panel.receiveShadow = true;
    group.add(panel);
  };
  const HW = YARD.halfWidth;
  const HD = YARD.halfDepth;
  mkFence(HW * 2, 0, HD, 0);
  mkFence(HD * 2, -HW, 0, Math.PI / 2);
  mkFence(HD * 2, HW, 0, Math.PI / 2);
  // Back fence is split so the house can sit in the gap.
  mkFence(HW - 10, -(HW + 10) / 2, -HD, 0);
  mkFence(HW - 10, (HW + 10) / 2, -HD, 0);

  // --- House and outbuildings --------------------------------------------
  const house = makeHouse();
  house.position.set(0, 0, -HD - 5.5);
  group.add(house);

  const shed = makeShed();
  shed.position.set(HW - 5, 0, HD - 6);
  shed.rotation.y = -0.35;
  group.add(shed);

  // --- Trees and bushes ---------------------------------------------------
  for (let i = 0; i < 22; i++) {
    const t = makeTree(rnd);
    // Ring the yard from just outside the fence.
    const side = Math.floor(rnd() * 4);
    const along = (rnd() - 0.5) * 2;
    if (side === 0) t.position.set(along * HW, 0, HD + 3 + rnd() * 12);
    else if (side === 1) t.position.set(along * HW, 0, -HD - 9 - rnd() * 12);
    else if (side === 2) t.position.set(-HW - 3 - rnd() * 12, 0, along * HD);
    else t.position.set(HW + 3 + rnd() * 12, 0, along * HD);
    t.scale.setScalar(0.85 + rnd() * 0.5);
    group.add(t);
  }
  // A couple inside the fence for depth, kept clear of the hoop approach.
  for (const [x, z] of [
    [-HW + 6, HD - 12],
    [HW - 8, -HD + 16],
  ] as const) {
    const t = makeTree(rnd);
    t.position.set(x, 0, z);
    group.add(t);
  }

  const bushMat = new THREE.MeshStandardMaterial({
    color: 0x5a8248,
    roughness: 1,
    flatShading: true,
  });
  for (let i = 0; i < 34; i++) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 + rnd() * 0.7, 0), bushMat);
    const edge = Math.floor(rnd() * 3);
    const along = (rnd() - 0.5) * 1.92;
    if (edge === 0) b.position.set(along * HW, 0.4, HD - 1.1);
    else if (edge === 1) b.position.set(-HW + 1.1, 0.4, along * HD);
    else b.position.set(HW - 1.1, 0.4, along * HD);
    b.scale.y = 0.75;
    b.castShadow = true;
    group.add(b);
  }

  // --- Clouds -------------------------------------------------------------
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xfff4e2,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), cloudMat);
    c.position.set((rnd() - 0.5) * 300, 45 + rnd() * 40, (rnd() - 0.5) * 300);
    c.scale.set(12 + rnd() * 18, 4 + rnd() * 3, 9 + rnd() * 10);
    group.add(c);
  }

  // --- Light --------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xcfe4f2, 0x6b7a4c, 1.05);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe6bc, 2.35);
  sun.position.set(28, 34, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  const sc = sun.shadow.camera;
  sc.near = 1;
  sc.far = 180;
  sc.left = -42;
  sc.right = 42;
  sc.top = 42;
  sc.bottom = -42;
  sc.updateProjectionMatrix();
  group.add(sun);
  group.add(sun.target);

  // Warm bounce off the lawn, keeps shadowed faces from going muddy.
  const bounce = new THREE.DirectionalLight(0xffd9a0, 0.35);
  bounce.position.set(-20, 8, -18);
  group.add(bounce);

  return { group, sun };
}
