# Creates the NEW Play upload keystore + the PEM certificate for the Play upload-key reset.
# Run in a visible window: keytool asks YOU for the store/key passwords. Nothing here reads, prints or stores them.
$ErrorActionPreference = 'Stop'
$keytool = 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
$dir = 'C:\secure\nf-keys'
$jks = Join-Path $dir 'nf-upload-NEW.jks'
$pem = Join-Path $dir 'upload_certificate.pem'
if (Test-Path $jks) { Write-Host "STOP: $jks already exists. Not overwriting."; Read-Host 'Enter to close'; exit 1 }
Write-Host 'Type a NEW store password twice, then press Enter for "same as store password" on the key password. Write it down somewhere safe (password manager): it cannot be recovered.'
& $keytool -genkeypair -v -storetype PKCS12 -keystore $jks -alias nf-upload -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Natural Plantation, O=NF Groups, C=LK'
if ($LASTEXITCODE -ne 0) { Write-Host 'Key generation failed.'; Read-Host 'Enter to close'; exit 1 }
Write-Host 'Now type the same store password once more to export the certificate.'
& $keytool -export -rfc -alias nf-upload -file $pem -keystore $jks
if ($LASTEXITCODE -ne 0) { Write-Host 'Export failed.'; Read-Host 'Enter to close'; exit 1 }
Write-Host "DONE. Created $jks and $pem. You can close this window and tell Claude."
Read-Host 'Enter to close'
