Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$project = 'plfr-local-uat-docker'
$compose = Join-Path $script:LocalUatRepoRoot 'docker-compose.local-uat-docker.yml'
$volume = 'plfr-local-uat-docker_uat_docker_data'
$expectedServices = @('db','init','backend','public-app','admin-app','edge')

try {
  [void](Get-LocalUatDockerContext)
  $containers = Invoke-LocalUatDocker -Arguments @('ps','-a','--filter',"label=com.docker.compose.project=$project",'--format','{{.ID}}')
  foreach ($id in $containers.Output) {
    if (-not $id) { continue }
    $service = Invoke-LocalUatDocker -Arguments @('inspect','--format','{{index .Config.Labels "com.docker.compose.service"}}',$id)
    if (($service.Output -join '').Trim() -notin $expectedServices) {
      throw 'Unexpected container belongs to the isolated Docker UAT project; refusing to stop services.'
    }
  }
  $volumeStatus = Invoke-LocalUatDocker -Arguments @('volume','inspect','--format','{{json .Labels}}',$volume) -AllowFailure
  if ($volumeStatus.ExitCode -eq 0) {
    $labels = ($volumeStatus.Output -join '') | ConvertFrom-Json
    if ($labels.'com.docker.compose.project' -ne $project -or $labels.'com.docker.compose.volume' -ne 'uat_docker_data' -or
        $labels.'org.public-lighting-fault-reporting.data' -ne 'synthetic-only') {
      throw 'Docker UAT volume ownership could not be verified; refusing to stop the stack.'
    }
  }
  $result = Invoke-LocalUatComposeProject -ProjectName $project -ComposeFile $compose -Arguments @('down','--remove-orphans') -AllowFailure
  if ($result.ExitCode -ne 0) { throw 'Docker UAT stop failed.' }
  Write-Host 'Only the isolated offline Docker UAT project was stopped. Its synthetic PostgreSQL volume was preserved.'
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
