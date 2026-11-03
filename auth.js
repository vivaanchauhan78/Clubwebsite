const statusMessage = document.querySelector('#status');
const forms = { login: document.querySelector('#login'), signup: document.querySelector('#signup'), verify: document.querySelector('#verify') };
const showStatus = (message, error = false) => { statusMessage.textContent = message; statusMessage.style.color = error ? '#ffad72' : ''; };
const showForm = (mode) => {
  document.querySelectorAll('.auth-tabs button').forEach((item) => item.classList.toggle('active', item.dataset.mode === mode));
  Object.entries(forms).forEach(([name, form]) => form.classList.toggle('hidden', name !== mode));
};
document.querySelectorAll('.auth-tabs button').forEach((tab) => tab.addEventListener('click', () => {
  showForm(tab.dataset.mode);
  showStatus('');
}));
const submit = async (form, endpoint, redirect = false) => {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : { error: `The backend returned a non-JSON response (${response.status}). Start the app with "npm start" and open http://localhost:3000, not a static preview server.` };
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong.');
    Object.assign(error, data);
    throw error;
  }
  showStatus(data.message || 'Success.');
  if (redirect) window.location.href = data.user.role === 'admin' ? 'admin.html' : 'dashboard.html';
  return data;
};
forms.login.addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await submit(forms.login, '/api/auth/login', true); }
  catch (error) {
    if (error.verificationRequired) {
      forms.verify.elements.email.value = forms.login.elements.email.value.trim().toLowerCase();
      sessionStorage.setItem('verificationEmail', forms.verify.elements.email.value);
      showForm('verify');
      showStatus(error.message, true);
    } else showStatus(error.message, true);
  }
});
forms.signup.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await submit(forms.signup, '/api/auth/signup');
    const email = forms.signup.elements.email.value.trim().toLowerCase();
    forms.verify.elements.email.value = email;
    sessionStorage.setItem('verificationEmail', email);
    showForm('verify');
    showStatus(data.message || 'Account created. Enter the code sent to your email.');
  } catch (error) { showStatus(error.message, true); }
});
forms.verify.addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await submit(forms.verify, '/api/auth/verify', true); }
  catch (error) { showStatus(error.message, true); }
});
const savedEmail = sessionStorage.getItem('verificationEmail');
if (savedEmail) forms.verify.elements.email.value = savedEmail;
