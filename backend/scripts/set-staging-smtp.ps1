# Enter the Gmail SMTP for the STAGING company "test-1". Run in a visible PowerShell window.
# You type the values; the app password is read hidden, sent over ssh (stdin) to the staging server and stored ENCRYPTED. It is never printed or saved on this PC.
$ErrorActionPreference = 'Stop'
$backend = Split-Path $PSScriptRoot -Parent
Push-Location $backend
node -e "require('esbuild').buildSync({entryPoints:['scripts/set-company-smtp.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:process.env.TEMP+'/set-smtp.cjs',logLevel:'warning',tsconfig:'tsconfig.json'})"
Pop-Location
$user = Read-Host 'Gmail address (SMTP user)'
$sec = Read-Host -AsSecureString 'Gmail APP password (hidden)'
$pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$fromName = Read-Host 'From name (Enter = Natural Plantation)'; if (-not $fromName) { $fromName = 'Natural Plantation' }
$json = @{ host = 'smtp.gmail.com'; port = 587; user = $user; pass = $pw; from_name = $fromName; from_email = $user } | ConvertTo-Json -Compress
scp -q "$env:TEMP\set-smtp.cjs" nfvps:/var/www/pos-staging/backend/.set-smtp.cjs
$json | ssh nfvps 'cd /var/www/pos-staging/backend && node --env-file=.env .set-smtp.cjs test-1; rm -f .set-smtp.cjs'
$pw = $null; $json = $null
Read-Host 'Enter to close'
