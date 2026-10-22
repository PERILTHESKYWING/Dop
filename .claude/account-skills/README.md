# Account skills

Copies of XIAO's claude.ai account skills, kept here so any Claude account can add them. This folder is not loaded automatically (that would duplicate the account copies); the repo's own task skills are in `.claude/skills/`.

| Skill | Runs | What it does |
| --- | --- | --- |
| work-habits | automatically, every task | batch questions to the end, respect limits, recheck old fixes, check every ask before "done", save lessons |
| premortem | `/premortem`, and automatically before big or multi-round tasks | imagine the task failed, prevent the likeliest causes |
| two-ways | `/two-ways`, and automatically when a new design starts | two different directions, user picks, then polish |
| taste | automatically on any visual work; `/taste`, `/taste add …`, `/taste remove N` | XIAO's design rules |
| showtaste | `/showtaste` | list the taste rules |
| design-shots | automatically when checking a web design | fixed desktop/phone screenshots, measured against the reference |
| design-critic-panel | automatically when running design critics | anchored, pairwise, median-scored critics |
| dop-dev | automatically on Dop/Kiai work | hard rules, lean session, verify, ship a ready PR |
| clarify | `/clarify` | 5-8 questions as tappable choices (AskUserQuestion, or cards in project threads) before work |
| be-ambitious | `/be-ambitious`, and automatically at the start of big or open-ended tasks | goal behind the goal, pick altitude/depth/range, outside check, then do it |
| altitude | `/altitude`, and on recurring streams of tasks | climb task → outcome (understand, decide, redesign), set up to own it |
| depth | `/depth`, `/deeper`, and on work with a right answer | four expert questions, raw material, real tools, hard targets |
| range | `/range`, `/crew`, and on important open-ended work | nouns → verbs, five fields with two critics, methods not role-play |
| outside-judge | automatically on anything checkable | a judge that isn't Claude's opinion, pass line set first, its numbers reported |
| keep-going | automatically before "impossible" or "good enough" | untried routes, prior art, ship then improve, honest numbers |

The last six come from Felix Rieseberg's "How to be more ambitious" (Oct 2026), rewritten in our own words for Dop's rules (free tiers, honest numbers, no invented analysis).

## Add them to another Claude account
Open a Claude Code session (or a project thread) on that account with this repo, and send:

> Read every `.claude/account-skills/*/SKILL.md` in the Dop repo and propose each one to me as a new account skill with propose_skills, unchanged, 3 per call. If a call is rate limited, wait and retry later instead of skipping any. Then list which ones I still need to save.

Then tap Save on each card. The taste rules on each account are separate after that: a `/taste add` on one account doesn't reach the other unless you copy it (update `taste/SKILL.md` here too).

The hub shares these skills with every account (`skill_list` / `skill_get`). After editing one here, run `node hub/seed-skills.mjs` and commit `hub/lib/skills-seed.js`.
