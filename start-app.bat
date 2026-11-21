@echo off
cd /d "%~dp0"
if exist "src-tauri\target\release\mosa.exe" (
    start "" "src-tauri\target\release\mosa.exe"
    exit /b 0
)
start /b cmd /c "npm run dev"
timeout /t 2 /nobreak >nul
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=http://127.0.0.1:4313 --window-size=1440,900
) else (
    start "" "http://127.0.0.1:4313"
)
