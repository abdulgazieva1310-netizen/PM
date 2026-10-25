const message = document.querySelector('#message');
const refresh = document.querySelector('#refresh');
const topicFilter = document.querySelector('#topic-filter');
const topicMessage = document.querySelector('#topic-message');
async function api(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) { window.location.replace('/login.html'); throw new Error('Please log in.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function showTopicMessage(text, error = false) {
  topicMessage.hidden = false; topicMessage.className = `alert alert-${error ? 'danger' : 'success'}`; topicMessage.textContent = text;
}
async function loadTopicsAndStatistics() {
  const [topics, statistics] = await Promise.all([api('/api/topics'), api('/api/statistics/topics')]);
  const selected = topicFilter.value;
  const names = new Set([...topics.map(topic => topic.name), ...statistics.map(item => item.topic)]);
  topicFilter.replaceChildren(new Option('All topics', ''));
  for (const name of names) topicFilter.add(new Option(name, name));
  topicFilter.value = names.has(selected) ? selected : '';
  const list = document.querySelector('#topic-list'); list.replaceChildren();
  for (const topic of topics) {
    const item = document.createElement('li'); item.className = 'list-group-item d-flex justify-content-between align-items-center gap-2';
    const name = document.createElement('span'); name.textContent = topic.name;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-outline-danger btn-sm'; button.textContent = 'Delete'; button.setAttribute('aria-label', `Delete topic ${topic.name}`);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await api(`/api/topics/${topic.id}`, { method: 'DELETE' }); showTopicMessage(`Deleted “${topic.name}”. Existing feedback was preserved.`); await loadFeedback(); }
      catch (error) { showTopicMessage(error.message, true); button.disabled = false; }
    });
    item.append(name, button); list.append(item);
  }
  const chart = document.querySelector('#topic-statistics'); chart.replaceChildren();
  const maximum = Math.max(1, ...statistics.map(item => item.count));
  for (const item of statistics) {
    const row = document.createElement('li');
    const label = document.createElement('div'); label.textContent = `${item.topic} (${item.count})`;
    const bar = document.createElement('meter'); bar.min = 0; bar.max = maximum; bar.value = item.count; bar.setAttribute('aria-label', `${item.topic}: ${item.count} submissions`);
    row.append(label, bar); chart.append(row);
  }
  if (!statistics.length) { const empty = document.createElement('li'); empty.textContent = 'No feedback yet.'; chart.append(empty); }
  return topics;
}

async function loadFeedback() {
  refresh.disabled = true; topicFilter.disabled = true; message.hidden = false; message.className = 'm-3 text-secondary'; message.textContent = 'Loading feedback…';
  try {
    await loadTopicsAndStatistics();
    const [allData, data] = await Promise.all([
      api('/api/feedback'),
      api(`/api/feedback${topicFilter.value ? `?topic=${encodeURIComponent(topicFilter.value)}` : ''}`)
    ]);
    document.querySelector('#row-count').textContent = `${data.length} matching submissions`;
    const rows = document.querySelector('#feedback-rows'); rows.replaceChildren();
    document.querySelector('#total').textContent = allData.length.toLocaleString();
    for (const sentiment of ['Positive', 'Negative', 'Neutral']) {
      document.querySelector(`#${sentiment.toLowerCase()}`).textContent = allData.filter(item => item.sentiment === sentiment).length.toLocaleString();
    }
    const unanalyzed = allData.filter(item => item.sentiment == null).length;
    document.querySelector('#analysis-note').textContent = `${unanalyzed} submission(s) not analyzed. Existing or unavailable analyses are excluded from sentiment counts. AI estimates may be imperfect. Intensity: 1 (mild) to 10 (strong).`;
    for (const item of data) {
      const row = document.createElement('tr');
      const values = [item.topic, item.ai_detected_topic || 'Not analyzed', item.text, item.sentiment || 'Not analyzed', item.language || '—', item.intensity == null ? '—' : `${item.intensity} / 10`, new Date(item.submitted_at).toLocaleString()];
      values.forEach((value, index) => {
        const cell = document.createElement('td');
        if (index === 3 && ['Positive', 'Negative', 'Neutral'].includes(item.sentiment)) {
          const badge = document.createElement('span');
          badge.className = `sentiment-badge sentiment-${item.sentiment.toLowerCase()}`;
          badge.textContent = value; cell.append(badge);
        } else { cell.textContent = value; }
        if (index === 3 && !item.sentiment && item.analysis_error) {
          const reason = document.createElement('small');
          reason.className = 'd-block text-danger mt-2';
          reason.textContent = item.analysis_error;
          cell.append(reason);
        }
        if (index === 1 && item.ai_detected_topic && item.ai_detected_topic !== item.topic) {
          const flag = document.createElement('small'); flag.className = 'd-block text-warning-emphasis mt-2'; flag.textContent = 'Differs from student selection'; cell.append(flag);
        }
        row.append(cell);
      });
      rows.append(row);
    }
    message.textContent = 'No feedback matches this filter.'; message.hidden = data.length > 0;
  } catch(error) { message.className = 'm-3 alert alert-danger'; message.textContent = error.message || 'Could not load feedback. Please refresh.'; }
  finally { refresh.disabled = false; topicFilter.disabled = false; }
}
refresh.addEventListener('click', loadFeedback);
topicFilter.addEventListener('change', loadFeedback);
document.querySelector('#topic-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = document.querySelector('#topic-name'); const button = document.querySelector('#add-topic'); button.disabled = true;
  try {
    await api('/api/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.value }) });
    input.value = ''; showTopicMessage('Topic added. It is now available on the student form.'); await loadFeedback();
  } catch (error) { showTopicMessage(error.message, true); }
  finally { button.disabled = false; }
});
document.querySelector('#logout').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok && response.status !== 401) throw new Error('Could not sign out. Please try again.');
    window.location.replace('/login.html');
  } catch(error) { message.hidden = false; message.className = 'm-3 alert alert-danger'; message.textContent = error.message; }
});
loadFeedback();
