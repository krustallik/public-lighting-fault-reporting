Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$script:LocalUatDockerProject = 'plfr-local-uat-docker'
$script:LocalUatDockerCompose = Join-Path $script:LocalUatRepoRoot 'docker-compose.local-uat-docker.yml'
$script:LocalUatDockerVolume = 'plfr-local-uat-docker_uat_docker_data'
$expectedServices = @('db','init','backend','public-app','admin-app','edge')

function Assert-LocalUatDockerStackOwnership {
  [void](Get-LocalUatDockerContext)
  $containers = Invoke-LocalUatDocker -Arguments @('ps','-a','--filter',"label=com.docker.compose.project=$script:LocalUatDockerProject",'--format','{{.ID}}')
  foreach ($id in $containers.Output) {
    if (-not $id) { continue }
    $serviceResult = Invoke-LocalUatDocker -Arguments @('inspect','--format','{{index .Config.Labels "com.docker.compose.service"}}',$id)
    $service = ($serviceResult.Output -join '').Trim()
    if ($service -notin $expectedServices) { throw 'Unexpected container found in the isolated Docker UAT project.' }
  }
  $volumeResult = Invoke-LocalUatDocker -Arguments @('volume','inspect',$script:LocalUatDockerVolume) -AllowFailure
  if ($volumeResult.ExitCode -eq 0) {
    $labelsResult = Invoke-LocalUatDocker -Arguments @('volume','inspect','--format','{{json .Labels}}',$script:LocalUatDockerVolume)
    $labels = ($labelsResult.Output -join '') | ConvertFrom-Json
    if ($labels.'com.docker.compose.project' -ne $script:LocalUatDockerProject -or
        $labels.'com.docker.compose.volume' -ne 'uat_docker_data' -or
        $labels.'org.public-lighting-fault-reporting.data' -ne 'synthetic-only') {
      throw 'The isolated Docker UAT volume does not have its expected ownership labels; refusing to use it.'
    }
  }
}

try {
  $null = Initialize-LocalUatPrivateState
  Protect-LocalUatStateTree
  Assert-LocalUatDockerStackOwnership

  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8097 -ErrorAction SilentlyContinue)
  if ($listeners.Count -gt 0) {
    $edge = Invoke-LocalUatComposeProject -ProjectName $script:LocalUatDockerProject -ComposeFile $script:LocalUatDockerCompose -Arguments @('ps','--status','running','--services')
    if ($edge.ExitCode -ne 0 -or 'edge' -notin @($edge.Output | ForEach-Object { "$($_)".Trim() })) {
      throw 'Local port 8097 is already in use outside this UAT edge. The other service was left untouched.'
    }
  }

  $config = Invoke-LocalUatComposeProject -ProjectName $script:LocalUatDockerProject -ComposeFile $script:LocalUatDockerCompose -Arguments @('config','--quiet')
  if ($config.ExitCode -ne 0) { throw 'Docker UAT Compose configuration did not validate.' }
  $started = Invoke-LocalUatComposeProject -ProjectName $script:LocalUatDockerProject -ComposeFile $script:LocalUatDockerCompose -Arguments @('up','-d','--build','--wait','--wait-timeout','180') -AllowFailure
  if ($started.ExitCode -ne 0) { throw 'Docker UAT startup/build failed. Check the isolated project logs; no other Compose project was targeted.' }

  Write-Host 'Offline Docker UAT is ready. Runtime providers are fake/off; no AUSEMIO, Resend, Geoapify or CARTO requests are made.'
  Write-Host 'Public:      http://localhost:8097/map'
  Write-Host 'Admin:       http://localhost:8097/panel-svietidla/login'
  Write-Host 'Fake inbox:  http://localhost:8097/fake-inbox/'
  Write-Host 'Status:      http://localhost:8097/api/dev/local-uat/status'
  Write-Host 'Stop with scripts/local-uat/stop-docker.ps1. The synthetic database volume is preserved.'
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
