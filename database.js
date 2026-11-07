const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_TOPICS } = require('./topics');
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin123';

async function initializeDatabase(pool, { seedAdmin = true } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    await client.query(`
      ALTER TABLE feedback ADD COLUMN IF NOT EXISTS sentiment TEXT CHECK (sentiment IN ('Positive', 'Negative', 'Neutral'));
      ALTER TABLE feedback ADD COLUMN IF NOT EXISTS language TEXT CHECK (language IN ('Kazakh', 'Russian', 'English', 'Other', 'Unknown'));
      ALTER TABLE feedback ADD COLUMN IF NOT EXISTS intensity INTEGER CHECK (intensity BETWEEN 1 AND 10);
      ALTER TABLE feedback ADD COLUMN IF NOT EXISTS analysis_error TEXT;
      ALTER TABLE feedback ADD COLUMN IF NOT EXISTS ai_detected_topic TEXT;
      ALTER TABLE feedback ADD COLUMN IF NOT EXISTS summary TEXT;
    `);

    const initialized = await client.query("SELECT value FROM settings WHERE key = 'topics_initialized'");
    if (!initialized.rowCount) {
      for (const name of DEFAULT_TOPICS) {
        await client.query('INSERT INTO topics (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
      }
      const oldTopics = await client.query('SELECT DISTINCT topic FROM feedback');
      for (const row of oldTopics.rows) {
        await client.query('INSERT INTO topics (name) VALUES ($1) ON CONFLICT DO NOTHING', [row.topic]);
      }
      await client.query("INSERT INTO settings (key, value) VALUES ('topics_initialized', '1') ON CONFLICT DO NOTHING");
    }

    if (seedAdmin) {
      // Serialize startup seeding across Render instances so an empty table
      // cannot race into multiple administrator rows.
      await client.query('SELECT pg_advisory_xact_lock(781234567890::bigint)');
      const admin = await client.query('SELECT id FROM admins LIMIT 1');
      if (!admin.rowCount) {
        await client.query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', [
          DEFAULT_ADMIN_USERNAME,
          bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 12)
        ]);
        console.info('Created default administrator account because the admins table was empty.');
      }
    }
    await client.query('DELETE FROM sessions WHERE expires < $1', [Date.now()]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function openDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString?.trim()) throw new Error('DATABASE_URL is required to connect to PostgreSQL.');
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  try {
    await initializeDatabase(pool);
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}

module.exports = { openDatabase, initializeDatabase, DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD };
