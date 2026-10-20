@echo off
rem Double-click to start agent B on your second Claude account.
cd /d "%~dp0"
node agent.mjs B %1
pause
