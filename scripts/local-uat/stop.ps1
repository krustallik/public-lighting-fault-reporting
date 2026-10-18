. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not (Test-Path $script:LocalUatStateRoot)) {
  Write-Output 'Local UAT has not been initialized.'
  exit 0
}
if (Test-Path $script:LocalUatRuntimeEnv) {
  Assert-LocalUatDockerOwnership
}
Stop-LocalUatManagedProcesses
if (Test-Path $script:LocalUatRuntimeEnv) {
  $null = Invoke-LocalUatCompose @('stop', 'db')
}
Write-Output 'Local UAT application processes and its dedicated database container are stopped. Synthetic data volume is preserved.'
