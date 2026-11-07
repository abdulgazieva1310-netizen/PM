const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../server');
const { createTestDatabase } = require('./postgres-helper');
test('submission validation, protected admin flow, persistence and logout', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const { db, close } = await createTestDatabase();
  let instance = await createApp({ db, analyze: async () => ({ sentiment: 'Positive', language: 'English', intensity: 4, ai_detected_topic: 'Library' }) });
  t.after(async () => { await instance?.close(); await close(); });
  try {
    await request(instance.app).get('/').expect(200);
    await request(instance.app).get('/vendor/bootstrap/bootstrap.min.css').expect(200);
    await request(instance.app).get('/admin').expect(302).expect('Location', '/login.html');
    await request(instance.app).get('/api/feedback').expect(401);
    await request(instance.app).post('/api/topics').send({ name: 'Housing' }).expect(401);
    await request(instance.app).delete('/api/topics/1').expect(401);
    await request(instance.app).get('/api/statistics/topics').expect(401);
    const topics = await request(instance.app).get('/api/topics').expect(200);
    assert.equal(topics.body.length, 5);
    await request(instance.app).get('/private/dashboard.html').expect(404);
    await request(instance.app).get('/data/database.db').expect(404);
    for (const body of [{ text: 'Missing topic' }, { topic: 'Library', text: '   ' }, { topic: 'Invalid', text: 'Hello' }, { topic: 'Other', text: 'x'.repeat(5001) }]) {
      await request(instance.app).post('/api/feedback').send(body).expect(400);
    }
    await request(instance.app).post('/api/feedback').set('Sec-Fetch-Site', 'cross-site').send({ topic: 'Other', text: 'test' }).expect(403);
    const text = "The library is helpful. <script>alert('x')</script>";
    await request(instance.app).post('/api/feedback').send({ topic: 'Library', text }).expect(201);
    await request(instance.app).post('/api/login').send({ username: 'admin', password: 'wrong' }).expect(401);
    const login = await request(instance.app).post('/api/login').send({ username: 'admin', password: 'admin123' }).expect(200);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    assert.match(login.headers['set-cookie'][0], /HttpOnly/);
    assert.match(login.headers['set-cookie'][0], /SameSite=Strict/);
    await request(instance.app).get('/admin').set('Cookie', cookie).expect(200);
    const added = await request(instance.app).post('/api/topics').set('Cookie', cookie).send({ name: 'Housing' }).expect(201);
    await request(instance.app).post('/api/topics').set('Cookie', cookie).send({ name: 'housing' }).expect(409);
    const filtered = await request(instance.app).get('/api/feedback?topic=Library').set('Cookie', cookie).expect(200);
    assert.equal(filtered.body.length, 1);
    const empty = await request(instance.app).get('/api/feedback?topic=Housing').set('Cookie', cookie).expect(200);
    assert.equal(empty.body.length, 0);
    const stats = await request(instance.app).get('/api/statistics/topics').set('Cookie', cookie).expect(200);
    assert.equal(stats.body[0].topic, 'Library'); assert.equal(stats.body[0].count, 1);
    await request(instance.app).delete(`/api/topics/${added.body.id}`).set('Cookie', cookie).expect(200);
    await request(instance.app).post('/api/feedback').send({ topic: 'Housing', text: 'Deleted topic' }).expect(400);
    instance = await createApp({ db, analyze: async () => ({ sentiment: 'Positive', language: 'English', intensity: 4, ai_detected_topic: 'Library' }) });
    const response = await request(instance.app).get('/api/feedback').set('Cookie', cookie).expect(200);
    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].text, text);
    assert.equal(response.body[0].topic, 'Library');
    assert.equal(response.body[0].sentiment, 'Positive');
    assert.equal(response.body[0].language, 'English');
    assert.equal(response.body[0].intensity, 4);
    assert.ok(Number.isFinite(Date.parse(response.body[0].submitted_at)));
    await request(instance.app).post('/api/logout').set('Cookie', cookie).send({}).expect(200);
    await request(instance.app).get('/api/feedback').set('Cookie', cookie).expect(401);
  } finally { await instance.close(); }
});
