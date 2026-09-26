@echo off
rem Dop Trainer for Windows: double-click to install (first time) and start training.
setlocal
cd /d "%~dp0"
title Dop Trainer

set "PY="
for %%V in (3.12 3.13 3.11 3.10) do (
  if not defined PY (
    py -%%V -c "import sys" >nul 2>nul && set "PY=py -%%V"
  )
)
if not defined PY (
  python -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)" >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo.
  echo Dop Trainer needs Python 3.10 to 3.13 ^(3.12 recommended^).
  where winget >nul 2>nul
  if not errorlevel 1 (
    echo Installing Python 3.12 with winget ...
    winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
    echo.
    echo Done. Close this window and double-click Start-Trainer.bat again.
  ) else (
    echo Download Python 3.12 from https://www.python.org/downloads/ , install it,
    echo then double-click Start-Trainer.bat again.
  )
  pause
  exit /b 1
)

set "DOPHOME=%USERPROFILE%\DopTrainer"
set "VENV=%DOPHOME%\venv"
if not exist "%VENV%\Scripts\python.exe" (
  echo Creating a Python environment in %VENV% ...
  %PY% -m venv "%VENV%"
  if errorlevel 1 goto failed
)

set "PYTHONPATH=%~dp0."
"%VENV%\Scripts\python.exe" -m doptrainer setup
if errorlevel 1 goto failed

"%VENV%\Scripts\python.exe" -m doptrainer run %*
pause
exit /b 0

:failed
echo.
echo Something went wrong above. The trainer did not start.
pause
exit /b 1
