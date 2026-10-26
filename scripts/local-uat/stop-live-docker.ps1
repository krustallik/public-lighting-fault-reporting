Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$project = 'plfr-local-live-provider-uat'
$composeBase = Join-Path $script:LocalUatRepoRoot 'docker-compose.local-uat-docker.yml'
$composeLive = Join-Path $script:LocalUatRepoRoot 'docker-compose.local-live-uat.yml'
$result = Invoke-LocalUatComposeProject -ProjectName $project -ComposeFile $composeBase `
  -Arguments @('-f',$composeLive,'stop') -AllowFailure
if ($result.ExitCode -ne 0) { throw 'Could not stop the isolated live Docker UAT project.' }
Write-Output 'Live Docker UAT containers stopped. Its isolated synthetic-data volume is preserved.'
