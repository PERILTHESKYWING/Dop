// Library › Skills tab: list, read, edit, create and upload shared SKILL.md files.
// mount(el, ctx): ctx = { api(op, body?, query?), toast(text), threads }.
const TEMPLATE = `---
name: my-skill
description: Use when ... (one line saying when an agent should use this skill).
---
# My skill

Steps the agent follows, in order.
`;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const when = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

export function mount(el, ctx) {
  let skills = [];
  let cur = null; // { name, isNew }
  el.innerHTML = `
    <style>
      .sk { display: grid; grid-template-columns: 270px minmax(0, 1fr); gap: 14px; }
      @media (max-width: 760px) { .sk { grid-template-columns: minmax(0, 1fr); } }
      .sk-list { display: flex; flex-direction: column; gap: 4px; }
      .sk-row { text-align: left; border: 1px solid var(--line); background: var(--panel); border-radius: 10px; padding: 8px 10px; cursor: pointer; }
      .sk-row:hover, .sk-row.on { background: var(--sel); }
      .sk-row b { display: block; }
      .sk-row span { color: var(--soft); font-size: 13px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sk-tag { font-size: 11.5px; background: var(--chip); border-radius: 99px; padding: 1px 7px; margin-left: 6px; color: var(--soft); font-weight: 400; }
      .sk-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
      .sk-text { width: 100%; min-height: 55vh; border: 1px solid var(--line); border-radius: 10px; padding: 10px; background: var(--panel); font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace; resize: vertical; }
      .sk-name { border: 1px solid var(--line); background: var(--panel); border-radius: 10px; padding: 7px 10px; min-height: 38px; }
      .sk-meta { color: var(--soft); font-size: 13px; }
    </style>
    <div class="sk-bar">
      <button class="btn go" data-a="new">New skill</button>
      <button class="btn" data-a="upload">Upload SKILL.md</button>
      <input type="file" accept=".md,text/markdown,text/plain" hidden data-f>
      <span class="sk-meta">Shared by every agent: they read these with skill_list / skill_get.</span>
    </div>
    <div class="sk"><div class="sk-list" data-list></div><div data-ed><p class="sk-meta">Pick a skill to read or edit it.</p></div></div>`;
  const $ = (s) => el.querySelector(s);
  const fileIn = $('[data-f]');

  async function load() {
    try { skills = (await ctx.api('skill-list')).skills; } catch (e) { ctx.toast(e.message); return; }
    drawList();
    if (cur && !cur.isNew && !skills.some((s) => s.name === cur.name)) { cur = null; $('[data-ed]').innerHTML = '<p class="sk-meta">Pick a skill to read or edit it.</p>'; }
  }

  function drawList() {
    $('[data-list]').innerHTML = skills
      .map((s) => `<button class="sk-row${cur?.name === s.name ? ' on' : ''}" data-n="${esc(s.name)}"><b>/${esc(s.name)}${s.overridden ? '<i class="sk-tag">edited</i>' : s.bundled ? '<i class="sk-tag">bundled</i>' : ''}</b><span>${esc(s.description || '(no description)')}</span></button>`)
      .join('');
  }

  function edit(name, text, s) {
    cur = { name, isNew: !s };
    drawList();
    const revert = s?.overridden;
    const del = s && !s.bundled;
    $('[data-ed]').innerHTML = `
      <div class="sk-bar">
        <input class="sk-name" data-nm placeholder="skill-name" value="${esc(name)}" ${s ? 'readonly' : ''} aria-label="Skill name">
        <button class="btn go" data-a="save">Save for everyone</button>
        ${revert ? '<button class="btn" data-a="del">Revert to bundled</button>' : ''}
        ${del ? '<button class="btn" data-a="del">Delete</button>' : ''}
        <span class="sk-meta">${s ? esc(`by ${s.by}${s.at ? `, ${when(s.at)}` : ''}`) : 'new'}</span>
      </div>
      <textarea class="sk-text" data-t spellcheck="false" aria-label="SKILL.md">${esc(text)}</textarea>`;
  }

  el.addEventListener('click', async (ev) => {
    const row = ev.target.closest('.sk-row');
    if (row) {
      const s = skills.find((x) => x.name === row.dataset.n);
      return edit(s.name, s.text, s);
    }
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (a === 'new') return edit('', TEMPLATE, null);
    if (a === 'upload') return fileIn.click();
    if (a === 'save') {
      const name = $('[data-nm]').value.trim();
      try {
        const r = await ctx.api('skill-save', { name, content: $('[data-t]').value });
        ctx.toast(`${r.replaced ? 'Replaced' : 'Saved'} /${r.name}`);
        cur = { name: r.name, isNew: false };
        await load();
        const s = skills.find((x) => x.name === r.name);
        if (s) edit(s.name, s.text, s);
      } catch (e) { ctx.toast(e.message); }
    }
    if (a === 'del') {
      const s = skills.find((x) => x.name === cur?.name);
      if (!s || !confirm(s.bundled ? `Revert /${s.name} to the bundled text?` : `Delete /${s.name} for everyone?`)) return;
      try {
        await ctx.api('skill-delete', { name: s.name });
        ctx.toast(s.bundled ? `/${s.name} reverted` : `/${s.name} deleted`);
        cur = null;
        $('[data-ed]').innerHTML = '<p class="sk-meta">Pick a skill to read or edit it.</p>';
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
  return { refresh: load };
}
