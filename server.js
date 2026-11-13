require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { openDatabase } = require('./database');
const { createAnalyzer, createKeyIssueAnalyzer, saveFeedback, describeAnalysisError } = require('./analysis');
const { listTopics, addTopic, deleteTopic, listFeedback, topicStatistics, weeklyReport } = require('./topics');
class PostgresSessionStore extends session.Store {
  constructor(db) { super(); this.db = db; }
  get(sid, cb) {
    this.db.query('SELECT data FROM sessions WHERE sid = $1 AND expires > $2', [sid, Date.now()])
      .then(result => cb(null, result.rows[0]?.data || null)).catch(cb);
  }
  set(sid, value, cb) {
    const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + (value.cookie?.maxAge || 8 * 60 * 60 * 1000);
    this.db.query('INSERT INTO sessions (sid, data, expires) VALUES ($1, $2::jsonb, $3) ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires = EXCLUDED.expires', [sid, JSON.stringify(value), expires])
      .then(() => cb?.(null)).catch(error => cb?.(error));
  }
  destroy(sid, cb) {
    this.db.query('DELETE FROM sessions WHERE sid = $1', [sid]).then(() => cb?.(null)).catch(error => cb?.(error));
  }
  touch(sid, value, cb) { this.set(sid, value, cb); }
}
async function createApp({ databaseUrl = process.env.DATABASE_URL, db: suppliedDb, analyze = createAnalyzer(), analyzeKeyIssues = createKeyIssueAnalyzer() } = {}) {
  const production = process.env.NODE_ENV === 'production';
  if (production && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
  const db = suppliedDb || await openDatabase(databaseUrl);
  const ownsDb = !suppliedDb;
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    secret = (await db.query("SELECT value FROM settings WHERE key = 'session_secret'")).rows[0]?.value;
    if (!secret) {
      secret = randomBytes(48).toString('hex');
      await db.query("INSERT INTO settings (key, value) VALUES ('session_secret', $1) ON CONFLICT (key) DO NOTHING", [secret]);
      secret = (await db.query("SELECT value FROM settings WHERE key = 'session_secret'")).rows[0].value;
    }
  }
  const store = new PostgresSessionStore(db);
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'] } } }));
  app.use(express.json({ limit: '32kb' }));
  app.use(session({ store, secret, name: 'feedback.sid', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'strict', secure: production, maxAge: 8 * 60 * 60 * 1000 } }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (['POST', 'DELETE'].includes(req.method) && req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Send JSON data.' });
    next();
  });
  const requireAdmin = (req, res, next) => req.session.adminId ? next() : res.status(401).json({ error: 'Please log in.' });
  app.get('/api/topics', async (req, res) => res.json(await listTopics(db)));
  app.post('/api/topics', requireAdmin, async (req, res) => {
    try { res.status(201).json(await addTopic(db, req.body?.name)); }
    catch (error) { if (!error.status) throw error; res.status(error.status).json({ error: error.message }); }
  });
  app.delete('/api/topics/:id', requireAdmin, async (req, res) => {
    try { await deleteTopic(db, Number(req.params.id)); res.json({ success: true }); }
    catch (error) { if (!error.status) throw error; res.status(error.status).json({ error: error.message }); }
  });
  app.get('/api/statistics/topics', requireAdmin, async (req, res) => res.json(await topicStatistics(db)));
  app.get('/api/admin/trends', requireAdmin, async (req, res, next) => {
    try {
      const days = req.query.days === undefined ? 7 : Number(req.query.days);
      if (![7, 30, 90].includes(days)) return res.status(400).json({ error: 'Choose a timeframe of 7, 30, or 90 days.' });
      const result = await db.query(`WITH bounds AS (
          SELECT (NOW() AT TIME ZONE 'UTC')::date - ($1::int - 1) AS start_date,
            (NOW() AT TIME ZONE 'UTC')::date AS end_date
        ), dates AS (
          SELECT series.day::date AS date FROM bounds,
            generate_series(bounds.start_date::timestamp, bounds.end_date::timestamp, INTERVAL '1 day') AS series(day)
        ), counts AS (
          SELECT (feedback.submitted_at AT TIME ZONE 'UTC')::date AS date,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE sentiment = 'Positive')::int AS positive,
            COUNT(*) FILTER (WHERE sentiment = 'Negative')::int AS negative,
            COUNT(*) FILTER (WHERE sentiment = 'Neutral')::int AS neutral
          FROM feedback CROSS JOIN bounds
          WHERE feedback.submitted_at >= (bounds.start_date::timestamp AT TIME ZONE 'UTC')
            AND feedback.submitted_at < ((bounds.end_date + 1)::timestamp AT TIME ZONE 'UTC')
          GROUP BY (feedback.submitted_at AT TIME ZONE 'UTC')::date
        )
        SELECT to_char(dates.date, 'YYYY-MM-DD') AS date, COALESCE(counts.total, 0)::int AS total,
          COALESCE(counts.positive, 0)::int AS positive,
          COALESCE(counts.negative, 0)::int AS negative,
          COALESCE(counts.neutral, 0)::int AS neutral
        FROM dates LEFT JOIN counts USING (date) ORDER BY dates.date`, [days]);
      const data = result.rows.map(row => ({ date: row.date, total: row.total, positive: row.positive, negative: row.negative, neutral: row.neutral }));
      res.json({ days, period: { start: data[0]?.date, end: data.at(-1)?.date }, data });
    } catch (error) { next(error); }
  });
  app.get('/api/admin/key-issues', requireAdmin, async (req, res, next) => {
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      const result = await db.query('SELECT text FROM feedback WHERE submitted_at >= $1 AND submitted_at <= $2 ORDER BY submitted_at DESC LIMIT 100', [start, end]);
      const feedbacks = result.rows.map((item, index) => ({ id: index + 1, text: item.text.slice(0, 1000) }));
      let issues = [];
      if (feedbacks.length) {
        try { issues = await analyzeKeyIssues(feedbacks); }
        catch (error) { return res.status(503).json({ error: describeAnalysisError(error) }); }
      }
      res.json({ period: { start: start.toISOString(), end: end.toISOString() }, feedbackCount: feedbacks.length, issues });
    } catch (error) { next(error); }
  });
  app.get('/api/admin/weekly-report', requireAdmin, async (req, res) => res.json(await weeklyReport(db)));
  app.get('/api/admin/weekly-report/pdf', requireAdmin, async (req, res, next) => {
    try {
      const report = await weeklyReport(db);
      const doc = new PDFDocument({ size: 'A4', margin: 52, info: { Title: 'Weekly Feedback Report', Author: 'Campus Voice' } });
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="weekly-feedback-report.pdf"' });
      doc.on('error', next);
      doc.pipe(res);
      doc.rect(0, 0, doc.page.width, 145).fill('#173c37');
      doc.circle(80, 67, 28).fill('#dff2e8');
      doc.fillColor('#173c37').font('Helvetica-Bold').fontSize(17).text('CV', 64, 59, { width: 32, align: 'center' });
      doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold').text('CAMPUS VOICE  /  ADMINISTRATOR REPORT', 125, 44);
      doc.fontSize(25).text('Weekly Feedback Report', 125, 65);
      doc.fillColor('#d4e5dc').fontSize(11).font('Helvetica').text(`${report.period.start.slice(0, 10)} – ${report.period.end.slice(0, 10)} (UTC)`, 125, 103);
      doc.moveDown(4).fillColor('#173c37').font('Helvetica-Bold').fontSize(15).text('Weekly statistics');
      const stats = [
        ['Total submissions', String(report.totalSubmissions)],
        ['Positive feedback', String(report.positive)],
        ['Negative feedback', String(report.negative)],
        ['Average intensity', report.averageIntensity == null ? 'N/A' : `${report.averageIntensity} / 10`]
      ];
      let y = doc.y + 14;
      stats.forEach(([label, value], index) => {
        const x = 52 + (index % 2) * 252;
        const rowY = y + Math.floor(index / 2) * 66;
        doc.roundedRect(x, rowY, 236, 52, 8).fill(index % 2 ? '#f1f6f2' : '#e8f2eb');
        doc.fillColor('#60736c').font('Helvetica').fontSize(9).text(label.toUpperCase(), x + 14, rowY + 10);
        doc.fillColor('#173c37').font('Helvetica-Bold').fontSize(17).text(value, x + 14, rowY + 25);
      });
      y += 154;
      doc.fillColor('#173c37').font('Helvetica-Bold').fontSize(15).text('Top topics', 52, y);
      y = doc.y + 14;
      if (!report.topTopics.length) doc.fillColor('#60736c').font('Helvetica').fontSize(11).text('No submissions in this period.', 52, y);
      report.topTopics.forEach((item, index) => {
        const rowY = y + index * 34;
        doc.roundedRect(52, rowY, 488, 27, 5).fill(index % 2 ? '#f6f8f5' : '#edf3ee');
        doc.fillColor('#173c37').font('Helvetica').fontSize(11).text(item.topic, 64, rowY + 8, { width: 380 });
        doc.fillColor('#276b56').font('Helvetica-Bold').text(String(item.count), 462, rowY + 8, { width: 64, align: 'right' });
      });
      doc.end();
    } catch (error) { next(error); }
  });
  app.get('/api/admin/weekly-report/excel', requireAdmin, async (req, res, next) => {
    try {
      const report = await weeklyReport(db);
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Campus Voice';
      workbook.created = new Date();
      const sheet = workbook.addWorksheet('Weekly Report', { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.columns = [{ header: 'Metric', key: 'metric', width: 30 }, { header: 'Value', key: 'value', width: 38 }];
      sheet.addRows([
        { metric: 'Report period (UTC)', value: `${report.period.start.slice(0, 10)} to ${report.period.end.slice(0, 10)}` },
        { metric: 'Total submissions', value: report.totalSubmissions },
        { metric: 'Positive feedback', value: report.positive },
        { metric: 'Negative feedback', value: report.negative },
        { metric: 'Average intensity', value: report.averageIntensity == null ? 'N/A' : `${report.averageIntensity} / 10` },
        { metric: '', value: '' },
        { metric: 'Top topics', value: 'Submissions' },
        ...report.topTopics.map(item => ({ metric: item.topic, value: item.count }))
      ]);
      sheet.getRow(1).height = 24;
      sheet.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173C37' } }; });
      sheet.getRow(8).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF276B56' } }; });
      sheet.eachRow((row, number) => { if (number > 1 && number !== 8 && number % 2 === 0) row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F6F2' } }; }); });
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="weekly-feedback-report.xlsx"' });
      res.send(await workbook.xlsx.writeBuffer());
    } catch (error) { next(error); }
  });
  app.post('/api/feedback', rateLimit({ windowMs: 60000, limit: 20, legacyHeaders: false, message: { error: 'Too many submissions. Please try again in a minute.' } }), async (req, res) => {
    const { topic, text } = req.body || {};
    if (!(await listTopics(db)).some(item => item.name === topic) || typeof text !== 'string' || !text.trim() || text.trim().length > 5000) return res.status(400).json({ error: 'Choose a valid topic and enter feedback between 1 and 5,000 characters.' });
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
      const admin = (await db.query('SELECT * FROM admins WHERE username = $1', [username])).rows[0];
      const valid = await bcrypt.compare(password, admin?.password_hash || dummyHash);
      if (!admin || !valid) return res.status(401).json({ error: 'Invalid username or password.' });
      req.session.regenerate(error => {
        if (error) return next(error);
        req.session.adminId = admin.id;
        req.session.save(error => error ? next(error) : res.json({ success: true }));
      });
    } catch(e) { next(e); }
  });
  app.get('/api/feedback', requireAdmin, async (req, res) => {
    if (req.query.topic !== undefined && (typeof req.query.topic !== 'string' || req.query.topic.length > 80)) return res.status(400).json({ error: 'Invalid topic filter.' });
    res.json(await listFeedback(db, req.query.topic));
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
  return { app, close() { return ownsDb ? db.end() : Promise.resolve(); } };
}
if (require.main === module) {
  createApp().then(({ app, close }) => {
    const server = app.listen(process.env.PORT || 3000, () => console.log(`Student feedback app: http://localhost:${process.env.PORT || 3000}`));
    server.on('error', error => { console.error(`Cannot start server: ${error.message}`); close(); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => close().finally(() => process.exit(0))));
  }).catch(error => { console.error(`Cannot start server: ${error.message}`); process.exitCode = 1; });
}
module.exports = { createApp };
