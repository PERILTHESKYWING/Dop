#!/usr/bin/env bash
# Native KataGo (CPU, AVX2) and the teacher network for the AI training workflow.
#   setup-katago.sh <teacher: b18|b28|b10>
# Writes KATAGO, TEACHER and TEACHER_ID to $GITHUB_ENV (or prints them).
set -euo pipefail
WANT=${1:-b18}
KATAGO_ZIP=https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-eigenavx2-linux-x64.zip
KATA1=https://media.katagotraining.org/uploaded/networks/models/kata1
G170=https://github.com/lightvector/KataGo/releases/download/v1.4.5
mkdir -p kg nets
if [ ! -x kg/katago ]; then
  curl -sSLf --retry 3 -o kg/katago.zip "$KATAGO_ZIP"
  unzip -q -o kg/katago.zip -d kg && chmod +x kg/katago && rm kg/katago.zip
fi
kg/katago version | head -1

fetch() { # file url...
  local f=$1; shift
  [ -s "nets/$f" ] && return 0
  for u in "$@"; do
    if curl -sSLf --retry 2 -m 900 -o "nets/$f.part" "$u"; then mv "nets/$f.part" "nets/$f"; return 0; fi
  done
  rm -f "nets/$f.part"; return 1
}
case "$WANT" in
  b28) F=kata1-b28c512nbt-s8326494464-d4628051565.bin.gz; ID=kata1-b28c512nbt ;;
  b10) F=; ID=g170e-b10c128 ;;
  *)   F=kata1-b18c384nbt-s9996604416-d4316597426.bin.gz; ID=kata1-b18c384nbt ;;
esac
if [ -n "$F" ] && fetch "$F" "$KATA1/$F"; then
  TEACHER=nets/$F
elif [ "$WANT" != b10 ] && fetch g170e-b20c256x2-s5303129600-d1228401921.bin.gz "$G170/g170e-b20c256x2-s5303129600-d1228401921.bin.gz"; then
  # katagotraining.org unreachable: the strongest network on GitHub instead.
  TEACHER=nets/g170e-b20c256x2-s5303129600-d1228401921.bin.gz; ID=g170e-b20c256x2
else
  TEACHER=public/models/g170e-b10c128-s1141046784-d204142634.bin.gz; ID=g170e-b10c128
fi
echo "teacher: $ID ($TEACHER)"
{ echo "KATAGO=$PWD/kg/katago"; echo "TEACHER=$PWD/$TEACHER"; echo "TEACHER_ID=$ID"; } >> "${GITHUB_ENV:-/dev/stdout}"
