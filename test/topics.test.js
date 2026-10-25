const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../database');
const { listTopics, addTopic, deleteTopic, listFeedback, topicStatistics } = require('../topics');
const { saveFeedback } = require('../analysis');
test('topic management, mismatch persistence, filters, historical statistics, and restart', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'topics-test-'));
  let db = openDatabase(directory);
  try {
    assert.equal(listTopics(db).length, 5);
    const housing = addTopic(db, '  Housing  ');
    assert.equal(housing.name, 'Housing');
    for (const value of ['', ' ', 'x'.repeat(81), null]) assert.throws(() => addTopic(db, value), { status: 400 });
    assert.throws(() => addTopic(db, 'housing'), { status: 409 });
    const analyzer = async (text, topics) => {
      assert.ok(topics.includes('Housing'));
      return { sentiment: 'Negative', language: 'English', intensity: 6, ai_detected_topic: 'Housing' };
    };
    await saveFeedback(db, { topic: 'Library', text: 'Dorm is cold' }, analyzer);
    await saveFeedback(db, { topic: 'Housing', text: 'Dorm needs heating' }, analyzer);
    assert.equal(listFeedback(db, 'Library')[0].ai_detected_topic, 'Housing');
    assert.equal(listFeedback(db, 'Housing').length, 1);
    assert.equal(listFeedback(db, "' OR 1=1 --").length, 0);
    assert.equal(listFeedback(db).length, 2);
    assert.deepEqual(topicStatistics(db).map(row => [row.topic, row.count]), [['Housing', 1], ['Library', 1]]);
    deleteTopic(db, housing.id);
    assert.equal(listFeedback(db, 'Housing').length, 1);
    assert.equal(topicStatistics(db).length, 2);
    assert.throws(() => deleteTopic(db, housing.id), { status: 404 });
    assert.throws(() => deleteTopic(db, NaN), { status: 400 });
    const library = listTopics(db).find(topic => topic.name === 'Library');
    deleteTopic(db, library.id);
    db.close(); db = openDatabase(directory);
    assert.ok(!listTopics(db).some(topic => topic.name === 'Library' || topic.name === 'Housing'));
    while (listTopics(db).length > 1) deleteTopic(db, listTopics(db)[0].id);
    assert.throws(() => deleteTopic(db, listTopics(db)[0].id), { status: 409 });
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
