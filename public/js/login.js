const form = document.querySelector('#login-form');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.querySelector('#login-button');
  const message = document.querySelector('#message');
  button.disabled = true; button.textContent = 'Signing in…'; message.hidden = true;
  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: form.username.value, password: form.password.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    window.location.assign('/admin');
  } catch(error) { message.className = 'alert alert-danger'; message.textContent = error.message || 'Unable to sign in. Please try again.'; message.hidden = false; }
  finally { button.disabled = false; button.textContent = 'Sign in →'; }
});
