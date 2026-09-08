import * as THREE from 'three';

/**
 * Every texture in the game is drawn procedurally at boot. No binary assets,
 * nothing to load, and the whole look can be tuned by editing numbers.
 */

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Deterministic value noise so the yard looks the same every session. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function speckle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  count: number,
  colors: string[],
  seed: number,
  size = 3,
) {
  const rnd = seeded(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)]!;
    const r = size * (0.4 + rnd() * 0.9);
    ctx.beginPath();
    ctx.ellipse(rnd() * w, rnd() * h, r, r * (0.5 + rnd()), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Mown lawn: base green, mower stripes, clover speckle. */
export function grassTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#79a85c';
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, 5200, ['#6f9e52', '#84b366', '#8fbd6e', '#6a9950', '#95c079'], 7, 4);
  // A few dandelions, because it is that kind of yard.
  const rnd = seeded(99);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = i % 3 === 0 ? '#f7e58a' : '#e9dfc2';
    ctx.beginPath();
    ctx.arc(rnd() * 512, rnd() * 512, 2.2 + rnd() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c, 30, 30);
}

/** Mower stripe overlay, applied as a second wide-repeat texture band. */
export function stripeTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.055)';
  ctx.fillRect(0, 0, 32, 4);
  ctx.fillStyle = 'rgba(0,40,0,0.05)';
  ctx.fillRect(32, 0, 32, 4);
  return finish(c, 14, 1);
}

/** Plywood sheet for ramp decks: warm ply with plank seams and scuffs. */
export function plywoodTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#c99a63';
  ctx.fillRect(0, 0, 512, 512);
  const rnd = seeded(21);
  // Wood grain
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = `rgba(${140 + rnd() * 40},${100 + rnd() * 30},${58 + rnd() * 20},0.24)`;
    ctx.lineWidth = 0.6 + rnd() * 2.2;
    ctx.beginPath();
    const y = rnd() * 512;
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.03 + i) * 3.5);
    ctx.stroke();
  }
  // Sheet seams every quarter
  ctx.strokeStyle = 'rgba(90,60,34,0.42)';
  ctx.lineWidth = 3;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (i * 512) / 4);
    ctx.lineTo(512, (i * 512) / 4);
    ctx.stroke();
  }
  // Skate scuffs
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(60,44,32,${0.05 + rnd() * 0.1})`;
    ctx.lineWidth = 2 + rnd() * 6;
    ctx.beginPath();
    const x = rnd() * 512;
    const y = rnd() * 512;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 90, y + (rnd() - 0.5) * 30);
    ctx.stroke();
  }
  return finish(c, 1, 1);
}

/** Weathered cedar fence boards. */
export function fenceTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#a98461';
  ctx.fillRect(0, 0, 256, 256);
  const rnd = seeded(5);
  for (let x = 0; x < 256; x += 32) {
    ctx.fillStyle = `rgb(${150 + rnd() * 28},${118 + rnd() * 22},${86 + rnd() * 18})`;
    ctx.fillRect(x + 1, 0, 30, 256);
    for (let i = 0; i < 22; i++) {
      ctx.strokeStyle = `rgba(96,70,46,${0.1 + rnd() * 0.16})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + 2 + rnd() * 28, 0);
      ctx.lineTo(x + 2 + rnd() * 28, 256);
      ctx.stroke();
    }
  }
  return finish(c, 1, 1);
}

/** Old painted backboard: chipped white with a faded shooter's square. */
export function backboardTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 356);
  ctx.fillStyle = '#eee6d3';
  ctx.fillRect(0, 0, 512, 356);
  const rnd = seeded(31);
  speckle(ctx, 512, 356, 900, ['#e3d8c0', '#d8ccb0', '#f4ecd9'], 12, 5);
  // Faded red shooter's square
  ctx.strokeStyle = 'rgba(186,64,44,0.72)';
  ctx.lineWidth = 13;
  ctx.strokeRect(158, 150, 196, 150);
  // Border trim
  ctx.strokeStyle = 'rgba(186,64,44,0.5)';
  ctx.lineWidth = 9;
  ctx.strokeRect(14, 14, 484, 328);
  // Paint chips and grime
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(120,104,80,${0.05 + rnd() * 0.14})`;
    ctx.beginPath();
    ctx.ellipse(rnd() * 512, rnd() * 356, 1 + rnd() * 7, 1 + rnd() * 5, rnd() * 3, 0, 7);
    ctx.fill();
  }
  return finish(c, 1, 1);
}

/** Cracked patio concrete. */
export function concreteTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#bdb5a4';
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, 3000, ['#b3ab99', '#c7c0b0', '#a9a291'], 3, 3);
  const rnd = seeded(64);
  ctx.strokeStyle = 'rgba(110,104,92,0.5)';
  for (let i = 0; i < 7; i++) {
    ctx.lineWidth = 0.8 + rnd() * 1.4;
    ctx.beginPath();
    let x = rnd() * 512;
    let y = rnd() * 512;
    ctx.moveTo(x, y);
    for (let s = 0; s < 9; s++) {
      x += (rnd() - 0.5) * 90;
      y += (rnd() - 0.5) * 90;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Expansion joints
  ctx.strokeStyle = 'rgba(96,90,80,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 512);
  ctx.moveTo(0, 256);
  ctx.lineTo(512, 256);
  ctx.stroke();
  return finish(c, 4, 4);
}

/** Basketball: pebbled orange with black seams, roughly equirectangular. */
export function basketballTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 256);
  ctx.fillStyle = '#d1702f';
  ctx.fillRect(0, 0, 512, 256);
  speckle(ctx, 512, 256, 6000, ['#c96a2b', '#dd7c38', '#bd6227'], 17, 2);
  ctx.strokeStyle = '#241a14';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  // Equator plus two meridians
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(512, 128);
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.moveTo(384, 0);
  ctx.lineTo(384, 256);
  ctx.stroke();
  // The two curved seams that make it read as a basketball
  for (const cx of [0, 256]) {
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const u = (i / 64) * 256;
      const v = 128 + Math.sin((i / 64) * Math.PI) * 86 * (cx === 0 ? 1 : -1);
      i === 0 ? ctx.moveTo(cx + u, v) : ctx.lineTo(cx + u, v);
    }
    ctx.stroke();
  }
  return finish(c, 1, 1);
}

/** Clapboard siding for the house. */
export function sidingTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#dfd8c6';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 22) {
    ctx.fillStyle = 'rgba(150,140,120,0.28)';
    ctx.fillRect(0, y + 19, 256, 3);
    ctx.fillStyle = 'rgba(255,252,242,0.3)';
    ctx.fillRect(0, y, 256, 5);
  }
  return finish(c, 1, 1);
}
