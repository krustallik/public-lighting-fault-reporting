. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not (Test-Path (Join-Path $script:LocalUatRepoRoot 'backend/node_modules/tsx/dist/cli.mjs')) -or
    -not (Test-Path (Join-Path $script:LocalUatRepoRoot 'frontend/node_modules/vite/bin/vite.js'))) {
  throw 'Install the repository dependencies first: npm ci in backend/ and frontend/. No database or local service was started.'
}
if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { throw 'Docker Desktop CLI is required.' }
[void](Get-LocalUatDockerContext)
$dockerInfo = Invoke-LocalUatDocker -Arguments @('info') -AllowFailure
if ($dockerInfo.ExitCode -ne 0) { throw 'Docker Desktop is not running. No database or local service was started.' }

$settings = Initialize-LocalUatPrivateState
Protect-LocalUatStateTree
Assert-LocalUatDockerOwnership
$alreadyRunning = @(Get-LocalUatManagedProcesses)
if ($alreadyRunning.Count -gt 0) { throw 'Local UAT application processes are already running. Use status.ps1 or stop.ps1 first.' }
Test-LocalUatPortFree 5433 -AllowOwnDatabase
foreach ($port in @(5000, 5001, 5173, 5174)) { Test-LocalUatPortFree $port }

$null = Invoke-LocalUatCompose @('up', '-d', 'db')
$deadline = (Get-Date).AddSeconds(75)
$databaseReady = $false
while ((Get-Date) -lt $deadline) {
  $readiness = Invoke-LocalUatCompose @('exec', '-T', 'db', 'pg_isready', '-U', $settings.DB_USER, '-d', $settings.DB_NAME) -AllowFailure
  if ($readiness.ExitCode -eq 0) { $databaseReady = $true; break }
  Start-Sleep -Milliseconds 750
}
if (-not $databaseReady) { throw 'The dedicated local UAT PostgreSQL did not become ready. Other containers and databases were not changed.' }

$schemaProbe = Invoke-LocalUatCompose @('exec', '-T', 'db', 'psql', '-U', $settings.DB_USER, '-d', $settings.DB_NAME, '-Atqc', "SELECT to_regclass('public.schema_migrations') IS NOT NULL") -AllowFailure
if ($schemaProbe.ExitCode -ne 0) { throw 'Could not inspect the dedicated local UAT migration ledger.' }
if (($schemaProbe.Output -join '').Trim() -ne 't') {
  Invoke-LocalUatBackendCommand $settings 'seed:dev'
} else {
  Invoke-LocalUatBackendCommand $settings 'db:migrate'
}

$processes = @()
try {
$backendDir = Join-Path $script:LocalUatRepoRoot 'backend'
  $frontDir = Join-Path $script:LocalUatRepoRoot 'frontend'
$processes += Start-LocalUatManagedProcess 'backend' $script:LocalUatStateRoot `
  @((Join-Path $backendDir 'node_modules/tsx/dist/cli.mjs'), (Join-Path $backendDir 'tests/local-uat/server.ts')) `
  (Get-LocalUatChildEnvironment $settings 'backend')
  Write-LocalUatPidRegistry $processes
  Wait-LocalUatHttp 'http://127.0.0.1:5000/api/dev/local-uat/status'

  $processes += Start-LocalUatManagedProcess 'public' $frontDir `
    @('node_modules/vite/bin/vite.js', '--config', 'apps/public/vite.config.ts', '--host', '127.0.0.1', '--port', '5173', '--strictPort') `
    (Get-LocalUatChildEnvironment $settings 'public')
  Write-LocalUatPidRegistry $processes
  Wait-LocalUatHttp 'http://127.0.0.1:5173/map'

  $processes += Start-LocalUatManagedProcess 'admin' $frontDir `
    @('node_modules/vite/bin/vite.js', '--config', 'apps/admin/vite.config.ts', '--host', '127.0.0.1', '--port', '5174', '--strictPort') `
    (Get-LocalUatChildEnvironment $settings 'admin')
  Write-LocalUatPidRegistry $processes
  Wait-LocalUatHttp 'http://127.0.0.1:5174/panel-svietidla/login'
} catch {
  Stop-LocalUatManagedProcesses
  throw
}

Write-Output 'Local UAT is ready.'
Write-Output 'Public:      http://127.0.0.1:5173/map'
Write-Output 'Admin:       http://127.0.0.1:5174/panel-svietidla/login'
Write-Output 'Fake inbox:  http://127.0.0.1:5001/'
Write-Output 'Status:      http://127.0.0.1:5000/api/dev/local-uat/status'
Write-Output 'Credentials: .local-uat/private/admin-credentials.txt (ignored and restricted to this Windows account)'
Write-Output 'Email and address providers are fake; report submissions end at the local simulated sink.'
