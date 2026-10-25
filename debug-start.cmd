@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1] 工作目录: %cd%
echo [2] 检查 node...
node --version
if errorlevel 1 (
  echo 错误：未找到 node，请安装 Node.js 24
  pause
  exit /b 1
)
echo [3] 启动器会按需构建，随后启动服务...
node tools\launch.ts
echo [4] 启动器退出，exit=%errorlevel%
pause
