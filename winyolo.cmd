@echo off
setlocal
set "WINYOLO_ROOT=%~dp0"
bun run "%WINYOLO_ROOT%src\cli.ts" %*
exit /b %ERRORLEVEL%
