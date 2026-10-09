#!/usr/bin/env bash
# Rebuild the browser KataGo engine (public/engine/kataeval.{js,wasm}).
#
# Source: https://github.com/saigo-online/katago-webgpu (KataGo + a WebGPU backend,
# MIT), pinned below. We compile its single-thread `kataeval` target to WebAssembly.
# The one binary contains both the WebGPU backend and the Eigen CPU backend and picks
# WebGPU when an adapter exists, else falls back to CPU.
#
# Local patches (engine/patches/*.patch) fix two upstream bugs and add exports:
#   - kgeEvalSeq with an ownership buffer freed the caller's buffer (heap corruption)
#   - kgeSearch treated side-to-move values as white-perspective values
#   - kgeRootStats: per-candidate visits / winrate / prior after kgeSearch
#   - kgePostProcessParams: the model's score/ownership scaling constants
#   - kgeEvalSeqBatch: batched evaluation with full move history and a symmetry per position
#   - kgeSetFp16 now also applies to this single-thread build (WebGPU only)
#
# Two builds come out of one run:
#   kataeval.{js,wasm}         -O3 with WebAssembly SIMD (about 2.5x faster on the CPU)
#   kataeval-compat.{js,wasm}  -O2 without SIMD, for browsers that lack it
#
# Requirements: git, python3, an emsdk (https://emscripten.org), Eigen 3 headers
# (e.g. `apt-get install libeigen3-dev`). Network access to github.com.
#
#   EMSDK_DIR=~/emsdk engine/build-engine.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PIN="${KATAGO_WEBGPU_COMMIT:-d5ad1c0423dba989c60a2f06b1848e7eec2b5941}"
WORK="${WORK_DIR:-$ROOT/.engine-build}"
EMSDK_DIR="${EMSDK_DIR:-$HOME/emsdk}"
EIGEN_INC="${EIGEN_INC:-/usr/include/eigen3}"

if [ ! -d "$WORK/katago-webgpu/.git" ]; then
  mkdir -p "$WORK"
  git clone https://github.com/saigo-online/katago-webgpu "$WORK/katago-webgpu"
fi
cd "$WORK/katago-webgpu"
git fetch --depth 1 origin "$PIN" 2>/dev/null || true
git checkout -f "$PIN"
git clean -fdq cpp/kataeval
for p in "$HERE"/patches/*.patch; do git apply "$p"; done

# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1
cd cpp
build() {
local NAME="$1"; shift
local OPT=( "$@" )
local OBJ="$WORK/obj-$NAME"; mkdir -p "$OBJ"
local CFLAGS=( "${OPT[@]}" -fexceptions -DNO_GIT_REVISION -DHALF_ENABLE_CPP11_CFENV=0
         -I external -isystem external/filesystem-1.5.8/include
         --use-port=emdawnwebgpu -sUSE_ZLIB=1 )
EXPORTS=_kgeLoad,_kgeEval,_kgeEvalSeq,_kgeEvalBatch,_kgeSearch,_kgeSetGumbel,_kgeSetPolicyOptimism,_kgeError,_kgeBoardSize,_kgeModelVersion,_kgeBackendIsGpu,_kgeSetForceCpu,_kgeSetFp16,_kgeRootStats,_kgePostProcessParams,_kgeEvalSeqBatch,_malloc,_free

mapfile -t SRCS < <(grep -vE '^\s*(#|$)' kataeval/sources.txt)
local OBJS=()
local f
for f in "${SRCS[@]}"; do
  local extra=(); local std=c++17
  if [ "$f" = "kataeval/backend_gpu.cpp" ]; then std=c++20
  elif [ "$f" = "kataeval/backend_cpu.cpp" ]; then extra=( -DUSE_EIGEN_BACKEND -isystem "$EIGEN_INC" ); fi
  local o="$OBJ/$(echo "$f" | tr '/.' '__').o"
  echo "  cc $f"
  em++ -c "$f" -std=$std "${CFLAGS[@]}" "${extra[@]}" -o "$o"
  OBJS+=("$o")
done

mkdir -p "$ROOT/public/engine"
em++ "${OBJS[@]}" --use-port=emdawnwebgpu -sUSE_ZLIB=1 -fexceptions \
  -sASYNCIFY -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sFORCE_FILESYSTEM=1 \
  -sSTACK_SIZE=16MB -sINITIAL_MEMORY=64MB \
  -sMODULARIZE=1 -sEXPORT_NAME=createKata -sENVIRONMENT=web,worker,node \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS,HEAPF32,HEAP32,UTF8ToString \
  "${OPT[@]}" -o "$ROOT/public/engine/$NAME.js"
}
build kataeval -O3 -msimd128
build kataeval-compat -O2
cp "$WORK/katago-webgpu/LICENSE" "$ROOT/public/engine/LICENSE-KataGo.txt"
echo "$PIN" > "$ROOT/public/engine/SOURCE_COMMIT.txt"
ls -la "$ROOT/public/engine"
