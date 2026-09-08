/**
 * Bundles dist/ into one self-contained play.html at the repo root.
 *
 * Why this exists: GitHub Pages needs a one-time manual toggle in repo
 * settings before it will deploy anything. A single committed HTML file can be
 * served straight out of the repo by a raw-file CDN with no setup at all, which
 * means the game is playable on a phone whether or not Pages is switched on.
 *
 * Run `npm run build` first, then `npm run build:single`.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html not found — run `npm run build` first.');
  process.exit(1);
}

let html = readFileSync(join(dist, 'index.html'), 'utf8');

/** Inline a built stylesheet. */
html = html.replace(
  /<link rel="stylesheet"[^>]*href="\.?\/?([^"]+\.css)"[^>]*>/g,
  (_m, href) => `<style>\n${readFileSync(join(dist, href), 'utf8')}\n</style>`,
);

/** Inline the module bundle. `</script` inside a string literal would end the
 *  tag early, so it has to be escaped. */
html = html.replace(
  /<script type="module"[^>]*src="\.?\/?([^"]+\.js)"[^>]*><\/script>/g,
  (_m, src) => {
    const js = readFileSync(join(dist, src), 'utf8').replace(/<\/script/gi, '<\\/script');
    return `<script type="module">\n${js}\n</script>`;
  },
);

/** Inline the home-screen icon so Add to Home Screen still gets artwork. */
const icon = readFileSync(join(dist, 'apple-touch-icon.png')).toString('base64');
html = html.replace(
  /<link rel="apple-touch-icon"[^>]*>/,
  `<link rel="apple-touch-icon" href="data:image/png;base64,${icon}" />`,
);
const favicon = readFileSync(join(dist, 'favicon.png')).toString('base64');
html = html.replace(
  /<link rel="icon"[^>]*>/,
  `<link rel="icon" type="image/png" href="data:image/png;base64,${favicon}" />`,
);

/** No manifest: a data: URI manifest cannot resolve start_url, and iOS ignores
 *  manifests anyway in favour of the apple-mobile-web-app meta tags. */
html = html.replace(/<link rel="manifest"[^>]*>\s*/, '');

const out = join(root, 'play.html');
writeFileSync(out, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`wrote play.html (${kb} KB, fully self-contained)`);
