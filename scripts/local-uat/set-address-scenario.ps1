param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('success','no-result','unavailable','timeout','rate-limited','budget-exhausted','outside-area')]
  [string]$Scenario
)

$status = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/dev/local-uat/status' -Method Get -TimeoutSec 3
if ($status.mode -ne 'local-uat' -or $status.submission -ne 'local simulated sink only; no AUSEMIO request') {
  throw 'The local UAT backend did not identify itself. No provider request was made.'
}
$body = @{ scenario = $Scenario } | ConvertTo-Json -Compress
$result = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/dev/local-uat/address-scenario' `
  -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 3
Write-Output "Local fake address scenario: $($result.scenario)"
