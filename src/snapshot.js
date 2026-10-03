// Render single frames of a plan for quick visual checks:
//   node src/snapshot.js out/<id>/plan.json /tmp/frame 12 42.1 60   -> /tmp/frame-12.png ...
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from './serve.js';
const [planFile, outPrefix, ...times] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
if (process.env.KEEP_SIZE !== "1") { plan.width = 960; plan.height = 540; }
const { server, url } = await serve();
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: plan.width, height: plan.height } });
page.on('pageerror', (e) => console.error(e.message));
await page.goto(`${url}/renderer/index.html`);
await page.waitForFunction(() => window.rendererReady === true);
await page.evaluate((p) => window.setup(p), plan);
for (const t of times) { await page.evaluate((f) => window.renderFrame(f), Math.round(Number(t) * plan.fps)); await page.screenshot({ path: `${outPrefix}-${t}.png` }); }
await b.close(); server.close();
