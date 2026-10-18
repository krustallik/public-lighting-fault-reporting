Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:LocalUatRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:LocalUatStateRoot = Join-Path $script:LocalUatRepoRoot '.local-uat'
$script:LocalUatPrivateRoot = Join-Path $script:LocalUatStateRoot 'private'
$script:LocalUatRuntimeEnv = Join-Path $script:LocalUatStateRoot 'runtime.env'
$script:LocalUatPidFile = Join-Path $script:LocalUatStateRoot 'pids.json'
$script:LocalUatLogRoot = Join-Path $script:LocalUatStateRoot 'logs'
$script:LocalUatCompose = Join-Path $script:LocalUatRepoRoot 'docker-compose.local-uat.yml'
$script:LocalUatProject = 'plfr-local-uat'
$script:LocalUatVolume = 'plfr-local-uat_uat_data'
$script:LocalUatAdminHandoff = Join-Path $script:LocalUatPrivateRoot 'admin-credentials.txt'
$script:LocalUatSecretFileVariables = @(
  'DB_PASSWORD_FILE', 'JWT_SECRET_FILE', 'GEOAPIFY_API_KEY_FILE', 'RESEND_API_KEY_FILE',
  'AUSEMIO_API_KEY_FILE', 'BOOTSTRAP_DB_PASSWORD_FILE', 'BACKUP_DB_PASSWORD_FILE',
  'DB_ADMIN_PASSWORD_FILE', 'DB_RUNTIME_PASSWORD_FILE', 'MIGRATION_DB_PASSWORD_FILE',
  'DB_BOOTSTRAP_PASSWORD_FILE', 'DB_BACKUP_PASSWORD_FILE', 'DB_RETENTION_PASSWORD_FILE',
  'RETENTION_DB_PASSWORD_FILE', 'LIGHTING_BACKUP_PASSWORD_FILE', 'LIGHTING_RETENTION_PASSWORD_FILE',
  'DBA_CREDENTIAL_FILE', 'AGE_IDENTITY_FILE', 'BACKUP_AGE_IDENTITY_FILE'
)
$script:LocalUatSensitiveVariables = @(
  'DATABASE_URL', 'PGPASSWORD', 'PGPASSFILE', 'AGE_IDENTITY', 'BACKUP_AGE_IDENTITY',
  'BACKUP_DB_PASSWORD', 'DB_BACKUP_PASSWORD', 'DB_RETENTION_PASSWORD', 'RETENTION_DB_PASSWORD',
  'LIGHTING_BACKUP_PASSWORD', 'LIGHTING_RETENTION_PASSWORD', 'DB_ADMIN_PASSWORD',
  'DB_RUNTIME_PASSWORD', 'MIGRATION_DB_PASSWORD', 'DB_BOOTSTRAP_PASSWORD', 'BOOTSTRAP_DB_PASSWORD',
  'DB_MIGRATION_PASSWORD', 'ADMIN_INITIAL_PASSWORD', 'JWT_SECRET', 'AUSEMIO_API_KEY', 'RESEND_API_KEY', 'GEOAPIFY_API_KEY'
)
$script:LocalUatRuntimeInjectionVariables = @('NODE_OPTIONS', 'NODE_PATH')

function Get-LocalUatBlockedEnvironmentNames {
  $inheritedFileVariables = @(Get-ChildItem Env: | Where-Object { $_.Name -match '_FILE$' } | ForEach-Object { $_.Name })
  $inheritedDatabaseVariables = @(Get-ChildItem Env: | Where-Object { $_.Name -match '^(DB_|PG|DATABASE_URL$)' } | ForEach-Object { $_.Name })
  $inheritedMaintenanceVariables = @(Get-ChildItem Env: | Where-Object {
    $_.Name -match '^(MIGRATION_DB_|BOOTSTRAP_DB_|BACKUP_DB_|RETENTION_DB_|LIGHTING_BACKUP_|LIGHTING_RETENTION_|DB_BACKUP_|DB_RETENTION_|DB_LIGHTING_BACKUP_|DB_LIGHTING_RETENTION_|DB_ADMIN_|DBA_)'
  } | ForEach-Object { $_.Name })
  return @($script:LocalUatSecretFileVariables + $script:LocalUatSensitiveVariables + $script:LocalUatRuntimeInjectionVariables + $inheritedFileVariables + $inheritedDatabaseVariables + $inheritedMaintenanceVariables | Select-Object -Unique)
}

