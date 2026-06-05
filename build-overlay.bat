@echo off
REM build-overlay.bat — one-click build of screenpilot-overlay on Windows.
REM
REM Run from CMD or PowerShell at any time (NOT Git Bash, which puts the
REM GNU link.exe ahead of MSVC's link.exe on PATH and breaks Rust linking).
REM
REM Usage:
REM   build-overlay.bat                      # release build (default)
REM   build-overlay.bat debug                # debug build
REM   build-overlay.bat clean                # rm -rf target/

setlocal

set "MODE=%~1"
if "%MODE%"=="" set "MODE=release"

cd /d "%~dp0\overlay\src-tauri"

if /I "%MODE%"=="clean" (
  echo Cleaning Cargo target directory...
  cargo clean
  goto :EOF
)

if /I "%MODE%"=="debug" (
  echo Building screenpilot-overlay in DEBUG mode...
  cargo build
) else (
  echo Building screenpilot-overlay in RELEASE mode...
  cargo build --release
)

echo.
echo Build complete. Binary:
if /I "%MODE%"=="debug" (
  dir /b "target\debug\screenpilot-overlay.exe"
) else (
  dir /b "target\release\screenpilot-overlay.exe"
)

endlocal
