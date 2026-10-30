# 在桌面创建「案屿」快捷方式；重复运行会覆盖同名快捷方式。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tools\create-shortcut.ps1
#
# 注意：Windows 解析 .lnk 的图标路径时对非 ASCII 字符不可靠——图标若直接指向仓库里的
# public\isle.ico（路径含「_项目\案屿」），资源管理器会退化成白纸图标。这里先把 ico
# 复制到纯 ASCII 的 %LOCALAPPDATA%\Isle\isle.ico，再让快捷方式指过去。
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '启动案屿.cmd'
if (-not (Test-Path -LiteralPath $target)) { throw "找不到启动脚本：$target" }

$sourceIcon = Join-Path $root 'public\isle.ico'
if (-not (Test-Path -LiteralPath $sourceIcon)) { throw "找不到图标：$sourceIcon" }

function Test-Ascii([string]$value) { return $value -notmatch '[^\x00-\x7F]' }

if (Test-Ascii $env:LOCALAPPDATA) { $iconDir = Join-Path $env:LOCALAPPDATA 'Isle' }
elseif (Test-Ascii $env:PUBLIC) { $iconDir = Join-Path $env:PUBLIC 'Isle' }
else { throw '找不到纯 ASCII 的图标目录（LOCALAPPDATA 与 PUBLIC 都含非 ASCII 字符）。' }

New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
$icon = Join-Path $iconDir 'isle.ico'
Copy-Item -LiteralPath $sourceIcon -Destination $icon -Force

$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop '案屿.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $root
$shortcut.Description = '案屿 · 本机项目看板'
$shortcut.WindowStyle = 1
$shortcut.IconLocation = "$icon,0"
$shortcut.Save()

Write-Host "已创建：$link"
Write-Host "图标：$icon"
