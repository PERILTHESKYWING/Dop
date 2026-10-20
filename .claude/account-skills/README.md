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

## Add them to another Claude account
Open a Claude Code session (or a project thread) on that account with this repo, and send:

> Read every `.claude/account-skills/*/SKILL.md` in the Dop repo and propose each one to me as a new account skill with propose_skills, unchanged, 3 per call. If a call is rate limited, wait and retry later instead of skipping any. Then list which ones I still need to save.

Then tap Save on each card. The taste rules on each account are separate after that: a `/taste add` on one account doesn't reach the other unless you copy it (update `taste/SKILL.md` here too).
