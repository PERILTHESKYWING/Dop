@echo off
rem Like start-windows.bat, and also reachable from your phone through a free Cloudflare tunnel.
cd /d "%~dp0"
call start-windows.bat --tunnel %*
