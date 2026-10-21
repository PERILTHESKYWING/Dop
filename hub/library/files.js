// Files tab of the hub library: upload images, videos, text and any file so
// every agent can read them (lib_list / lib_get). Agents can't watch a video
// or open a huge photo, so the browser makes what they can see before the
// upload: a 'view' JPEG of big images, and for videos up to 16 still frames
// plus one contact sheet. Everything goes up in chunks the API accepts.
const RAW_CHUNK = 675_000; // bytes per chunk = 900,000 base64 characters, the API's limit
const MAX_B64 = 900_000;
const VIEW_PX = 1568; // longest side of the copies agents see
const VIEW_BYTES = 650 * 1024; // images bigger than this get a view copy (and still fit one chunk below it)
const FRAME_PX = 768;
const MAX_FRAMES = 16;
const VIDEO_KEEP = 24 * 1024 * 1024; // longer videos keep their frames only
const POOL = 3; // body chunks sent at once

const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  md: 'text/markdown', txt: 'text/plain', json: 'application/json', sgf: 'application/x-go-sgf', csv: 'text/csv', js: 'text/javascript', mjs: 'text/javascript', ts: 'text/plain', tsx: 'text/plain',
  html: 'text/html', css: 'text/css', yaml: 'text/yaml', yml: 'text/yaml', xml: 'text/xml', py: 'text/x-python', pdf: 'application/pdf', zip: 'application/zip',
};
const extOf = (name) => (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] || '').toLowerCase();
const typeOf = (f) => f.type || TYPES[extOf(f.name)] || 'application/octet-stream';
const kindOf = (type) => (type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('text/') || /json|xml|javascript|sgf|yaml/.test(type) ? 'text' : 'file');
const KIND_LABEL = { image: 'Image', video: 'Video', text: 'Text', file: 'File' };
const size = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`);
const secs = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Names stay simple (letters, digits, . _ - and spaces) so agents can pass them back exactly.
export function cleanName(name) {
  const raw = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const e = extOf(raw);
  const tidy = (x) => x.replace(/[^A-Za-z0-9._\- ]+/g, '-').replace(/-{2,}/g, '-').replace(/\s+/g, ' ').replace(/^[-. ]+|[-. ]+$/g, '');
  let base = tidy(e ? raw.slice(0, -e.length - 1) : raw).slice(0, 110).trim();
  if (!base.replace(/[.\-_ ]/g, '')) base = 'file';
  return e ? `${base}.${raw.slice(-e.length)}` : base;
}

export function cleanTags(text) {
  return [...new Set(String(text || '').toLowerCase().split(/[,;\n]/).map((t) => t.trim().replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, '-')).filter(Boolean))].slice(0, 12);
}

const b64 = (blob) =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => no(r.error || new Error('could not read the file'));
    r.readAsDataURL(blob);
  });
const blobOf = async (data, type) => (await fetch(`data:${type || 'application/octet-stream'};base64,${data}`)).blob();

// ---------- what agents see ----------
function drawScaled(src, sw, sh, maxPx) {
  const k = Math.min(1, maxPx / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; // JPEG has no transparency
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
function jpeg(canvas) {
  for (const q of [0.85, 0.72, 0.6, 0.45]) {
    const s = canvas.toDataURL('image/jpeg', q).split(',')[1] || '';
    if (s && s.length <= MAX_B64) return s;
  }
  return null;
}
function jpegFit(src, sw, sh, maxPx) {
  for (let px = maxPx, n = 0; n < 4; n++, px = Math.round(px * 0.75)) {
    const s = jpeg(drawScaled(src, sw, sh, px));
    if (s) return s;
  }
  return null;
}

async function decodeImage(file) {
  try {
    const b = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { src: b, w: b.width, h: b.height, close: () => b.close?.() };
  } catch {}
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { src: img, w: img.naturalWidth || 1024, h: img.naturalHeight || 1024, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null; // e.g. HEIC outside Safari: the original still uploads
  }
}

async function imageView(file) {
  const img = await decodeImage(file);
  if (!img) return { warn: file.size > VIEW_BYTES ? 'this browser could not open the picture, so agents get the original only' : '' };
  try {
    if (file.size <= VIEW_BYTES && Math.max(img.w, img.h) <= VIEW_PX) return {};
    return { view: jpegFit(img.src, img.w, img.h, VIEW_PX) };
  } finally {
    img.close();
  }
}

function waitFor(el, name, ms) {
  return new Promise((ok, no) => {
    const done = () => (clearTimeout(t), el.removeEventListener(name, on), el.removeEventListener('error', bad));
    const on = () => (done(), ok());
    const bad = () => (done(), no(new Error('this browser cannot read this video')));
    const t = setTimeout(() => (done(), no(new Error(`the video did not answer (${name})`))), ms);
    el.addEventListener(name, on);
    el.addEventListener('error', bad);
  });
}

// Up to 16 frames spread over the clip, and a contact sheet of all of them with times.
export function frameTimes(duration, max = MAX_FRAMES) {
  if (!(duration > 0)) return [0];
  const n = Math.min(max, Math.max(1, Math.ceil(duration * 2)));
  return Array.from({ length: n }, (_, i) => Math.round(((duration * (i + 0.5)) / n) * 100) / 100);
}
export function sheetGrid(n, vw, vh, maxPx = VIEW_PX) {
  const cols = Math.min(4, Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  let cw = Math.floor(maxPx / cols);
  let ch = Math.round((cw * vh) / vw);
  if (rows * ch > maxPx) {
    const k = maxPx / (rows * ch);
    cw = Math.floor(cw * k);
    ch = Math.floor(ch * k);
  }
  return { cols, rows, cw: Math.max(1, cw), ch: Math.max(1, ch) };
}

async function videoFrames(file, step) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  try {
    const meta = waitFor(v, 'loadeddata', 30000);
    v.src = url;
    await meta;
    if (!(v.duration > 0) || !isFinite(v.duration)) {
      // Some recordings only learn their length after a seek to the end.
      const s = waitFor(v, 'seeked', 10000);
      v.currentTime = 1e9;
      await s.catch(() => {});
    }
    const duration = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    // iPhones draw nothing until the video has played once.
    try { await v.play(); v.pause(); } catch {}
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) throw new Error('this browser cannot show this video');
    const times = frameTimes(duration);
    const grid = sheetGrid(times.length, vw, vh);
    const sheet = document.createElement('canvas');
    sheet.width = grid.cols * grid.cw;
    sheet.height = grid.rows * grid.ch;
    const g = sheet.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, sheet.width, sheet.height);
    const frames = [];
    for (let i = 0; i < times.length; i++) {
      step(`Reading frame ${i + 1} of ${times.length}`);
      const t = Math.min(times[i], Math.max(0, duration - 0.05));
      if (Math.abs(v.currentTime - t) > 0.001) {
        const s = waitFor(v, 'seeked', 15000);
        v.currentTime = t;
        await s;
      }
      await new Promise((r) => requestAnimationFrame(() => r()));
      const f = jpegFit(v, vw, vh, FRAME_PX);
      if (!f) throw new Error('could not save a frame');
      frames.push(f);
      const x = (i % grid.cols) * grid.cw, y = Math.floor(i / grid.cols) * grid.ch;
      g.drawImage(v, x + 1, y + 1, grid.cw - 2, grid.ch - 2);
      const label = secs(times[i]);
      g.font = `600 ${Math.max(12, Math.round(grid.cw / 18))}px system-ui, sans-serif`;
      const w = g.measureText(label).width + 10, h = Math.max(18, Math.round(grid.cw / 13));
      g.fillStyle = 'rgba(0,0,0,.66)';
      g.fillRect(x + 5, y + 5, w, h);
      g.fillStyle = '#fff';
      g.textBaseline = 'middle';
      g.fillText(label, x + 10, y + 5 + h / 2);
    }
    return { frames, frameTimes: times, sheet: jpeg(sheet), duration };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

// What one picked file becomes: its kind, notes for the person, and whether the original fits.
function plan(file) {
  const type = typeOf(file);
  const kind = kindOf(type);
  const keepBody = kind !== 'video' || file.size <= VIDEO_KEEP;
  const notes = [];
  if (kind === 'video') notes.push(keepBody ? 'video + 16 frames for agents' : `over ${size(VIDEO_KEEP)}: only still frames are kept`);
  if (kind === 'image' && file.size > VIEW_BYTES) notes.push('a smaller copy is made for agents');
  return { file, name: cleanName(file.name), type, kind, keepBody, notes };
}

// ---------- page ----------
const CSS = `
.lf-drop { padding: 18px; border: 2px dashed var(--line); text-align: center; transition: border-color .15s, background .15s; }
.lf-drop.over { border-color: var(--green); background: color-mix(in srgb, var(--green) 8%, var(--panel)); }
.lf-drop p { margin: 0 0 10px; color: var(--soft); }
.lf-drop .row { justify-content: center; }
.lf-stage { margin-top: 12px; padding: 14px; }
.lf-stage h3, .lf-edit h3 { margin: 0 0 8px; font-size: 15px; }
.lf-picked { list-style: none; margin: 0 0 6px; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; }
.lf-picked li { display: flex; gap: 10px; align-items: center; border: 1px solid var(--line); border-radius: 10px; padding: 6px 6px 6px 10px; background: var(--bg); min-width: 0; }
.lf-picked .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lf-picked small { color: var(--faint); display: block; white-space: normal; }
.lf-ref { display: flex; flex-wrap: wrap; gap: 6px; }
.lf-ref label { border: 1px solid var(--line); border-radius: 99px; padding: 5px 12px; cursor: pointer; font-size: 14px; background: var(--panel); min-height: 34px; display: inline-flex; align-items: center; gap: 6px; }
.lf-ref input { position: absolute; opacity: 0; pointer-events: none; }
.lf-ref label:has(input:checked) { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.lf-ref label:has(input:focus-visible) { outline: 2px solid var(--green); outline-offset: 2px; }
.lf-ths { display: flex; flex-wrap: wrap; gap: 6px; max-height: 150px; overflow-y: auto; }
.lf-ths label { border: 1px solid var(--line); border-radius: 99px; padding: 4px 10px; font-size: 13px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; max-width: 100%; background: var(--panel); }
.lf-ths label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lf-ths input { accent-color: var(--green); }
.lf-f { display: block; font-size: 14px; color: var(--soft); margin: 12px 0 4px; }
.lf-prog { margin-top: 12px; padding: 12px 14px; }
.lf-bar { height: 8px; border-radius: 99px; background: var(--chip); overflow: hidden; margin-top: 8px; }
.lf-bar i { display: block; height: 100%; width: 0; background: var(--green); transition: width .2s; }
.lf-tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 18px 0 10px; }
.lf-tools input[type=search] { flex: 1; min-width: 160px; }
.lf-used { color: var(--faint); font-size: 13px; }
.lf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.lf-item { border: 1px solid var(--line); background: var(--panel); border-radius: 12px; overflow: hidden; cursor: pointer; text-align: left; padding: 0; display: flex; flex-direction: column; min-width: 0; }
.lf-item:hover { border-color: var(--soft); }
.lf-item:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.lf-thumb { position: relative; aspect-ratio: 4 / 3; background: var(--chip); display: grid; place-items: center; color: var(--faint); font: 600 18px/1 ui-monospace, Menlo, monospace; overflow: hidden; }
.lf-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.lf-kind { position: absolute; left: 6px; bottom: 6px; background: rgba(0,0,0,.66); color: #fff; font: 12px/1 system-ui, sans-serif; padding: 4px 7px; border-radius: 99px; }
.lf-cap { padding: 7px 9px 9px; min-width: 0; }
.lf-cap b { display: block; font-weight: 600; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lf-cap small { color: var(--faint); font-size: 12px; }
.lf-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.lf-tag { font-size: 11.5px; padding: 1px 7px; border-radius: 99px; background: var(--chip); color: var(--soft); }
.lf-tag.do { background: color-mix(in srgb, var(--green) 18%, var(--panel)); color: var(--green); font-weight: 600; }
.lf-tag.dont { background: color-mix(in srgb, var(--red) 16%, var(--panel)); color: var(--red); font-weight: 600; }
.lf-tag.warn { background: color-mix(in srgb, var(--amber) 18%, var(--panel)); color: var(--amber); }
.lf-dlg { width: min(860px, calc(100vw - 32px)); }
.lf-dlg .head { display: flex; gap: 10px; align-items: flex-start; }
.lf-dlg .head h2 { flex: 1; min-width: 0; }
.lf-media { margin: 10px 0; display: flex; flex-direction: column; gap: 10px; }
.lf-media img, .lf-media video { display: block; max-width: 100%; max-height: 60vh; margin: 0 auto; border-radius: 10px; border: 1px solid var(--line); background: #000; }
.lf-media img { background: var(--chip); }
.lf-media pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.5 ui-monospace, Menlo, monospace; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 10px; margin: 0; max-height: 50vh; overflow: auto; }
.lf-strip { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
.lf-strip figure { margin: 0; flex: none; width: 128px; }
.lf-strip img { width: 128px; height: auto; max-height: none; border-radius: 6px; }
.lf-strip figcaption { font-size: 11.5px; color: var(--faint); text-align: center; }
.lf-meta { color: var(--soft); font-size: 13px; }
.lf-edit { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 12px; }
.lf-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
`;

export function mount(el, ctx) {
  const { api, toast, threads, esc } = ctx;
  if (!document.getElementById('lf-css')) document.head.insertAdjacentHTML('beforeend', `<style id="lf-css">${CSS}</style>`);
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  el.innerHTML = `
    <div class="card lf-drop" data-drop>
      <p><b>Add files for the team.</b> Drop them here, paste, or pick them.</p>
      <div class="row">
        <button class="btn go" type="button" data-pick="any">Choose files</button>
        <button class="btn" type="button" data-pick="media">Photos &amp; videos</button>
      </div>
      <input type="file" multiple hidden data-in="any">
      <input type="file" multiple hidden accept="image/*,video/*" data-in="media">
      <p class="hint">Images, videos, text and any other file. Agents see pictures and still frames from videos; videos over ${size(VIDEO_KEEP)} keep the frames only.</p>
    </div>
    <div class="card lf-stage" data-stage hidden>
      <h3 data-count></h3>
      <ul class="lf-picked" data-picked></ul>
      <div data-meta></div>
      <div class="lf-actions">
        <button class="btn go" type="button" data-up>Upload</button>
        <button class="btn" type="button" data-cancel>Cancel</button>
      </div>
    </div>
    <div class="card lf-prog" data-prog hidden>
      <div data-ptext>Uploading…</div>
      <div class="lf-bar"><i data-pbar></i></div>
    </div>
    <div class="lf-tools">
      <input type="search" placeholder="Search names, notes, tags" aria-label="Search files" data-q>
      <select aria-label="Kind" data-kind>
        <option value="">All kinds</option><option value="image">Images</option><option value="video">Videos</option><option value="text">Text</option><option value="file">Other files</option>
      </select>
      <select aria-label="Tag" data-tag>
        <option value="">All tags</option><option value="studio">Studio</option><option value="do">Do (copy this)</option><option value="dont">Don't (avoid this)</option><option value="-">No tags</option>
      </select>
      <span class="lf-used" data-used></span>
    </div>
    <div class="lf-grid" data-grid></div>
    <p class="empty" data-empty hidden></p>
    <dialog class="lf-dlg" data-dlg></dialog>`;
  const q = (sel) => el.querySelector(`[data-${sel}]`);
  const S = { items: [], bytes: 0, max: 0, picked: [], busy: false, thumbs: new Map(), urls: new Map(), loaded: false };

  // ---------- note, tags and threads (shared by upload and edit) ----------
  let formN = 0;
  function metaForm({ note = '', tags = [], threads: on = [] } = {}) {
    const n = ++formN;
    const ref = tags.includes('do') ? 'do' : tags.includes('dont') ? 'dont' : '';
    const other = tags.filter((t) => !['do', 'dont', 'studio'].includes(t));
    const ids = new Set(on.map(Number));
    const list = [...threads];
    for (const id of ids) if (!list.some((t) => t.id === id)) list.push({ id, title: '(closed thread)' });
    return `
      <label class="lf-f" for="lf-note${n}">Note for the agents (what is this, what should they take from it?)</label>
      <textarea id="lf-note${n}" data-f="note" maxlength="2000" placeholder="e.g. Good: the squash on the jump. Bad: the eyes drift off the face.">${esc(note)}</textarea>
      <span class="lf-f">Reference</span>
      <div class="lf-ref" role="radiogroup" aria-label="Reference">
        <label><input type="radio" name="lf-ref${n}" value="" ${ref ? '' : 'checked'}>Just a file</label>
        <label><input type="radio" name="lf-ref${n}" value="do" ${ref === 'do' ? 'checked' : ''}>Do: copy this</label>
        <label><input type="radio" name="lf-ref${n}" value="dont" ${ref === 'dont' ? 'checked' : ''}>Don't: avoid this</label>
      </div>
      <div class="row" style="margin-top:10px">
        <label class="check"><input type="checkbox" data-f="studio" ${tags.includes('studio') ? 'checked' : ''}> For the Storytime studio</label>
      </div>
      <label class="lf-f" for="lf-tags${n}">Other tags (comma separated, optional)</label>
      <input type="text" id="lf-tags${n}" data-f="tags" value="${esc(other.join(', '))}" placeholder="e.g. leo, walk-cycle" style="width:100%">
      <span class="lf-f">Point threads to it (optional; every agent can find the library anyway)</span>
      <div class="lf-ths">${list.length ? list.map((t) => `<label title="${esc(t.title)}"><input type="checkbox" value="${t.id}" ${ids.has(t.id) ? 'checked' : ''}><span>#${t.id} ${esc(t.title)}</span></label>`).join('') : '<span class="lf-meta">No open threads.</span>'}</div>`;
  }
  function readForm(root) {
    const ref = root.querySelector('.lf-ref input:checked')?.value || '';
    const tags = [...(root.querySelector('[data-f="studio"]').checked ? ['studio'] : []), ...(ref ? [ref] : []), ...cleanTags(root.querySelector('[data-f="tags"]').value).filter((t) => !['do', 'dont', 'studio'].includes(t))];
    return {
      note: root.querySelector('[data-f="note"]').value.trim(),
      tags,
      threads: [...root.querySelectorAll('.lf-ths input:checked')].map((i) => Number(i.value)),
    };
  }

  // ---------- picking ----------
  for (const b of el.querySelectorAll('[data-pick]')) b.onclick = () => el.querySelector(`[data-in="${b.dataset.pick}"]`).click();
  for (const inp of el.querySelectorAll('[data-in]')) inp.onchange = () => { add([...inp.files]); inp.value = ''; };
  const drop = q('drop');
  el.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) drop.classList.remove('over'); });
  el.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); add([...(e.dataTransfer?.files || [])]); });
  document.addEventListener('paste', (e) => {
    if (el.hidden || el.closest('[hidden]') || e.target.closest?.('input, textarea')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); add(files); }
  });

  function add(files) {
    files = files.filter((f) => f && f.size >= 0);
    if (!files.length) return;
    if (S.busy) return toast('Wait for this upload to finish.');
    const fresh = !S.picked.length;
    S.picked.push(...files.map(plan));
    renderStage(fresh);
  }
  function renderStage(fresh) {
    q('stage').hidden = !S.picked.length;
    if (!S.picked.length) return;
    const total = S.picked.reduce((s, p) => s + p.file.size, 0);
    q('count').textContent = `${S.picked.length} file${S.picked.length > 1 ? 's' : ''} to upload (${size(total)})`;
    q('picked').innerHTML = S.picked
      .map((p, i) => `<li><span class="nm" title="${esc(p.name)}">${esc(p.name)}<small>${KIND_LABEL[p.kind]} · ${size(p.file.size)}${p.notes.length ? ` · ${esc(p.notes.join(', '))}` : ''}</small></span><button class="btn quiet" type="button" data-rm="${i}" aria-label="Remove ${esc(p.name)}">✕</button></li>`)
      .join('');
    for (const b of q('picked').querySelectorAll('[data-rm]')) b.onclick = () => { S.picked.splice(Number(b.dataset.rm), 1); renderStage(false); };
    if (fresh) {
      let last = {};
      try { last = JSON.parse(ls.get('library-last') || '{}'); } catch {}
      q('meta').innerHTML = metaForm({ tags: Array.isArray(last.tags) ? last.tags.filter((t) => t === 'studio') : [] });
    }
    q('up').textContent = `Upload ${S.picked.length > 1 ? `${S.picked.length} files` : ''}`.trim();
  }
  q('cancel').onclick = () => { S.picked = []; renderStage(false); };

  // ---------- uploading ----------
  async function send(op, body, tries = 3) {
    for (let n = 1; ; n++) {
      try {
        return await api(op, body);
      } catch (e) {
        if (n >= tries || /password|full|limit|too big|not allowed/i.test(e.message)) throw e;
        await sleep(n * 1500);
      }
    }
  }
  const progress = (text, frac) => {
    q('ptext').textContent = text;
    if (frac != null) q('pbar').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  };

  async function uploadOne(p, meta, report) {
    let extra = {};
    if (p.kind === 'image') {
      report('Making a copy for agents', 0);
      extra = await imageView(p.file);
    } else if (p.kind === 'video') {
      try {
        extra = await videoFrames(p.file, (s) => report(s, 0));
      } catch (e) {
        if (!p.keepBody) throw new Error(`${p.name}: too big to keep and ${e.message}`);
        extra = { warn: `${e.message}, so agents only get the file` };
      }
    }
    const chunks = p.keepBody ? Math.ceil(p.file.size / RAW_CHUNK) : 0;
    const parts = [];
    if (extra.view) parts.push({ part: 'view', i: 0, data: extra.view });
    if (extra.sheet) parts.push({ part: 'sheet', i: 0, data: extra.sheet });
    (extra.frames || []).forEach((data, i) => parts.push({ part: 'frame', i, data }));
    const weight = parts.reduce((s, x) => s + x.data.length, 0) + Math.ceil((p.file.size * 4) / 3) * (p.keepBody ? 1 : 0) || 1;
    let sent = 0;
    const { id } = await send('lib-put', { name: p.name, type: p.type, size: p.file.size, ...meta, chunks });
    try {
      for (const x of parts) {
        await send('lib-chunk', { id, ...x });
        sent += x.data.length;
        report('Uploading', sent / weight);
      }
      let next = 0;
      const worker = async () => {
        while (next < chunks) {
          const i = next++;
          const data = await b64(p.file.slice(i * RAW_CHUNK, (i + 1) * RAW_CHUNK));
          await send('lib-chunk', { id, part: 'body', i, data });
          sent += data.length;
          report('Uploading', sent / weight);
        }
      };
      await Promise.all(Array.from({ length: Math.min(POOL, chunks) }, worker));
      await send('lib-done', { id, ...(extra.frameTimes ? { frameTimes: extra.frameTimes } : {}) });
    } catch (e) {
      await api('lib-delete', { id }).catch(() => {});
      throw e;
    }
    return extra.warn || '';
  }

  q('up').onclick = async () => {
    if (S.busy || !S.picked.length) return;
    const meta = readForm(q('meta'));
    ls.set('library-last', JSON.stringify({ tags: meta.tags }));
    const list = S.picked.slice();
    S.busy = true;
    q('stage').hidden = true;
    q('prog').hidden = false;
    const failed = [], warns = [];
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      const head = `${list.length > 1 ? `File ${k + 1} of ${list.length} · ` : ''}${p.name}`;
      try {
        const w = await uploadOne(p, meta, (step, frac) => progress(`${head} · ${step}${frac ? ` ${Math.round(frac * 100)}%` : '…'}`, (k + frac) / list.length));
        if (w) warns.push(`${p.name}: ${w}`);
        S.picked.splice(S.picked.indexOf(p), 1);
      } catch (e) {
        failed.push(`${p.name}: ${e.message}`);
      }
      progress(head, (k + 1) / list.length);
      load().catch(() => {});
    }
    S.busy = false;
    q('prog').hidden = true;
    q('pbar').style.width = '0';
    renderStage(false);
    if (failed.length) toast(`Not uploaded: ${failed.join('; ')}`);
    else toast(warns.length ? `Uploaded. Note: ${warns.join('; ')}` : `Uploaded ${list.length > 1 ? `${list.length} files` : list[0].name}. Every agent can read ${list.length > 1 ? 'them' : 'it'} now.`);
  };
  addEventListener('beforeunload', (e) => { if (S.busy) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- list ----------
  async function load() {
    const r = await api('lib-list');
    S.items = (r.items || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    S.bytes = r.bytes || 0;
    S.max = r.max || 0;
    S.loaded = true;
    render();
  }
  const ready = (it) => !it.status || it.status === 'ready' || it.status === 'done';
  function matches(it) {
    const text = q('q').value.trim().toLowerCase();
    const kind = q('kind').value, tag = q('tag').value;
    if (kind && it.kind !== kind) return false;
    if (tag === '-' ? (it.tags || []).length : tag && !(it.tags || []).includes(tag)) return false;
    return !text || `${it.name} ${it.note || ''} ${(it.tags || []).join(' ')}`.toLowerCase().includes(text);
  }
  const tagChips = (it) =>
    (it.tags || []).map((t) => `<span class="lf-tag ${t === 'do' || t === 'dont' ? t : ''}">${t === 'do' ? 'Do' : t === 'dont' ? "Don't" : esc(t)}</span>`).join('') +
    (ready(it) ? '' : `<span class="lf-tag warn">${esc(it.status === 'uploading' ? 'unfinished' : it.status)}</span>`);
  function render() {
    q('used').textContent = S.max ? `${size(S.bytes)} of ${size(S.max)} used` : '';
    const list = S.items.filter(matches);
    q('empty').hidden = !!list.length;
    q('empty').textContent = S.items.length ? 'No files match.' : 'No files yet. Add reference pictures, clips or notes above; agents read them with lib_list and lib_get.';
    q('grid').innerHTML = list
      .map((it) => {
        const badge = it.kind === 'video' ? `▶ ${it.frames ? `${it.frames} frames` : 'video'}` : KIND_LABEL[it.kind] || 'File';
        return `<button class="lf-item" type="button" data-id="${esc(it.id)}"><span class="lf-thumb" data-thumb="${esc(it.id)}"><span data-ext>${esc((extOf(it.name) || it.kind || 'file').toUpperCase().slice(0, 5))}</span><span class="lf-kind">${esc(badge)}</span></span><span class="lf-cap"><b title="${esc(it.name)}">${esc(it.name)}</b><small>${size(it.size || 0)}</small><span class="lf-tags">${tagChips(it)}</span></span></button>`;
      })
      .join('');
    for (const b of q('grid').querySelectorAll('[data-id]')) b.onclick = () => open(b.dataset.id);
    for (const t of q('grid').querySelectorAll('[data-thumb]')) seen.observe(t);
  }
  for (const k of ['q', 'kind', 'tag']) q(k).addEventListener('input', render);

  // ---------- pictures ----------
  // Which small picture stands for an item: its view, a middle frame, or a small image itself.
  function thumbPart(it) {
    if (it.hasView) return { part: 'view', i: 0 };
    if (it.kind === 'video' && it.frames) return { part: 'frame', i: Math.floor((it.frames - 1) / 2) };
    if (it.kind === 'video' && it.hasSheet) return { part: 'sheet', i: 0 };
    if (it.kind === 'image' && it.hasBody && (it.size || 0) <= VIEW_BYTES) return { part: 'body', i: 0 };
    return null;
  }
  async function picture(it, part, i = 0) {
    const key = `${it.id}:${it.at}:${part}:${i}`;
    if (!S.thumbs.has(key)) {
      S.thumbs.set(key, api('lib-raw', null, `&id=${encodeURIComponent(it.id)}&part=${part}&i=${i}`).then((r) => `data:${r.type || (part === 'body' ? it.type : 'image/jpeg')};base64,${r.data}`));
      S.thumbs.get(key).catch(() => S.thumbs.delete(key));
    }
    return S.thumbs.get(key);
  }
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      const it = S.items.find((x) => x.id === e.target.dataset.thumb);
      const tp = it && thumbPart(it);
      if (!tp) continue;
      picture(it, tp.part, tp.i).then((src) => {
        const img = new Image();
        img.alt = '';
        img.loading = 'lazy';
        img.src = src;
        e.target.querySelector('[data-ext]')?.replaceWith(img);
      }).catch(() => {});
    }
  }, { rootMargin: '200px' });

  // The original, put back together from its chunks.
  async function original(it, report) {
    if (S.urls.has(`${it.id}:${it.at}`)) return S.urls.get(`${it.id}:${it.at}`);
    const first = await api('lib-raw', null, `&id=${encodeURIComponent(it.id)}&part=body&i=0`);
    const n = Math.max(1, first.chunks || 1);
    const parts = [await blobOf(first.data, it.type)];
    for (let i = 1; i < n; i++) {
      report?.(i / n);
      const r = await api('lib-raw', null, `&id=${encodeURIComponent(it.id)}&part=body&i=${i}`);
      parts.push(await blobOf(r.data, it.type));
    }
    const url = URL.createObjectURL(new Blob(parts, { type: it.type || 'application/octet-stream' }));
    S.urls.set(`${it.id}:${it.at}`, url);
    return url;
  }

  // ---------- one file ----------
  const dlg = q('dlg');
  async function open(id) {
    const it = S.items.find((x) => x.id === id);
    if (!it) return;
    const times = it.frameTimes || [];
    dlg.innerHTML = `
      <div class="head"><h2>${esc(it.name)}</h2><button class="btn quiet" type="button" data-x aria-label="Close">✕</button></div>
      <div class="lf-meta">${KIND_LABEL[it.kind] || 'File'} · ${size(it.size || 0)}${it.type ? ` · ${esc(it.type)}` : ''}${it.at ? ` · ${new Date(it.at).toLocaleString()}` : ''}${it.hasBody ? '' : it.kind === 'video' ? ' · original not kept (too big), agents see the frames' : ''}</div>
      <div class="lf-tags">${tagChips(it)}</div>
      <div class="lf-media" data-media><p class="lf-meta">Loading…</p></div>
      <div class="lf-actions">
        ${it.hasBody ? '<button class="btn" type="button" data-dl>Download</button>' : ''}
        <span class="spacer"></span>
        <button class="btn bad" type="button" data-del>Delete</button>
      </div>
      <form class="lf-edit" data-edit>
        <h3>Edit</h3>
        <label class="lf-f" for="lf-name">Name</label>
        <input type="text" id="lf-name" data-f="name" value="${esc(it.name)}" style="width:100%">
        ${metaForm({ note: it.note || '', tags: it.tags || [], threads: it.threads || [] })}
        <div class="lf-actions"><button class="btn go" type="submit">Save</button></div>
      </form>`;
    const media = dlg.querySelector('[data-media]');
    dlg.querySelector('[data-x]').onclick = () => dlg.close();
    dlg.querySelector('[data-dl]')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const url = await original(it, (f) => (b.textContent = `Download ${Math.round(f * 100)}%`));
        const a = Object.assign(document.createElement('a'), { href: url, download: it.name });
        document.body.append(a);
        a.click();
        a.remove();
      } catch (err) { toast(err.message); }
      b.disabled = false;
      b.textContent = 'Download';
    });
    dlg.querySelector('[data-del]').onclick = async () => {
      if (!confirm(`Delete ${it.name}? Agents will no longer see it.`)) return;
      try { await api('lib-delete', { id: it.id }); dlg.close(); toast(`Deleted ${it.name}.`); load(); } catch (err) { toast(err.message); }
    };
    dlg.querySelector('[data-edit]').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const name = cleanName(f.querySelector('[data-f="name"]').value);
      try {
        await api('lib-edit', { id: it.id, name, ...readForm(f) });
        toast('Saved.');
        dlg.close();
        load();
      } catch (err) { toast(err.message); }
    };
    if (!dlg.open) dlg.showModal();
    try {
      await fillMedia(it, media, times);
    } catch (err) {
      media.innerHTML = `<p class="lf-meta">Could not load a preview (${esc(err.message)}).</p>`;
    }
  }

  async function fillMedia(it, media, times) {
    const html = [];
    if (it.kind === 'image') {
      const tp = it.hasView ? { part: 'view' } : it.hasBody && (it.size || 0) <= VIEW_BYTES ? { part: 'body' } : null;
      if (tp) html.push(`<img alt="${esc(it.name)}" src="${await picture(it, tp.part)}">`);
      if (it.hasView) html.push('<p class="lf-meta">Agents see this copy. Download gets the original.</p>');
      if (!tp) html.push('<p class="lf-meta">No preview for this picture in the hub. Download it to look.</p>');
      media.innerHTML = html.join('');
      return;
    }
    if (it.kind === 'video') {
      if (it.hasBody) html.push('<div class="row" style="justify-content:center"><button class="btn go" type="button" data-play>▶ Play video</button></div><div data-player></div>');
      if (it.hasSheet) html.push(`<img alt="Contact sheet of ${esc(it.name)}" src="${await picture(it, 'sheet')}">`);
      if (it.frames) html.push(`<div class="lf-strip" data-strip>${Array.from({ length: it.frames }, (_, i) => `<figure><img alt="" data-fi="${i}"><figcaption>${times[i] != null ? secs(times[i]) : `#${i + 1}`}</figcaption></figure>`).join('')}</div>`);
      if (!html.length) html.push('<p class="lf-meta">Nothing to show yet.</p>');
      media.innerHTML = html.join('');
      for (const img of media.querySelectorAll('[data-fi]')) picture(it, 'frame', Number(img.dataset.fi)).then((s) => (img.src = s)).catch(() => {});
      media.querySelector('[data-play]')?.addEventListener('click', async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          const url = await original(it, (f) => (b.textContent = `Loading ${Math.round(f * 100)}%`));
          media.querySelector('[data-player]').innerHTML = `<video controls playsinline src="${url}"></video>`;
          b.parentElement.remove();
          media.querySelector('video').play().catch(() => {});
        } catch (err) {
          toast(err.message);
          b.disabled = false;
          b.textContent = '▶ Play video';
        }
      });
      return;
    }
    if (it.kind === 'text' && it.hasBody) {
      if ((it.size || 0) > 4 * 1024 * 1024) {
        media.innerHTML = '<p class="lf-meta">Too long to show here. Download it to read.</p>';
        return;
      }
      const url = await original(it);
      const text = await (await fetch(url)).text();
      media.innerHTML = `<pre>${esc(text.length > 200_000 ? `${text.slice(0, 200_000)}\n…` : text)}</pre>`;
      return;
    }
    media.innerHTML = '<p class="lf-meta">Agents can read this file with lib_get. Download it to open it here.</p>';
  }

  load().catch((e) => {
    q('empty').hidden = false;
    q('empty').textContent = `Could not load the files (${e.message}).`;
  });
  addEventListener('focus', () => { if (S.loaded && !S.busy && !el.hidden) load().catch(() => {}); });
  return { show: () => (S.busy ? null : load().catch(() => {})) };
}
