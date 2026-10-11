#!/usr/bin/env bash
# The champion against the built-in network at equal time (gate.ts), and the site's
# manifest: export champion.pt, measure it, record what it was trained on.
#   gate.sh <network name> <milliseconds per move> <teacher id> <minds per run>
set -euo pipefail
NAME=$1; MS=$2; TEACHER=$3; MINDS=$4
python scripts/student/export.py --ckpt champion.pt --out public/student/dopnet.dopnet --name "$NAME"
npx tsx scripts/student/gate.ts --ref ref.json --net public/student/dopnet.dopnet --ms "$MS" \
  --manifest public/student/manifest.json --file dopnet.dopnet --out gate.json
[ -f population.json ] || echo '{}' > population.json
[ -f arena.json ] || echo '{}' > arena.json
jq --slurpfile p population.json --slurpfile a arena.json --arg t "$TEACHER" --argjson m "$MINDS" \
  '.trained = {samples: ($p[0].samples // 0), records: ($a[0].best.meta.records // 0), teacher: $t, minds: $m, nights: ($p[0].runs // 0),
     shape: ($a[0].best.shape // null | if . then "\(.c)x\(.blocks)" else null end)}' \
  public/student/manifest.json > m.json && mv m.json public/student/manifest.json
