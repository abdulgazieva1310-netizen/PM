const form = document.querySelector('#feedback-form');
const feedback = document.querySelector('#feedback');
const message = document.querySelector('#message');
const button = document.querySelector('#submit-button');
const topicSelect = document.querySelector('#topic');
let submitting = false;
async function loadTopics() {
  try {
    const response = await fetch('/api/topics');
    if (!response.ok) throw new Error('Could not load topics. Reload the page to try again.');
    const topics = await response.json();
    const selected = topicSelect.value;
    topicSelect.replaceChildren(new Option(topics.length ? 'Choose a topic' : 'No topics available', ''));
    topicSelect.options[0].disabled = true;
    for (const topic of topics) topicSelect.add(new Option(topic.name, topic.name));
    topicSelect.value = topics.some(topic => topic.name === selected) ? selected : '';
    topicSelect.disabled = topics.length === 0;
    button.disabled = submitting || topics.length === 0;
  } catch (error) {
    button.disabled = true;
    message.hidden = false; message.className = 'alert alert-danger'; message.textContent = error.message;
  }
}
button.disabled = true;
loadTopics();
window.addEventListener('focus', loadTopics);

feedback.addEventListener('input', () => { document.querySelector('#counter').textContent = `${feedback.value.length.toLocaleString()} / 5,000`; feedback.setCustomValidity(''); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!feedback.value.trim()) { feedback.setCustomValidity('Please enter your feedback.'); feedback.reportValidity(); return; }
  submitting = true; button.disabled = true; button.textContent = 'Submitting…'; message.hidden = true;
  try {
    const response = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: form.topic.value, text: feedback.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    message.className = 'alert alert-success'; message.textContent = data.message;
    form.reset(); document.querySelector('#counter').textContent = '0 / 5,000';
  } catch(error) { message.className = 'alert alert-danger'; message.textContent = error.message || 'Unable to submit. Please try again.'; }
  finally { message.hidden = false; message.focus(); submitting = false; button.disabled = false; button.textContent = 'Submit feedback →'; }
});
