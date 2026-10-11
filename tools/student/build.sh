#!/usr/bin/env bash
# Builds the DopNet runtime (tools/student/dopnet.c) into public/student/dopnet.wasm.
#   tools/student/build.sh                 the SIMD128 build the site ships
#   tools/student/build.sh --scalar OUT    also a scalar build (no SIMD) at OUT, for comparison
# Needs clang with the wasm32 target and wasm-ld (no emscripten, no libc). -O2, not -O3: in V8
# the -O3 build measured ~15% slower (and is larger); -Os does not keep the register blocks.
set -euo pipefail
cd "$(dirname "$0")/../.."

SRC=tools/student/dopnet.c
OUT=public/student/dopnet.wasm
CLANG=${CLANG:-clang}

FLAGS=(--target=wasm32 -O2 -ffreestanding -nostdlib -fno-exceptions -mbulk-memory
  -Wall -Wextra -Wno-unused-parameter
  -Wl,--no-entry -Wl,--strip-all -Wl,--export-memory -Wl,-z,stack-size=65536
  -Wl,--initial-memory=4194304)

mkdir -p "$(dirname "$OUT")"
"$CLANG" "${FLAGS[@]}" -msimd128 -o "$OUT" "$SRC"
echo "$OUT: $(wc -c < "$OUT") bytes"

if [[ "${1:-}" == "--scalar" ]]; then
  SCALAR=${2:?usage: build.sh --scalar OUT.wasm}
  "$CLANG" "${FLAGS[@]}" -fno-vectorize -fno-slp-vectorize -o "$SCALAR" "$SRC"
  echo "$SCALAR (scalar): $(wc -c < "$SCALAR") bytes"
fi
