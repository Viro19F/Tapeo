const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'tapeo-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Root route → main landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'tapeo-main.html'));
});

app.use(express.static(path.join(__dirname), { index: false }));

// ── DATABASE ───────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'segovia.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS taps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id    TEXT    NOT NULL,
    place_name  TEXT    NOT NULL,
    driver_id   TEXT    DEFAULT 'unknown',
    business_id INTEGER DEFAULT NULL,
    source      TEXT    DEFAULT 'taxi',
    route       TEXT    DEFAULT 'unknown',
    tapped_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS suggestions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    area         TEXT,
    category     TEXT,
    description  TEXT,
    email        TEXT,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS businesses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    category     TEXT,
    website_url  TEXT NOT NULL,
    contact_name TEXT,
    email        TEXT NOT NULL,
    phone        TEXT,
    plan         TEXT DEFAULT 'starter',
    active       INTEGER DEFAULT 1,
    joined_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS drivers (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    phone     TEXT NOT NULL,
    vehicle   TEXT,
    active    INTEGER DEFAULT 1,
    joined_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    card_code   TEXT NOT NULL UNIQUE,
    driver_id   INTEGER,
    business_id INTEGER,
    route       TEXT DEFAULT 'city',
    active      INTEGER DEFAULT 1,
    FOREIGN KEY (driver_id)   REFERENCES drivers(id),
    FOREIGN KEY (business_id) REFERENCES businesses(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'business',
    business_id INTEGER DEFAULT NULL,
    name        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (business_id) REFERENCES businesses(id)
  );
`);

// Safe migrations
['driver_id TEXT DEFAULT "unknown"', 'source TEXT DEFAULT "taxi"',
 'route TEXT DEFAULT "unknown"', 'business_id INTEGER DEFAULT NULL']
  .forEach(col => {
    try { db.exec(`ALTER TABLE taps ADD COLUMN ${col}`); } catch (_) {}
  });

// Seed admin user if none exists
const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('tapeo2026', 10);
  db.prepare('INSERT INTO users (email, password, role, name) VALUES (?, ?, ?, ?)')
    .run('admin@tapeo.co', hash, 'admin', 'Fernando');
}

// ── AUTH MIDDLEWARE ────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ── AUTH ENDPOINTS ────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials' });

  req.session.user = {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    businessId: user.business_id
  };

  res.json({ ok: true, user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.session.user });
});

// ── NFC REDIRECT ───────────────────────────────────────────
app.get('/go', (req, res) => {
  const { d = 'unknown', r = 'city', b } = req.query;

  if (b) {
    const business = db.prepare(
      'SELECT * FROM businesses WHERE id = ? AND active = 1'
    ).get(Number(b));

    if (business) {
      db.prepare(`
        INSERT INTO taps (place_id, place_name, driver_id, business_id, source, route)
        VALUES (?, ?, ?, ?, 'nfc', ?)
      `).run(`biz_${business.id}`, business.name, d, business.id, r);

      return res.redirect(business.website_url);
    }
  }

  res.redirect(`/nfc-discover.html?src=taxi&d=${d}&r=${r}`);
});

// ── TAP LOGGING ───────────────────────────────────────────
app.post('/api/tap', (req, res) => {
  const {
    placeId, placeName,
    driverId = 'unknown',
    route    = 'unknown',
    src      = 'taxi'
  } = req.body;

  if (!placeId || !placeName)
    return res.status(400).json({ error: 'placeId and placeName required' });

  db.prepare(`
    INSERT INTO taps (place_id, place_name, driver_id, source, route)
    VALUES (?, ?, ?, ?, ?)
  `).run(placeId, placeName, driverId, src, route);

  res.json({ ok: true });
});

// ── TRENDING / STATS ──────────────────────────────────────
app.get('/api/trending', (req, res) => {
  const rows = db.prepare(`
    SELECT place_id AS id, place_name AS name, COUNT(*) AS visits
    FROM taps
    WHERE tapped_at >= datetime('now', '-7 days')
    GROUP BY place_id ORDER BY visits DESC LIMIT 5
  `).all();
  res.json(rows);
});

app.get('/api/stats', (req, res) => {
  const { total }  = db.prepare('SELECT COUNT(*) AS total FROM taps').get();
  const { places } = db.prepare('SELECT COUNT(DISTINCT place_id) AS places FROM taps').get();
  res.json({ total, places });
});

app.post('/api/suggest', (req, res) => {
  const { name, area, category, description, email } = req.body;
  if (!name) return res.status(400).json({ error: 'Place name is required' });
  db.prepare(`
    INSERT INTO suggestions (name, area, category, description, email)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, area || '', category || '', description || '', email || '');
  res.json({ ok: true, message: 'Suggestion received — thank you!' });
});

app.get('/api/suggestions', (req, res) => {
  res.json(db.prepare('SELECT * FROM suggestions ORDER BY submitted_at DESC').all());
});

