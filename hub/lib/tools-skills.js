// Shared skills and the ask_user question tool for the hub MCP. Skills are
// SKILL.md texts every account reads the same way (skill_list / skill_get);
// the bundled set comes from .claude/account-skills, and skill_put saves a
// change for everyone. ask_user is the hub's AskUserQuestion: it posts
// tappable question cards to the thread and waits for the answer.
import { SEED_SKILLS } from './skills-seed.js';

const MAX_SKILL = 64 * 1024;
const WAIT_MAX_S = 45;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const K = { skills: 'hub:skills' };
const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

export function cleanSkillName(name) {
  const n = String(name ?? '').trim().toLowerCase().replace(/^\/+/, '');
  if (!/^[a-z0-9][a-z0-9:_-]{0,63}$/.test(n)) throw new Error('skill name may use only a-z, 0-9, - _ : (max 64 characters)');
  return n;
}

// The frontmatter fields the hub shows in a list.
export function skillInfo(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const field = (k) => (m && new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(m[1])?.[1].trim().replace(/^["']|["']$/g, '')) || '';
  return { description: field('description'), argumentHint: field('argument-hint') };
}

// Trim and validate ask_user questions the way Claude's AskUserQuestion does.
export function cleanQuestions(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('questions must be a list of 1 to 4 questions');
  if (list.length > 4) throw new Error('at most 4 questions per call; send two ask_user calls in the same turn for more');
  return list.map((q, i) => {
    const question = String(q?.question ?? '').trim();
    const options = (Array.isArray(q?.options) ? q.options : []).map((o) => ({ label: String(o?.label ?? '').trim().slice(0, 80), description: String(o?.description ?? '').trim().slice(0, 240) })).filter((o) => o.label);
    if (!question) throw new Error(`question ${i + 1} has no text`);
    if (options.length < 2 || options.length > 4) throw new Error(`question ${i + 1} needs 2 to 4 options`);
    return { header: String(q?.header ?? '').trim().slice(0, 12) || `Q${i + 1}`, question: question.slice(0, 400), options, multiSelect: !!q?.multiSelect };
  });
}

export function questionText(qs) {
  return qs.map((q, i) => `${i + 1}. ${q.header}: ${q.question}\n${q.options.map((o) => `   - ${o.label}${o.description ? ` (${o.description})` : ''}`).join('\n')}`).join('\n');
}

export function skillTools(hub) {
  const { store } = hub;
  const now = hub.now || (() => Date.now());
  const str = { type: 'string' };
  const num = { type: 'number' };
  const saved = async () => {
    const flat = await store.cmd('HGETALL', K.skills);
    const out = {};
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = parse(flat[i + 1]);
    return out;
  };
  const all = async () => {
    const over = await saved();
    const out = {};
    for (const [n, text] of Object.entries(SEED_SKILLS)) out[n] = { text, by: 'bundled' };
    for (const [n, s] of Object.entries(over)) if (s?.text) out[n] = { text: s.text, by: s.by, at: s.at };
    return out;
  };

  return [
    {
      name: 'skill_list',
      description: 'List the skills shared by the hub (the same for every account), with what each does. When XIAO sends a skill command such as /clarify or /premortem, or a task matches a skill, read it with skill_get and follow it exactly.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const list = await all();
        return Object.entries(list)
          .sort(([p], [q]) => p.localeCompare(q))
          .map(([n, s]) => {
            const i = skillInfo(s.text);
            return `/${n}${i.argumentHint ? ` ${i.argumentHint}` : ''}: ${i.description || '(no description)'}`;
          })
          .join('\n');
      },
    },
    {
      name: 'skill_get',
      description: 'Read one shared skill (its full SKILL.md) and follow it. Accepts "/clarify" or "clarify".',
      inputSchema: { type: 'object', properties: { name: str }, required: ['name'] },
      run: async (a, x) => {
        const n = cleanSkillName(x.name);
        const s = (await all())[n];
        if (!s) return `No skill "${n}". See skill_list.`;
        return `Skill /${n} (${s.by}). Follow it exactly. Where it names AskUserQuestion, use the hub's ask_user tool (thread: your thread id) if you have no AskUserQuestion.\n\n${s.text}`;
      },
    },
    {
      name: 'skill_put',
      description: 'Save a skill (its whole SKILL.md text, with frontmatter) for every account, replacing the one with that name.',
      inputSchema: { type: 'object', properties: { name: str, content: str }, required: ['name', 'content'] },
      run: async (a, x) => {
        const n = cleanSkillName(x.name);
        const text = String(x.content ?? '');
        if (!/^---\r?\n[\s\S]*?\r?\n---/.test(text)) throw new Error('content must start with SKILL.md frontmatter (--- name, description ---)');
        if (Buffer.byteLength(text) > MAX_SKILL) throw new Error(`skill is over ${MAX_SKILL / 1024} KB`);
        const had = (await all())[n];
        await store.cmd('HSET', K.skills, n, JSON.stringify({ text, by: a.name, at: now() }));
        return `${had ? 'Replaced' : 'Saved'} skill /${n}. Every account sees it now.`;
      },
    },
    {
      name: 'ask_user',
      description:
        'The hub\'s AskUserQuestion. Posts 1 to 4 multiple-choice questions to XIAO in your thread as tappable cards and waits (up to wait_s, max 45) for the answer. Each question: header (12 characters or fewer), question (ends in ?), 2 to 4 options with label and description (put the default first, label ending "(Recommended)"), optional multiSelect. "Other" is added automatically. For 5 to 8 questions, call it twice in the same turn. If no answer comes in time, carry on with hub_wait(thread, after: <id>).',
      inputSchema: {
        type: 'object',
        properties: {
          thread: num,
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: { header: str, question: str, multiSelect: { type: 'boolean' }, options: { type: 'array', items: { type: 'object', properties: { label: str, description: str }, required: ['label'] } } },
              required: ['question', 'options'],
            },
          },
          wait_s: num,
        },
        required: ['thread', 'questions'],
      },
      run: async (a, x) => {
        const qs = cleanQuestions(x.questions);
        const tid = Number(x.thread) || 0;
        const msg = await hub.agentPost(a, { thread: tid, kind: 'question', text: questionText(qs), meta: { questions: qs } });
        const id = Number(/#(\d+)/.exec(msg)?.[1]);
        const end = now() + Math.min(WAIT_MAX_S, x.wait_s ?? 40) * 1000;
        for (;;) {
          const ans = await hub.answerFor(id);
          if (ans) return `XIAO answered #${id}: ${ans.text}`;
          if (now() >= end) break;
          await sleep(2500);
        }
        return `No answer to #${id} yet. Carry on with anything that does not need it, then check with hub_wait(thread: ${tid}, after: ${id - 1}).`;
      },
    },
  ];
}
