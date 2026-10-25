# 在桌面创建「案屿」快捷方式；重复运行会覆盖同名快捷方式。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tools\create-shortcut.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '启动案屿.cmd'
if (-not (Test-Path -LiteralPath $target)) { throw "找不到启动脚本：$target" }

$icon = Join-Path $root 'public\isle.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop '案屿.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $root
$shortcut.Description = '案屿 · 本机项目看板'
$shortcut.WindowStyle = 1
if (Test-Path -LiteralPath $icon) { $shortcut.IconLocation = "$icon,0" }
$shortcut.Save()

Write-Host "已创建：$link"
