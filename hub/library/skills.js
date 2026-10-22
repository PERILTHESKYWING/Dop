// Library › Skills tab: list, read, edit, create and upload shared SKILL.md files.
// mount(el, ctx): ctx = { api(op, body?, query?), toast(text), threads, count(tab, n) }.
// The list comes without the texts (skill-list); a text loads when its skill opens (skill-get).
const TEMPLATE = `---
name: my-skill
description: Use when ... (one line saying when an agent should use this skill).
---
# My skill

Steps the agent follows, in order.
`;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const when = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const day = (t) => (t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', ...(new Date(t).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) }) : '');
const STALE = 30_000; // a tab switch reloads the list only after this long
const PICK = '<p class="sk-meta sk-pick">Pick a skill to read or edit it.</p>';

export function mount(el, ctx) {
  let skills = [];
  let loadedAt = 0;
  let cur = null; // { name, isNew }
  const texts = new Map(); // name:at -> text
  el.innerHTML = `
    <style>
      .sk-top { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
      .sk-top .sk-meta { flex: 1 1 260px; }
      .sk { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 14px; align-items: start; }
      .sk-side { display: flex; flex-direction: column; gap: 8px; position: sticky; top: 64px; max-height: calc(100vh - 80px); min-height: 0; }
      .sk-side input[type=search] { width: 100%; }
      .sk-count { color: var(--soft); font-size: 14px; }
      .sk-list { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; min-height: 0; padding-bottom: 4px; }
      .sk-row { text-align: left; border: 1px solid var(--line); background: var(--panel); border-radius: 10px; padding: 8px 10px; cursor: pointer; min-width: 0; }
      .sk-row:hover, .sk-row.on { background: var(--sel); }
      .sk-row.on { border-color: var(--soft); }
      .sk-row b { display: block; overflow-wrap: anywhere; }
      .sk-row span { color: var(--soft); font-size: 14px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .sk-row small { display: block; color: var(--soft); font-size: 13px; margin-top: 2px; }
      .sk-tag { font-size: 12px; background: var(--chip); border-radius: 99px; padding: 1px 7px; margin-left: 6px; color: var(--soft); font-weight: 400; font-style: normal; }
      .sk-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
      .sk-text { width: 100%; min-height: 60vh; border: 1px solid var(--line); border-radius: 10px; padding: 10px; background: var(--panel); font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace; resize: vertical; }
      .sk-name { border: 1px solid var(--line); background: var(--panel); border-radius: 10px; padding: 7px 10px; min-height: 38px; flex: 1 1 180px; min-width: 0; }
      .sk-meta { color: var(--soft); font-size: 14px; }
      .sk-pick { padding: 18px 4px; }
      .sk-back { display: none; }
      @media (max-width: 760px) {
        .sk { grid-template-columns: minmax(0, 1fr); }
        .sk-side { position: static; max-height: none; }
        .sk-list { overflow: visible; }
        .sk-pick { display: none; }
        .sk.editing .sk-side { display: none; }
        .sk:not(.editing) [data-ed] { display: none; }
        .sk-back { display: inline-flex; align-items: center; }
      }
    </style>
    <div class="sk-top">
      <button class="btn go" data-a="new">New skill</button>
      <button class="btn" data-a="upload">Upload SKILL.md</button>
      <input type="file" accept=".md,text/markdown,text/plain" hidden data-f>
      <span class="sk-meta">Shared by every agent: they read these with skill_list and skill_get.</span>
    </div>
    <div class="sk">
      <div class="sk-side">
        <input type="search" placeholder="Search skills" aria-label="Search skills" data-q>
        <span class="sk-count" data-count></span>
        <div class="sk-list" data-list><p class="sk-meta">Loading…</p></div>
      </div>
      <div data-ed>${PICK}</div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const fileIn = $('[data-f]');
  const editing = (on) => $('.sk').classList.toggle('editing', on);

  async function load() {
    try {
      skills = (await ctx.api('skill-list')).skills || [];
      loadedAt = Date.now();
    } catch (e) {
      if (!loadedAt) $('[data-list]').innerHTML = `<p class="sk-meta">Could not load the skills (${esc(e.message)}). <button class="btn" data-a="retry">Try again</button></p>`;
      else ctx.toast(e.message);
      return;
    }
    ctx.count?.('skills', skills.length);
    drawList();
    if (cur && !cur.isNew && !skills.some((s) => s.name === cur.name)) close();
  }

  function close() {
    const was = cur?.name;
    cur = null;
    $('[data-ed]').innerHTML = PICK;
    editing(false);
    drawList();
    if (was) [...el.querySelectorAll('.sk-row')].find((r) => r.dataset.n === was)?.scrollIntoView({ block: 'center' });
  }

  function drawList() {
    const text = $('[data-q]').value.trim().toLowerCase();
    const list = text ? skills.filter((s) => `${s.name} ${s.description || ''}`.toLowerCase().includes(text)) : skills;
    $('[data-count]').textContent = text ? `${list.length} of ${skills.length} skills` : `${skills.length} skill${skills.length === 1 ? '' : 's'}`;
    $('[data-list]').innerHTML = list.length
      ? list
          .map((s) => {
            const tag = s.overridden ? '<i class="sk-tag">edited</i>' : s.bundled ? '<i class="sk-tag">bundled</i>' : '';
            const who = s.bundled && !s.overridden ? '' : `<small>by ${esc(s.by)}${s.at ? `, ${esc(day(s.at))}` : ''}</small>`;
            return `<button class="sk-row${cur?.name === s.name ? ' on' : ''}" data-n="${esc(s.name)}"><b>/${esc(s.name)}${tag}</b><span>${esc(s.description || '(no description)')}</span>${who}</button>`;
          })
          .join('')
      : `<p class="sk-meta">${skills.length ? 'No skill matches.' : 'No skills yet. Make one with New skill.'}</p>`;
  }
  $('[data-q]').addEventListener('input', drawList);

  function edit(name, text, s) {
    cur = { name, isNew: !s };
    drawList();
    editing(true);
    const revert = s?.overridden;
    const del = s && !s.bundled;
    $('[data-ed]').innerHTML = `
      <div class="sk-bar">
        <button class="btn quiet sk-back" data-a="back">${icon('chevron-left', 16)}All skills</button>
        <input class="sk-name" data-nm placeholder="skill-name" value="${esc(name)}" ${s ? 'readonly' : ''} aria-label="Skill name">
        <button class="btn go" data-a="save" ${text == null ? 'disabled' : ''}>Save for everyone</button>
        ${revert ? '<button class="btn" data-a="del">Revert to bundled</button>' : ''}
        ${del ? '<button class="btn" data-a="del">Delete</button>' : ''}
      </div>
      <p class="sk-meta" style="margin:0 0 8px">${s ? esc(s.bundled && !s.overridden ? 'Bundled with the hub' : `by ${s.by}${s.at ? `, ${when(s.at)}` : ''}`) : 'New skill, not saved yet'}</p>
      ${text == null ? '<p class="sk-meta" data-wait>Loading…</p>' : `<textarea class="sk-text" data-t spellcheck="false" aria-label="SKILL.md">${esc(text)}</textarea>`}`;
    if (matchMedia('(max-width: 760px)').matches) scrollTo({ top: 0 });
  }

  async function openSkill(s) {
    const key = `${s.name}:${s.at}`;
    if (texts.has(key)) return edit(s.name, texts.get(key), s);
    edit(s.name, null, s);
    try {
      const r = await ctx.api('skill-get', null, `&name=${encodeURIComponent(s.name)}`);
      texts.set(key, r.text);
      if (cur?.name === s.name) edit(s.name, r.text, s);
    } catch (e) {
      if (cur?.name === s.name) $('[data-wait]').textContent = `Could not load /${s.name} (${e.message}).`;
    }
  }

  el.addEventListener('click', async (ev) => {
    const row = ev.target.closest('.sk-row');
    if (row) {
      const s = skills.find((x) => x.name === row.dataset.n);
      if (s) openSkill(s);
      return;
    }
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (a === 'new') return edit('', TEMPLATE, null);
    if (a === 'upload') return fileIn.click();
    if (a === 'back') return close();
    if (a === 'retry') { $('[data-list]').innerHTML = '<p class="sk-meta">Loading…</p>'; return load(); }
    if (a === 'save') {
      const name = $('[data-nm]').value.trim();
      const content = $('[data-t]').value;
      try {
        const r = await ctx.api('skill-save', { name, content });
        ctx.toast(`${r.replaced ? 'Replaced' : 'Saved'} /${r.name}`);
        cur = { name: r.name, isNew: false };
        await load();
        const s = skills.find((x) => x.name === r.name);
        if (s) {
          texts.set(`${s.name}:${s.at}`, content);
          edit(s.name, content, s);
        }
      } catch (e) { ctx.toast(e.message); }
    }
    if (a === 'del') {
      const s = skills.find((x) => x.name === cur?.name);
      if (!s || !confirm(s.bundled ? `Revert /${s.name} to the bundled text?` : `Delete /${s.name} for everyone?`)) return;
      try {
        await ctx.api('skill-delete', { name: s.name });
        ctx.toast(s.bundled ? `/${s.name} reverted` : `/${s.name} deleted`);
        close();
        await load();
      } catch (e) { ctx.toast(e.message); }
    }
  });

  // An uploaded SKILL.md opens in the editor so XIAO can check it, then save.
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    const text = await f.text();
    const fromFm = /^---\r?\n[\s\S]*?^name:\s*["']?([^\r\n"']+)/m.exec(text)?.[1];
    const guess = (fromFm || f.name.replace(/\.md$/i, '')).trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/^-+|-+$/g, '');
    const had = skills.find((x) => x.name === guess);
    edit(guess, text, null);
    if (had) ctx.toast(`/${guess} exists: saving will replace it`);
  });

  load();
  return { show: () => { if (Date.now() - loadedAt > STALE) load(); }, refresh: load };
}
