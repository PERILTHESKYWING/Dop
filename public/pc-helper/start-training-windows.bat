@echo off
rem DOPPELGANGER: train the site's small network on this PC's graphics card (8 hours).
rem First run installs PyTorch for NVIDIA cards (about 3 GB). Keep the window open.
rem To send a winner to the cloud arena, set GITHUB_TOKEN first (see scripts/student/README.md).
cd /d "%~dp0"
set PY=python
where py >nul 2>nul && set PY=py -3
%PY% -c "import torch" 2>nul || %PY% -m pip install numpy torch --index-url https://download.pytorch.org/whl/cu128
set UP=
if defined GITHUB_TOKEN set UP=--upload
%PY% dop_pc.py --train 8 %UP% %*
pause
