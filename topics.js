const DEFAULT_TOPICS = ['Academic Process', 'Library', 'Cafeteria', 'IT Services', 'Other'];
async function listTopics(db) {
  const result = await db.query('SELECT id, name FROM topics ORDER BY id');
  return result.rows;
}
async function addTopic(db, value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) {
    throw Object.assign(new Error('Enter a topic name between 1 and 80 characters.'), { status: 400 });
  }
  const name = value.trim();
  try {
    const result = await db.query('INSERT INTO topics (name) VALUES ($1) RETURNING id', [name]);
    return { id: result.rows[0].id, name };
  } catch (error) {
    if (error.code === '23505') throw Object.assign(new Error('This topic already exists.'), { status: 409 });
    throw error;
  }
}
async function deleteTopic(db, id) {
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error('Invalid topic ID.'), { status: 400 });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT id FROM topics WHERE id = $1 FOR UPDATE', [id]);
    if (!found.rowCount) throw Object.assign(new Error('Topic not found.'), { status: 404 });
    const count = await client.query('SELECT COUNT(*)::int AS count FROM topics');
    if (count.rows[0].count <= 1) throw Object.assign(new Error('Keep at least one topic available for students.'), { status: 409 });
    await client.query('DELETE FROM topics WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
async function listFeedback(db, topic) {
  const fields = 'topic, text, summary, submitted_at, sentiment, language, intensity, analysis_error, ai_detected_topic';
  const result = topic
    ? await db.query(`SELECT ${fields} FROM feedback WHERE topic = $1 ORDER BY id DESC`, [topic])
    : await db.query(`SELECT ${fields} FROM feedback ORDER BY id DESC`);
  return result.rows;
}
async function topicStatistics(db) {
  const result = await db.query('SELECT topic, COUNT(*)::int AS count FROM feedback GROUP BY topic ORDER BY count DESC, topic ASC');
  return result.rows;
}
async function weeklyReport(db, now = new Date()) {
  const end = now;
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const totalsResult = await db.query(`SELECT COUNT(*)::int AS "totalSubmissions",
      COUNT(*) FILTER (WHERE sentiment = 'Positive')::int AS positive,
      COUNT(*) FILTER (WHERE sentiment = 'Negative')::int AS negative,
      AVG(intensity) AS "averageIntensity"
    FROM feedback WHERE submitted_at >= $1 AND submitted_at <= $2`, [start, end]);
  const topTopicsResult = await db.query(`SELECT topic, COUNT(*)::int AS count FROM feedback
    WHERE submitted_at >= $1 AND submitted_at <= $2 GROUP BY topic
    ORDER BY count DESC, topic ASC LIMIT 3`, [start, end]);
  const totals = totalsResult.rows[0];
  const topTopics = topTopicsResult.rows;
  const averageIntensity = totals.averageIntensity == null ? null : Number(Number(totals.averageIntensity).toFixed(2));
  const report = {
    period: { start: start.toISOString(), end: end.toISOString() },
    totalSubmissions: totals.totalSubmissions,
    positive: totals.positive,
    negative: totals.negative,
    topTopics,
    averageIntensity
  };
  const periodLabel = `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)} UTC`;
  report.summary = [
    `Weekly Feedback Report (${periodLabel})`,
    `Total submissions: ${report.totalSubmissions}`,
    `Positive: ${report.positive}`,
    `Negative: ${report.negative}`,
    `Top topics: ${topTopics.length ? topTopics.map(item => `${item.topic} (${item.count})`).join(', ') : 'None'}`,
    `Average intensity: ${averageIntensity == null ? 'N/A' : `${averageIntensity} / 10`}`
  ].join('\n');
  return report;
}
module.exports = { DEFAULT_TOPICS, listTopics, addTopic, deleteTopic, listFeedback, topicStatistics, weeklyReport };
