const DEFAULT_TOPICS = ['Academic Process', 'Library', 'Cafeteria', 'IT Services', 'Other'];
function listTopics(db) { return db.prepare('SELECT id, name FROM topics ORDER BY id').all(); }
function addTopic(db, value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) {
    throw Object.assign(new Error('Enter a topic name between 1 and 80 characters.'), { status: 400 });
  }
  const name = value.trim();
  if (listTopics(db).some(topic => topic.name.toLowerCase() === name.toLowerCase())) {
    throw Object.assign(new Error('This topic already exists.'), { status: 409 });
  }
  const result = db.prepare('INSERT INTO topics (name) VALUES (?)').run(name);
  return { id: Number(result.lastInsertRowid), name };
}
function deleteTopic(db, id) {
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error('Invalid topic ID.'), { status: 400 });
  if (!db.prepare('SELECT id FROM topics WHERE id = ?').get(id)) throw Object.assign(new Error('Topic not found.'), { status: 404 });
  if (listTopics(db).length <= 1) throw Object.assign(new Error('Keep at least one topic available for students.'), { status: 409 });
  db.prepare('DELETE FROM topics WHERE id = ?').run(id);
}
function listFeedback(db, topic) {
  const fields = 'topic, text, submitted_at, sentiment, language, intensity, analysis_error, ai_detected_topic';
  return topic ? db.prepare(`SELECT ${fields} FROM feedback WHERE topic = ? ORDER BY id DESC`).all(topic)
    : db.prepare(`SELECT ${fields} FROM feedback ORDER BY id DESC`).all();
}
function topicStatistics(db) {
  return db.prepare('SELECT topic, COUNT(*) AS count FROM feedback GROUP BY topic ORDER BY count DESC, topic ASC').all();
}
module.exports = { DEFAULT_TOPICS, listTopics, addTopic, deleteTopic, listFeedback, topicStatistics };
