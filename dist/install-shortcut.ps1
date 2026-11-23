$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$htmlFile = Get-ChildItem -LiteralPath $root -Filter '*.html' -File | Select-Object -First 1
$iconFile = Get-ChildItem -LiteralPath $root -Filter '*.ico' -File | Select-Object -First 1
if (-not $htmlFile) { throw 'HTML file not found in this folder.' }
if (-not $iconFile) { throw 'ICO file not found in this folder.' }
$desktop = [Environment]::GetFolderPath('Desktop')
$appName = -join ([char[]](0x56FE, 0x7247, 0x538B, 0x7F29, 0x5668))
$shortcutPath = Join-Path $desktop ($appName + '.lnk')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $htmlFile.FullName
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = $iconFile.FullName + ',0'
$shortcut.Description = 'Offline image recompressor'
$shortcut.Save()
Write-Host ('Shortcut created: ' + $shortcutPath)
