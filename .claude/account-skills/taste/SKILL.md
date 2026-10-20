---
name: taste
description: Use automatically whenever designing, building or reviewing anything visual (UI, page, landing, board, logo, image), and when the user types /taste to check a design or add or remove a rule.
---
# Taste

XIAO's personal design rules. They come from real feedback on Dop, Kami and Kiai and override generic design advice.

## Automatic use
- Whenever you design, build or review anything visual, follow every rule below without being asked.
- Before showing a design, check it against the rules, fix any break, and mention a rule only if you could not meet it.

## Commands
- `/taste` (no text): check the current design against every rule, list each break as `rule number: where it breaks: the fix`, fix what you can, and say which rules pass. Measure where possible (font sizes, colours, contrast, overlap) rather than guess.
- `/taste add <rule>` (or `/taste <a new rule in plain words>`): add the rule to the end of the list in XIAO's own words, tightened to one line, with today's date. If it contradicts an existing rule, ask once which wins.
- `/taste remove <number or words>`: remove that rule. Confirm which one if the match is unclear.
- `/taste show`: same as /showtaste.

## How an add or remove is saved
This skill's own file is the store. After an add or remove, propose an improvement of this `taste` skill (propose_skills, kind improvement, target `taste`) with the complete updated file: the list renumbered, nothing else changed. Then say in one line: "Tap Save on the card to keep it." No proposal tool available: print the full updated list and say it must be saved in Settings to stick.

## Rules
1. Nothing should look cheap or "AI generated": one font family, flat pressable buttons, small corner radii, short copy. (2026-10-09)
2. No decorative gradients. (2026-10-09)
3. No glows, rings, pulses, ripples or light beams. (2026-10-20)
4. No blue lights or neon accents. (2026-10-20)
5. No small grey text under titles; text is at least 17 px on landing pages. (2026-10-20)
6. No em-dashes in UI text. (2026-10-09)
7. Nothing overlaps while scrolling, and nothing important is cut off at any screen size. (2026-10-20)
8. Motion is calm: no fast cascades, every animation has a reason, holds let the eye rest. (2026-10-20)
9. Every control does something visible; no decorative scroll bars or dead buttons. (2026-10-20)
10. Match the reference image the user gave (colour, material, angle) and measure the match; "close enough" is not done. (2026-10-20)
11. Go boards: real wood that matches the reference (honey kaya, not orange), stones with shading and shadows, and never an invented stone or wall in a diagram. (2026-10-20)
12. Answers and key numbers are big and readable; the board or main visual gets the space. (2026-10-20)
