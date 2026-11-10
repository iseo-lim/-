@echo off
cd /d "%~dp0"
echo [%date% %time%] launcher started in %cd% >> launch-log.txt

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" if "%NODE%" NEQ "node" (
  echo [%date% %time%] node.exe not found >> launch-log.txt
  echo.
  echo  Node.js is not installed. Please install the LTS version from https://nodejs.org
  echo.
  pause
  exit /b 1
)

rem GitHub token: use GITHUB_TOKEN if set, otherwise borrow the logged-in GitHub CLI token (never written to a file)
set "GH=C:\Program Files\GitHub CLI\gh.exe"
if "%GITHUB_TOKEN%"=="" if exist "%GH%" for /f "usebackq delims=" %%t in (`call "%GH%" auth token 2^>nul`) do set "GITHUB_TOKEN=%%t"
if "%GITHUB_TOKEN%"=="" (echo   GitHub: no token - issues will not be created) else (echo   GitHub: token found)

echo ==================================================
echo   Request Hub server - http://localhost:8080
echo   Keep this window open. Closing it stops the server.
echo ==================================================
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8080"
"%NODE%" server.js --seed
echo [%date% %time%] server exited with code %errorlevel% >> launch-log.txt

echo.
echo  The server stopped. Please send a screenshot of this window.
pause