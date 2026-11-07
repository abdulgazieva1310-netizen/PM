const { randomUUID } = require('node:crypto');
const { Client, Pool } = require('pg');
const { initializeDatabase } = require('../database');

async function createTestDatabase() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('Set TEST_DATABASE_URL to a dedicated PostgreSQL test database.');
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ connectionString });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new Pool({ connectionString, options: `-c search_path=${schema}` });
  await initializeDatabase(db);
  return {
    db,
    async close() {
      await db.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  };
}

module.exports = { createTestDatabase };
