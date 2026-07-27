@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

"__NODE_EXECUTABLE__" "%SCRIPT_DIR%agent-hook.mjs" %* >nul 2>nul

exit /b 0