function New-LocalUatRandomBytes([int]$Count) {
  $bytes = New-Object byte[] $Count
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return ,$bytes
}

function ConvertTo-LocalUatHex([byte[]]$Bytes) {
  return [Convert]::ToHexString($Bytes).ToLowerInvariant()
}

function Protect-LocalUatPath([string]$Path, [switch]$Directory) {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $identitySid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $grant = if ($Directory) { "${identity}:(OI)(CI)F" } else { "${identity}:F" }
  & icacls.exe $Path /reset | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not reset local UAT state permissions.' }
  & icacls.exe $Path /inheritance:r /grant:r $grant | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not restrict local UAT state to the current Windows account.' }
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  $unexpected = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) |
    Where-Object { $_.IdentityReference -ne $identitySid })
  if ($unexpected.Count -gt 0) { throw 'Local UAT state permissions include an unexpected account.' }
}

function Protect-LocalUatStateTree {
  if (-not (Test-Path -LiteralPath $script:LocalUatStateRoot -PathType Container)) {
    throw 'Local UAT state directory is missing.'
  }

  $frontendEnvRoot = Join-Path $script:LocalUatStateRoot 'frontend-env'
  $logDirectory = Join-Path $script:LocalUatStateRoot 'logs'
  foreach ($requiredDirectory in @($frontendEnvRoot, $logDirectory)) {
    if (-not (Test-Path -LiteralPath $requiredDirectory -PathType Container)) {
      New-Item -ItemType Directory -Path $requiredDirectory -Force | Out-Null
    }
  }

  $pending = [System.Collections.Generic.Stack[string]]::new()
  $pending.Push($script:LocalUatStateRoot)
  $paths = [System.Collections.Generic.List[string]]::new()
  while ($pending.Count -gt 0) {
    $path = $pending.Pop()
    $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'Local UAT state must not contain symbolic links or reparse points.'
    }
    if ($item.Name -match '^\.env(?:\.|$)') {
      throw 'Local UAT state must not contain dotenv files.'
    }
    $paths.Add($item.FullName)
    if ($item.PSIsContainer) {
      foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction Stop) {
        if (($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
          throw 'Local UAT state must not contain symbolic links or reparse points.'
        }
        if ($child.Name -match '^\.env(?:\.|$)') {
          throw 'Local UAT state must not contain dotenv files.'
        }
        $pending.Push($child.FullName)
      }
    }
  }

  foreach ($path in $paths) {
    $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    Protect-LocalUatPath $path -Directory:$item.PSIsContainer
  }
}

function Get-LocalUatDockerContext {
  if ((Test-Path Env:DOCKER_HOST) -or (Test-Path Env:DOCKER_CONTEXT)) {
    throw 'Docker host overrides are not allowed for local UAT. Clear DOCKER_HOST and DOCKER_CONTEXT, then retry.'
  }
  $contextOutput = & docker context show 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Could not determine the active Docker context.' }
  $context = (@($contextOutput) -join '').Trim()
  if (-not $context) { throw 'Could not determine the active Docker context.' }
  $endpointOutput = & docker context inspect $context --format '{{.Endpoints.docker.Host}}' 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Could not verify the active Docker endpoint.' }
  $endpoint = (@($endpointOutput) -join '').Trim()
  $localWindowsEndpoints = @('npipe:////./pipe/docker_engine', 'npipe:////./pipe/dockerDesktopLinuxEngine')
  if ($endpoint -notin $localWindowsEndpoints) {
    throw 'Local UAT requires a verified local Docker Desktop named-pipe endpoint. No Docker operation was run.'
  }
  return $context
}

function Invoke-LocalUatDocker {
  param([string[]]$Arguments, [switch]$AllowFailure)
  $context = Get-LocalUatDockerContext
  $output = @(& docker --context $context @Arguments 2>&1)
  $exitCode = $LASTEXITCODE
  if (-not $AllowFailure -and $exitCode -ne 0) { throw 'Local UAT Docker command failed.' }
  return [pscustomobject]@{ ExitCode = $exitCode; Output = $output }
}