// ── BUSINESS ENDPOINTS ─────────────────────────────────────
app.post('/api/business/signup', (req, res) => {
  const { name, category, websiteUrl, contactName, email, phone, plan } = req.body;
  if (!name || !email || !websiteUrl)
    return res.status(400).json({ error: 'Name, email, and website are required' });

  const result = db.prepare(`
    INSERT INTO businesses (name, category, website_url, contact_name, email, phone, plan)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, category || '', websiteUrl, contactName || '', email, phone || '', plan || 'starter');

  // Create user account for the business
  const hash = bcrypt.hashSync(email.split('@')[0] + '2026', 10);
  try {
    db.prepare('INSERT INTO users (email, password, role, business_id, name) VALUES (?, ?, ?, ?, ?)')
      .run(email.toLowerCase().trim(), hash, 'business', result.lastInsertRowid, contactName || name);
  } catch (_) { /* email already exists */ }

  res.json({
    ok: true,
    id: result.lastInsertRowid,
    message: "Welcome to Tapeo. We'll be in touch within 24 hours to set up your cards."
  });
});

app.get('/api/business/:id/stats', (req, res) => {
  const id = Number(req.params.id);
  const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(id);
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM taps WHERE business_id = ?`
  ).get(id).n;

  const week = db.prepare(
    `SELECT COUNT(*) AS n FROM taps WHERE business_id = ? AND tapped_at >= datetime('now','-7 days')`
  ).get(id).n;

  const prevWeek = db.prepare(
    `SELECT COUNT(*) AS n FROM taps WHERE business_id = ? AND tapped_at >= datetime('now','-14 days') AND tapped_at < datetime('now','-7 days')`
  ).get(id).n;

  const today = db.prepare(
    `SELECT COUNT(*) AS n FROM taps WHERE business_id = ? AND tapped_at >= date('now')`
  ).get(id).n;

  const month = db.prepare(
    `SELECT COUNT(*) AS n FROM taps WHERE business_id = ? AND tapped_at >= datetime('now','-30 days')`
  ).get(id).n;

  const prevMonth = db.prepare(
    `SELECT COUNT(*) AS n FROM taps WHERE business_id = ? AND tapped_at >= datetime('now','-60 days') AND tapped_at < datetime('now','-30 days')`
  ).get(id).n;

  const byHour = db.prepare(`
    SELECT strftime('%H', tapped_at) AS hour, COUNT(*) AS n
    FROM taps WHERE business_id = ? GROUP BY hour ORDER BY hour
  `).all(id);

  const byRoute = db.prepare(`
    SELECT route, COUNT(*) AS n FROM taps WHERE business_id = ?
    GROUP BY route ORDER BY n DESC
  `).all(id);

  const bySource = db.prepare(`
    SELECT source, COUNT(*) AS n FROM taps WHERE business_id = ?
    GROUP BY source ORDER BY n DESC
  `).all(id);

  const byDay = db.prepare(`
    SELECT date(tapped_at) AS day, COUNT(*) AS n FROM taps
    WHERE business_id = ? AND tapped_at >= datetime('now', '-30 days')
    GROUP BY day ORDER BY day
  `).all(id);

  const recent = db.prepare(`
    SELECT route, source, tapped_at FROM taps
    WHERE business_id = ? ORDER BY tapped_at DESC LIMIT 30
  `).all(id);

  // Plan pricing
  const planPrices = { starter: 80, growth: 150, premium: 300 };
  const monthlyFee = planPrices[business.plan] || 80;
  const costPerTap = month > 0 ? (monthlyFee / month).toFixed(2) : '—';
  const googleEquiv = (total * 2.50).toFixed(2);
  const weekTrend = prevWeek > 0 ? Math.round(((week - prevWeek) / prevWeek) * 100) : 0;
  const monthTrend = prevMonth > 0 ? Math.round(((month - prevMonth) / prevMonth) * 100) : 0;

  res.json({
    business: {
      name: business.name,
      plan: business.plan,
      category: business.category,
      joined: business.joined_at,
      monthlyFee
    },
    stats: {
      total, week, prevWeek, today, month, prevMonth,
      costPerTap,
      googleAdsEquivalent: googleEquiv,
      paidTapeo: monthlyFee.toFixed(2),
      weekTrend,
      monthTrend
    },
    byHour, byRoute, bySource, byDay, recent
  });
});

app.get('/api/businesses', (req, res) => {
  res.json(
    db.prepare('SELECT id, name, category, plan, active, joined_at FROM businesses ORDER BY joined_at DESC').all()
  );
});

// ── DRIVER ENDPOINTS ───────────────────────────────────────
app.post('/api/driver/signup', (req, res) => {
  const { name, phone, vehicle } = req.body;
  if (!name || !phone)
    return res.status(400).json({ error: 'Name and phone required' });

  const result = db.prepare('INSERT INTO drivers (name, phone, vehicle) VALUES (?, ?, ?)')
    .run(name, phone, vehicle || '');

  res.json({
    ok: true,
    id: result.lastInsertRowid,
    message: "Welcome to Tapeo! We'll WhatsApp you to install your card."
  });
});

