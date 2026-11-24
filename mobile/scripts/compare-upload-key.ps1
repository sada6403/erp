# Compares the LOCAL Play upload key (C:\secure\nf-keys\nf-release-key.jks, alias nf-farming) with the fingerprints
# shown in Play Console > App integrity > App signing > "Upload key certificate".
# Usage (visible PowerShell window, you type the keystore password when asked; it is never printed or stored):
#   .\compare-upload-key.ps1 -PlaySha1 "AA:BB:..." -PlaySha256 "AA:BB:..."
param(
  [Parameter(Mandatory = $true)][string]$PlaySha1,
  [Parameter(Mandatory = $true)][string]$PlaySha256,
  [string]$Keystore = 'C:\secure\nf-keys\nf-release-key.jks',
  [string]$Alias = 'nf-farming'
)
$keytool = 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
if (-not (Test-Path $keytool)) { $keytool = 'C:\Program Files\Java\jdk-25\bin\keytool.exe' }
$sec = Read-Host -AsSecureString 'Keystore password (not shown)'
$pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$out = $pw | & $keytool -list -v -keystore $Keystore -alias $Alias 2>&1
$pw = $null
$norm = { param($s) ($s -replace '[^0-9A-Fa-f]', '').ToUpper() }
$l1 = ($out | Select-String 'SHA1:\s*(.+)$').Matches | Select-Object -First 1
$l2 = ($out | Select-String 'SHA256:\s*(.+)$').Matches | Select-Object -First 1
if (-not $l1 -or -not $l2) { Write-Host 'COULD NOT READ the keystore (wrong password or alias). Nothing compared.'; exit 2 }
$ok1 = (& $norm $l1.Groups[1].Value) -eq (& $norm $PlaySha1)
$ok2 = (& $norm $l2.Groups[1].Value) -eq (& $norm $PlaySha256)
Write-Host ("SHA-1   : " + $(if ($ok1) { 'MATCH' } else { 'NO MATCH' }))
Write-Host ("SHA-256 : " + $(if ($ok2) { 'MATCH' } else { 'NO MATCH' }))
if ($ok1 -and $ok2) { Write-Host 'RESULT: MATCH - this key is the Play upload key.' } else { Write-Host 'RESULT: NO MATCH - upload-key reset path (see PRODUCTION_RUNBOOK section 0).' }
