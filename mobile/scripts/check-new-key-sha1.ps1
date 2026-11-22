# Prints MATCH / NO MATCH for the SHA1 of nf-upload-NEW.jks against the Play value. You type the keystore password; it is not shown or stored.
$play = '16A83324CCFF06829AA277290383E8AD091EC6BE'
$kt = 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
$sec = Read-Host -AsSecureString 'Keystore password (not shown)'
$pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$out = $pw | & $kt -list -v -keystore 'C:\secure\nf-keys\nf-upload-NEW.jks' -alias nf-upload 2>&1; $pw = $null
$m = ($out | Select-String 'SHA1:\s*(.+)$').Matches | Select-Object -First 1
if (-not $m) { Write-Host 'Could not read the keystore (wrong password?).' } else {
  $s = ($m.Groups[1].Value -replace '[^0-9A-Fa-f]', '').ToUpper()
  Write-Host ('SHA1 of nf-upload-NEW.jks: ' + $(if ($s -eq $play) { 'MATCH' } else { 'NO MATCH' })) }
Read-Host 'Enter to close'
