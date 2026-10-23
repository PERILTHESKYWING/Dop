// Library › Repos tab: link GitHub repos so every agent can read them
// (repo_list / repo_read through the hub; add_repo in cloud coding sessions).
// mount(el, ctx): ctx = { api(op, body?, query?), toast(text), threads, esc }.
const CSS = `
.lr-top { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.lr-top .hint { flex: 1 1 260px; margin: 0; font-size: 14px; color: var(--soft); }
.lr-form { padding: 14px; margin-bottom: 16px; }
.lr-form h3 { margin: 0 0 8px; font-size: 15px; }
.lr-form .lr-f { display: block; font-size: 14px; color: var(--soft); margin: 12px 0 4px; }
.lr-form input[type=text] { width: 100%; }
.lr-two { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 8px; }
@media (max-width: 600px) { .lr-two { grid-template-columns: minmax(0, 1fr); } }
.lr-ths { display: flex; flex-wrap: wrap; gap: 6px; max-height: 150px; overflow-y: auto; }
.lr-ths label { border: 1px solid var(--line); border-radius: 99px; padding: 4px 10px; font-size: 13px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; max-width: 100%; background: var(--panel); }
.lr-ths label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lr-ths input { accent-color: var(--green); }
.lr-count { color: var(--soft); font-size: 14px; margin: 0 0 8px; }
.lr-list { display: flex; flex-direction: column; gap: 8px; }
.lr-item { padding: 12px 14px; min-width: 0; }
.lr-item .top2 { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.lr-item b { font-size: 15px; overflow-wrap: anywhere; }
.lr-item a { color: var(--soft); font-size: 14px; }
.lr-item p { margin: 6px 0 0; color: var(--soft); font-size: 14px; overflow-wrap: anywhere; white-space: pre-wrap; }
.lr-tag { font-size: 12px; padding: 1px 7px; border-radius: 99px; background: var(--chip); color: var(--soft); }
.lr-tag.bad { background: color-mix(in srgb, var(--amber) 18%, var(--panel)); color: var(--amber); }
.lr-acts { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
`;

