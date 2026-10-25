const express = require('express');
const session = require('express-session');
const { DatabaseSync: Database } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { openDatabase } = require('./database');
const { createAnalyzer, saveFeedback } = require('./analysis');
const { listTopics, addTopic, deleteTopic, listFeedback, topicStatistics } = require('./topics');
class SQLiteStore extends session.Store {
  constructor(directory) {
    super();
    this.db = new Database(path.join(directory, 'sessions.db'));
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)');
    this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  }
  get(sid, cb) { try { const row = this.db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires > ?').get(sid, Date.now()); cb(null, row ? JSON.parse(row.data) : null); } catch (e) { cb(e); } }
  set(sid, value, cb) { try { this.db.prepare('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)').run(sid, JSON.stringify(value), new Date(value.cookie.expires).getTime()); cb?.(); } catch(e) { cb?.(e); } }
  destroy(sid, cb) { try { this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); cb?.(); } catch(e) { cb?.(e); } }
}
function createApp({ dataDir = path.join(__dirname, 'data'), analyze = createAnalyzer() } = {}) {
  const production = process.env.NODE_ENV === 'production';
  if (production && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
  const db = openDatabase(dataDir);
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    secret = db.prepare("SELECT value FROM settings WHERE key = 'session_secret'").get()?.value;
    if (!secret) { secret = randomBytes(48).toString('hex'); db.prepare('INSERT INTO settings VALUES (?, ?)').run('session_secret', secret); }
  }
  const store = new SQLiteStore(dataDir);
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));
  app.use(session({ store, secret, name: 'feedback.sid', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'strict', secure: production, maxAge: 8 * 60 * 60 * 1000 } }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (['POST', 'DELETE'].includes(req.method) && req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Send JSON data.' });
    next();
  });
  const requireAdmin = (req, res, next) => req.session.adminId ? next() : res.status(401).json({ error: 'Please log in.' });
  app.get('/api/topics', (req, res) => res.json(listTopics(db)));
  app.post('/api/topics', requireAdmin, (req, res) => {
    try { res.status(201).json(addTopic(db, req.body?.name)); }
    catch (error) { if (!error.status) throw error; res.status(error.status).json({ error: error.message }); }
  });
  app.delete('/api/topics/:id', requireAdmin, (req, res) => {
    try { deleteTopic(db, Number(req.params.id)); res.json({ success: true }); }
    catch (error) { if (!error.status) throw error; res.status(error.status).json({ error: error.message }); }
  });
  app.get('/api/statistics/topics', requireAdmin, (req, res) => res.json(topicStatistics(db)));
  app.post('/api/feedback', rateLimit({ windowMs: 60000, limit: 20, legacyHeaders: false, message: { error: 'Too many submissions. Please try again in a minute.' } }), async (req, res) => {
    const { topic, text } = req.body || {};
    if (!listTopics(db).some(item => item.name === topic) || typeof text !== 'string' || !text.trim() || text.trim().length > 5000) return res.status(400).json({ error: 'Choose a valid topic and enter feedback between 1 and 5,000 characters.' });
    const result = await saveFeedback(db, { topic, text }, analyze);
    res.status(201).json({ ...result, message: result.analyzed
      ? 'Your feedback has been submitted successfully!'
      : 'Your feedback has been submitted successfully! AI analysis is currently unavailable; your feedback has been saved.' });
  });
  const dummyHash = bcrypt.hashSync(randomBytes(24).toString('hex'), 12);
  app.post('/api/login', rateLimit({ windowMs: 15 * 60000, limit: 10, legacyHeaders: false, message: { error: 'Too many login attempts. Try again in 15 minutes.' } }), async (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || typeof password !== 'string' || password.length > 256 || username.length > 100) return res.status(400).json({ error: 'Enter a valid username and password.' });
      const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
      const valid = await bcrypt.compare(password, admin?.password_hash || dummyHash);
      if (!admin || !valid) return res.status(401).json({ error: 'Invalid username or password.' });
      req.session.regenerate(error => {
        if (error) return next(error);
        req.session.adminId = admin.id;
        req.session.save(error => error ? next(error) : res.json({ success: true }));
      });
    } catch(e) { next(e); }
  });
  app.get('/api/feedback', requireAdmin, (req, res) => {
    if (req.query.topic !== undefined && (typeof req.query.topic !== 'string' || req.query.topic.length > 80)) return res.status(400).json({ error: 'Invalid topic filter.' });
    res.json(listFeedback(db, req.query.topic));
  });
  app.post('/api/logout', requireAdmin, (req, res, next) => req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie('feedback.sid', { path: '/' }); res.json({ success: true });
  }));
  app.get(['/admin', '/admin/dashboard'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.session.adminId) return res.redirect('/login.html');
    res.sendFile(path.join(__dirname, 'private/dashboard.html'));
  });
  app.use('/vendor/bootstrap', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css')));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    console.error(err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return { app, close() { store.db.close(); db.close(); } };
}
if (require.main === module) {
  const { app, close } = createApp();
  const server = app.listen(process.env.PORT || 3000, () => console.log(`Student feedback app: http://localhost:${process.env.PORT || 3000}`));
  server.on('error', error => { console.error(`Cannot start server: ${error.message}`); close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { close(); process.exit(0); }));
}
module.exports = { createApp };
