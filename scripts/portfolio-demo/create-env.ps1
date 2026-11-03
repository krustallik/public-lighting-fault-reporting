param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $resolvedOutput) {
  throw 'Refusing to overwrite an existing demo environment file.'
}

function New-Base64UrlSecret {
  $bytes = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$dbPassword = New-Base64UrlSecret
$jwtSecret = New-Base64UrlSecret
$adminPassword = New-Base64UrlSecret
$environment = @"
DB_HOST=127.0.0.1
DB_PORT=15432
DB_NAME=lighting_portfolio_demo_dev
DB_USER=postgres
DB_PASSWORD=$dbPassword
NODE_ENV=development
PORTFOLIO_DEMO_APPROVED=true
BACKEND_PORT=18000
FRONTEND_PORT=18097
ADMIN_FRONTEND_PORT=18098
CORS_ORIGIN=http://localhost:18097
LOCAL_TEST_SUBMIT_ENABLED=false
EMAIL_VERIFICATION_ENABLED=false
REPORT_SUBMISSION_MODE=disabled
RESEND_API_KEY=
RESEND_FROM_EMAIL=
ADMIN_INITIAL_PASSWORD=$adminPassword
GEOAPIFY_ENABLED=false
GEOAPIFY_BASE_URL=https://api-eu.geoapify.com
GEOAPIFY_API_KEY=
JWT_SECRET=$jwtSecret
VITE_MAP_TILE_PROVIDER=dev-osm
VITE_CARTO_TILES_APPROVED=false
VITE_CARTO_PUBLIC_KEY=
VITE_ALLOW_DEVICE_MAP_RECENTER=false
VITE_ADMIN_BASE_PATH=/panel-svietidla
NOMINATIM_AUTO_GEOCODE=false
AUSEMIO_API_KEY=
AUSEMIO_TEST_MODE=true
"@

$parent = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $parent)) {
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
}
[System.IO.File]::WriteAllText($resolvedOutput, $environment.Trim() + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Write-Output $resolvedOutput
