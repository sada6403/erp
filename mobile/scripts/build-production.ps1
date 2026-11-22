# Production AAB, ONE command, only after Moni says "go" in chat (HARD STOP).  Run from mobile\:  .\scripts\build-production.ps1
# API_BASE_URL, APP_KEY and GOOGLE_SERVICES_FILE come from EAS environment variables (environment "production"), never from this PC or git.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$names = (npx eas-cli@latest env:list production 2>&1 | Out-String)
foreach ($n in 'API_BASE_URL', 'APP_KEY', 'GOOGLE_SERVICES_FILE') { if ($names -notmatch $n) { throw "EAS production variable $n is missing (see PRODUCTION_RUNBOOK step 7)." } }
if ($names -match '__SET_AT_BUILD__|placeholder') { throw 'A production variable still holds a placeholder.' }
npx tsc --noEmit; if ($LASTEXITCODE) { throw 'tsc failed' }
npm test --silent; if ($LASTEXITCODE) { throw 'jest failed' }
npx eas-cli@latest build --platform android --profile production
