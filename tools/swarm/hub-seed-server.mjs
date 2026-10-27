// Starts the hub dev server (memory store, fake Claude) and seeds realistic data.
// Usage: node hub-seed-server.mjs   (port 7791 or PORT, password dev; BIG=1 adds 55 threads and a long one, LONG=n sets its length)
process.env.HUB_DEV_MEMORY = '1';
process.env.HUB_FAKE_CLAUDE = '1';
process.env.HUB_PASSWORD = 'dev';
await import(new URL('../../hub/dev.mjs', import.meta.url));
const { hubFromEnv } = await import(new URL('../../hub/lib/api.js', import.meta.url));
const hub = hubFromEnv();

await hub.upsertAccount({ name: 'Main', plan: 'max', routines: [{ model: 'opus', id: 'trig_main_opus', token: 'tokmain1' }, { model: 'sonnet', id: 'trig_main_son', token: 'tokmain2' }] });
await hub.upsertAccount({ name: 'Alt', plan: 'pro', routines: [{ model: 'opus', id: 'trig_alt_opus', token: 'tokalt1' }] });
await hub.upsertAccount({ name: 'Alt 2', plan: 'pro', routines: [{ model: 'sonnet', id: 'trig_alt2_s', token: 'tokalt22' }] });
await hub.upsertAccount({ name: 'Helper1', plan: 'free' });
await hub.setUsage('Main', { five_hour_pct: 34, seven_day_pct: 61 });
await hub.setUsage('Alt', { five_hour_pct: 72, seven_day_pct: 40 });
await hub.setUsage('Alt 2', { five_hour_pct: 8, seven_day_pct: 22 });
const A = async (n) => hub.account(n);
// Post as the account the hub actually gave the thread (it moves work off a low account), so names match.
// The coordinator posts as the account it was started on (the hub's "Coordinator started on X" note).
const coord = async () => A((await hub.snapshot()).messages.filter((m) => m.thread === 0 && m.kind === 'start').pop()?.text.match(/started on (.+?) \(/)?.[1] || 'Main');
const owner = async (t, fallback) => A((await hub.threads()).find((x) => x.id === t.id)?.account || fallback);

// Project chat: one prompt routed into threads
const p1 = await hub.prompt({ text: 'Kiai review screen feels slow on my phone, and the ko marker is hard to see in dark mode. Fix both and tell me the numbers.', model: '', thinking: 'medium' });
await hub.route(await coord(), {
  prompt_id: p1.id,
  summary: 'Two independent fixes, one thread each',
  threads: [
    { title: 'Kiai phone review: first paint under 1 s', brief: 'Measure first paint of the review screen on a throttled phone profile, find the biggest blocker, fix it, report before/after.', model: 'opus', account: 'Main' },
    { title: 'Ko marker unreadable in dark mode', brief: 'The ko square uses the same ink as the board lines in dark. Give it a contrast that passes 3:1 on both themes.', model: 'sonnet', account: 'Alt 2' },
  ],
});
const ths = await hub.threads();
const t1 = ths.find((t) => t.title.startsWith('Kiai phone'));
const t2 = ths.find((t) => t.title.startsWith('Ko marker'));
await hub.agentPost(await A('Main'), { thread: t1.id, kind: 'progress', text: 'Measured on a Moto G4 profile (4x CPU, Fast 3G): **first paint 2.84 s**, review ready 4.1 s.\n\nBiggest blocker: the 3D board module (412 KB) loads before the move list. Splitting it so the flat board paints first.' });
await hub.agentPost(await A('Main'), { thread: t1.id, kind: 'thinking', text: 'The flat board is already in the entry chunk, so lazy-loading three.js should not change what the user sees first.' });
await hub.agentRun(await A('Main'), { action: 'start', id: 'bench', thread: t1.id, title: 'Run throttled benchmark x5', step: 'Run 3 of 5', pct: 60 });
await hub.agentPost(await A('Main'), { thread: t1.id, kind: 'progress', text: 'After the split: first paint **0.92 s** (median of 5), review ready 2.3 s. Running the full test suite now.' });

await hub.agentPost(await owner(t2, 'Alt 2'), { thread: t2.id, kind: 'progress', text: 'The ko square was `#3b332a` on `#4a3420` wood: contrast 1.2:1. Changed to the white-stone ink in dark (6.8:1) and kept black in light (9.1:1).' });
await hub.checkpoint(await owner(t2, 'Alt 2'), { thread: t2.id, done: 'Ko marker uses stone ink per theme; screenshot test added.', next: 'Nothing; ready for review.', branch: 'claude/ko-marker-dark' });
await hub.agentPost(await owner(t2, 'Alt 2'), { thread: t2.id, kind: 'done', text: 'Done. Ko marker passes 3:1 on both themes. PR: https://github.com/PERILTHESKYWING/Dop/pull/116' });
await hub.routed(await coord(), p1.id, 'Both threads are running.');

// A second prompt
const p2 = await hub.prompt({ text: 'Which joseki source should the Forge use for the next problem set? Ask me before you start.', model: '' });
await hub.route(await coord(), { prompt_id: p2.id, summary: 'One thread, it will ask you first', threads: [{ title: 'Forge: pick the joseki source for set 25', brief: 'Compare three joseki sources we may be able to use, check each licence, and ask XIAO which to use.', model: 'sonnet', account: 'Alt', code: false }] });
const t3 = (await hub.threads()).find((t) => t.title.startsWith('Forge'));
await hub.agentPost(await owner(t3, 'Alt'), {
  thread: t3.id, kind: 'question', text: 'Three sources could work. Licences are not checked yet for the first two. Which one should set 25 use?',
  meta: { questions: [{ header: 'Joseki source', question: 'Which source should the Forge draw from?', options: [{ label: 'KataGo self-play lines', description: 'Modern lines; licence of the published data still to check' }, { label: 'Classic pro game records (1930s-1950s)', description: 'Joseki would be extracted from classic pro games; copyright of each collection still to check' }, { label: 'Your own studied lines', description: 'Yours, so no licence question; smallest set' }] }] },
});

// More threads in other states
const t4 = await hub.createThread({ title: 'Library: video thumbnails in the Files tab', brief: 'Show the first sheet of each video as its thumbnail.', model: 'sonnet', account: 'Alt' });
const t5 = await hub.createThread({ title: 'Studio nightly rules job writes duplicate rules', brief: 'Dedupe the nightly rules before saving.', model: 'opus', account: 'Main' });
await hub.agentPost(await owner(t5, 'Main'), { thread: t5.id, kind: 'done', text: 'Fixed: rules are compared after lower-casing and trimming. 14 duplicates removed from the store. PR: https://github.com/PERILTHESKYWING/Dop/pull/114' });
const t6 = await hub.createThread({ title: 'Hub: Team panel shows stale usage after a reset', brief: 'After a 5-hour reset the bar keeps the old %.', model: 'sonnet', account: 'Alt 2' });
await hub.agentPost(await owner(t6, 'Alt 2'), { thread: t6.id, kind: 'progress', text: 'Reproduced with a fake clock: the card reads `usage.at` but never compares it with `resets_at`.' });
for (const [title, acc] of [['Kiai study path: XP table 30k to 9d', 'Main'], ['Doppel: mistake replay on the free board', 'Alt'], ['THIRD_PARTY_NOTICES for the new icons', 'Alt 2']]) {
  const t = await hub.createThread({ title, brief: title, model: 'sonnet', account: acc });
  await hub.agentPost(await owner(t, acc), { thread: t.id, kind: 'done', text: `Done: ${title}.` });
}

await hub.learn({ text: 'Push once per thread when the work is done, never after each edit.', kind: 'do', why: 'Vercel Hobby allows about 100 deployments a day.', by: 'XIAO' });
await hub.learn({ text: 'Never name Gemini in the Kiai app.', kind: 'dont', why: 'Product rule.', by: 'Main', thread: t1.id });
// Alt has connected before (it is only low on usage now).
await hub.touchAccount('Alt');
await hub.learn({ text: 'Bump ENGINE_FILES whenever public/engine changes.', kind: 'do', why: 'Vercel caches /engine for a week.', by: 'Alt' });
console.log('SEEDED', (await hub.threads()).length, 'threads');

if (process.env.BIG === '1') {
  const accs = ['Main', 'Alt', 'Alt 2'];
  const lorem = 'Checked the review screen on the throttled profile. The move list renders **after** the board, so the first paint waits on `three.js`.\n\n- first paint 2.84 s → 0.92 s\n- review ready 4.1 s → 2.3 s\n\nNext: run `npm test` and the phone shots.';
  for (let i = 0; i < 55; i++) {
    const acc = accs[i % 3];
    const t = await hub.createThread({ title: `Task ${i + 1}: ${['Kiai', 'Hub', 'Doppel', 'Forge', 'Studio'][i % 5]} change number ${i + 1} with a longer title`, brief: lorem, model: 'sonnet', account: acc });
    const who = await owner(t, acc);
    for (let j = 0; j < 9; j++) await hub.agentPost(who, { thread: t.id, kind: j === 8 && i % 2 ? 'done' : 'progress', text: `${j + 1}. ${lorem}` });
  }
  // One long thread for scroll tests: 200 messages (LONG=500 for more).
  const n = Number(process.env.LONG) || 200;
  const lt = await hub.createThread({ title: `Long thread: ${n} messages`, brief: lorem, model: 'sonnet', account: 'Main' });
  const lw = await owner(lt, 'Main');
  for (let j = 0; j < n; j++) await hub.agentPost(lw, { thread: lt.id, kind: j % 10 === 9 ? 'thinking' : 'progress', text: `${j + 1}. ${lorem}` });
  console.log('BIG seeded', (await hub.threads()).length);
}
