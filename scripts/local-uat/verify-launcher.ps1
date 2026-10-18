$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not (Test-Path -LiteralPath $script:LocalUatRuntimeEnv)) {
  throw 'Start local UAT once before verifying the launcher.'
}

$probeRoot = Join-Path $script:LocalUatPrivateRoot 'argument test with spaces'
if (Test-Path -LiteralPath $probeRoot) { throw 'The launcher verification path already exists; inspect it before retrying.' }
$originalPidFile = $script:LocalUatPidFile
$originalLogRoot = $script:LocalUatLogRoot
$script:LocalUatPidFile = Join-Path $probeRoot 'pids.json'
$script:LocalUatLogRoot = Join-Path $probeRoot 'logs'
$probePath = Join-Path $probeRoot 'probe.js'
$resultPath = Join-Path $probeRoot 'child result.json'
$preloadPath = Join-Path $probeRoot 'preload.cjs'
$preloadMarker = Join-Path $probeRoot 'preload-ran.txt'
$parentValues = @{}
$probeValues = @{}
$probeNames = @('VITE_RESEND_API_KEY', 'DB_PASSWORD_FILE', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'MIGRATION_DB_USER', 'ADMIN_INITIAL_PASSWORD', 'JWT_SECRET', 'NODE_OPTIONS', 'NODE_PATH')
$dockerVariableNames = @('DOCKER_HOST', 'DOCKER_CONTEXT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD')
$dockerParentValues = @{}
$script:mockDockerCalls = [System.Collections.Generic.List[object]]::new()
$script:mockComposeEnvironment = $null
$script:mockDockerEndpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$process = $null
foreach ($name in $probeNames) {
  $parentValues[$name] = if (Test-Path "Env:$name") { (Get-Item "Env:$name").Value } else { $null }
}
foreach ($name in $dockerVariableNames) {
  $dockerParentValues[$name] = if (Test-Path "Env:$name") { (Get-Item "Env:$name").Value } else { $null }
}

function docker {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$DockerArguments)
  $global:LASTEXITCODE = 0
  $script:mockDockerCalls.Add([string[]]$DockerArguments)
  $joined = $DockerArguments -join ' '
  if ($joined -eq 'context show') { return 'desktop-linux' }
  if ($joined -match '^context inspect ') { return $script:mockDockerEndpoint }
  if ($DockerArguments -contains 'compose') {
    $script:mockComposeEnvironment = @{
      DB_NAME = $env:DB_NAME
      DB_USER = $env:DB_USER
      DB_PASSWORD = $env:DB_PASSWORD
    }
    return
  }
  throw 'Unexpected Docker mock invocation.'
}