export function mount(el, ctx) {
  const { api, toast, threads } = ctx;
  const esc = ctx.esc || ((s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
  if (!document.getElementById('lr-css')) document.head.insertAdjacentHTML('beforeend', `<style id="lr-css">${CSS}</style>`);
  let repos = [];
  let token = false;
  let editing = null; // repo name being edited, or null for a new link
  let loadedAt = 0;
  const STALE = 30_000; // a tab switch reloads the list only after this long

  el.innerHTML = `
    <div class="lr-top">
      <button class="btn go" type="button" data-open>Link a repo</button>
      <p class="hint" data-hint></p>
    </div>
    <form class="card lr-form" data-form hidden>
      <h3 data-title>Link a GitHub repo</h3>
      <div class="lr-two">
        <input type="text" data-f="repo" placeholder="owner/name or a github.com link" aria-label="Repo" autocomplete="off" autocapitalize="off" spellcheck="false" required>
        <input type="text" data-f="ref" placeholder="branch (optional)" aria-label="Branch" autocomplete="off" autocapitalize="off" spellcheck="false">
      </div>
      <label class="lr-f" for="lr-note">Note for the agents (what is it, what should they use it for?)</label>
      <textarea id="lr-note" data-f="note" maxlength="2000" placeholder="e.g. Kami's explain engine lives in src/explain; copy its board drawing."></textarea>
      <span class="lr-f">Point threads to it (optional; every agent sees the list anyway)</span>
      <div class="lr-ths" data-ths></div>
      <div class="lr-acts">
        <button class="btn go" data-save>Link repo</button>
        <button class="btn" type="button" data-cancel>Cancel</button>
      </div>
    </form>
    <p class="lr-count" data-count></p>
    <div class="lr-list" data-list><p class="empty">Loading…</p></div>`;
  const q = (s) => el.querySelector(`[data-${s}]`);
  const field = (n) => el.querySelector(`[data-f="${n}"]`);

  function drawThreads(on = []) {
    const ids = new Set(on.map(Number));
    const list = [...threads];
    for (const id of ids) if (!list.some((t) => t.id === id)) list.push({ id, title: '(closed thread)' });
    q('ths').innerHTML = list.length
      ? list.map((t) => `<label title="${esc(t.title)}"><input type="checkbox" value="${t.id}" ${ids.has(t.id) ? 'checked' : ''}><span>#${t.id} ${esc(t.title)}</span></label>`).join('')
      : '<span class="hint" style="margin:0">No open threads.</span>';
  }

  function resetForm() {
    editing = null;
    q('form').reset();
    field('repo').readOnly = false;
    q('title').textContent = 'Link a GitHub repo';
    q('save').textContent = 'Link repo';
    q('cancel').hidden = !repos.length;
    q('form').hidden = !!repos.length;
    q('open').hidden = !q('form').hidden;
    drawThreads();
  }
  function openForm() {
    q('form').hidden = false;
    q('open').hidden = true;
    q('cancel').hidden = !repos.length;
    q('form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (!editing) field('repo').focus();
  }
  q('open').onclick = openForm;

  function draw() {
    q('hint').textContent = token
      ? 'The hub has a GitHub token, so agents can also read private repos it can see.'
      : 'Agents can read public repos through the hub. Private ones: cloud coding sessions add them with their own add_repo tool; for chats too, set GITHUB_TOKEN in Vercel (docs/handoff/hub-cloud.md).';
    q('count').textContent = repos.length ? `${repos.length} linked repo${repos.length === 1 ? '' : 's'}` : '';
    ctx.count?.('repos', repos.length);
    if (!repos.length && !editing) { q('form').hidden = false; q('open').hidden = true; q('cancel').hidden = true; }
    q('list').innerHTML = repos.length
      ? repos
          .map(
            (r) => `<div class="card lr-item">
        <div class="top2"><b>${esc(r.repo)}</b>${r.ref ? `<span class="lr-tag">${esc(r.ref)}</span>` : ''}${r.private ? '<span class="lr-tag">private</span>' : ''}${r.readable ? '' : `<span class="lr-tag bad" title="${esc(r.problem)}">hub can't read it</span>`}${(r.threads || []).map((n) => `<span class="lr-tag">#${n}</span>`).join('')}
          <a href="https://github.com/${esc(r.repo)}${r.ref ? `/tree/${encodeURIComponent(r.ref)}` : ''}" target="_blank" rel="noopener">Open on GitHub ${icon('arrow-up-right', 14)}</a></div>
        ${r.description ? `<p>${esc(r.description)}</p>` : ''}${r.note ? `<p><i>Note:</i> ${esc(r.note)}</p>` : ''}${r.readable ? '' : `<p>${esc(r.problem)}</p>`}
        <div class="lr-acts"><button class="btn" type="button" data-edit="${esc(r.repo)}">Edit</button><button class="btn" type="button" data-check="${esc(r.repo)}">Check again</button><button class="btn bad" type="button" data-del="${esc(r.repo)}">Remove</button></div>
      </div>`,
          )
          .join('')
      : '<p class="empty">No repos linked yet. Agents already work on this project\'s own repo; link others they should read.</p>';
  }

  async function load() {
    try {
      const r = await api('repo-list');
      repos = r.repos || [];
      token = !!r.token;
      loadedAt = Date.now();
    } catch (e) {
      if (loadedAt) return toast(e.message);
      q('list').innerHTML = `<p class="empty">Could not load the repos (${esc(e.message)}). <button class="btn" type="button" data-retry>Try again</button></p>`;
      q('list').querySelector('[data-retry]').onclick = () => { q('list').innerHTML = '<p class="empty">Loading…</p>'; load(); };
      return;
    }
    draw();
    if (!editing && !field('repo').value.trim()) resetForm();
  }

  async function save(body) {
    const btn = q('save');
    btn.disabled = true;
    try {
      const r = await api('repo-add', body);
      toast(r.readable ? `Linked ${r.repo}. Every agent can read it now.` : `Linked ${r.repo}, but the hub can't read it: ${r.problem}`);
      resetForm();
      await load();
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
    }
  }

  q('form').onsubmit = (e) => {
    e.preventDefault();
    save({
      repo: field('repo').value.trim(),
      ref: field('ref').value.trim(),
      note: field('note').value.trim(),
      threads: [...q('ths').querySelectorAll('input:checked')].map((i) => Number(i.value)),
    });
  };
  q('cancel').onclick = resetForm;

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-edit],[data-check],[data-del]');
    if (!b) return;
    const r = repos.find((x) => x.repo === (b.dataset.edit || b.dataset.check || b.dataset.del));
    if (!r) return;
    if (b.dataset.edit) {
      editing = r.repo;
      field('repo').value = r.repo;
      field('repo').readOnly = true;
      field('ref').value = r.ref || '';
      field('note').value = r.note || '';
      drawThreads(r.threads || []);
      q('title').textContent = `Edit ${r.repo}`;
      q('save').textContent = 'Save';
      openForm();
      q('cancel').hidden = false;
    } else if (b.dataset.check) {
      save({ repo: r.repo });
    } else if (confirm(`Remove ${r.repo} from the library? Agents stop seeing it in their list.`)) {
      try {
        await api('repo-delete', { repo: r.repo });
        if (editing === r.repo) resetForm();
        toast(`Removed ${r.repo}.`);
        await load();
      } catch (err) {
        toast(err.message);
      }
    }
  });

  drawThreads();
  load();
  return { show: () => { if (!editing) drawThreads(); if (Date.now() - loadedAt > STALE) load(); } };
}
