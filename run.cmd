@echo off
rem Launches INDRA HUB using the Node runtime bundled in .tools\node
setlocal
cd /d "%~dp0"
set "PATH=%~dp0.tools\node;%PATH%"
call npm run dev
endlocal
