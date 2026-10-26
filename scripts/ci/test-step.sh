#!/usr/bin/env bash
# Tests for scripts/ci/step.sh (run by workflow-check.yml): it must behave like GitHub's
# `bash -e {0}` (exit codes, -e, environment) and add its extras (lower priority, first to
# be killed on out-of-memory, an error annotation on failure, no hang on background processes).
set -u
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
fails=0
export STEP_TEST=value-42
check() { # name, expected exit, expected text in output, script
  printf '%s\n' "$4" > "$tmp/s.sh"
  local start out code
  start=$(date +%s)
  out=$(bash "$here/step.sh" "$tmp/s.sh" 2>&1)
  code=$?
  if [ "$code" != "$2" ] || ! grep -qF -- "$3" <<< "$out" || [ $(($(date +%s) - start)) -gt 10 ]; then
    echo "FAIL $1: exit $code (want $2), output: $out"
    fails=$((fails + 1))
  else
    echo "ok   $1"
  fi
}
check 'success' 0 'hello' 'echo hello'
check '-e stops at the first failure' 1 '::error title=Step failed: exit code 1::before' 'echo before
false
echo never'
check 'exit code kept' 7 '100%25 done' 'echo 100% done
exit 7'
check 'killed step is named' 137 'killed (most likely out of memory)' 'kill -9 $$'
check 'background process does not hold the step' 0 'started' 'sleep 60 &
echo started'
base=$(nice); want=$((base + 10 > 19 ? 19 : base + 10))
check 'lower CPU priority' 0 "$want" 'nice'
if [ "${GITHUB_ACTIONS:-}" = true ] && sudo -n true 2> /dev/null; then
  check 'own memory cgroup on GitHub runners' 0 'ci-step-' 'cat /proc/self/cgroup'
fi
command -v choom > /dev/null && check 'first to be killed on out-of-memory' 0 '800' 'cat /proc/self/oom_score_adj'
check 'environment passes through' 0 'value-42' 'echo "$STEP_TEST"'
rm -rf "$tmp"
[ "$fails" = 0 ] && echo "step.sh: all tests passed" || { echo "step.sh: $fails failed"; exit 1; }
