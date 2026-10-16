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
echo [3] 检查 dist\index.html...
if not exist "dist\index.html" (
  echo dist\index.html 不存在，开始构建...
  call npm run build
  if errorlevel 1 (
    echo 构建失败
    pause
    exit /b 1
  )
)
echo [4] 启动服务器...
call npm start
echo [5] 服务器退出，exitcode=%errorlevel%
pause

