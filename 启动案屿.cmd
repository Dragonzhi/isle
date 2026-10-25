@echo off
chcp 65001 >nul
title 案屿
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto nonode
if %NODE_MAJOR% LSS 24 goto oldnode

if not exist "node_modules" (
  echo 首次启动，正在安装依赖……
  call npm install
  if errorlevel 1 goto failed
)

rem 首次或源码有更新时会自动构建，随后启动本机看板并自动打开浏览器。
node tools\launch.ts --open
if errorlevel 1 goto failed
exit /b 0

:nonode
echo 未找到 Node.js。案屿需要 Node.js 24 或更高版本：https://nodejs.org/
echo.
pause
exit /b 1

:oldnode
echo 当前 Node.js 版本是 v%NODE_MAJOR%，案屿需要 24 或更高版本：https://nodejs.org/
echo.
pause
exit /b 1

:failed
echo.
echo 启动失败，请查看上方提示。
pause
exit /b 1
