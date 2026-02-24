const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

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
`);

// Safe migrations — add columns to existing taps table if missing
['driver_id TEXT DEFAULT "unknown"', 'source TEXT DEFAULT "taxi"',
 'route TEXT DEFAULT "unknown"', 'business_id INTEGER DEFAULT NULL']
  .forEach(col => {
    try { db.exec(`ALTER TABLE taps ADD COLUMN ${col}`); } catch (_) {}
  });

// ── NFC REDIRECT ───────────────────────────────────────────
// This URL lives inside every NFC card: /go?d=DRIVER_ID&r=ROUTE&b=BUSINESS_ID
// Tourist taps → we log it → redirect to business website
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

  // No business assigned → show the discovery page
  res.redirect(`/discover.html?src=taxi&d=${d}&r=${r}`);
});

// ── TAP LOGGING (from discover.html) ──────────────────────
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

// ── TRENDING / STATS (legacy) ──────────────────────────────
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

  res.json({
    ok: true,
    id: result.lastInsertRowid,
    message: "Welcome to LTN. We'll be in touch within 24 hours to set up your cards."
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

  const today = db.prepare(
    `SELECT COUNT(*) AS n FROM taps WHERE business_id = ? AND tapped_at >= date('now')`
  ).get(id).n;

  const byHour = db.prepare(`
    SELECT strftime('%H', tapped_at) AS hour, COUNT(*) AS n
    FROM taps WHERE business_id = ? GROUP BY hour ORDER BY hour
  `).all(id);

  const byRoute = db.prepare(`
    SELECT route, COUNT(*) AS n FROM taps WHERE business_id = ?
    GROUP BY route ORDER BY n DESC
  `).all(id);

  const recent = db.prepare(`
    SELECT route, source, tapped_at FROM taps
    WHERE business_id = ? ORDER BY tapped_at DESC LIMIT 20
  `).all(id);

  res.json({
    business: { name: business.name, plan: business.plan, joined: business.joined_at },
    stats: {
      total, week, today,
      googleAdsEquivalent: (total * 1.9).toFixed(2)
    },
    byHour, byRoute, recent
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
    message: "Welcome to LTN! We'll WhatsApp you to install your card."
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
      base:      30.00,
      perTap:    0.30,
      thisMonth: (30 + month * 0.30).toFixed(2)
    }
  });
});

// ── CATCH-ALL ──────────────────────────────────────────────
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'discover.html'));
});

app.listen(PORT, () => {
  console.log(`\n  LTN server → http://localhost:${PORT}\n`);
  console.log(`  NFC redirect:  /go?d=DRIVER&r=ROUTE&b=BUSINESS_ID`);
  console.log(`  Business join: /join.html`);
  console.log(`  Dashboard:     /dashboard.html?id=BUSINESS_ID`);
  console.log(`  Driver signup: /driver.html\n`);
});
