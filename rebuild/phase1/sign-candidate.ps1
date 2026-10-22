param([string]$DevEcoHome='D:\APP\DevEcoStudio', [string]$SigningProject='D:\Project\turboio-harmony\harmony-sdk', [string]$RunId='',[string]$BuildWorkspaceRoot='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'candidate-build-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-run-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-package-support.ps1')
$taskSource=Split-Path $PSScriptRoot -Parent
$taskWorkspace=Get-CandidateWorkspacePolicy $PSScriptRoot $BuildWorkspaceRoot
$taskOperationLock=Enter-CandidateBuildLock $taskWorkspace.workspaceRoot $PSScriptRoot
try {
$taskInput=Get-CandidateSigningInput $PSScriptRoot $taskWorkspace.workspaceRoot $RunId $taskSource
$taskProcessTemp=$null
$taskSignScratch=''
try {
$taskSignScratch=New-CandidateScratchDirectory $taskWorkspace.workspaceRoot ('sign-'+$taskInput.runId)
$taskProcessTemp=Enter-CandidateProcessTemp $taskSignScratch
$taskStage=Join-Path $taskInput.stageDirectory 'harmony-sdk'
$taskOutput=Join-Path (Split-Path $taskInput.unsigned -Parent) 'entry-default-signed.hap'
if (Test-Path -LiteralPath $taskOutput) { throw 'Signed artifact for this run already exists; refusing overwrite' }
$taskSignLog=Join-Path $taskInput.runDirectory 'sign.log'
$taskSignStatus=[ordered]@{ runId=$taskInput.runId; stageDirectory=$taskInput.stageDirectory; compileStatusSha256=$taskInput.statusSha256; phase='signing'; signingSucceeded=$false; startedUtc=[DateTime]::UtcNow.ToString('o') }
$taskSignStatusPath=Join-Path $taskInput.runDirectory 'sign-status.json'
$taskProfilePath=Join-Path $taskStage 'build-profile.json5'
$taskOriginal=[IO.File]::ReadAllBytes($taskProfilePath)
$taskProfile=[Text.Encoding]::UTF8.GetString($taskOriginal).TrimStart([char]0xFEFF) | ConvertFrom-Json
$taskSigningProfile=Join-Path $SigningProject 'build-profile.json5'
# DevEco writes build-profile.json5 (JSON5); ConvertFrom-Json cannot read it.
# Windows PowerShell 5.1 also mangles non-ASCII arguments passed to native tools,
# so the parser is staged into an ASCII temp path before it is called. Keep this
# script ASCII-only: PS 5.1 misreads UTF-8 without BOM and breaks the statement.
$taskParser=Join-Path $taskSignScratch 'turboio-parse-json5.mjs'
[IO.File]::WriteAllText($taskParser,[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'parse-json5.mjs'),[Text.Encoding]::UTF8),(New-Object Text.UTF8Encoding($false)))
$taskSigningJson=& (Join-Path $DevEcoHome 'tools\node\node.exe') $taskParser $taskSigningProfile
if ($LASTEXITCODE -ne 0 -or !$taskSigningJson) { throw 'Signing profile parse failed' }
$taskSigning=$taskSigningJson | ConvertFrom-Json
$taskProduct=@($taskSigning.app.products | Where-Object { $_.name -eq 'default' })[0]
$taskConfig=@($taskSigning.app.signingConfigs | Where-Object { $_.name -eq $taskProduct.signingConfig })[0]
if (!$taskConfig) { throw 'Existing signing configuration unavailable' }
foreach ($taskKey in @('certpath','profile','storeFile')) {
  if (!(Test-Path -LiteralPath $taskConfig.material.$taskKey)) { throw 'Existing signing material unavailable' }
}
$taskProfile.app.signingConfigs=@($taskConfig)
@($taskProfile.app.products | Where-Object { $_.name -eq 'default' })[0] | Add-Member -NotePropertyName signingConfig -NotePropertyValue $taskConfig.name -Force
$env:DEVECO_SDK_HOME=Join-Path $DevEcoHome 'sdk'
$env:JAVA_HOME=Join-Path $DevEcoHome 'jbr'
$env:PATH=(Join-Path $DevEcoHome 'tools\node')+';'+$env:PATH
Write-CandidateJson $taskSignStatusPath $taskSignStatus
try {
  [IO.File]::WriteAllText($taskProfilePath,($taskProfile | ConvertTo-Json -Depth 30),(New-Object Text.UTF8Encoding($false)))
  Push-Location $taskStage
  try {
    $ErrorActionPreference='Continue'
    & (Join-Path $DevEcoHome 'tools\node\node.exe') (Join-Path $DevEcoHome 'tools\hvigor\bin\hvigorw.js') assembleHap --mode module -p 'module=entry@default' -p 'product=default' -p 'buildMode=debug' --no-daemon *> $taskSignLog
    $taskExit=$LASTEXITCODE
    $ErrorActionPreference='Stop'
    if ($taskExit -ne 0) { throw 'Signing failed; inspect candidate-sign.log privately' }
    $taskSigned=Join-Path $taskStage 'entry\build\default\outputs\default\entry-default-signed.hap'
    $taskSignedItem=Get-Item -LiteralPath $taskSigned
    if ($taskSignedItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected signed HAP refused' }
    Assert-CandidateHapFresh $taskSignedItem $taskSignStatus.startedUtc
    $taskSignedApp=Get-CandidateHapApp $taskSigned
    Assert-CandidateRuntimePayload $taskSigned
    if ($taskSignedApp.versionCode -ne $taskInput.status.versionCode -or $taskSignedApp.versionName -cne $taskInput.status.versionName -or $taskSignedApp.bundleName -cne $taskInput.status.hap.bundleName) { throw 'Signed HAP embedded metadata mismatch' }
  } finally { Pop-Location }
} catch {
  $taskSignStatus.phase='sign_failed';$taskSignStatus.failure='Signing or artifact verification failed; inspect scoped log privately'
  throw
} finally {
  [IO.File]::WriteAllBytes($taskProfilePath,$taskOriginal)
  if ($taskSignStatus.phase -eq 'sign_failed') { $taskSignStatus.finishedUtc=[DateTime]::UtcNow.ToString('o') }
  if (Test-Path -LiteralPath $taskSignLog) { Copy-Item -LiteralPath $taskSignLog -Destination (Join-Path $PSScriptRoot 'candidate-sign.log') -Force }
  Write-CandidateJson $taskSignStatusPath $taskSignStatus
}
# Recheck the whole source/stage after restoring the unsigned build profile.
# No signed artifact is published before this check passes.
try {
  $taskFinal=Complete-CandidateSignedBuild $PSScriptRoot $taskWorkspace.workspaceRoot $taskInput.runId $taskSource $DevEcoHome
  $taskSignStatus.phase='complete';$taskSignStatus.signingSucceeded=$true
  $taskSignStatus.hap=[ordered]@{ path=$taskOutput; bytes=(Get-Item -LiteralPath $taskOutput).Length; sha256=(Get-FileHash -LiteralPath $taskOutput).Hash; versionCode=$taskSignedApp.versionCode; versionName=$taskSignedApp.versionName; bundleName=$taskSignedApp.bundleName }
  $taskFinal | ConvertTo-Json -Compress
} catch {
  $taskSignStatus.phase='sign_failed';$taskSignStatus.failure='Post-sign provenance check or artifact publication failed'
  throw
} finally {
  $taskSignStatus.finishedUtc=[DateTime]::UtcNow.ToString('o')
  Write-CandidateJson $taskSignStatusPath $taskSignStatus
}
} finally {
  Restore-CandidateProcessTemp $taskProcessTemp
  if ($taskSignScratch) { Complete-CandidateScratch $taskSignScratch $taskWorkspace.workspaceRoot (Join-Path $taskInput.runDirectory ('scratch-'+(Split-Path $taskSignScratch -Leaf)+'.json')) | Out-Null }
}
} finally { Exit-CandidateBuildLock $taskOperationLock }
