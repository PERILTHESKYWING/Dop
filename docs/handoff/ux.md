# UX decisions
Summary: board pages share one Fox-style screen; the site is deliberately plain. Follow these unless XIAO says otherwise.

- XIAO's priority: the free AI study board and Doppelgänger. Other pages are secondary.
- Study, Review, Live games and Doppelgänger all use `src/components/BoardScreen.tsx` (modelled on Fox Weiqi): full-width board, eval bar above, plain step buttons below, Home + Save in the head, tabs Data / Trend / Blunder / Performance / Skill.
- Nothing covers the board except the save and leave-without-saving notices. Focus mode was removed on purpose.
- Doppelgänger games hide eval and tabs until the Analysis toggle is on.
- Study opens empty in "recording" mode; Review opens on a game picker.
- Nothing on a board is lost on reload (2026-10-12, XIAO): the Study working copy autosaves to IndexedDB (`study.draft`) and the address follows it (`#/study?draft=1`, or `#/study/<id>` once saved), so a reload reopens it; plain `#/study` still opens empty but offers **Resume**. Review keeps `?move=` in the address. `router.replaceQuiet` does this without reopening the page.
- Accounts (2026-10-12): signed in, every saved change uploads on its own (45 s after the last change, at most 4 min while changes keep coming, at once when the tab is hidden) and a newer copy from another device is pulled when the tab returns. `dop.syncedId` skips re-downloading our own copy; commit sends `base` and the server answers 409 `stale` if another device committed first, then the client merges and retries. Home, the sidebar and the landing page offer Sign up / Log in.
- Move numbers: bold, opposite colour, never circled; current move's number red. Selected Data line shows solid numbered stones and a green row.
- Move badges are chess.com-style classes (`src/lib/coach/classify.ts`); Performance shows Brilliant to Blunder only.
- Visual style (round 10, after XIAO said it looked "AI generated"): one font (Archivo), flat pressable buttons, no gradients or glow, small radii, short copy, no em-dashes in UI text.
- Phone: tab bar Home / Study / Doppelgänger + More; labels must fit in full (use icons if not). Desktop: 104px labelled icon rail.
- Betting and focus mode were removed; do not bring them back.
