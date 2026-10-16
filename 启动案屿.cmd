@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules" (
  call npm install
  if errorlevel 1 goto failed
)
if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 goto failed
)
call npm start
if errorlevel 1 goto failed
exit /b 0
:failed
echo 启动失败，请查看上方错误。需要 Node.js 24 或更高版本。
pause
exit /b 1
