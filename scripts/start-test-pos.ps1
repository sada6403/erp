# Starts the TEST POS (staging) from its own data folder. It never touches the real POS data in %APPDATA%\pos-erp.
$exe  = "$env:LOCALAPPDATA\Programs\pos-erp\Enterprise POS ERP.exe"
$data = 'C:\work\test-pos-data'
if (-not (Test-Path $exe))  { Write-Host "POS exe not found: $exe"; exit 1 }
if (-not (Test-Path "$data\config.json")) { Write-Host "Test POS data folder not found: $data"; exit 1 }
$cfg = Get-Content "$data\config.json" -Raw | ConvertFrom-Json
$url = $cfg.app_settings.cloud_api_url
Write-Host "Test POS cloud URL: $url"
if ($url -notlike 'https://staging-api.*') { Write-Host 'STOP: this data folder does not point at staging. Not starting.'; exit 1 }
Start-Process -FilePath $exe -ArgumentList "--user-data-dir=`"$data`""
Write-Host 'Test POS started with its own data folder (staging).'
