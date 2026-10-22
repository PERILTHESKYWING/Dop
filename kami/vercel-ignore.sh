#!/bin/sh
# Vercel ignoreCommand for Kiai (kept in a file: Vercel rejects commands over 256 characters).
# Exit 0 skips the build, anything else builds, so an error always builds.
cd "$(git rev-parse --show-toplevel)" || exit 1
exec git diff --quiet HEAD^ HEAD -- . \
  ':!docs' ':!.claude' ':!.claude-plugin' ':!.github' ':!hub' ':!eval' ':!data' \
  ':!README.md' ':!CLAUDE.md' ':!THIRD_PARTY_NOTICES.md' ':!tools' ':!scripts' ':!tests' \
  ':!public/student' ':!public/book' ':!public/level' ':!public/coach' ':!public/problems' \
  ':!public/broadcast' ':!public/pc-helper' ':!public/downloads'
