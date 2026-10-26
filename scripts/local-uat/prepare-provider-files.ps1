. (Join-Path $PSScriptRoot 'Common.ps1')

$files = Initialize-LocalUatProviderSecretFiles
Write-Output 'Created or protected local-only provider configuration files under .local-uat/private/.'
Write-Output 'Enter each value locally in a text editor. Do not paste provider keys or email addresses into chat or commit them.'
Write-Output ($files -join "`n")
