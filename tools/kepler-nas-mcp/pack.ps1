# Dong goi tien ich Claude Desktop: dist\kepler-nas.mcpb (tep zip gom manifest.json, server.js, package.json).
# Khong can thu vien ngoai. Cai: nhan dup tep .mcpb, hoac Claude Desktop > Settings > Extensions > Install Extension.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$stage = Join-Path $env:TEMP ('kepler-nas-pack-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $stage, 'dist' | Out-Null
Copy-Item manifest.json, server.js, package.json $stage
$zip = Join-Path $stage 'out.zip'
Compress-Archive -Path (Join-Path $stage '*.js*') -DestinationPath $zip -Force
Move-Item $zip 'dist\kepler-nas.mcpb' -Force
Remove-Item $stage -Recurse -Force
Get-Item 'dist\kepler-nas.mcpb' | Select-Object Name, Length, LastWriteTime
