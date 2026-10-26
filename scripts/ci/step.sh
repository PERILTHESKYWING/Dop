#!/usr/bin/env bash
# Every workflow's default shell for `run:` steps (docs/handoff/training.md):
#
#   defaults:
#     run:
#       shell: bash scripts/ci/step.sh {0}
#
# GitHub passes the step's script as $1. It runs like GitHub's own `bash -e {0}`, with three
# differences that keep runs from failing for reasons that have nothing to do with the work:
# - The step runs at lower CPU priority (nice 10), so the runner agent always gets CPU time.
# - The step is the kernel's first choice when memory runs out (oom_score_adj 800), so a step
#   that uses too much memory dies on its own and the agent keeps talking to GitHub instead of
#   the whole machine going silent ("The hosted runner lost communication with the server").
# - When a step fails, its last lines become an error annotation, readable on the run's page
#   and through the API (gh api .../check-runs/<job id>/annotations) without the log.
# Output goes to a file that is followed live, not through a pipe, so a process the step
# leaves running in the background can never hold the step open.

script=$1
log=$(mktemp)
pre=()
command -v choom > /dev/null 2>&1 && pre=(choom -n 800 --)

"${pre[@]}" nice -n 10 bash -e "$script" > "$log" 2>&1 < /dev/null &
pid=$!
tail -n +1 -f --pid="$pid" "$log" &
tailer=$!
wait "$pid"
code=$?
wait "$tailer" 2> /dev/null

if [ "$code" -ne 0 ]; then
  case $code in
    137) why="killed (most likely out of memory)" ;;
    143) why="stopped (SIGTERM, a timeout or a cancel)" ;;
    *) why="exit code $code" ;;
  esac
  # The last lines, without colour codes, escaped for a workflow command.
  tail -n 25 "$log" | sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' | tail -c 3500 > "$log.tail"
  body=$(sed -e 's/%/%25/g' -e 's/\r/%0D/g' "$log.tail" | awk 'BEGIN { ORS = "%0A" } { print }')
  echo "::error title=Step failed: $why::${body}"
fi
rm -f "$log" "$log.tail"
exit "$code"
