param([switch]$ConfirmDisposableUatReset)
. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not $ConfirmDisposableUatReset) {
  throw 'Pass -ConfirmDisposableUatReset to reseed only lighting_faults_local_uat_dev. No database was changed.'
}
Protect-LocalUatStateTree
$settings = Get-LocalUatPrivateSettings
Assert-LocalUatDockerOwnership
Stop-LocalUatManagedProcesses
$null = Invoke-LocalUatCompose @('up', '-d', 'db')
$deadline = (Get-Date).AddSeconds(60)
$ready = $false
while ((Get-Date) -lt $deadline) {
  $readiness = Invoke-LocalUatCompose @('exec', '-T', 'db', 'pg_isready', '-U', $settings.DB_USER, '-d', $settings.DB_NAME) -AllowFailure
  if ($readiness.ExitCode -eq 0) { $ready = $true; break }
  Start-Sleep -Milliseconds 750
}
if (-not $ready) { throw 'The dedicated local UAT PostgreSQL is not ready; no seed was run.' }
Invoke-LocalUatBackendCommand $settings 'seed:dev'
Invoke-LocalUatBackendCommand $settings 'uat:reset'
Write-Output 'The guarded seed restored synthetic inventory; local operational logs, OTP state, sessions and admin password were reset. The database volume was preserved.'
