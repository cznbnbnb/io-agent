param([string]$DevEcoHome='D:\APP\DevEcoStudio',[string]$BuildWorkspaceRoot='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'candidate-build-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-run-support.ps1')
$candidateWorkspace=Get-CandidateWorkspacePolicy $PSScriptRoot $BuildWorkspaceRoot
$candidateRun='cached-dependency-smoke-'+[Guid]::NewGuid().ToString('N')
$candidateStage=New-CandidateScratchDirectory $candidateWorkspace.workspaceRoot $candidateRun
$candidateProcessTemp=$null
$candidateLocationPushed=$false
try {
if ($candidateStage -match '[^\x00-\x7F]') { throw 'ASCII smoke fixture required' }
$candidateEvidenceDir=Join-Path (Join-Path $PSScriptRoot 'candidate-runs') $candidateRun
New-Item -ItemType Directory -Path $candidateEvidenceDir -Force | Out-Null
$candidateCachedRelative='harmony-sdk\oh_modules\.ohpm\sherpa_onnx@1.13.3\oh_modules\sherpa_onnx'
$candidateCached=Join-Path (Join-Path $candidateWorkspace.legacyTempRoot 'TurboIO-phase1-01a125f7') $candidateCachedRelative
$candidateCopied=Join-Path $candidateStage $candidateCachedRelative
New-Item -ItemType Directory -Path $candidateCopied -Force | Out-Null
& robocopy $candidateCached $candidateCopied /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Smoke fixture package copy failed' }
$candidateProject=Join-Path $candidateStage 'harmony-sdk'
New-Item -ItemType Directory -Path (Join-Path $candidateProject 'entry') -Force | Out-Null
Write-CandidateJson (Join-Path $candidateProject 'oh-package.json5') @{ name='candidate-cache-smoke'; version='1.0.0'; modelVersion='5.0.0'; dependencies=@{} }
Write-CandidateJson (Join-Path $candidateProject 'build-profile.json5') @{ app=@{}; modules=@(@{name='entry'; srcPath='./entry'; targets=@(@{name='default'})}) }
Write-CandidateJson (Join-Path $candidateProject 'entry\oh-package.json5') @{ name='entry'; version='1.0.0'; dependencies=@{sherpa_onnx='1.13.3'} }
$candidateFallback=Initialize-CandidateSherpaFallback $candidateStage $candidateRun $candidateEvidenceDir 'isolated local dependency smoke; no actual metadata timeout'
$candidateLog=Join-Path $candidateEvidenceDir 'install.log'
$env:PATH=(Join-Path $DevEcoHome 'tools\node')+';'+$env:PATH
Push-Location $candidateProject
$candidateLocationPushed=$true
  $candidateProcessTemp=Enter-CandidateProcessTemp $candidateStage
  $ErrorActionPreference='Continue'
  & (Join-Path $DevEcoHome 'tools\ohpm\bin\ohpm.bat') install --fetch_timeout 15000 --retry_times 0 --cache (Join-Path $candidateStage 'cache') *> $candidateLog
  $candidateExit=$LASTEXITCODE
  $ErrorActionPreference='Stop'
  if ($candidateExit -ne 0) { Get-Content -LiteralPath $candidateLog; throw 'Isolated fallback dependency install failed' }
  Test-CandidateSherpaInstalled $candidateStage $candidateFallback
  $candidateNative=Join-Path $candidateProject 'entry\oh_modules\sherpa_onnx\oh_modules\libsherpa_onnx.so\oh-package.json5'
  if (-not (Test-Path -LiteralPath $candidateNative)) { throw 'Native type package declaration was not linked' }
  Write-CandidateJson (Join-Path $candidateEvidenceDir 'status.json') @{ kind='isolated_local_dependency_smoke'; dependencyInstalled=$true; nativeTypesLinked=$true; compileStarted=$false; productSourceModified=$false; stage=$candidateStage; version='1.13.3'; snapshotSha256=$candidateFallback.snapshot.sha256; limits='No product candidate compilation; no actual metadata timeout claimed. Local file installation/native metadata only.' }
  Write-Output ('Cached same-version file dependency installed with native declarations; evidence '+$candidateEvidenceDir)
} finally {
  Restore-CandidateProcessTemp $candidateProcessTemp
  if ($candidateLocationPushed) { Pop-Location }
  Complete-CandidateScratch $candidateStage $candidateWorkspace.workspaceRoot (Join-Path $candidateEvidenceDir 'scratch-cached-dependency.json') | Out-Null
}
