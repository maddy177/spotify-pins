@echo off
rem Starts Spotify Pins and opens it in its own window (no tabs, no address bar).
rem To use Edge instead of Chrome, change the next line to:  set BROWSER=msedge
set BROWSER=chrome

cd /d "%~dp0"

rem The server runs in a minimized window. Close that window to stop the server.
start "Spotify Pins server" /min cmd /k python run.py

rem Wait (up to 30 seconds) until the server answers
set tries=0
:wait
curl -s -o nul http://127.0.0.1:5050/api/sync/status && goto ready
set /a tries+=1
if %tries% GEQ 30 goto failed
timeout /t 1 /nobreak >nul
goto wait

:ready
start "" %BROWSER% --app=http://127.0.0.1:5050
exit /b

:failed
echo.
echo The server did not start. Look at the "Spotify Pins server" window for the error.
pause