app.get('/api/driver/:id/earnings', (req, res) => {
  const id = Number(req.params.id);
  const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });

  const total = db.prepare(`SELECT COUNT(*) AS n FROM taps WHERE driver_id = ?`).get(String(id)).n;
  const week  = db.prepare(`SELECT COUNT(*) AS n FROM taps WHERE driver_id = ? AND tapped_at >= datetime('now','-7 days')`).get(String(id)).n;
  const month = db.prepare(`SELECT COUNT(*) AS n FROM taps WHERE driver_id = ? AND tapped_at >= datetime('now','-30 days')`).get(String(id)).n;

  res.json({
    driver: { name: driver.name },
    taps:   { total, week, month },
    earnings: {
      base:      0,
      perTap:    0.30,
      thisMonth: (month * 0.30).toFixed(2)
    }
  });
});

// ── ADMIN ENDPOINTS ───────────────────────────────────────
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const totalBusinesses = db.prepare('SELECT COUNT(*) AS n FROM businesses WHERE active = 1').get().n;
  const totalDrivers = db.prepare('SELECT COUNT(*) AS n FROM drivers WHERE active = 1').get().n;
  const totalTaps = db.prepare('SELECT COUNT(*) AS n FROM taps').get().n;
  const tapsThisMonth = db.prepare("SELECT COUNT(*) AS n FROM taps WHERE tapped_at >= datetime('now','-30 days')").get().n;
  const tapsLastMonth = db.prepare("SELECT COUNT(*) AS n FROM taps WHERE tapped_at >= datetime('now','-60 days') AND tapped_at < datetime('now','-30 days')").get().n;
  const activeCards = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE active = 1').get().n;

  // MRR calculation
  const planPrices = { starter: 80, growth: 150, premium: 300 };
  const businesses = db.prepare('SELECT plan FROM businesses WHERE active = 1').all();
  const mrr = businesses.reduce((sum, b) => sum + (planPrices[b.plan] || 0), 0);

  // Driver costs this month
  const driverCost = tapsThisMonth * 0.30;

  // Recent activity
  const recentTaps = db.prepare(`
    SELECT t.route, t.source, t.tapped_at, b.name AS business_name, t.driver_id
    FROM taps t LEFT JOIN businesses b ON t.business_id = b.id
    ORDER BY t.tapped_at DESC LIMIT 20
  `).all();

  // Taps by day (last 30 days)
  const tapsByDay = db.prepare(`
    SELECT date(tapped_at) AS day, COUNT(*) AS n FROM taps
    WHERE tapped_at >= datetime('now', '-30 days')
    GROUP BY day ORDER BY day
  `).all();

  // Taps by source
  const tapsBySource = db.prepare(`
    SELECT source, COUNT(*) AS n FROM taps GROUP BY source ORDER BY n DESC
  `).all();

  const tapsTrend = tapsLastMonth > 0 ? Math.round(((tapsThisMonth - tapsLastMonth) / tapsLastMonth) * 100) : 0;

  res.json({
    totalBusinesses, totalDrivers, totalTaps, tapsThisMonth, tapsLastMonth,
    tapsTrend, activeCards, mrr, driverCost,
    netRevenue: mrr - driverCost,
    recentTaps, tapsByDay, tapsBySource
  });
});

app.get('/api/admin/businesses', requireAdmin, (req, res) => {
  const businesses = db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM taps WHERE business_id = b.id) AS total_taps,
      (SELECT COUNT(*) FROM taps WHERE business_id = b.id AND tapped_at >= datetime('now','-30 days')) AS month_taps,
      (SELECT COUNT(*) FROM taps WHERE business_id = b.id AND tapped_at >= datetime('now','-7 days')) AS week_taps
    FROM businesses b ORDER BY b.joined_at DESC
  `).all();
  res.json(businesses);
});

app.get('/api/admin/drivers', requireAdmin, (req, res) => {
  const drivers = db.prepare(`
    SELECT d.*,
      (SELECT COUNT(*) FROM taps WHERE driver_id = CAST(d.id AS TEXT)) AS total_taps,
      (SELECT COUNT(*) FROM taps WHERE driver_id = CAST(d.id AS TEXT) AND tapped_at >= datetime('now','-30 days')) AS month_taps,
      (SELECT COUNT(*) FROM taps WHERE driver_id = CAST(d.id AS TEXT) AND tapped_at >= datetime('now','-7 days')) AS week_taps
    FROM drivers d ORDER BY d.joined_at DESC
  `).all();

  const result = drivers.map(d => ({
    ...d,
    earnings: (d.month_taps * 0.30).toFixed(2)
  }));

  res.json(result);
});


app.listen(PORT, () => {
  console.log(`\n  Tapeo server → http://localhost:${PORT}\n`);
  console.log(`  Login:         /login.html`);
  console.log(`  Admin:         /admin.html`);
  console.log(`  Dashboard:     /dashboard.html`);
  console.log(`  NFC redirect:  /go?d=DRIVER&r=ROUTE&b=BUSINESS_ID`);
  console.log(`  Business join: /nfc-join.html`);
  console.log(`  Driver signup: /nfc-driver.html\n`);
  console.log(`  Admin login:   admin@tapeo.co / tapeo2026\n`);
});
