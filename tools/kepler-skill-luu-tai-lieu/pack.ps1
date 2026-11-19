# Dong goi skill thanh dist/kepler-luu-tai-lieu.zip (thu muc kepler-luu-tai-lieu nam o goc tep zip).
# Dung ZipArchive va dau "/" trong ten muc (Compress-Archive cua PowerShell 5.1 ghi dau "\", claude.ai co the khong nhan).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here 'kepler-luu-tai-lieu'
$dist = Join-Path $here 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$zip = Join-Path $dist 'kepler-luu-tai-lieu.zip'
if (Test-Path $zip) { Remove-Item $zip }
$z = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
  foreach ($f in Get-ChildItem -LiteralPath $src -Recurse -File) {
    $rel = 'kepler-luu-tai-lieu/' + $f.FullName.Substring($src.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $f.FullName, $rel) | Out-Null
  }
} finally { $z.Dispose() }
"Da tao $zip"
