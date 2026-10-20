param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $root 'vendor\ffmpeg'
$licenseDir = Join-Path $root 'vendor\licenses'
$ffmpeg = Join-Path $binDir 'ffmpeg.exe'
$ffprobe = Join-Path $binDir 'ffprobe.exe'

if (-not $Force -and (Test-Path $ffmpeg) -and (Test-Path $ffprobe)) {
  Write-Host "FFmpeg binaries already present in $binDir"
  exit 0
}

$tag = 'autobuild-2026-10-19-13-06'
$asset = 'ffmpeg-n9.0.2-28-g669f5ab083-win64-gpl-9.0.zip'
$expected = 'b2b9817023338f801b86d36b9bc41eb8b953ce895367ef2b776a8651aad68944'
$url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/$tag/$asset"

$cache = Join-Path $root 'vendor\cache'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$zipPath = Join-Path $cache $asset

if (-not (Test-Path $zipPath)) {
  Write-Host "Downloading $asset"
  Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
}

$sha = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($zipPath)
try {
  $hash = ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
} finally {
  $stream.Dispose()
  $sha.Dispose()
}
if ($hash -ne $expected) {
  Remove-Item -LiteralPath $zipPath -Force
  throw "FFmpeg checksum mismatch. expected=$expected actual=$hash"
}

$extract = Join-Path $cache 'extract'
if (Test-Path $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
Expand-Archive -LiteralPath $zipPath -DestinationPath $extract -Force

$ffmpegSrc = Get-ChildItem -LiteralPath $extract -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
$ffprobeSrc = Get-ChildItem -LiteralPath $extract -Recurse -Filter 'ffprobe.exe' | Select-Object -First 1
if (-not $ffmpegSrc -or -not $ffprobeSrc) {
  throw 'ffmpeg.exe or ffprobe.exe was not found in the archive.'
}

New-Item -ItemType Directory -Force -Path $binDir | Out-Null
New-Item -ItemType Directory -Force -Path $licenseDir | Out-Null
Copy-Item -LiteralPath $ffmpegSrc.FullName -Destination $ffmpeg -Force
Copy-Item -LiteralPath $ffprobeSrc.FullName -Destination $ffprobe -Force

$license = Get-ChildItem -LiteralPath $extract -Recurse -Include 'LICENSE.txt','COPYING.GPLv3','GPLv3.txt' -File | Select-Object -First 1
if ($license) {
  Copy-Item -LiteralPath $license.FullName -Destination (Join-Path $licenseDir 'FFMPEG-GPLv3.txt') -Force
} else {
  Invoke-WebRequest -Uri 'https://www.gnu.org/licenses/gpl-3.0.txt' -OutFile (Join-Path $licenseDir 'FFMPEG-GPLv3.txt') -UseBasicParsing
}

$sourceInfo = @(
  "FFmpeg build: $asset",
  "Release tag: $tag",
  "Download: $url",
  "SHA256: $expected",
  "Source: https://github.com/BtbN/FFmpeg-Builds",
  "License: GNU General Public License version 3"
) -join "`r`n"
Set-Content -LiteralPath (Join-Path $licenseDir 'FFMPEG-SOURCE.txt') -Value $sourceInfo -Encoding utf8

Remove-Item -LiteralPath $extract -Recurse -Force
Write-Host "Installed FFmpeg to $binDir"
