param([switch]$ConfirmLiveProviderCalls)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not $ConfirmLiveProviderCalls) {
  throw 'This local Docker UAT can make real CARTO and Geoapify requests, and Resend requests when the owner recipient is configured. Re-run with -ConfirmLiveProviderCalls only for controlled local testing.'
}

$project = 'plfr-local-live-provider-uat'
$composeBase = Join-Path $script:LocalUatRepoRoot 'docker-compose.local-uat-docker.yml'
$composeLive = Join-Path $script:LocalUatRepoRoot 'docker-compose.local-live-uat.yml'
$volumeName = 'plfr-local-live-provider-uat_uat_docker_data'
$expectedServices = @('db','init','backend','public-app','admin-app','edge')
$savedEmailFlag = if (Test-Path Env:LIVE_UAT_EMAIL_VERIFICATION_ENABLED) {
  $env:LIVE_UAT_EMAIL_VERIFICATION_ENABLED
} else { $null }

function Assert-LiveDockerProjectOwnership {
  $containers = Invoke-LocalUatDocker -Arguments @(
    'ps','-a','--filter',"label=com.docker.compose.project=$project",'--format','{{.ID}}'
  )
  foreach ($id in $containers.Output) {
    if (-not $id) { continue }
    $serviceResult = Invoke-LocalUatDocker -Arguments @(
      'inspect','--format','{{index .Config.Labels "com.docker.compose.service"}}',$id
    )
    $service = ($serviceResult.Output -join '').Trim()
    if ($service -notin $expectedServices) {
      throw 'Unexpected container found in the isolated live Docker UAT project.'
    }
  }

  $volumeResult = Invoke-LocalUatDocker -Arguments @('volume','inspect',$volumeName) -AllowFailure
  if ($volumeResult.ExitCode -eq 0) {
    $labelsResult = Invoke-LocalUatDocker -Arguments @('volume','inspect','--format','{{json .Labels}}',$volumeName)
    $labels = ($labelsResult.Output -join '') | ConvertFrom-Json
    if ($labels.'com.docker.compose.project' -ne $project -or
        $labels.'com.docker.compose.volume' -ne 'uat_docker_data' -or
        $labels.'org.public-lighting-fault-reporting.purpose' -ne 'isolated-local-uat-docker' -or
        $labels.'org.public-lighting-fault-reporting.data' -ne 'synthetic-only') {
      throw 'The live Docker UAT database volume has unexpected ownership labels; refusing to use it.'
    }
  }
}

try {
  $settings = Initialize-LocalUatPrivateState
  Protect-LocalUatStateTree
  [void](Get-LocalUatDockerContext)
  $dockerInfo = Invoke-LocalUatDocker -Arguments @('info') -AllowFailure
  if ($dockerInfo.ExitCode -ne 0) { throw 'Docker Desktop is unavailable; no UAT container was started.' }

  $providers = Get-LocalUatDockerLiveProviderSettings
  Ensure-LocalUatDockerSecretFile 'docker-db-password.txt' $settings.DB_PASSWORD
  Ensure-LocalUatDockerSecretFile 'docker-jwt-secret.txt' $settings.JWT_SECRET
  Ensure-LocalUatDockerSecretFile 'docker-admin-initial-password.txt' $settings.ADMIN_INITIAL_PASSWORD
  $liveAdminHandoff = Join-Path $script:LocalUatPrivateRoot 'admin-live-docker-credentials.txt'
  if (-not (Test-Path -LiteralPath $liveAdminHandoff -PathType Leaf)) {
    $handoffText = @"
Public Lighting Fault Reporting — Live-provider local Docker UAT
Admin URL: https://localhost:8443/panel-svietidla/login
Username: admin
Password: $($settings.ADMIN_INITIAL_PASSWORD)

This credential is for the isolated synthetic-data local UAT database only.
It is not a production or VPS credential.
"@
    [System.IO.File]::WriteAllText($liveAdminHandoff, $handoffText, [System.Text.UTF8Encoding]::new($false))
    Protect-LocalUatPath $liveAdminHandoff
  }
  Protect-LocalUatStateTree
  Assert-LiveDockerProjectOwnership

  foreach ($port in @(8097,8443)) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { continue }
    $ownEdge = Invoke-LocalUatDocker -Arguments @(
      'ps','--filter',"label=com.docker.compose.project=$project",'--filter','label=com.docker.compose.service=edge','--format','{{.Ports}}'
    )
    $portsText = $ownEdge.Output -join ' '
    if ($portsText -notmatch '127\.0\.0\.1:8097->8080/tcp' -or
        $portsText -notmatch '127\.0\.0\.1:8443->8443/tcp') {
      throw "Local port $port is already in use outside the owned live UAT edge; the other service was left untouched."
    }
  }

  $emailFlag = if ($providers.EMAIL_VERIFICATION_ENABLED) { 'true' } else { 'false' }
  $env:LIVE_UAT_EMAIL_VERIFICATION_ENABLED = $emailFlag
  $composeArgs = @('-f',$composeLive)
  $config = Invoke-LocalUatComposeProject -ProjectName $project -ComposeFile $composeBase -Arguments ($composeArgs + @('config','--quiet'))
  if ($config.ExitCode -ne 0) { throw 'The isolated live Docker UAT Compose configuration did not validate.' }

  $started = Invoke-LocalUatComposeProject -ProjectName $project -ComposeFile $composeBase `
    -Arguments ($composeArgs + @('up','-d','--build','--wait','--wait-timeout','300')) -AllowFailure
  if ($started.ExitCode -ne 0) { throw 'Live Docker UAT startup/build failed. The offline UAT project and all other volumes were left untouched.' }

  Write-Output 'Live-provider Docker UAT is ready. No AUSEMIO traffic is enabled; submissions remain local.'
  Write-Output 'Public:      https://localhost:8443/map'
  Write-Output 'Admin:       https://localhost:8443/panel-svietidla/login'
  Write-Output 'HTTP:        http://localhost:8097 (use HTTPS for admin Secure-cookie verification)'
  Write-Output 'Status:      https://localhost:8443/api/dev/local-uat/status'
  Write-Output 'Admin login: .local-uat/private/admin-live-docker-credentials.txt'
  if (-not $providers.EMAIL_VERIFICATION_ENABLED) {
    Write-Output 'OTP is fail-closed and disabled because the owner-approved recipient is missing.'
    Write-Output 'Owner gate: enter one controlled mailbox in .local-uat/private/resend-approved-recipient.txt, then restart this stack.'
  } else {
    Write-Output 'Resend is allowlisted to the owner-controlled recipient; inbox delivery still requires owner confirmation.'
  }
  Write-Output 'Stop without deleting the disposable database: scripts/local-uat/stop-live-docker.ps1'
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  if ($null -eq $savedEmailFlag) { Remove-Item Env:LIVE_UAT_EMAIL_VERIFICATION_ENABLED -ErrorAction SilentlyContinue }
  else { $env:LIVE_UAT_EMAIL_VERIFICATION_ENABLED = $savedEmailFlag }
}
