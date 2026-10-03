// Renders the vector channel art in branding/logo.html to PNGs:
//   node src/logo.js   -> branding/banner.png (2560x1440), branding/avatar.png (800x800), branding/logo.png (transparent)
import path from 'node:path';
import { chromium } from 'playwright';
import { serve } from './serve.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const JOBS = [
  { view: 'banner', w: 2560, h: 1440, out: 'branding/banner.png' },
  { view: 'avatar', w: 800, h: 800, out: 'branding/avatar.png' },
  { view: 'logo', w: 1400, h: 360, out: 'branding/logo.png', transparent: true },
];
const { server, url } = await serve();
const b = await chromium.launch();
for (const j of JOBS) {
  const page = await b.newPage({ viewport: { width: j.w, height: j.h } });
  await page.goto(`${url}/branding/logo.html?view=${j.view}`);
  await page.waitForFunction(() => window.logoReady === true);
  await page.screenshot({ path: path.join(ROOT, j.out), omitBackground: !!j.transparent });
  console.log(`wrote ${j.out}`);
  await page.close();
}
await b.close();
server.close();
