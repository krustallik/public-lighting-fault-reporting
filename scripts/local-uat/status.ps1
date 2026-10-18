. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not (Test-Path $script:LocalUatRuntimeEnv)) {
  Write-Output 'Local UAT is not initialized.'
  exit 0
}
$settings = Get-LocalUatPrivateSettings
Assert-LocalUatDockerOwnership
$activeProcesses = @(Get-LocalUatManagedProcesses)
Write-Output "Managed application processes: $($activeProcesses.Count)"
Write-Output 'Dedicated database container:'
$composeStatus = Invoke-LocalUatCompose @('ps', '-a')
$composeStatus.Output | Write-Output
$reportedMode = $null
foreach ($url in @(
  'http://127.0.0.1:5000/api/dev/local-uat/status',
  'http://127.0.0.1:5173/map',
  'http://127.0.0.1:5174/panel-svietidla/login',
  'http://127.0.0.1:5001/'
)) {
  if ($url.EndsWith(':5001/')) {
    if ($reportedMode -eq 'LIVE_PROVIDER_UAT') {
      Write-Output 'DISABLED http://127.0.0.1:5001/ (live mode has no fake inbox)'
      continue
    }
    if ($reportedMode -ne 'local-uat') {
      Write-Output 'NOT CHECKED http://127.0.0.1:5001/ (backend mode is unknown)'
      continue
    }
  }
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
    Write-Output "$($response.StatusCode) $url"
    if ($url.EndsWith('/api/dev/local-uat/status')) {
      $status = $response.Content | ConvertFrom-Json
      $reportedMode = [string]$status.mode
      Write-Output "Mode: $reportedMode"
      $response.Content
    }
  } catch {
    Write-Output "NOT READY $url"
  }
}
$counts = Invoke-LocalUatCompose @('exec', '-T', 'db', 'psql', '-U', $settings.DB_USER, '-d', $settings.DB_NAME, '-Atqc', "SELECT 'inventory_rows=' || count(*) FROM light_points") -AllowFailure
if ($counts.ExitCode -eq 0) { $counts.Output | Write-Output }
Write-Output 'No credentials, email codes, or provider keys are displayed by this command.'
