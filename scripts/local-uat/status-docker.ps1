Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$project = 'plfr-local-uat-docker'
$compose = Join-Path $script:LocalUatRepoRoot 'docker-compose.local-uat-docker.yml'
$volume = 'plfr-local-uat-docker_uat_docker_data'

try {
  [void](Get-LocalUatDockerContext)
  $containers = Invoke-LocalUatDocker -Arguments @('ps','-a','--filter',"label=com.docker.compose.project=$project",'--format','{{.ID}}')
  foreach ($id in $containers.Output) {
    if (-not $id) { continue }
    $service = Invoke-LocalUatDocker -Arguments @('inspect','--format','{{index .Config.Labels "com.docker.compose.service"}}',$id)
    if (($service.Output -join '').Trim() -notin @('db','init','backend','public-app','admin-app','edge')) {
      throw 'Unexpected container belongs to the isolated Docker UAT project; status stopped.'
    }
  }
  if (@($containers.Output | Where-Object { $_ }).Count -eq 0) { Write-Host 'Docker UAT is not running.'; exit 0 }
  $states = Invoke-LocalUatDocker -Arguments @('ps','-a','--filter',"label=com.docker.compose.project=$project",'--format','{{.Names}} {{.Status}} {{.Ports}}')
  $states.Output | ForEach-Object { Write-Host $_ }
  $volumeStatus = Invoke-LocalUatDocker -Arguments @('volume','inspect','--format','{{json .Labels}}',$volume) -AllowFailure
  if ($volumeStatus.ExitCode -eq 0) {
    $labels = ($volumeStatus.Output -join '') | ConvertFrom-Json
    if ($labels.'com.docker.compose.project' -ne $project -or $labels.'com.docker.compose.volume' -ne 'uat_docker_data' -or
        $labels.'org.public-lighting-fault-reporting.data' -ne 'synthetic-only') {
      throw 'Docker UAT volume ownership could not be verified.'
    }
    Write-Host 'Database volume: present (synthetic UAT; preserved across stop/start).'
  } else {
    Write-Host 'Database volume: not created yet.'
  }
  try {
    $status = Invoke-RestMethod -Method Get -Uri 'http://localhost:8097/api/dev/local-uat/status' -TimeoutSec 3
    Write-Host ("Application status: mode={0}; email={1}; address={2}; submission={3}" -f $status.mode,$status.email.delivery,$status.address.provider,$status.submission)
  } catch {
    Write-Host 'Application status: not reachable on loopback port 8097.'
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
