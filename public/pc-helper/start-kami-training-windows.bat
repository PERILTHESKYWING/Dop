@echo off
setlocal
rem KAMI: grow Kami's own Go-explaining model on this PC's NVIDIA graphics card.
rem First run downloads about 10 GB (Python packages and the base model). Keep the window open.
rem Safe to close at any time: run this file again and it continues where it stopped.
title Kami training
set "KAMI=%LOCALAPPDATA%\kami-train"
set "REPO=%KAMI%\Dop"
set "VENV=%KAMI%\venv"
set "VPY=%VENV%\Scripts\python.exe"
if not exist "%KAMI%" mkdir "%KAMI%"

rem ---- 1. Python 3.11 or newer, git, Node.js ----
set "PY="
py -3.12 -c "import sys" >nul 2>nul && set "PY=py -3.12"
if not defined PY py -3.13 -c "import sys" >nul 2>nul && set "PY=py -3.13"
if not defined PY py -3.11 -c "import sys" >nul 2>nul && set "PY=py -3.11"
if not defined PY python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python 3.11 or newer is missing. Install Python 3.12 from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" on the first screen. Then run this file again.
  pause
  exit /b 1
)
where git >nul 2>nul || (
  echo Git is missing. Install it from https://git-scm.com/download/win with the default options, then run this file again.
  pause
  exit /b 1
)
where node >nul 2>nul || (
  echo Node.js is missing. Install the LTS version from https://nodejs.org with the default options, then run this file again.
  pause
  exit /b 1
)

rem ---- 2. the training code (a copy of the Dop repository in the data folder) ----
if exist "%REPO%\.git" goto update_code
echo Downloading the training code...
git clone --depth 1 https://github.com/PERILTHESKYWING/Dop "%REPO%"
if errorlevel 1 (
  echo Could not download the code. Check the internet connection and run this file again.
  pause
  exit /b 1
)
goto code_ready
:update_code
echo Updating the training code...
git -C "%REPO%" pull --ff-only
:code_ready

rem ---- 3. Python packages (first time about 3 GB) ----
if not exist "%VPY%" (
  echo Making a Python environment in %VENV% ...
  %PY% -m venv "%VENV%"
)
if not exist "%VPY%" (
  echo Could not make the Python environment.
  pause
  exit /b 1
)
"%VPY%" -c "import torch, sys; sys.exit(0 if torch.version.cuda else 1)" >nul 2>nul
if errorlevel 1 (
  echo Installing PyTorch for NVIDIA graphics cards, about 3 GB, first time only...
  "%VPY%" -m pip install --upgrade pip >nul
  "%VPY%" -m pip install --force-reinstall torch --index-url https://download.pytorch.org/whl/cu128 || "%VPY%" -m pip install --force-reinstall torch --index-url https://download.pytorch.org/whl/cu130
)
"%VPY%" -m pip install -q -r "%REPO%\scripts\coachlm\requirements.txt"
if errorlevel 1 (
  echo Could not install the Python packages. Check the internet connection and run this file again.
  pause
  exit /b 1
)

rem ---- 4. Node packages for the KataGo truth check (again only when they change) ----
fc /b "%REPO%\package-lock.json" "%KAMI%\package-lock.seen" >nul 2>nul && if exist "%REPO%\node_modules" goto node_ready
echo Installing the Node packages...
pushd "%REPO%"
call npm ci --no-audit --no-fund
popd
copy /y "%REPO%\package-lock.json" "%KAMI%\package-lock.seen" >nul
:node_ready

rem ---- 5. tokens: asked once, saved in %KAMI%\.env (never in the repository) ----
if exist "%KAMI%\.env" goto tokens_ready
echo.
echo Three optional keys. Paste one and press Enter, or just press Enter to skip it.
echo How to make them: docs\handoff\kami-training.md in the Dop repository.
set "HF_IN="
set /p "HF_IN=Hugging Face write token (shares the trained model): "
set "GH_IN="
set /p "GH_IN=GitHub token (shares the answer pool with other machines): "
set "GM_IN="
set /p "GM_IN=Gemini API key (the writing judge): "
(echo # Kami training keys. Delete this file to be asked again.)>"%KAMI%\.env"
if defined HF_IN (echo HF_TOKEN=%HF_IN%)>>"%KAMI%\.env"
if defined GH_IN (echo GITHUB_TOKEN=%GH_IN%)>>"%KAMI%\.env"
if defined GM_IN (echo GEMINI_API_KEY=%GM_IN%)>>"%KAMI%\.env"
:tokens_ready

rem ---- 6. check everything, offer nightly training once, then train for 8 hours ----
cd /d "%REPO%"
"%VPY%" scripts\coachlm\run.py --check
if errorlevel 1 (
  echo.
  echo Fix the items above, then run this file again.
  pause
  exit /b 1
)
if exist "%KAMI%\schedule.asked" goto schedule_ready
echo.
set "NIGHT="
set /p "NIGHT=Also train every night at 01:00 while this PC is on? Type y and press Enter for yes, or just Enter for no: "
(echo asked)>"%KAMI%\schedule.asked"
if /i "%NIGHT%"=="y" "%VPY%" scripts\coachlm\run.py --schedule
:schedule_ready
echo.
echo Training for 8 hours. You can close this window at any time; run this file again to continue.
"%VPY%" scripts\coachlm\run.py --hours 8 --upload %*
pause
