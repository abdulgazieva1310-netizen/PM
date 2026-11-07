require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');
const { initializeDatabase, DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD } = require('../database');

async function migrate() {
  const sqlitePath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'database.db');
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the target PostgreSQL database.');
  if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite database not found: ${sqlitePath}`);

  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await initializeDatabase(pool, { seedAdmin: false });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tables = new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
      if (tables.has('admins')) {
        for (const admin of sqlite.prepare('SELECT id, username, password_hash FROM admins').all()) {
          await client.query('INSERT INTO admins (id, username, password_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [admin.id, admin.username, admin.password_hash]);
        }
      }
      if (tables.has('settings')) {
        for (const setting of sqlite.prepare('SELECT key, value FROM settings').all()) {
          await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [setting.key, setting.value]);
        }
      }
      if (tables.has('topics')) {
        for (const topic of sqlite.prepare('SELECT id, name FROM topics').all()) {
          await client.query('INSERT INTO topics (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [topic.id, topic.name]);
        }
      }
      if (tables.has('feedback')) {
        const columns = new Set(sqlite.prepare('PRAGMA table_info(feedback)').all().map(column => column.name));
        const fields = ['id', 'topic', 'text', 'submitted_at', 'sentiment', 'language', 'intensity', 'analysis_error', 'ai_detected_topic', 'summary'];
        const available = fields.filter(field => columns.has(field));
        const rows = sqlite.prepare(`SELECT ${available.map(field => `"${field}"`).join(', ')} FROM feedback ORDER BY id`).all();
        for (const row of rows) {
          const value = field => row[field] ?? null;
          await client.query(`INSERT INTO feedback (${fields.join(', ')}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`, fields.map(value));
        }
      }
      for (const table of ['admins', 'topics', 'feedback']) {
        await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), EXISTS (SELECT 1 FROM ${table}))`);
      }
      const admin = await client.query('SELECT id FROM admins LIMIT 1');
      if (!admin.rowCount) {
        await client.query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', [
          DEFAULT_ADMIN_USERNAME, bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 12)
        ]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    console.log(`SQLite records imported from ${sqlitePath}. Existing PostgreSQL rows were preserved.`);
  } finally {
    sqlite.close();
    await pool.end();
  }
}

migrate().catch(error => {
  console.error(`SQLite import failed: ${error.message}`);
  process.exitCode = 1;
});
