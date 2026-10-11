@echo off
rem DOPPELGANGER PC helper: double-click to start. Keep the window open while you use the site.
rem Needs Python 3; if it is missing, Windows' own installer (winget) installs it first.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 dop_pc.py %* & goto :end)
where python >nul 2>nul && (python dop_pc.py %* & goto :end)
echo Python 3 is not installed. Installing it with winget...
winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
echo Done. Close this window and double-click start-windows.bat again.
:end
pause
