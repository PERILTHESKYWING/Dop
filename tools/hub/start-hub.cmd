@echo off
rem Double-click to start the Dop hub, then open http://localhost:7790
cd /d "%~dp0"
start "" http://localhost:7790
node hub.mjs
pause
