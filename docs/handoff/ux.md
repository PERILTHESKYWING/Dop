# UX decisions
Summary: board pages share one Fox-style screen; the site is deliberately plain. Follow these unless XIAO says otherwise.

- XIAO's priority: the free AI study board and Doppelgänger. Other pages are secondary.
- Study, Review, Live games and Doppelgänger all use `src/components/BoardScreen.tsx` (modelled on Fox Weiqi): full-width board, eval bar above, plain step buttons below, Home + Save in the head, tabs Data / Trend / Blunder / Performance / Skill.
- Nothing covers the board except the save and leave-without-saving notices. Focus mode was removed on purpose.
- Doppelgänger games hide eval and tabs until the Analysis toggle is on.
- Study opens empty in "recording" mode; Review opens on a game picker.
- Move numbers: bold, opposite colour, never circled; current move's number red. Selected Data line shows solid numbered stones and a green row.
- Move badges are chess.com-style classes (`src/lib/coach/classify.ts`); Performance shows Brilliant to Blunder only.
- Visual style (round 10, after XIAO said it looked "AI generated"): one font (Archivo), flat pressable buttons, no gradients or glow, small radii, short copy, no em-dashes in UI text.
- Phone: tab bar Home / Study / Doppelgänger + More; labels must fit in full (use icons if not). Desktop: 104px labelled icon rail.
- Betting and focus mode were removed; do not bring them back.