function Test-LocalUatDockerStateExists {
  $containers = Invoke-LocalUatDocker -Arguments @('ps', '-a', '--filter', "label=com.docker.compose.project=$script:LocalUatProject", '--format', '{{.ID}}') -AllowFailure
  if ($containers.ExitCode -eq 0 -and @($containers.Output | Where-Object { $_ }).Count -gt 0) { return $true }
  $volume = Invoke-LocalUatDocker -Arguments @('volume', 'inspect', $script:LocalUatVolume) -AllowFailure
  return $volume.ExitCode -eq 0
}

function Initialize-LocalUatPrivateState {
  if (-not (Test-Path $script:LocalUatStateRoot)) {
    New-Item -ItemType Directory -Path $script:LocalUatStateRoot | Out-Null
  }
  if (Test-Path $script:LocalUatRuntimeEnv) {
    Protect-LocalUatStateTree
    $settings = Get-LocalUatPrivateSettings
    if (-not (Test-Path $script:LocalUatAdminHandoff)) { Write-LocalUatAdminHandoff $settings }
    return $settings
  }

  $existing = @(Get-ChildItem -LiteralPath $script:LocalUatStateRoot -Force)
  if ($existing.Count -gt 0 -or (Test-LocalUatDockerStateExists)) {
    throw 'Local UAT private settings are missing while state already exists. Stop here and recover the local UAT credentials; do not recreate or reset the database.'
  }

  New-Item -ItemType Directory -Path $script:LocalUatPrivateRoot | Out-Null
  New-Item -ItemType Directory -Path $script:LocalUatLogRoot | Out-Null
  Protect-LocalUatPath $script:LocalUatStateRoot -Directory

  $databasePassword = ConvertTo-LocalUatHex (New-LocalUatRandomBytes 32)
  $adminPassword = ConvertTo-LocalUatHex (New-LocalUatRandomBytes 32)
  $jwtBytes = New-LocalUatRandomBytes 32
  $jwtSecret = [Convert]::ToBase64String($jwtBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  $values = [ordered]@{
    DB_HOST = '127.0.0.1'
    DB_PORT = '5433'
    DB_NAME = 'lighting_faults_local_uat_dev'
    DB_USER = 'plfr_uat'
    DB_PASSWORD = $databasePassword
    JWT_SECRET = $jwtSecret
    ADMIN_INITIAL_PASSWORD = $adminPassword
  }
  $content = (($values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n") + "`n"
  [System.IO.File]::WriteAllText($script:LocalUatRuntimeEnv, $content, [System.Text.UTF8Encoding]::new($false))
  Protect-LocalUatStateTree
  $settings = Get-LocalUatPrivateSettings
  Write-LocalUatAdminHandoff $settings
  return $settings
}

function Get-LocalUatPrivateSettings {
  if (-not (Test-Path $script:LocalUatRuntimeEnv)) { throw 'Local UAT private settings are not initialized.' }
  $settings = @{}
  foreach ($line in [System.IO.File]::ReadAllLines($script:LocalUatRuntimeEnv)) {
    if ($line -notmatch '^([A-Z][A-Z0-9_]*)=(.*)$') { throw 'Local UAT private settings have an invalid format.' }
    $settings[$Matches[1]] = $Matches[2]
  }
  $expected = @('DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD','JWT_SECRET','ADMIN_INITIAL_PASSWORD')
  if ($settings.Count -ne $expected.Count -or @($expected | Where-Object { -not $settings.ContainsKey($_) }).Count -gt 0) {
    throw 'Local UAT private settings do not match the expected schema.'
  }
  if (
    $settings.DB_HOST -ne '127.0.0.1' -or $settings.DB_PORT -ne '5433' -or
    $settings.DB_NAME -ne 'lighting_faults_local_uat_dev' -or $settings.DB_USER -ne 'plfr_uat' -or
    $settings.DB_PASSWORD -notmatch '^[a-f0-9]{64}$' -or
    $settings.ADMIN_INITIAL_PASSWORD -notmatch '^[a-f0-9]{64}$' -or
    $settings.JWT_SECRET -notmatch '^[A-Za-z0-9_-]{43}$'
  ) { throw 'Local UAT configuration must point only to its loopback disposable database.' }
  return $settings
}

function Write-LocalUatAdminHandoff([hashtable]$Settings) {
  New-Item -ItemType Directory -Path $script:LocalUatPrivateRoot -Force | Out-Null
  if (Test-Path $script:LocalUatAdminHandoff) { return }
  $text = @"
Public Lighting Fault Reporting — Local UAT only
Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')
Admin URL: http://127.0.0.1:5174
Username: admin
Password: $($Settings.ADMIN_INITIAL_PASSWORD)

This credential is for the synthetic local disposable database only.
It is excluded from Git and is not a production or VPS credential.
"@
  [System.IO.File]::WriteAllText($script:LocalUatAdminHandoff, $text, [System.Text.UTF8Encoding]::new($false))
  Protect-LocalUatPath $script:LocalUatAdminHandoff
}

function Assert-LocalUatDockerOwnership {
  [void](Get-LocalUatDockerContext)
  $containers = Invoke-LocalUatDocker -Arguments @('ps', '-a', '--filter', "label=com.docker.compose.project=$script:LocalUatProject", '--format', '{{.ID}}')
  foreach ($id in $containers.Output) {
    if (-not $id) { continue }
    $serviceResult = Invoke-LocalUatDocker -Arguments @('inspect', '--format', '{{index .Config.Labels "com.docker.compose.service"}}', $id)
    $service = ($serviceResult.Output -join '').Trim()
    if ($service -ne 'db') { throw 'Unexpected service found in the dedicated local UAT Compose project.' }
  }
  $volumeResult = Invoke-LocalUatDocker -Arguments @('volume', 'inspect', $script:LocalUatVolume) -AllowFailure
  if ($volumeResult.ExitCode -eq 0) {
    $labelsResult = Invoke-LocalUatDocker -Arguments @('volume', 'inspect', '--format', '{{json .Labels}}', $script:LocalUatVolume)
    $labels = ($labelsResult.Output -join '') | ConvertFrom-Json
    if ($labels.'com.docker.compose.project' -ne $script:LocalUatProject -or $labels.'com.docker.compose.volume' -ne 'uat_data') {
      throw 'The expected local UAT volume name belongs to a different Compose project; refusing to use it.'
    }
  }
}

function Invoke-LocalUatCompose {
  param([string[]]$Arguments, [switch]$AllowFailure)
  $settings = Get-LocalUatPrivateSettings
  $composeVariables = @('DB_NAME', 'DB_USER', 'DB_PASSWORD')
  $saved = @{}
  foreach ($key in $composeVariables) {
    $envPath = "Env:$key"
    $saved[$key] = if (Test-Path $envPath) { (Get-Item $envPath).Value } else { $null }
    Set-Item -Path $envPath -Value $settings[$key]
  }
  try {
    $dockerArguments = @('compose', '--project-name', $script:LocalUatProject, '--env-file', $script:LocalUatRuntimeEnv, '-f', $script:LocalUatCompose) + $Arguments
    return Invoke-LocalUatDocker -Arguments $dockerArguments -AllowFailure:$AllowFailure
  } finally {
    foreach ($key in $saved.Keys) {
      $envPath = "Env:$key"
      if ($null -eq $saved[$key]) { Remove-Item -Path $envPath -ErrorAction SilentlyContinue }
      else { Set-Item -Path $envPath -Value $saved[$key] }
    }
  }
}

function Get-LocalUatChildEnvironment([hashtable]$Settings, [ValidateSet('backend','seed','public','admin')][string]$Target) {
  if ($Target -in @('backend','seed')) {
    $environment = @{
      NODE_ENV = 'development'; LOCAL_UAT_MODE = 'true'; EMAIL_VERIFICATION_ENABLED = 'true'
      LOCAL_TEST_SUBMIT_ENABLED = 'true'; GEOAPIFY_ENABLED = 'false'; GEOAPIFY_API_KEY = ''
      NOMINATIM_AUTO_GEOCODE = 'false'; AUSEMIO_API_KEY = ''; RESEND_API_KEY = ''; RESEND_FROM_EMAIL = ''
      DB_HOST = $Settings.DB_HOST; DB_PORT = $Settings.DB_PORT; DB_NAME = $Settings.DB_NAME
      DB_USER = $Settings.DB_USER; DB_PASSWORD = $Settings.DB_PASSWORD; JWT_SECRET = $Settings.JWT_SECRET
      PORT = '5000'; EMAIL_E2E_PORT = '5001'; CORS_ORIGIN = 'http://127.0.0.1:5173'
      LOCAL_TEST_MAX_FILE_BYTES = '10485760'; LOCAL_TEST_MAX_FILES = '3'; LOCAL_TEST_MAX_TOTAL_UPLOAD_BYTES = '20971520'
    }
    if ($Target -eq 'seed') {
      $environment.ALLOW_DESTRUCTIVE_SEED = 'true'
      $environment.ADMIN_INITIAL_PASSWORD = $Settings.ADMIN_INITIAL_PASSWORD
    }
    return $environment
  }
  if ($Target -eq 'public') {
    return @{
      LOCAL_UAT_MODE = 'true'; VITE_API_URL = 'http://127.0.0.1:5000/api'; VITE_DEV_PROXY_TARGET = 'http://127.0.0.1:5000'
      VITE_MAP_TILE_PROVIDER = 'synthetic'; VITE_LOCAL_UAT_MODE = 'true'
      VITE_CARTO_TILES_APPROVED = 'false'; VITE_CARTO_PUBLIC_KEY = ''
      VITE_ALLOW_DEVICE_MAP_RECENTER = 'true'
    }
  }
  return @{
    LOCAL_UAT_MODE = 'true'; VITE_API_URL = '/api'; VITE_DEV_PROXY_TARGET = 'http://127.0.0.1:5000'
    VITE_ADMIN_BASE_PATH = '/panel-svietidla'
  }
}

function ConvertTo-LocalUatArgumentLine([string[]]$Arguments) {
  foreach ($argument in $Arguments) {
    if ($argument.Contains('"')) { throw 'Local UAT process arguments must not contain quote characters.' }
  }
  return (($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
}

function Start-LocalUatManagedProcess(
  [string]$Name,
  [string]$WorkingDirectory,
  [string[]]$Arguments,
  [hashtable]$Environment
) {
  $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
  $stdout = Join-Path $script:LocalUatLogRoot "$Name.stdout.log"
  $stderr = Join-Path $script:LocalUatLogRoot "$Name.stderr.log"
  $saved = @{}
  $inheritedViteVariables = @(Get-ChildItem Env: | Where-Object { $_.Name -like 'VITE_*' } | ForEach-Object { $_.Name })
  $blockedVariables = Get-LocalUatBlockedEnvironmentNames
  foreach ($key in (@($Environment.Keys) + $blockedVariables + $inheritedViteVariables | Select-Object -Unique)) {
    $envPath = "Env:$key"
    $saved[$key] = if (Test-Path $envPath) { (Get-Item $envPath).Value } else { $null }
    if (($key -in $blockedVariables -or $key -like 'VITE_*') -and -not $Environment.ContainsKey($key)) {
      Remove-Item -Path $envPath -ErrorAction SilentlyContinue
    } else {
      Set-Item -Path $envPath -Value $Environment[$key]
    }
  }
  try {
    $argumentLine = ConvertTo-LocalUatArgumentLine $Arguments
    $process = Start-Process -FilePath $nodePath -ArgumentList $argumentLine -WorkingDirectory $WorkingDirectory `
      -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  } finally {
    foreach ($key in $saved.Keys) {
      $envPath = "Env:$key"
      if ($null -eq $saved[$key]) { Remove-Item -Path $envPath -ErrorAction SilentlyContinue }
      else { Set-Item -Path $envPath -Value $saved[$key] }
    }
  }
  return [pscustomobject]@{ name = $Name; pid = $process.Id; marker = $argumentLine }
}

function Write-LocalUatPidRegistry([object[]]$Processes) {
  $json = ConvertTo-Json -InputObject @($Processes) -Depth 4
  [System.IO.File]::WriteAllText($script:LocalUatPidFile, $json, [System.Text.UTF8Encoding]::new($false))
}

function Get-LocalUatManagedProcesses {
  if (-not (Test-Path $script:LocalUatPidFile)) { return @() }
  $rows = @(Get-Content -LiteralPath $script:LocalUatPidFile -Raw | ConvertFrom-Json)
  $active = @()
  foreach ($row in $rows) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($row.pid)" -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    if (-not $process.CommandLine.Contains([string]$row.marker)) {
      throw "PID $($row.pid) no longer matches the recorded local UAT command; refusing to stop it."
    }
    $active += $row
  }
  return $active
}

