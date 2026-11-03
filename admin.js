const statusMessage = document.querySelector('#status');
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
const showStatus = (message, error = false) => { statusMessage.textContent = message; statusMessage.classList.toggle('error', error); };
let questionsCache = [];
const requestJson = async (url, options) => {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
};
const switchPanel = (panel) => {
  document.querySelectorAll('.side-link').forEach((item) => item.classList.toggle('active', item.dataset.panel === panel));
  document.querySelectorAll('.portal-panel').forEach((item) => item.classList.toggle('active', item.dataset.panelView === panel));
};
document.querySelectorAll('[data-panel]').forEach((item) => item.addEventListener('click', () => switchPanel(item.dataset.panel)));
document.querySelectorAll('[data-go]').forEach((item) => item.addEventListener('click', () => switchPanel(item.dataset.go)));
const loadData = async () => {
  const me = await requestJson('/api/auth/me');
  if (me.user.role !== 'admin') return window.location.replace('dashboard.html');
  const [{ resources }, { questions }, { members }, { builds }, stats] = await Promise.all([requestJson('/api/resources'), requestJson('/api/questions'), requestJson('/api/admin/members'), requestJson('/api/builds'), requestJson('/api/admin/stats')]);
  document.querySelector('#metric-members').textContent = members.length;
  document.querySelector('#metric-events').textContent = stats.upcomingEvents;
  document.querySelector('#metric-photos').textContent = resources.filter((item) => item.kind === 'photo').length;
  const resourceMarkup = resources.filter((item) => item.kind !== 'photo').map((item) => `<article class="list-row"><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.description || 'Google Drive resource')}</small></div><a class="text-button" href="${escapeHtml(item.drive_url || '#')}" target="_blank" rel="noreferrer">Open ↗</a><button class="icon-button danger" data-delete-resource="${item.id}" aria-label="Delete resource">×</button></article>`).join('');
  document.querySelector('#resource-list').innerHTML = resourceMarkup || '<p class="empty-state">No resources yet.</p>';
  const photoMarkup = resources.filter((item) => item.kind === 'photo').map((item) => `<article class="media-card"><a href="${escapeHtml(item.drive_url || '#')}" target="_blank" rel="noreferrer">${item.drive_url ? `<img src="${escapeHtml(item.drive_url.replace(/\/file\/d\/([^/]+)/, 'https://drive.google.com/uc?export=view&id=$1'))}" alt="${escapeHtml(item.title)}">` : ''}<div><span>PHOTO</span><b>${escapeHtml(item.title)}</b></div></a><button class="icon-button danger" data-delete-resource="${item.id}">×</button></article>`).join('');
  document.querySelector('#photo-list').innerHTML = photoMarkup || '<p class="empty-state">No photos yet.</p>';
  questionsCache = questions;
  document.querySelector('#question-select').innerHTML = '<option value="">Choose a question…</option>' + questions.map((item) => `<option value="${item.id}">${escapeHtml(item.question.slice(0, 80))}</option>`).join('');
  document.querySelector('#question-list').innerHTML = questions.map((item) => `<article class="list-row question-row"><div><b>${escapeHtml(item.question)}</b><small>${escapeHtml(item.answer || 'Awaiting answer')}</small></div><div class="row-actions"><button class="text-button" data-edit-question="${item.id}">${item.answer ? 'Edit' : 'Answer'}</button><button class="icon-button danger" data-delete-question="${item.id}">×</button></div></article>`).join('') || '<p class="empty-state">No questions yet.</p>';
  document.querySelector('#member-list').innerHTML = `<div class="member-row member-heading"><span>NAME</span><span>EMAIL</span><span>STATUS</span><span></span></div>` + members.map((member) => `<div class="member-row"><b>${escapeHtml(member.name)}</b><span>${escapeHtml(member.email)}</span><span class="member-status">${member.verified ? 'VERIFIED' : 'PENDING'}</span><button class="text-button danger" data-delete-member="${member.id}">Remove</button></div>`).join('');
  document.querySelector('#build-list').innerHTML = builds.length ? builds.map((item) => `<article class="build-card"><div><span class="eyebrow">${item.status.toUpperCase()}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><small>By ${escapeHtml(item.author_name)}</small></div><div class="row-actions">${item.link ? `<a class="text-button" href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">Open ↗</a>` : ''}${item.status === 'pending' ? `<button class="text-button" data-publish-build="${item.id}">Publish</button>` : ''}<button class="icon-button danger" data-delete-build="${item.id}">×</button></div></article>`).join('') : '<p class="empty-state">No build submissions yet.</p>';
};
document.querySelector('#resource-form').addEventListener('submit', async (event) => { event.preventDefault(); try { await requestJson('/api/admin/resources', { method: 'POST', body: new FormData(event.currentTarget) }); event.currentTarget.reset(); showStatus('Resource added.'); await loadData(); } catch (error) { showStatus(error.message, true); } });
document.querySelector('#photo-form').addEventListener('submit', async (event) => { event.preventDefault(); try { await requestJson('/api/admin/resources', { method: 'POST', body: new FormData(event.currentTarget) }); event.currentTarget.reset(); showStatus('Photo published.'); await loadData(); } catch (error) { showStatus(error.message, true); } });
document.querySelector('#question-select').addEventListener('change', (event) => { const item = questionsCache.find((question) => String(question.id) === event.target.value); const form = document.querySelector('#question-form'); if (!item) { form.reset(); return; } form.elements.questionId.value = item.id; form.elements.question.value = item.question; form.elements.answer.value = item.answer; });
document.querySelector('#question-form').addEventListener('submit', async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const questionId = values.questionId; delete values.questionId; delete values.questionSelect; if (!questionId) return showStatus('Choose a question first.', true); try { await requestJson(`/api/admin/questions/${questionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }); event.currentTarget.reset(); showStatus('Answer saved.'); await loadData(); } catch (error) { showStatus(error.message, true); } });
document.addEventListener('click', async (event) => { const resourceId = event.target.dataset.deleteResource; const questionId = event.target.dataset.deleteQuestion; const memberId = event.target.dataset.deleteMember; const buildId = event.target.dataset.deleteBuild; const publishId = event.target.dataset.publishBuild; if (memberId) { if (!window.confirm('Remove this member account permanently? This cannot be undone.')) return; try { await requestJson(`/api/admin/members/${memberId}`, { method: 'DELETE' }); showStatus('Member removed.'); await loadData(); } catch (error) { showStatus(error.message, true); } return; } if (publishId) { await requestJson(`/api/admin/builds/${publishId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'published' }) }); showStatus('Build published.'); await loadData(); return; } if (buildId) { if (!window.confirm('Remove this build submission?')) return; await requestJson(`/api/admin/builds/${buildId}`, { method: 'DELETE' }); showStatus('Build removed.'); await loadData(); return; } if (!resourceId && !questionId) return; try { await requestJson(resourceId ? `/api/admin/resources/${resourceId}` : `/api/admin/questions/${questionId}`, { method: 'DELETE' }); showStatus('Deleted.'); await loadData(); } catch (error) { showStatus(error.message, true); } });
document.addEventListener('click', (event) => { const editId = event.target.dataset.editQuestion; if (!editId) return; const item = questionsCache.find((question) => String(question.id) === editId); if (!item) return; const form = document.querySelector('#question-form'); form.elements.questionId.value = item.id; form.elements.question.value = item.question; form.elements.answer.value = item.answer; document.querySelector('#question-select').value = item.id; switchPanel('questions'); form.elements.answer.focus(); });
document.querySelector('#logout').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.replace('auth.html'); });
const savedAccent = localStorage.getItem('makerspaceAccent');
if (savedAccent) {
  document.documentElement.style.setProperty('--cyan', savedAccent);
  document.documentElement.style.setProperty('--violet', savedAccent);
  document.documentElement.style.setProperty('--lime', savedAccent);
  document.documentElement.style.setProperty('--theme-glow', `${savedAccent}30`);
}
document.querySelectorAll('.theme-choice').forEach((choice) => choice.addEventListener('click', () => { const accent = choice.dataset.accent; localStorage.setItem('makerspaceAccent', accent); document.documentElement.style.setProperty('--cyan', accent); document.documentElement.style.setProperty('--violet', accent); document.documentElement.style.setProperty('--lime', accent); document.documentElement.style.setProperty('--theme-glow', `${accent}30`); showStatus('Full theme saved.'); }));
const compactSetting = document.querySelector('#compact-setting');
compactSetting.checked = localStorage.getItem('makerspaceCompact') === 'true';
document.body.classList.toggle('compact', compactSetting.checked);
compactSetting.addEventListener('change', () => { localStorage.setItem('makerspaceCompact', compactSetting.checked); document.body.classList.toggle('compact', compactSetting.checked); });
const motionSetting = document.querySelector('#motion-setting');
motionSetting.checked = localStorage.getItem('makerspaceReducedMotion') === 'true';
document.body.classList.toggle('reduced-motion', motionSetting.checked);
motionSetting.addEventListener('change', () => { localStorage.setItem('makerspaceReducedMotion', motionSetting.checked); document.body.classList.toggle('reduced-motion', motionSetting.checked); });
loadData().catch(() => window.location.replace('auth.html'));
