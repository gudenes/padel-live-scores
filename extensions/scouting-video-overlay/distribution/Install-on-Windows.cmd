@echo off
setlocal
set "PACKAGE_DIR=%~dp0"
if not exist "%PACKAGE_DIR%padel-nachos-scout\manifest.json" (
  echo Please extract the complete ZIP first. Keep this helper beside the padel-nachos-scout folder.
  pause
  exit /b 1
)
set "SCOUT_CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "SCOUT_CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined SCOUT_CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "SCOUT_CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined SCOUT_CHROME if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "SCOUT_CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined SCOUT_CHROME (
  echo Google Chrome was not found. Install it from https://www.google.com/chrome/ and run this helper again.
  pause
  exit /b 1
)
echo.
echo Padel Nachos Scout - installation
echo Keep this extracted package in a permanent folder before loading the extension.
echo In Chrome:
echo   1. Turn on Developer mode.
echo   2. Click Load unpacked.
echo   3. Choose the padel-nachos-scout folder shown in Explorer.
echo   4. Pin Padel Nachos Scout, then open its menu and choose Playground.
echo.
echo This helper does not change existing extension data or Chrome profiles.
start "" explorer.exe "%PACKAGE_DIR%"
start "" "%SCOUT_CHROME%" "chrome://extensions/"
pause
