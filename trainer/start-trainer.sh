#!/usr/bin/env bash
# Dop Trainer for Linux (and WSL): install on first run, then train.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
home="${DOP_TRAINER_HOME:-$HOME/DopTrainer}"
py="$(command -v python3.12 || command -v python3)"
if [ ! -x "$home/venv/bin/python" ]; then
  echo "Creating a Python environment in $home/venv ..."
  mkdir -p "$home"
  "$py" -m venv "$home/venv"
fi
export PYTHONPATH="$here"
"$home/venv/bin/python" -m doptrainer setup ${DOP_SETUP_ARGS:-}
exec "$home/venv/bin/python" -m doptrainer run "$@"
