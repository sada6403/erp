# One-time: creates a dedicated full-rights LOCAL MySQL test account for the integration harness (step 8).
# Run in a visible PowerShell window. You type the local MySQL root password once when mysqlsh asks (never stored).
# The new account's random password goes into backend\.int-mysql.env (git-ignored) and is never printed.
$ErrorActionPreference = 'Stop'
$pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
$sql = "CREATE USER IF NOT EXISTS 'np_test'@'localhost' IDENTIFIED BY '$pw'; ALTER USER 'np_test'@'localhost' IDENTIFIED BY '$pw'; GRANT ALL PRIVILEGES ON *.* TO 'np_test'@'localhost'; FLUSH PRIVILEGES;"
mysqlsh --sql -u root -h localhost -p -e $sql
if ($LASTEXITCODE -ne 0) { Write-Host 'mysqlsh failed (wrong root password?). Nothing written.'; exit 1 }
"INT_MYSQL_HOST=localhost`nINT_MYSQL_PORT=3306`nINT_MYSQL_USER=np_test`nINT_MYSQL_PASSWORD=$pw" | Set-Content -Encoding ascii "$PSScriptRoot\..\.int-mysql.env"
Write-Host 'Done. Account np_test created (LOCAL only); credentials saved in backend\.int-mysql.env. Tell Claude "mysql ready".'
