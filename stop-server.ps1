# Stop all Kurarium server processes (called from stop.bat)
$ErrorActionPreference = 'SilentlyContinue'

$backend = Join-Path $PSScriptRoot 'backend'

# Read the configured port (hidden config first, legacy fallback)
$port = 3000
$cfg = Join-Path $PSScriptRoot 'data\.system\config.ini'
if (-not (Test-Path -LiteralPath $cfg)) {
  $cfg = Join-Path $PSScriptRoot 'config.ini'
}
if (Test-Path -LiteralPath $cfg) {
  $m = Select-String -LiteralPath $cfg -Pattern '^\s*port\s*=\s*(\d+)' | Select-Object -First 1
  if ($m) { $port = [int]$m.Matches[0].Groups[1].Value }
}

# 1) Kill processes listening on the configured port (and their children)
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($p in $listeners) {
  taskkill /F /T /PID $p | Out-Null
}

# 2) Kill node processes belonging to this project's backend
#    (tsx watch itself + the server child process)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($backend) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host 'Kurarium stopped.'
