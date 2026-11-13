const message = document.querySelector('#message');
const refresh = document.querySelector('#refresh');
const topicFilter = document.querySelector('#topic-filter');
const topicMessage = document.querySelector('#topic-message');
const keyIssuesList = document.querySelector('#key-issues-list');
const keyIssuesPeriod = document.querySelector('#key-issues-period');
const keyIssuesRefresh = document.querySelector('#key-issues-refresh');
const weeklyReportButton = document.querySelector('#weekly-report');
const weeklyReportDialog = document.querySelector('#weekly-report-dialog');
const weeklyReportStatus = document.querySelector('#weekly-report-status');
const weeklyReportMetrics = document.querySelector('#weekly-report-metrics');
const weeklyReportSentiment = document.querySelector('#weekly-report-sentiment');
const weeklyReportTopics = document.querySelector('#weekly-report-topics');
const weeklyReportDownloads = [...document.querySelectorAll('#weekly-report-pdf, #weekly-report-excel, #weekly-report-csv')];
const trendTimeframe = document.querySelector('#trend-timeframe');
const trendStatus = document.querySelector('#trend-status');
const adminAlertBanner = document.querySelector('#admin-alert-banner');
const adminAlertList = document.querySelector('#admin-alert-list');
let trendsChart = null;
const trendsCache = new Map();
let currentWeeklyReport = null;
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
      const values = [item.topic, item.ai_detected_topic || 'Not analyzed', item.summary || item.text, item.text, item.sentiment || 'Not analyzed', item.language || '—', item.intensity == null ? '—' : `${item.intensity} / 10`, new Date(item.submitted_at).toLocaleString()];
      values.forEach((value, index) => {
        const cell = document.createElement('td');
        if (index === 2) {
          const summary = document.createElement('small');
          summary.className = 'text-secondary fst-italic';
          summary.textContent = value;
          cell.append(summary);
        } else if (index === 4 && ['Positive', 'Negative', 'Neutral'].includes(item.sentiment)) {
          const badge = document.createElement('span');
          badge.className = `sentiment-badge sentiment-${item.sentiment.toLowerCase()}`;
          badge.textContent = value; cell.append(badge);
        } else if (index === 4 && !item.sentiment) {
          cell.textContent = value;
          if (item.analysis_error) {
            const reason = document.createElement('small');
            reason.className = 'd-block text-danger mt-2';
            reason.textContent = item.analysis_error;
            cell.append(reason);
          }
          const retry = document.createElement('button');
          retry.type = 'button'; retry.className = 'btn btn-outline-primary btn-sm mt-2'; retry.textContent = 'Re-analyze';
          retry.setAttribute('aria-label', `Re-analyze feedback ${item.id}`);
          retry.addEventListener('click', async () => {
            retry.disabled = true; retry.textContent = 'Analyzing…';
            try {
              await api(`/api/admin/feedback/${item.id}/reanalyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
              await loadFeedback();
            } catch (error) {
              const failure = document.createElement('small');
              failure.className = 'd-block text-danger mt-2';
              failure.textContent = error.message || 'Could not re-analyze this feedback.';
              cell.append(failure);
              retry.disabled = false; retry.textContent = 'Retry analysis';
            }
          });
          cell.append(retry);
        } else { cell.textContent = value; }
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
async function loadTrends() {
  const days = Number(trendTimeframe.value);
  trendTimeframe.disabled = true;
  trendStatus.textContent = trendsCache.has(days) ? 'Updating chart…' : 'Loading trends…';
  try {
    let result = trendsCache.get(days);
    if (!result) {
      result = await api(`/api/admin/trends?days=${days}`);
      trendsCache.set(days, result);
    }
    if (!window.Chart) throw new Error('The chart library could not be loaded. Refresh the page to try again.');
    const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
    const labels = result.data.map(item => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(item.date).slice(0, 10));
      if (!match) return '—';
      const [, year, month, day] = match;
      return dateLabel.format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
    });
    const configuration = {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Positive', data: result.data.map(item => item.positive), borderColor: '#266b56', backgroundColor: '#266b56', tension: 0.3 },
        { label: 'Negative', data: result.data.map(item => item.negative), borderColor: '#ae4848', backgroundColor: '#ae4848', tension: 0.3 },
        { label: 'Neutral', data: result.data.map(item => Number(item.neutral ?? 0)), borderColor: '#697784', backgroundColor: '#697784', borderWidth: 2, borderDash: [5, 4], pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: '#697784', tension: 0.3 }
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' }, scales: { x: { type: 'category', ticks: { autoSkip: true, maxTicksLimit: result.days === 7 ? 7 : result.days === 30 ? 15 : 12 } }, y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } } }
    };
    if (trendsChart) { trendsChart.data = configuration.data; trendsChart.options = configuration.options; trendsChart.update(); }
    else trendsChart = new Chart(document.querySelector('#feedback-trends-chart'), configuration);
    trendStatus.textContent = `${result.period.start} – ${result.period.end} UTC · ${result.data.reduce((sum, item) => sum + item.total, 0).toLocaleString()} total submissions`;
  } catch (error) { trendStatus.textContent = error.message || 'Could not load feedback trends.'; }
  finally { trendTimeframe.disabled = false; }
}
trendTimeframe.addEventListener('change', loadTrends);
loadTrends();
async function loadAdminAlerts() {
  try {
    const alerts = await api('/api/admin/alerts');
    adminAlertList.replaceChildren();
    if (!alerts.length) { adminAlertBanner.hidden = true; return; }
    for (const alert of alerts) {
      const item = document.createElement('li');
      item.textContent = alert.message;
      adminAlertList.append(item);
    }
    adminAlertBanner.hidden = false;
  } catch (error) {
    adminAlertBanner.hidden = true;
    console.error('Could not load administrator alerts:', error);
  }
}
document.querySelector('#admin-alert-dismiss').addEventListener('click', () => { adminAlertBanner.hidden = true; });
loadAdminAlerts();
function closeWeeklyReport() { weeklyReportDialog.close(); }
function addMetricCard(container, label, value, icon, tone) {
  const card = document.createElement('article'); card.className = `weekly-metric-card ${tone}`;
  const iconBox = document.createElement('span'); iconBox.className = 'weekly-metric-icon'; iconBox.setAttribute('aria-hidden', 'true'); iconBox.innerHTML = icon;
  const name = document.createElement('span'); name.className = 'weekly-metric-label'; name.textContent = label;
  const number = document.createElement('strong'); number.className = 'weekly-metric-value'; number.textContent = value;
  card.append(iconBox, name, number); container.append(card);
}
function addChartBar(container, label, value, maximum, tone) {
  const row = document.createElement('li'); row.className = 'weekly-chart-row';
  const heading = document.createElement('div'); heading.className = 'weekly-chart-label';
  const name = document.createElement('span'); name.textContent = label;
  const count = document.createElement('strong'); count.textContent = value.toLocaleString();
  heading.append(name, count);
  const track = document.createElement('div'); track.className = 'weekly-chart-track'; track.setAttribute('role', 'img'); track.setAttribute('aria-label', `${label}: ${value} submissions`);
  const bar = document.createElement('span'); bar.className = `weekly-chart-bar ${tone}`;
  bar.style.width = `${maximum ? Math.max(value ? 3 : 0, value / maximum * 100) : 0}%`;
  track.append(bar); row.append(heading, track); container.append(row);
}
function renderWeeklyReport(report) {
  weeklyReportStatus.textContent = `${new Date(report.period.start).toLocaleDateString()} – ${new Date(report.period.end).toLocaleDateString()} · Last 7 days`;
  weeklyReportMetrics.replaceChildren();
  addMetricCard(weeklyReportMetrics, 'Submissions', report.totalSubmissions.toLocaleString(), '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>', 'tone-green');
  addMetricCard(weeklyReportMetrics, 'Positive', report.positive.toLocaleString(), '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>', 'tone-positive');
  addMetricCard(weeklyReportMetrics, 'Negative', report.negative.toLocaleString(), '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>', 'tone-negative');
  addMetricCard(weeklyReportMetrics, 'Avg. intensity', report.averageIntensity == null ? '—' : `${report.averageIntensity} / 10`, '<svg viewBox="0 0 24 24"><path d="M4 19V5m0 14h17M8 15l4-5 3 3 5-7"/></svg>', 'tone-purple');
  weeklyReportSentiment.replaceChildren();
  const sentimentMax = Math.max(report.positive, report.negative);
  addChartBar(weeklyReportSentiment, 'Positive', report.positive, sentimentMax, 'bar-positive');
  addChartBar(weeklyReportSentiment, 'Negative', report.negative, sentimentMax, 'bar-negative');
  weeklyReportTopics.replaceChildren();
  const topicMax = Math.max(0, ...report.topTopics.map(item => item.count));
  if (!report.topTopics.length) {
    const empty = document.createElement('li'); empty.className = 'weekly-chart-empty'; empty.textContent = 'No submissions in this period.'; weeklyReportTopics.append(empty);
  } else report.topTopics.forEach(item => addChartBar(weeklyReportTopics, item.topic, item.count, topicMax, 'bar-topic'));
}
document.querySelector('#weekly-report-close').addEventListener('click', closeWeeklyReport);
document.querySelector('#weekly-report-done').addEventListener('click', closeWeeklyReport);
weeklyReportButton.addEventListener('click', async () => {
  currentWeeklyReport = null;
  weeklyReportDownloads.forEach(button => { button.disabled = true; });
  weeklyReportStatus.textContent = 'Loading report…';
  weeklyReportMetrics.replaceChildren(); weeklyReportSentiment.replaceChildren(); weeklyReportTopics.replaceChildren();
  weeklyReportDialog.showModal();
  weeklyReportButton.disabled = true;
  try {
    currentWeeklyReport = await api('/api/admin/weekly-report');
    renderWeeklyReport(currentWeeklyReport);
    weeklyReportDownloads.forEach(button => { button.disabled = false; });
  } catch (error) {
    weeklyReportStatus.textContent = error.message || 'Could not generate the weekly report.';
  } finally { weeklyReportButton.disabled = false; }
});
document.querySelector('#weekly-report-csv').addEventListener('click', () => {
  if (!currentWeeklyReport) return;
  const rows = [
    ['Metric', 'Value'],
    ['Report start (UTC)', currentWeeklyReport.period.start],
    ['Report end (UTC)', currentWeeklyReport.period.end],
    ['Total submissions', currentWeeklyReport.totalSubmissions],
    ['Positive', currentWeeklyReport.positive],
    ['Negative', currentWeeklyReport.negative],
    ['Average intensity', currentWeeklyReport.averageIntensity ?? 'N/A'],
    ...currentWeeklyReport.topTopics.map((item, index) => [`Top topic ${index + 1}`, `${item.topic} (${item.count})`])
  ];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'weekly-feedback-report.csv'; link.click();
  URL.revokeObjectURL(url);
});
async function downloadWeeklyReport(format) {
  try {
    const response = await fetch(`/api/admin/weekly-report/${format}`);
    if (response.status === 401) { window.location.replace('/login.html'); throw new Error('Please log in.'); }
    if (!response.ok) throw new Error('Could not download the report.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `weekly-feedback-report.${format === 'excel' ? 'xlsx' : 'pdf'}`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    weeklyReportStatus.textContent = error.message || 'Could not download the report.';
  }
}
document.querySelector('#weekly-report-pdf').addEventListener('click', () => downloadWeeklyReport('pdf'));
document.querySelector('#weekly-report-excel').addEventListener('click', () => downloadWeeklyReport('excel'));
async function loadKeyIssues() {
  keyIssuesRefresh.disabled = true;
  keyIssuesPeriod.textContent = 'Analyzing feedback from the last 30 days…';
  keyIssuesList.replaceChildren();
  const loading = document.createElement('li'); loading.className = 'key-issues-empty'; loading.textContent = 'Finding recurring issues…'; keyIssuesList.append(loading);
  try {
    const result = await api('/api/admin/key-issues');
    keyIssuesPeriod.textContent = `${result.feedbackCount} recent submissions analyzed`;
    keyIssuesList.replaceChildren();
    if (!result.issues.length) {
      const empty = document.createElement('li'); empty.className = 'key-issues-empty'; empty.textContent = result.feedbackCount ? 'No recurring issues were identified.' : 'No feedback submitted in the last 30 days.'; keyIssuesList.append(empty);
      return;
    }
    for (const item of result.issues) {
      const row = document.createElement('li'); row.className = 'key-issue-row';
      const issue = document.createElement('span'); issue.textContent = item.issue;
      const frequency = document.createElement('span'); frequency.className = 'key-issue-frequency'; frequency.textContent = `${item.mentions} ${item.mentions === 1 ? 'mention' : 'mentions'}`;
      row.append(issue, frequency); keyIssuesList.append(row);
    }
  } catch (error) {
    keyIssuesPeriod.textContent = 'Could not analyze recent feedback';
    keyIssuesList.replaceChildren();
    const failure = document.createElement('li'); failure.className = 'key-issues-empty'; failure.textContent = error.message || 'Could not load key issues.'; keyIssuesList.append(failure);
  } finally { keyIssuesRefresh.disabled = false; }
}
keyIssuesRefresh.addEventListener('click', loadKeyIssues);
loadKeyIssues();
