const { DatabaseSync: Database } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_TOPICS } = require('./topics');
function openDatabase(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const db = new Database(path.join(directory, 'database.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec(`CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY, topic TEXT NOT NULL, text TEXT NOT NULL, submitted_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  // Idempotent migration: existing submissions and administrator credentials remain intact.
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE)');
    if (!db.prepare("SELECT value FROM settings WHERE key = 'topics_initialized'").get()) {
      const insert = db.prepare('INSERT OR IGNORE INTO topics (name) VALUES (?)');
      for (const name of DEFAULT_TOPICS) insert.run(name);
      for (const row of db.prepare('SELECT DISTINCT topic FROM feedback').all()) insert.run(row.topic);
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('topics_initialized', '1');
    }
    const columns = new Set(db.prepare('PRAGMA table_info(feedback)').all().map(column => column.name));
    for (const [name, definition] of [
      ['sentiment', "TEXT CHECK (sentiment IN ('Positive', 'Negative', 'Neutral'))"],
      ['language', "TEXT CHECK (language IN ('Kazakh', 'Russian', 'English', 'Other', 'Unknown'))"],
      ['intensity', 'INTEGER CHECK (intensity BETWEEN 1 AND 10)'],
      ['analysis_error', 'TEXT'],
      ['ai_detected_topic', 'TEXT']
    ]) {
      if (!columns.has(name)) db.exec(`ALTER TABLE feedback ADD COLUMN ${name} ${definition}`);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  if (!db.prepare('SELECT id FROM admins LIMIT 1').get()) {
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(process.env.ADMIN_USERNAME || 'admin', bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 12));
  }
  return db;
}
module.exports = { openDatabase };
