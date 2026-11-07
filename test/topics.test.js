const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./postgres-helper');
const { listTopics, addTopic, deleteTopic, listFeedback, topicStatistics } = require('../topics');
const { saveFeedback } = require('../analysis');
test('PostgreSQL topic management, mismatch persistence, filters, and statistics', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  try {
    assert.equal((await listTopics(db)).length, 5);
    const housing = await addTopic(db, '  Housing  ');
    assert.equal(housing.name, 'Housing');
    for (const value of ['', ' ', 'x'.repeat(81), null]) await assert.rejects(addTopic(db, value), { status: 400 });
    await assert.rejects(addTopic(db, 'housing'), { status: 409 });
    const analyzer = async (text, topics) => {
      assert.ok(topics.includes('Housing'));
      return { sentiment: 'Negative', language: 'English', intensity: 6, ai_detected_topic: 'Housing' };
    };
    await saveFeedback(db, { topic: 'Library', text: 'Dorm is cold' }, analyzer);
    await saveFeedback(db, { topic: 'Housing', text: 'Dorm needs heating' }, analyzer);
    assert.equal((await listFeedback(db, 'Library'))[0].ai_detected_topic, 'Housing');
    assert.equal((await listFeedback(db, 'Housing')).length, 1);
    assert.equal((await listFeedback(db, "' OR 1=1 --")).length, 0);
    assert.equal((await listFeedback(db)).length, 2);
    assert.deepEqual((await topicStatistics(db)).map(row => [row.topic, row.count]), [['Housing', 1], ['Library', 1]]);
    await deleteTopic(db, housing.id);
    assert.equal((await listFeedback(db, 'Housing')).length, 1);
    assert.equal((await topicStatistics(db)).length, 2);
    await assert.rejects(deleteTopic(db, housing.id), { status: 404 });
    await assert.rejects(deleteTopic(db, NaN), { status: 400 });
    const library = (await listTopics(db)).find(topic => topic.name === 'Library');
    await deleteTopic(db, library.id);
    assert.ok(!(await listTopics(db)).some(topic => topic.name === 'Library' || topic.name === 'Housing'));
    while ((await listTopics(db)).length > 1) await deleteTopic(db, (await listTopics(db))[0].id);
    await assert.rejects(deleteTopic(db, (await listTopics(db))[0].id), { status: 409 });
  } catch (error) { throw error; }
});
