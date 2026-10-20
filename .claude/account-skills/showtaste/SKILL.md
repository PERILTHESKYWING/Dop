---
name: showtaste
description: Use only when the user types /showtaste: list XIAO's current design taste rules, numbered, from the taste skill.
---
# /showtaste

Show the current rules of the `taste` skill. Change nothing.

1. Get the newest saved version of the `taste` skill: if its text is already in this conversation, use it; otherwise load it with the Skill tool (`taste`, args `show`) or find its SKILL.md under the skills folders (for example Glob `**/taste/SKILL.md` in `~/.claude/skills`).
2. Print only the `## Rules` list, numbered exactly as saved, with each rule's date.
3. End with one line: "/taste add <rule> to add, /taste remove <number> to remove."

If the taste skill can't be found, say it isn't saved to this account yet.
