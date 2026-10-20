@echo off
rem Start a hub agent. Double-click = agent A (your main account).
rem For your second account run:  start-agent.cmd B
cd /d "%~dp0"
set NAME=%1
if "%NAME%"=="" set NAME=A
node agent.mjs %NAME% %2
pause
