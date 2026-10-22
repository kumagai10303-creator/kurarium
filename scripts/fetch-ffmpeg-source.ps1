param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $root 'vendor\ffmpeg-source'
$releaseDir = Join-Path $root 'release'
$archive = Join-Path $releaseDir 'FFMPEG-SOURCE.zip'

$assets = @(
  @{
    Name = 'ffmpeg-669f5ab083.tar.gz'
    Url = 'https://github.com/FFmpeg/FFmpeg/archive/669f5ab083.tar.gz'
    Sha256 = 'e5b24d5779f736b3ef8a985d52051d48fece48712f810af7037283ad707ecd67'
  },
  @{
    Name = 'FFmpeg-Builds-autobuild-2026-10-19-13-06.zip'
    Url = 'https://github.com/BtbN/FFmpeg-Builds/archive/refs/tags/autobuild-2026-10-19-13-06.zip'
    Sha256 = '963a51df2e658b782a6e1d6dc3651bf543205f0ec02b6f96dad30ad28bc56932'
  }
)

New-Item -ItemType Directory -Force -Path $sourceDir | Out-Null
foreach ($asset in $assets) {
  $path = Join-Path $sourceDir $asset.Name
  if ($Force -or -not (Test-Path -LiteralPath $path)) {
    Write-Host "Downloading $($asset.Name)"
    Invoke-WebRequest -Uri $asset.Url -OutFile $path -UseBasicParsing
  }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
  if ($actual -ne $asset.Sha256) {
    Remove-Item -LiteralPath $path -Force
    throw "Checksum mismatch for $($asset.Name): expected=$($asset.Sha256) actual=$actual"
  }
}

Copy-Item -LiteralPath (Join-Path $root 'vendor\licenses\FFMPEG-SOURCE.txt') -Destination (Join-Path $sourceDir 'FFMPEG-SOURCE.txt') -Force
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
Compress-Archive -Path (Join-Path $sourceDir '*') -DestinationPath $archive -Force
Write-Host "Created $archive"