try {
  New-Item -ItemType Directory -Path $script:LocalUatLogRoot -Force | Out-Null
  Protect-LocalUatPath $probeRoot -Directory
  Protect-LocalUatPath $script:LocalUatLogRoot -Directory
  $env:DOCKER_HOST = 'tcp://remote.invalid:2375'
  $callsBeforeOverride = $script:mockDockerCalls.Count
  try { [void](Get-LocalUatDockerContext); throw 'The Docker host override was accepted.' }
  catch { if ($_.Exception.Message -notmatch 'Docker host overrides') { throw } }
  if ($script:mockDockerCalls.Count -ne $callsBeforeOverride) {
    throw 'Docker was invoked while an explicit Docker host override was present.'
  }
  Remove-Item Env:DOCKER_HOST
  $env:DOCKER_CONTEXT = 'remote-context'
  try { [void](Get-LocalUatDockerContext); throw 'The Docker context override was accepted.' }
  catch { if ($_.Exception.Message -notmatch 'Docker host overrides') { throw } }
  Remove-Item Env:DOCKER_CONTEXT
  $script:mockDockerCalls.Clear()
  $script:mockDockerEndpoint = 'tcp://remote.invalid:2375'
  try { [void](Get-LocalUatDockerContext); throw 'A remote Docker endpoint was accepted.' }
  catch { if ($_.Exception.Message -notmatch 'verified local Docker Desktop') { throw } }
  if ($script:mockDockerCalls.Count -ne 2) { throw 'A Docker command ran after the remote endpoint check failed.' }
  $script:mockDockerCalls.Clear()
  $script:mockDockerEndpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine'
  $env:DB_NAME = 'ambient-database-sentinel'
  $env:DB_USER = 'ambient-user-sentinel'
  $env:DB_PASSWORD = 'ambient-password-sentinel'
  $composeProbe = Invoke-LocalUatCompose @('config') -AllowFailure
  $expectedSettings = Get-LocalUatPrivateSettings
  if ($composeProbe.ExitCode -ne 0 -or $null -eq $script:mockComposeEnvironment -or
      $script:mockComposeEnvironment.DB_NAME -ne $expectedSettings.DB_NAME -or
      $script:mockComposeEnvironment.DB_USER -ne $expectedSettings.DB_USER -or
      $script:mockComposeEnvironment.DB_PASSWORD -ne $expectedSettings.DB_PASSWORD) {
    throw 'Compose received ambient DB interpolation values instead of the protected local UAT settings.'
  }
  if ($env:DB_NAME -ne 'ambient-database-sentinel' -or $env:DB_USER -ne 'ambient-user-sentinel' -or $env:DB_PASSWORD -ne 'ambient-password-sentinel') {
    throw 'The Compose wrapper did not restore the parent DB environment.'
  }
  if (($script:mockDockerCalls[-1] -join ' ') -notmatch '^--context desktop-linux compose ') {
    throw 'The Compose operation was not pinned to the verified local Docker context.'
  }

  $probeValues['VITE_RESEND_API_KEY'] = 'synthetic-parent-sentinel'
  $probeValues['DB_PASSWORD_FILE'] = 'synthetic-parent-sentinel'
  $probeValues['DB_NAME'] = 'synthetic-parent-sentinel'
  $probeValues['DB_USER'] = 'synthetic-parent-sentinel'
  $probeValues['DB_PASSWORD'] = 'synthetic-parent-sentinel'
  $probeValues['MIGRATION_DB_USER'] = 'synthetic-parent-sentinel'
  $probeValues['ADMIN_INITIAL_PASSWORD'] = 'synthetic-parent-sentinel'
  $probeValues['JWT_SECRET'] = 'synthetic-parent-sentinel'
  $probeValues['NODE_OPTIONS'] = '--require "' + $preloadPath + '"'
  $probeValues['NODE_PATH'] = 'synthetic-parent-sentinel'
  $preloadLiteral = ConvertTo-Json -InputObject $preloadMarker -Compress
  $preloadSource = "require('node:fs').writeFileSync($preloadLiteral, 'executed'); process.env.VITE_RESEND_API_KEY = 'injected-by-preload';`n"
  [System.IO.File]::WriteAllText($preloadPath, $preloadSource, [System.Text.UTF8Encoding]::new($false))
  $probeSource = @'
require('node:fs').writeFileSync(process.argv[2], JSON.stringify({
  vite: process.env.VITE_RESEND_API_KEY ?? null,
  file: process.env.DB_PASSWORD_FILE ?? null,
  dbName: process.env.DB_NAME ?? null,
  dbUser: process.env.DB_USER ?? null,
  dbPassword: process.env.DB_PASSWORD ?? null,
  migration: process.env.MIGRATION_DB_USER ?? null,
  admin: process.env.ADMIN_INITIAL_PASSWORD ?? null,
  jwtSecret: process.env.JWT_SECRET ?? null,
  nodeOptions: process.env.NODE_OPTIONS ?? null,
  nodePath: process.env.NODE_PATH ?? null,
}));
setTimeout(() => {}, 20000);
'@
  [System.IO.File]::WriteAllText($probePath, $probeSource, [System.Text.UTF8Encoding]::new($false))
  foreach ($name in $probeNames) {
    Set-Item "Env:$name" $probeValues[$name]
  }

  $process = Start-LocalUatManagedProcess 'launcher-verification' $probeRoot @($probePath, $resultPath) @{}
  Write-LocalUatPidRegistry @($process)
  $deadline = (Get-Date).AddSeconds(5)
  while (-not (Test-Path -LiteralPath $resultPath) -and (Get-Date) -lt $deadline) {
    $childProcess = Get-Process -Id $process.pid -ErrorAction SilentlyContinue
    if (-not $childProcess) { throw 'The argument quoting probe exited before writing its result.' }
    Start-Sleep -Milliseconds 50
  }
  if (-not (Test-Path -LiteralPath $resultPath)) { throw 'The argument quoting probe did not write its result.' }

  $active = @(Get-LocalUatManagedProcesses)
  if ($active.Count -ne 1 -or $active[0].pid -ne $process.pid) {
    throw 'The PID safety check did not recognize the quoted child command.'
  }
  $childEnvironment = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
  if ($childEnvironment.vite -or $childEnvironment.file -or $childEnvironment.dbName -or $childEnvironment.dbUser -or $childEnvironment.dbPassword -or $childEnvironment.migration -or $childEnvironment.admin -or $childEnvironment.jwtSecret -or
      $childEnvironment.nodeOptions -or $childEnvironment.nodePath -or (Test-Path -LiteralPath $preloadMarker)) {
    throw 'A blocked parent environment variable reached the managed child.'
  }
  foreach ($name in $probeNames) {
    if ((Get-Item "Env:$name" -ErrorAction Stop).Value -ne $probeValues[$name]) {
      throw "The launcher did not restore parent environment variable $name."
    }
  }
  foreach ($name in $dockerVariableNames) {
    if ($null -eq $dockerParentValues[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    else { Set-Item "Env:$name" $dockerParentValues[$name] }
  }
  Stop-LocalUatManagedProcesses
  $process = $null
  Write-Output 'Launcher verification passed: local Docker endpoint pinning, ambient DB isolation, Node preload removal, inherited environment filtering, argument quoting, and safe PID matching.'
} finally {
  if (Test-Path -LiteralPath $script:LocalUatPidFile) { Stop-LocalUatManagedProcesses }
  foreach ($name in $probeNames) {
    if ($null -eq $parentValues[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    else { Set-Item "Env:$name" $parentValues[$name] }
  }
  foreach ($name in $dockerVariableNames) {
    if ($null -eq $dockerParentValues[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    else { Set-Item "Env:$name" $dockerParentValues[$name] }
  }
  $script:LocalUatPidFile = $originalPidFile
  $script:LocalUatLogRoot = $originalLogRoot
  foreach ($file in @($probePath, $preloadPath, $preloadMarker, $resultPath, (Join-Path $probeRoot 'logs/launcher-verification.stdout.log'), (Join-Path $probeRoot 'logs/launcher-verification.stderr.log'))) {
    if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file -Force }
  }
  if (Test-Path -LiteralPath (Join-Path $probeRoot 'logs') -PathType Container) {
    Remove-Item -LiteralPath (Join-Path $probeRoot 'logs') -Force
  }
  if (Test-Path -LiteralPath $probeRoot -PathType Container) { Remove-Item -LiteralPath $probeRoot -Force }
}
