import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const SHOTS = '/tmp/tapeo-screenshots';

const issues = [];
const passed = [];

function log(msg) { console.log(`  ✓ ${msg}`); passed.push(msg); }
function warn(msg) { console.log(`  ✗ ${msg}`); issues.push(msg); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Create screenshot dir
  const fs = await import('fs');
  fs.mkdirSync(SHOTS, { recursive: true });

  console.log('\n═══ TAPEO UX AUDIT ═══\n');

  // ════════════════════════════════════════
  // 1. LANDING PAGE (tapeo-main.html)
  // ════════════════════════════════════════
  console.log('1. LANDING PAGE');
  await page.goto(BASE);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/01-landing.png`, fullPage: true });

  // Check title
  const title = await page.title();
  if (title.includes('Tapeo')) log('Title contains Tapeo');
  else warn('Title missing Tapeo branding: ' + title);

  // Check Sign In button exists
  const signIn = await page.$('a[href="/login.html"]');
  if (signIn) log('Sign In button visible in nav');
  else warn('No Sign In button found in navigation');

  // Check hero content loads
  const heroText = await page.textContent('body');
  if (heroText.includes('taxi') || heroText.includes('Taxi') || heroText.includes('NFC')) log('Hero mentions core value prop (taxis/NFC)');
  else warn('Hero doesn\'t clearly mention what Tapeo does');

  // ════════════════════════════════════════
  // 2. LOGIN / ROLE PICKER
  // ════════════════════════════════════════
  console.log('\n2. LOGIN / ROLE PICKER');
  await page.goto(BASE + '/login.html');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/02-login.png` });

  // Check both role buttons exist
  const adminBtn = await page.$('a[href="/admin.html"]');
  const bizBtn = await page.$('a[href="/dashboard.html"]');
  if (adminBtn) log('Admin Panel button exists');
  else warn('Admin Panel button missing');
  if (bizBtn) log('Business Dashboard button exists');
  else warn('Business Dashboard button missing');

  // Check back to Tapeo link
  const backLink = await page.$('a[href="/"]');
  if (backLink) log('Back to Tapeo link exists');
  else warn('No way to go back to landing');

  // ════════════════════════════════════════
  // 3. BUSINESS DASHBOARD (Consumer View)
  // ════════════════════════════════════════
  console.log('\n3. BUSINESS DASHBOARD (Consumer POV)');
  await page.goto(BASE + '/dashboard.html');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/03-dashboard-dark.png`, fullPage: true });

  // Check demo banner shows
  const demoBanner = await page.$('.demo-banner.show');
  if (demoBanner) log('Demo banner visible (good — user knows it\'s sample data)');
  else warn('Demo banner not showing — user won\'t know it\'s demo data');

  // Check savings hero card
  const savingsAmount = await page.textContent('#savingsAmount');
  if (savingsAmount && savingsAmount !== '0') log(`Savings hero shows: €${savingsAmount}`);
  else warn('Savings hero card shows €0 or missing');

  // Check KPIs rendered
  const kpiTotal = await page.textContent('#kpiTotal');
  if (kpiTotal && kpiTotal !== '—') log(`Total taps KPI: ${kpiTotal}`);
  else warn('Total taps KPI not rendering');

  // Check sidebar nav items
  const navItems = await page.$$('.sidebar .nav-item');
  log(`Sidebar has ${navItems.length} navigation items`);
  if (navItems.length < 3) warn('Sidebar needs more navigation options');

  // Check recent taps
  const recentItems = await page.$$('.recent-item');
  if (recentItems.length > 0) log(`Recent taps feed: ${recentItems.length} items`);
  else warn('Recent taps feed is empty');

  // NAVIGATE to Analytics
  console.log('\n   Analytics page:');
  await page.click('[data-page="analytics"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/04-dashboard-analytics.png`, fullPage: true });

  const hourBars = await page.$$('.h-bar');
  if (hourBars.length > 0) log(`Hour chart rendered with ${hourBars.length} bars`);
  else warn('Hour chart not rendering');

  // NAVIGATE to Insights
  console.log('\n   Insights page:');
  await page.click('[data-page="insights"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/05-dashboard-insights.png`, fullPage: true });

  const insightItems = await page.$$('.insight-item');
  if (insightItems.length >= 3) log(`${insightItems.length} insights generated`);
  else warn(`Only ${insightItems.length} insights — needs more actionable tips`);

  // NAVIGATE to Settings
  console.log('\n   Settings page:');
  await page.click('[data-page="settings"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/06-dashboard-settings.png`, fullPage: true });

  const planBadge = await page.textContent('.plan-badge');
  if (planBadge) log(`Plan badge shows: ${planBadge}`);
  else warn('Plan badge not rendering');

  // THEME TOGGLE — go back to overview first
  console.log('\n   Theme toggle:');
  await page.click('[data-page="overview"]');
  await page.waitForTimeout(300);
  await page.locator('.main-header .theme-toggle').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/07-dashboard-light.png`, fullPage: true });

  const theme = await page.getAttribute('html', 'data-theme');
  if (theme === 'light') log('Theme toggled to light mode');
  else warn('Theme toggle not working');

  // Check light mode text contrast
  const textColor = await page.$eval('.main-title', el => getComputedStyle(el).color);
  log(`Light mode title color: ${textColor}`);

  // Switch back to dark
  await page.locator('.main-header .theme-toggle').click();

  // ════════════════════════════════════════
  // 4. ADMIN PANEL
  // ════════════════════════════════════════
  console.log('\n4. ADMIN PANEL');
  await page.goto(BASE + '/admin.html');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/08-admin-overview.png`, fullPage: true });

  // Check KPIs
  const adminKpis = await page.$$('.kpi-card');
  if (adminKpis.length >= 4) log(`Overview has ${adminKpis.length} KPI cards`);
  else warn(`Only ${adminKpis.length} KPI cards — need more overview data`);

  // BUSINESSES page
  console.log('\n   Businesses page:');
  await page.click('[data-page="businesses"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/09-admin-businesses.png`, fullPage: true });

  const bizRows = await page.$$('#bizBody tr');
  if (bizRows.length > 0) log(`Business table has ${bizRows.length} rows`);
  else warn('Business table is empty');

  // Check Add Business button
  const addBizBtn = await page.$('#addBizBtn');
  if (addBizBtn) log('+ Add Business button exists');
  else warn('No Add Business button');

  // Click Add Business and check form appears
  if (addBizBtn) {
    await addBizBtn.click();
    await page.waitForTimeout(300);
    const formVisible = await page.$('#addBizCard');
    const display = await formVisible?.evaluate(el => el.style.display);
    if (display === 'block') log('Add Business form opens on click');
    else warn('Add Business form not opening');
    await page.screenshot({ path: `${SHOTS}/10-admin-add-biz.png`, fullPage: true });
  }

  // DRIVERS page
  console.log('\n   Drivers page:');
  await page.click('[data-page="drivers"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/11-admin-drivers.png`, fullPage: true });

  const driverRows = await page.$$('#driverBody tr');
  if (driverRows.length > 0) log(`Driver table has ${driverRows.length} rows`);
  else warn('Driver table is empty');

  // NFC CARDS page
  console.log('\n   NFC Cards page:');
  await page.click('[data-page="nfc"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/12-admin-nfc.png`, fullPage: true });

  // Check NFC URL explanation exists
  const nfcExplain = await page.textContent('#page-nfc');
  if (nfcExplain.includes('/go?')) log('NFC URL structure explained');
  else warn('NFC URL explanation missing');

  // Test NFC URL generator
  await page.fill('#nfcDriver', '3');
  await page.selectOption('#nfcRoute', 'airport');
  await page.fill('#nfcBusiness', '1');
  await page.click('#nfcGenForm button[type="submit"]');
  await page.waitForTimeout(300);

  const nfcUrl = await page.textContent('#nfcUrl');
  if (nfcUrl && nfcUrl.includes('/go?')) log(`NFC URL generated: ${nfcUrl}`);
  else warn('NFC URL generator not working');

  await page.screenshot({ path: `${SHOTS}/13-admin-nfc-generated.png`, fullPage: true });

  // THEME TOGGLE (admin)
  console.log('\n   Admin theme toggle:');
  await page.click('[data-page="overview"]');
  await page.waitForTimeout(300);
  await page.locator('.main-header .theme-toggle').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/14-admin-light.png`, fullPage: true });

  // ════════════════════════════════════════
  // 5. MOBILE VIEW
  // ════════════════════════════════════════
  console.log('\n5. MOBILE VIEW');
  await page.setViewportSize({ width: 390, height: 844 });

  // Dashboard mobile
  await page.goto(BASE + '/dashboard.html');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/15-mobile-dashboard.png`, fullPage: true });

  const mobileNav = await page.$('.mobile-nav');
  if (mobileNav) log('Mobile bottom nav visible');
  else warn('Mobile bottom nav missing');

  const mobileLogo = await page.$('.mobile-header');
  if (mobileLogo) log('Mobile header visible');
  else warn('Mobile header missing');

  // Check mobile nav has all tabs
  const mobileTabs = await page.$$('.mobile-nav-item');
  log(`Mobile nav has ${mobileTabs.length} tabs`);

  // Admin mobile
  await page.goto(BASE + '/admin.html');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/16-mobile-admin.png`, fullPage: true });

  // ════════════════════════════════════════
  // 6. CONSUMER CLARITY AUDIT
  // ════════════════════════════════════════
  console.log('\n6. CONSUMER CLARITY AUDIT');

  // Go to dashboard as first-time consumer
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + '/dashboard.html');
  await page.waitForTimeout(1500);

  // Check: does the consumer immediately understand what they're looking at?
  const savingsHero = await page.$('.savings-hero');
  if (savingsHero) {
    const heroText = await savingsHero.textContent();
    if (heroText.includes('Google Ads') || heroText.includes('saved')) {
      log('Savings hero clearly references Google Ads comparison');
    } else {
      warn('Savings hero doesn\'t clearly explain the comparison');
    }
  }

  // Check: are the KPI labels clear enough for a non-technical restaurant owner?
  const kpiLabels = await page.$$eval('.kpi-label', els => els.map(e => e.textContent.trim()));
  log(`KPI labels: [${kpiLabels.join(', ')}]`);

  // Check: is there any onboarding or help text for first-time users?
  const helpText = await page.$('.onboarding, .help-text, .welcome-msg');
  if (helpText) log('Onboarding/help text found');
  else warn('No onboarding for first-time users — consumer lands and has no context');

  // Check: does the overview page explain what a "tap" is?
  const overviewText = await page.textContent('#page-overview');
  if (overviewText.includes('verified') || overviewText.includes('tourist') || overviewText.includes('person')) {
    log('Overview mentions verified/tourist — connects taps to real people');
  } else {
    warn('Overview never explains what a "tap" means — confusing for first-time user');
  }

  // ════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════
  console.log('\n═══════════════════════════════════════');
  console.log('AUDIT SUMMARY');
  console.log('═══════════════════════════════════════');
  console.log(`\n  ✓ Passed: ${passed.length}`);
  console.log(`  ✗ Issues: ${issues.length}\n`);

  if (issues.length > 0) {
    console.log('ISSUES TO FIX:');
    issues.forEach((issue, i) => {
      console.log(`  ${i + 1}. ${issue}`);
    });
  }

  console.log(`\nScreenshots saved to: ${SHOTS}/`);

  await browser.close();
})();
