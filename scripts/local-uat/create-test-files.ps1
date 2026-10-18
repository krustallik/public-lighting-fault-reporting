$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not (Test-Path -LiteralPath $script:LocalUatRuntimeEnv -PathType Leaf)) {
  throw 'Start local UAT once before generating its attachment fixtures.'
}

Protect-LocalUatStateTree
$testRoot = Join-Path $script:LocalUatPrivateRoot 'test-files'
if (Test-Path -LiteralPath $testRoot) {
  throw 'The local UAT test-files directory already exists; inspect it before retrying.'
}
New-Item -ItemType Directory -Path $testRoot | Out-Null
Protect-LocalUatPath $testRoot -Directory

$validPath = Join-Path $testRoot 'valid-synthetic-attachment.txt'
$oversizePath = Join-Path $testRoot 'oversize-synthetic-attachment.bin'
$validBytes = [System.Text.Encoding]::UTF8.GetBytes('Synthetic local UAT attachment. Contains no personal data.')
$oversizeBytes = New-Object byte[] (10MB + 1)
[System.IO.File]::WriteAllBytes($validPath, $validBytes)
[System.IO.File]::WriteAllBytes($oversizePath, $oversizeBytes)
Protect-LocalUatPath $validPath
Protect-LocalUatPath $oversizePath

Write-Output 'Created synthetic attachment fixtures under .local-uat/private/test-files/.'
Write-Output 'valid-synthetic-attachment.txt is below the upload limit.'
Write-Output 'oversize-synthetic-attachment.bin is one byte above the 10 MiB local test sink limit.'
