#!/usr/bin/env bash
# Games for the teacher to label, different every run and machine.
#   games.sh pro <count> <seed>      -> pro.txt (one SGF per line, professional games)
#   games.sh fox <count> <seed> <job> -> fox/ (amateur Fox games of some of the ranks)
set -euo pipefail
KIND=$1; COUNT=$2; SEED=$3; JOB=${4:-0}
if [ "$KIND" = pro ]; then
  git clone -q --filter=blob:none --no-checkout --depth 1 https://github.com/yenw/computer-go-dataset pro-src
  (cd pro-src && git checkout -q HEAD -- Professional/pro2000+.zip Professional/pro1940-1999.zip)
  unzip -q -o pro-src/Professional/pro2000+.zip -d prodata && unzip -q -o pro-src/Professional/pro1940-1999.zip -d prodata
  cat prodata/*.txt | grep '^(' | shuf -n "$COUNT" --random-source=<(yes "$SEED") > pro.txt
  rm -rf pro-src prodata
  wc -l pro.txt
else
  command -v 7z > /dev/null || (sudo apt-get update -q && sudo apt-get install -y -q p7zip-full)
  git clone -q --filter=blob:none --no-checkout --depth 1 https://github.com/featurecat/go-dataset fox-src
  cd fox-src
  # Three ranks per machine, spread over the whole range (18k to 9d), different every run.
  DIRS=$(git ls-tree -d --name-only HEAD | grep -E '^[0-9]+[kd]$' | shuf --random-source=<(yes "$SEED$JOB") | head -n 3 || true)
  PER=$(( COUNT / 3 + 1 ))
  for d in $DIRS; do
    git checkout -q HEAD -- "$d/"
    for ARCH in $(ls "$d"/ | grep -E '\.7z(\.001)?$'); do
      7z l -ba -slt "$d/$ARCH" | sed -n 's/^Path = //p' | grep -i '\.sgf$' | shuf --random-source=<(yes "$SEED$d") | head -n "$PER" > "../$d.list" || true
      7z x -y -o"../fox/$d" "$d/$ARCH" @"../$d.list" > /dev/null || true
    done
    rm -f "$d"/*.7z*
  done
  cd .. && rm -rf fox-src
  echo "fox games: $(find fox -iname '*.sgf' | wc -l) from $DIRS"
fi
