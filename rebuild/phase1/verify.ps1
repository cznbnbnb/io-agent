param([string]$DevEcoHome='D:\APP\DevEcoStudio', [string]$NodePath='D:\openclaw\nodejs\node.exe')
$ErrorActionPreference='Stop'
$env:DEVECO_HOME=$DevEcoHome
$taskRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Push-Location (Join-Path $taskRoot 'rebuild\harmony-sdk')
try {
  $taskTests=@(Get-ChildItem -LiteralPath tests -Filter '*.test.mjs' | ForEach-Object FullName)
  & $NodePath --test @taskTests *> (Join-Path $PSScriptRoot 'final-tests.log')
  if ($LASTEXITCODE -ne 0) { throw 'Application regression failed; see final-tests.log' }
} finally { Pop-Location }
Push-Location $taskRoot
try {
  & $NodePath --test tools/phase1/contracts.test.mjs *> (Join-Path $PSScriptRoot 'contracts-tests.log')
  if ($LASTEXITCODE -ne 0) { throw 'Contract conformance failed; see contracts-tests.log' }
} finally { Pop-Location }
'Application and contract regression passed. This does not run hardware tests.'
