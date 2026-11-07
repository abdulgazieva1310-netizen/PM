const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAnalyzer, saveFeedback, describeAnalysisError } = require('../analysis');
const { createTestDatabase } = require('./postgres-helper');
function fakeClient(response) {
  return { getGenerativeModel: () => ({ generateContent: async () => ({ response }) }) };
}
function completion(content, extra = {}) {
  return { candidates: [{ finishReason: 'STOP' }], text: () => content, ...extra };
}
test('Gemini request schema and valid analysis for all supported languages', async () => {
  for (const language of ['Kazakh', 'Russian', 'English']) {
    const expected = { sentiment: 'Negative', language, intensity: 6, ai_detected_topic: 'Library' };
    const client = { getGenerativeModel: (config, options) => {
      assert.equal(config.model, 'gemini-3.5-flash-lite');
      assert.equal(config.generationConfig.responseMimeType, 'application/json');
      assert.ok(config.generationConfig.responseSchema.properties.ai_detected_topic.enum.includes('Library'));
      assert.equal(options.timeout, 30000);
      assert.equal(config.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
      return { generateContent: async request => {
        assert.equal(request.contents[0].parts[0].text, 'so cold');
        return { response: completion(JSON.stringify(expected)) };
      } };
    } };
    assert.deepEqual(await createAnalyzer({ client })('so cold'), expected);
  }
});
test('rejects malformed JSON, invalid labels, intensity, safety blocks and truncation', async () => {
  for (const response of [
    completion('invalid json'), completion('{"sentiment":"Happy","language":"English","intensity":4}'),
    completion('{"sentiment":"Neutral","language":"English","intensity":11}'),
    completion('{"sentiment":"Neutral","language":"English","intensity":1.5}'),
    completion('{}', { candidates: [{ finishReason: 'MAX_TOKENS' }] }),
    completion('{}', { promptFeedback: { blockReason: 'SAFETY' } }),
    completion('{}', { candidates: [] })
  ]) await assert.rejects(createAnalyzer({ client: fakeClient(response) })('text'));
});
test('PostgreSQL schema initialization is repeatable and successful/failed analysis persists', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  try {
    await require('../database').initializeDatabase(db);
    const success = await saveFeedback(db, { topic: 'Library', text: 'so cold' }, async () => ({ sentiment: 'Negative', language: 'English', intensity: 6, ai_detected_topic: 'Library' }));
    assert.equal(success.analyzed, true);
    const failure = await saveFeedback(db, { topic: 'Other', text: 'Saved during outage' }, async () => { throw new Error('API timeout'); });
    assert.equal(failure.analyzed, false);
    assert.ok((await db.query('SELECT analysis_error FROM feedback WHERE id = $1', [failure.id])).rows[0].analysis_error);
    await require('../database').initializeDatabase(db);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM feedback')).rows[0].count, 2);
    const row = (await db.query('SELECT * FROM feedback WHERE id = $1', [success.id])).rows[0];
    assert.equal(row.ai_detected_topic, 'Library');
    assert.equal(row.sentiment, 'Negative'); assert.equal(row.intensity, 6); assert.equal(row.language, 'English');
    assert.ok(Number.isFinite(Date.parse(row.submitted_at)));
    assert.equal((await db.query('SELECT sentiment FROM feedback WHERE id = $1', [failure.id])).rows[0].sentiment, null);
  } catch (error) { throw error; }
});

test('diagnostic messages identify failures without echoing secrets or URLs', () => {
  const secret = 'private-test-key';
  const network = new Error(`Error fetching https://example.test?key=${secret}: fetch failed`);
  assert.match(describeAnalysisError(network), /Cannot connect/);
  assert.ok(!describeAnalysisError(network).includes(secret));
  assert.match(describeAnalysisError({ message: 'API key not valid' }), /key is invalid/);
  assert.match(describeAnalysisError({ status: 429 }), /quota/);
  assert.match(describeAnalysisError({ code: 'AI_TRUNCATED' }), /token limit/);
});

test('Gemini uses dynamic topic enum and rejects hallucinated topics', async () => {
  const topics = ['Housing', 'Transport'];
  const client = { getGenerativeModel: config => {
    assert.deepEqual(config.generationConfig.responseSchema.properties.ai_detected_topic.enum, topics);
    assert.ok(config.systemInstruction.includes('Housing'));
    return { generateContent: async () => ({ response: completion(JSON.stringify({ sentiment: 'Negative', language: 'English', intensity: 5, ai_detected_topic: 'Housing' })) }) };
  } };
  assert.equal((await createAnalyzer({ client })('Dorm room is cold', topics)).ai_detected_topic, 'Housing');
  await assert.rejects(createAnalyzer({ client: fakeClient(completion(JSON.stringify({ sentiment: 'Negative', language: 'English', intensity: 5, ai_detected_topic: 'Library' }))) })('text', topics));
});
