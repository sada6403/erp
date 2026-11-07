# Reconnect the real phone to the dev PC over USB and open the app.
#   .\scripts\phone.ps1              demo mock data (Quick Login cards)
#   .\scripts\phone.ps1 -Real        real local backend (needs backend on :3000, seeded TEST company)
# Re-run after every unplug. Safe to run repeatedly.
param(
  [string]$Serial = '0002205R60002053',
  [switch]$Real
)
$ErrorActionPreference = 'Stop'
$mobile = Split-Path -Parent $PSScriptRoot
Set-Location $mobile

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$package = 'com.naturalplantation.app.dev'

# 1. phone must be attached and authorised
$state = (& $adb -s $Serial get-state 2>&1) -join ''
if ($state -ne 'device') {
  Write-Host "Phone $Serial not ready (adb says: $state). Plug it in, unlock it, accept the USB debugging prompt." -ForegroundColor Red
  exit 1
}

# 2. phone reaches the PC through the USB cable (API base URL on the phone is http://localhost:3000)
& $adb -s $Serial reverse tcp:3000 tcp:3000 | Out-Null   # backend
& $adb -s $Serial reverse tcp:8081 tcp:8081 | Out-Null   # Metro
Write-Host 'adb reverse: 3000 (backend) and 8081 (Metro) set.'

# 3. Metro with the dev client (stop an old one on 8081 first)
Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

if ($Real) {
  $seed = Get-Content (Join-Path $mobile '..\backend\.seed-output.json') -Raw | ConvertFrom-Json
  $env:USE_MOCKS = '0'
  $env:APP_KEY = $seed.app_key
} else {
  $env:USE_MOCKS = '1'
}
$env:API_BASE_URL_DEVICE = 'http://localhost:3000'

Start-Process -FilePath 'cmd.exe' -WorkingDirectory $mobile `
  -ArgumentList '/c', 'npx expo start --dev-client --port 8081' -WindowStyle Minimized
Start-Sleep -Seconds 8

# 4. open the app on the phone, pointed at Metro through the reverse tunnel
$url = 'exp+natural-plantation://expo-development-client/?url=' + [uri]::EscapeDataString('http://localhost:8081')
& $adb -s $Serial shell am start -a android.intent.action.VIEW -d $url | Out-Null
Write-Host 'Opened on the phone. Quick Login cards (mock) or seeded users (-Real): see docs/mobile-app/PROGRESS.md.'
