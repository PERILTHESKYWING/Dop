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
# - The step runs in its own memory cgroup (machine memory minus 1.5 GB) and is the kernel's
#   first choice when memory runs out (oom_score_adj 800), so a step that uses too much memory
#   dies on its own and the runner keeps talking to GitHub instead of the whole machine going
#   silent ("The hosted runner lost communication with the server").
# - When a step fails, its last lines become an error annotation, readable on the run's page
#   and through the API (gh api .../check-runs/<job id>/annotations) without the log.
# Output goes to a file that is followed live, not through a pipe, so a process the step
# leaves running in the background can never hold the step open.

script=$1
log=$(mktemp)
pre=()
command -v choom > /dev/null 2>&1 && pre=(choom -n 800 --)

# On a GitHub runner, the step also gets its own memory cgroup capped at the machine's memory
# minus 1.5 GB, so running out of memory kills only the step. Without it the step sits in the
# runner's own systemd service (hosted-compute-agent.service), and systemd stops that whole
# service when anything in it is killed for memory: the job dies (stress test, 2026-10-26). Anywhere this can't be set up
# (no sudo, no cgroup v2), the step simply runs without it.
cg=""
if [ "${GITHUB_ACTIONS:-}" = true ] && [ -f /sys/fs/cgroup/cgroup.controllers ] && sudo -n true 2> /dev/null; then
  total=$(awk '/^MemTotal:/ {print $2 * 1024}' /proc/meminfo)
  cap=$((total - 1536 * 1024 * 1024))
  cg=/sys/fs/cgroup/ci-step-$$
  if ! { sudo mkdir -p "$cg" && echo "$cap" | sudo tee "$cg/memory.max" > /dev/null; } 2> /dev/null; then
    sudo rmdir "$cg" 2> /dev/null
    cg=""
  fi
fi

(
  # $BASHPID read here, not inside the pipe (each side of a pipe is its own subshell).
  me=$BASHPID
  [ -n "$cg" ] && echo "$me" | sudo tee "$cg/cgroup.procs" > /dev/null 2>&1
  exec "${pre[@]}" nice -n 10 bash -e "$script"
) > "$log" 2>&1 < /dev/null &
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
[ -n "$cg" ] && sudo rmdir "$cg" 2> /dev/null
exit "$code"
