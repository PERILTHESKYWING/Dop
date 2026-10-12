---
name: dop-ship-pr
description: Use when a Dop change is built and tested, to branch, push and open a ready (not draft) PR.
---
# Ship a PR
1. Branch from fresh main: `git fetch origin main && git checkout -b claude/<short-topic> origin/main`. Keep one topic per PR.
2. Run dop-verify first. Do not open the PR with a failing check.
3. Commit small and clear, then `git push -u origin <branch>`.
4. Open it ready for review, never draft. `gh pr create` can fail here (GraphQL is blocked), so use the REST route: `gh api repos/PERILTHESKYWING/Dop/pulls -f title='...' -f head='<branch>' -f base=main -f body='...'`. Do not pass `draft=true`.
5. Body: Before, After, How, Checks (the three commands and results). Plain words.
6. Tell XIAO in one line what to merge and anything they must do after. If a Vercel or GitHub click is needed, spell each click out, as few as possible.
7. Ask first before anything that costs money, deletes data, or changes production settings.
