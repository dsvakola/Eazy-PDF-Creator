@echo off
title Build Eazy PDF Creator
echo Step 1: checking pnpm...
where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm not found. Installing it now...
  call npm install -g pnpm
  if errorlevel 1 goto fail
)
echo Step 2: installing tools (internet needed, first time only)...
call pnpm install
if errorlevel 1 goto fail
echo Step 3: building executables...
call pnpm run dist
if errorlevel 1 goto fail
echo.
echo DONE. Your executables are in the "release" folder:
echo   1) Portable (no install): Eazy PDF Creator Portable 1.2.0.exe
echo   2) Setup Installer:       Eazy PDF Creator Setup 1.2.0.exe
explorer release
pause
exit /b 0
:fail
echo Something went wrong. Please send me the message shown above.
pause
