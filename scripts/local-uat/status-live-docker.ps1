Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$project = 'plfr-local-live-provider-uat'
$composeBase = Join-Path $script:LocalUatRepoRoot 'docker-compose.local-uat-docker.yml'
$composeLive = Join-Path $script:LocalUatRepoRoot 'docker-compose.local-live-uat.yml'
$result = Invoke-LocalUatComposeProject -ProjectName $project -ComposeFile $composeBase `
  -Arguments @('-f',$composeLive,'ps') -AllowFailure
if ($result.ExitCode -ne 0) { throw 'Could not read the isolated live Docker UAT status.' }
$result.Output
