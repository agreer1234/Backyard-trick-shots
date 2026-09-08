import { chromium } from 'playwright';

/**
 * Sanity checks on the build sandbox's collision:
 *  - you cannot walk through a tall deck,
 *  - you can ride up a ramp and get launched off the lip,
 *  - a piece raised onto a deck is still standable.
 */

const PORT = process.env.PORT ?? '4173';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1600 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.click('#intro-go');
await page.waitForTimeout(400);

const setup = (pieces) =>
  page.evaluate((ps) => {
    const w = window.bts.world;
    w.clear();
    for (const p of ps) {
      const def = window.bts.pieceDefs.get(p.id);
      if (!def) throw new Error('no such piece: ' + p.id);
      w.place(def, p.x, p.z, p.yaw ?? 0, p.baseY ?? 0);
    }
  }, pieces);

const defs = await page.evaluate(() => [...window.bts.pieceDefs.keys()]);
console.log('piece catalogue:', defs.join(', '), '\n');

await page.evaluate(() => {
  const sk = window.bts.skater;
  const orig = sk.update.bind(sk);
  window.__tr = [];
  sk.update = (dt, i, w) => {
    orig(dt, i, w);
    window.__tr.push([sk.pos.x, sk.pos.y, sk.pos.z, sk.vel.x, sk.vel.y, sk.vel.z, sk.grounded ? 1 : 0]);
  };
});

const run = async (label, place, start, vel, seconds) => {
  await setup(place);
  await page.evaluate(
    ({ s, v }) => {
      const sk = window.bts.skater;
      sk.pos.set(s[0], s[1], s[2]);
      sk.vel.set(v[0], v[1], v[2]);
      sk.yaw = Math.atan2(v[0], v[2]);
      sk.riding = true;
      sk.grounded = true;
      window.__tr = [];
    },
    { s: start, v: vel },
  );
  await page.waitForTimeout(seconds * 1000);
  const tr = await page.evaluate(() => window.__tr);
  console.log(`\n${label}`);
  console.log('   step |      y |      z |  speed | vy     | grounded');
  for (let i = 0; i < tr.length; i += Math.max(1, Math.floor(tr.length / 18))) {
    const t = tr[i];
    console.log(
      `   ${String(i).padStart(4)} | ${t[1].toFixed(3).padStart(6)} | ${t[2].toFixed(2).padStart(6)} | ` +
        `${Math.hypot(t[3], t[5]).toFixed(2).padStart(6)} | ${t[4].toFixed(2).padStart(6)} | ${t[6]}`,
    );
  }
  const last = tr[tr.length - 1];
  console.log(`   total steps ${tr.length}, ended y=${last[1].toFixed(2)} z=${last[2].toFixed(2)}`);
};

// A high deck is 6 m tall; walking into its side must not pass through it.
await run(
  'Riding hard into the side of a 6 m High Deck at x=0,z=0:',
  [{ id: 'deck', x: 0, z: 0 }],
  [0, 0, 9],
  [0, 0, -14],
  3.5,
);

// Riding up a launch ramp should convert speed into height and launch.
await run(
  'Riding up a Launch Ramp (3.4 m, lip facing -Z):',
  [{ id: 'launch', x: 0, z: 0, yaw: Math.PI }],
  [0, 0, 6],
  [0, 0, -16],
  14,
);

await browser.close();