function Stop-LocalUatManagedProcesses {
  if (-not (Test-Path $script:LocalUatPidFile)) { return }
  $rows = @(Get-Content -LiteralPath $script:LocalUatPidFile -Raw | ConvertFrom-Json)
  foreach ($row in $rows) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($row.pid)" -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    if (-not $process.CommandLine.Contains([string]$row.marker)) {
      throw "PID $($row.pid) no longer matches the recorded local UAT command; refusing to stop it."
    }
    Stop-Process -Id ([int]$row.pid) -Force
  }
  Remove-Item -LiteralPath $script:LocalUatPidFile -Force -ErrorAction SilentlyContinue
}

function Test-LocalUatPortFree([int]$Port, [switch]$AllowOwnDatabase) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { return }
  if ($AllowOwnDatabase) {
    $ownContainer = Invoke-LocalUatDocker -Arguments @('ps', '--filter', "label=com.docker.compose.project=$script:LocalUatProject", '--filter', 'label=com.docker.compose.service=db', '--format', '{{.Names}}') -AllowFailure
    if ($ownContainer.ExitCode -eq 0 -and @($ownContainer.Output | Where-Object { $_ }).Count -gt 0) { return }
  }
  throw "Local UAT port $Port is already in use. No process was changed."
}

function Invoke-LocalUatBackendCommand([hashtable]$Settings, [ValidateSet('seed:dev','db:migrate','uat:reset')][string]$Command) {
  $backend = Join-Path $script:LocalUatRepoRoot 'backend'
  $target = if ($Command -in @('seed:dev','uat:reset')) { 'seed' } else { 'backend' }
  $environment = Get-LocalUatChildEnvironment $Settings $target
  $tsxCli = Join-Path $backend 'node_modules/tsx/dist/cli.mjs'
  $scriptPath = switch ($Command) {
    'seed:dev' { Join-Path $backend 'src/scripts/seedDevelopment.ts'; break }
    'db:migrate' { Join-Path $backend 'src/scripts/migrateDatabase.ts'; break }
    'uat:reset' { Join-Path $backend 'tests/local-uat/resetDatabase.ts'; break }
  }
  $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
  $saved = @{}
  $blockedVariables = Get-LocalUatBlockedEnvironmentNames
  $inheritedViteVariables = @(Get-ChildItem Env: | Where-Object { $_.Name -like 'VITE_*' } | ForEach-Object { $_.Name })
  foreach ($key in (@($environment.Keys) + $blockedVariables + $inheritedViteVariables | Select-Object -Unique)) {
    $envPath = "Env:$key"
    $saved[$key] = if (Test-Path $envPath) { (Get-Item $envPath).Value } else { $null }
    if ($key -in $blockedVariables -and -not $environment.ContainsKey($key)) {
      Remove-Item -Path $envPath -ErrorAction SilentlyContinue
    } else {
      Set-Item -Path $envPath -Value $environment[$key]
    }
  }
  try {
    Push-Location $script:LocalUatStateRoot
    try {
      & $nodePath $tsxCli $scriptPath
      if ($LASTEXITCODE -ne 0) { throw "Local UAT backend command failed: $Command." }
    } finally { Pop-Location }
  } finally {
    foreach ($key in $saved.Keys) {
      $envPath = "Env:$key"
      if ($null -eq $saved[$key]) { Remove-Item -Path $envPath -ErrorAction SilentlyContinue }
      else { Set-Item -Path $envPath -Value $saved[$key] }
    }
  }
}

function Wait-LocalUatHttp([string]$Url, [int]$TimeoutSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { return }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  throw "Local UAT service did not become ready at $Url. Check ignored logs under .local-uat/logs."
}
