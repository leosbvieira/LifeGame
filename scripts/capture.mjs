// Headless render + screenshot harness using SwiftShader WebGPU.
// Software rendering is slow — this is for correctness/comdposition checks and
// catching WGSL compile errors, not perf. Real perf is on the user's GPU.
import { chromium } from 'playwright';

const OUT = process.env.OUT || 'scripts/shots';
const URL = process.env.URL || 'http://localhost:5173/';
const SETTLE = parseInt(process.env.SETTLE || '9000', 10);

// Sequence of {keys, hold(ms), shot} steps, provided as JSON in STEPS env.
const steps = JSON.parse(process.env.STEPS || '[]');

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME,
  args: [
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
const warns = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error') errors.push(m.text());
  else if (t === 'warning') warns.push(m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });

// Wait for boot (window.__voidrift) or fatal screen.
let booted = false;
try {
  await page.waitForFunction(
    () => window.__voidrift || getComputedStyle(document.getElementById('fatal')).display !== 'none',
    { timeout: 180000 }
  );
  booted = await page.evaluate(() => !!window.__voidrift);
} catch (e) {
  console.log('BOOT TIMEOUT');
}

console.log('BOOTED', booted);
console.log('ERRORS', errors.length ? errors.slice(0, 30) : 'none');
console.log('WARNS', warns.filter((w) => /wgsl|shader|compil|uniform|attribute/i.test(w)).slice(0, 20));

if (booted) {
  // Grab an early frame before any potential software-renderer crash.
  try {
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/00_early.png` });
    console.log('EARLY SHOT OK');
  } catch (e) {
    console.log('EARLY SHOT FAILED', String(e).slice(0, 80));
  }

  // Let a few frames render (software is slow).
  await page.waitForTimeout(SETTLE);
  await page.screenshot({ path: `${OUT}/00_boot.png` });

  const canvas = await page.$('#renderCanvas');
  await canvas.click(); // pointer lock / focus (may fail headless, that's ok)

  let idx = 1;
  for (const step of steps) {
    if (step.keys) {
      for (const k of step.keys) await page.keyboard.down(k);
      await page.waitForTimeout(step.hold || 800);
      for (const k of step.keys) await page.keyboard.up(k);
    }
    if (step.wait) await page.waitForTimeout(step.wait);
    if (step.shot) {
      await page.screenshot({ path: `${OUT}/${String(idx).padStart(2, '0')}_${step.shot}.png` });
      idx++;
    }
  }

  // Pull a telemetry snapshot.
  const telem = await page.evaluate(() => {
    const v = window.__voidrift;
    if (!v) return null;
    const s = v.scene;
    return {
      fps: v.engine.getFps().toFixed(1),
      meshes: s.meshes.length,
      activeMeshes: s.getActiveMeshes().length,
      shipY: v.ship.position.y.toFixed(1),
    };
  });
  console.log('TELEM', JSON.stringify(telem));
}

await browser.close();
console.log('DONE');
