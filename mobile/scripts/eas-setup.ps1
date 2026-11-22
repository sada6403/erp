# One-time EAS setup, run in a VISIBLE PowerShell window from the mobile\ folder. You type the Expo password yourself.
# Uses npx (no global install). Prints the project id (not a secret) so Claude can put it in the config.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
npx eas-cli@latest login
npx eas-cli@latest whoami
npx eas-cli@latest init --id 5dd24d2b-7eeb-4aad-bc7b-8777cff45373 --non-interactive
Write-Host 'If a project id (a UUID) was printed above, copy it to Claude. It is not secret.'
Read-Host 'Enter to close'
