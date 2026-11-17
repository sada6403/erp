# Production AAB, one command, AFTER Moni says go (HARD STOP: do not run without his approval in chat).
# Fills the production env from git-ignored/secure sources, refuses placeholders, then starts the EAS build.
#   .\build-production.ps1 -ApiBaseUrl https://<production-api> [-GoogleServices C:\secure\nf-keys\google-services.json]
# APP_KEY is read from the environment variable APP_KEY (real-company key, runbook step 4); it is never printed.
param(
  [Parameter(Mandatory = $true)][string]$ApiBaseUrl,
  [string]$GoogleServices = 'C:\secure\nf-keys\google-services.json',
  [string]$AndroidPackage = 'nfgroups.naturefarming.app'
)
$ErrorActionPreference = 'Stop'
if (-not $env:APP_KEY -or $env:APP_KEY -like '__*') { throw 'APP_KEY env var missing (real-company App Key, step 4).' }
if ($ApiBaseUrl -notmatch '^https://') { throw 'ApiBaseUrl must be https.' }
if (-not (Test-Path $GoogleServices)) { throw "google-services.json not found at $GoogleServices" }
$gs = Get-Content $GoogleServices -Raw | ConvertFrom-Json
if ($gs.client[0].client_info.android_client_info.package_name -ne $AndroidPackage) { throw 'google-services.json package_name does not match the Play package.' }
Set-Location (Join-Path $PSScriptRoot '..')
npx tsc --noEmit; if ($LASTEXITCODE) { throw 'tsc failed' }
npm test --silent; if ($LASTEXITCODE) { throw 'jest failed' }
$env:APP_ENV = 'production'; $env:ANDROID_PACKAGE = $AndroidPackage; $env:API_BASE_URL = $ApiBaseUrl
$env:GOOGLE_SERVICES_FILE = (Resolve-Path $GoogleServices).Path   # local path; for cloud builds upload it as an EAS file env var instead (see runbook step 7)
eas build --platform android --profile production
