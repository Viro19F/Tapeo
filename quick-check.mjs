import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Landing dark
  await page.goto(BASE);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/tapeo-screenshots/landing-dark.png' });

  // Toggle to light
  await page.click('.theme-btn');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/tapeo-screenshots/landing-light.png' });

  // Switch to Spanish
  await page.click('button[data-lang="es"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/tapeo-screenshots/landing-spanish.png' });

  await browser.close();
  console.log('Done — screenshots saved');
})();
