# One-time: sets the EAS remote versionCode of the Play package to 6 (first production build). Type 6 when asked.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$env:ANDROID_PACKAGE = 'nfgroups.naturefarming.app'
npx eas-cli@latest build:version:set -p android --profile test
npx eas-cli@latest build:version:get -p android --profile test
Read-Host 'Enter to close'
