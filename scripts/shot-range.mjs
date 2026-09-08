import { chromium } from 'playwright';

/**
 * Sweeps standing-shot distance, recording the ball's position every physics
 * step, to answer two questions: can a shot go in at all, and at what range
 * does a plain standing shot land?
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

await page.evaluate(() => {
  window.bts.world.clear();
  const b = window.bts.ball;
  const orig = b.update.bind(b);
  window.__trace = [];
  b.update = (dt, w, h) => {
    orig(dt, w, h);
    if (b.state === 'live') window.__trace.push([b.pos.x, b.pos.y, b.pos.z, b.vel.y]);
  };
});

const shoot = async (dist) => {
  await page.evaluate((d) => {
    const s = window.bts.skater;
    s.pos.set(0, 0, -34 + d);
    s.vel.set(0, 0, 0);
    s.yaw = Math.PI;
    s.riding = false;
    s.grounded = true;
    // Force the ball back into the hands; otherwise the shot button is inert
    // while the previous attempt is still rolling around the yard.
    const V = window.bts.ball.pos.constructor;
    window.bts.ball.hold(s.handPoint(new V()));
    window.__trace = [];
  }, dist);
  await page.waitForFunction(() => window.bts.ball.state === 'held', null, { timeout: 5000 });
  const before = await page.evaluate(() => window.bts.stats().makes);
  await page.keyboard.press('j');
  try {
    await page.waitForFunction(() => window.bts.ball.state === 'live', null, { timeout: 4000 });
  } catch {
    return { made: false, samples: 0, apex: 0, offBy: null, at: null, misfire: true };
  }
  // Wait until the ball settles or we give up.
  for (let i = 0; i < 60; i++) {
    const live = await page.evaluate(() => window.bts.ball.state === 'live');
    if (!live) break;
    await page.waitForTimeout(150);
  }
  return page.evaluate((before) => {
    const t = window.__trace;
    const RIM_Y = 3.048;
    let apex = 0;
    let closestDesc = 99;
    let rimPlaneX = null;
    for (let i = 1; i < t.length; i++) {
      apex = Math.max(apex, t[i][1]);
      // Where does it cross the rim plane on the way down?
      if (t[i - 1][1] > RIM_Y && t[i][1] <= RIM_Y && t[i][3] < 0) {
        const f = (t[i - 1][1] - RIM_Y) / (t[i - 1][1] - t[i][1]);
        const px = t[i - 1][0] + (t[i][0] - t[i - 1][0]) * f;
        const pz = t[i - 1][2] + (t[i][2] - t[i - 1][2]) * f;
        const d = Math.hypot(px, pz + 34);
        if (d < closestDesc) {
          closestDesc = d;
          rimPlaneX = [px, pz];
        }
      }
    }
    return {
      made: window.bts.stats().makes > before,
      samples: t.length,
      apex: +apex.toFixed(2),
      // Horizontal miss distance at the moment it drops through rim height.
      offBy: closestDesc === 99 ? null : +closestDesc.toFixed(3),
      at: rimPlaneX ? rimPlaneX.map((v) => +v.toFixed(2)) : null,
    };
  }, before);
};

console.log('Rim radius 0.229 m, ball radius 0.121 m -> a make needs offBy < ~0.19 m\n');
for (const d of [4, 4.5, 5, 5.25, 5.5, 5.75, 6, 6.25, 6.5, 7]) {
  const r = await shoot(d);
  console.log(
    `dist ${String(d).padStart(5)} m | ${r.made ? 'MAKE' : 'miss'} | apex ${String(r.apex).padStart(5)} | ` +
      `offBy ${r.offBy === null ? '  n/a (never fell through rim height)' : r.offBy + ' m'} | samples ${r.samples}`,
  );
  await page.waitForTimeout(800);
}

console.log('\nfinal', JSON.stringify(await page.evaluate(() => window.bts.stats())));
await browser.close();
