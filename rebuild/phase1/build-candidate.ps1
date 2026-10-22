param([string]$DevEcoHome='D:\APP\DevEcoStudio', [switch]$AllowCachedSherpaFallback,[string]$BuildWorkspaceRoot='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'candidate-build-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-run-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-package-support.ps1')
$taskWorkspace=Get-CandidateWorkspacePolicy $PSScriptRoot $BuildWorkspaceRoot
$taskCapacity=Get-CandidateWorkspaceCapacity $taskWorkspace.workspaceRoot
$taskBuildLock=Enter-CandidateBuildLock $taskWorkspace.workspaceRoot $PSScriptRoot
try {
$taskStageCapacity=Get-CandidateStageCapacity $taskWorkspace.workspaceRoot
$taskArtifactCapacity=Get-CandidateArtifactCapacity $PSScriptRoot
$taskSource=Split-Path $PSScriptRoot -Parent
$taskRunId=(Get-Date -Format 'yyyyMMdd-HHmmssfff')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$taskRunDir=Join-Path (Join-Path $PSScriptRoot 'candidate-runs') $taskRunId
New-Item -ItemType Directory -Path $taskRunDir -Force | Out-Null
$taskBuildLog=Join-Path $PSScriptRoot 'candidate-build.log'
$taskDependencyLog=Join-Path $PSScriptRoot 'candidate-dependencies.log'
foreach ($taskPrevious in @($taskBuildLog,$taskDependencyLog,(Join-Path $PSScriptRoot 'candidate-run-status.json'))) {
  if (Test-Path -LiteralPath $taskPrevious) { Copy-Item -LiteralPath $taskPrevious -Destination (Join-Path $taskRunDir ('previous-'+[IO.Path]::GetFileName($taskPrevious))) }
}
$taskApp=Get-Content -LiteralPath (Join-Path $taskSource 'harmony-sdk\AppScope\app.json5') -Raw | ConvertFrom-Json
$taskStatus=[ordered]@{ runId=$taskRunId; startedUtc=[DateTime]::UtcNow.ToString('o'); versionName=$taskApp.app.versionName; versionCode=$taskApp.app.versionCode; phase='source_staging'; dependencySucceeded=$false; compileStarted=$false; compileSucceeded=$false; fallbackUsed=$false; runDirectory=$taskRunDir; buildWorkspaceRoot=$taskWorkspace.workspaceRoot; capacityBeforeBuild=$taskCapacity; stageCapacityBeforeBuild=$taskStageCapacity; artifactCapacityBeforeBuild=$taskArtifactCapacity }
function Save-CandidateStatus {
  Write-CandidateJson (Join-Path $PSScriptRoot 'candidate-run-status.json') $taskStatus
  Write-CandidateJson (Join-Path $taskRunDir 'status.json') $taskStatus
}
[IO.File]::WriteAllText($taskBuildLog, ('BUILD_NOT_STARTED run='+$taskRunId+' version='+$taskStatus.versionName+"`r`n"))
[IO.File]::WriteAllText($taskDependencyLog, ('DEPENDENCY_NOT_STARTED run='+$taskRunId+"`r`n"))
Save-CandidateStatus
$taskBaseline=@()
$taskFallback=$null
$taskProcessTemp=$null
$taskScratch=''
try {
$taskStage=New-CandidateStage $taskWorkspace.workspaceRoot $taskRunId
$taskStatus.stageDirectory=$taskStage
$taskScratch=New-CandidateScratchDirectory $taskWorkspace.workspaceRoot ('build-'+$taskRunId)
$taskStatus.processTempDirectory=$taskScratch
$taskProcessTemp=Enter-CandidateProcessTemp $taskScratch
Save-CandidateStatus
$taskBaseline=Get-CandidateSourceSnapshot $taskSource @('harmony-sdk','core-probe')
Write-CandidateJson (Join-Path $taskRunDir 'source-hashes.json') $taskBaseline
$taskStatus.sourceHashManifestSha256=(Get-FileHash -LiteralPath (Join-Path $taskRunDir 'source-hashes.json')).Hash
foreach ($taskModule in @('harmony-sdk','core-probe')) {
  & robocopy (Join-Path $taskSource $taskModule) (Join-Path $taskStage $taskModule) /E /XJ /XD build .hvigor .idea oh_modules node_modules .git (Join-Path $taskSource 'harmony-sdk\entry\.cxx') /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'Source staging failed' }
}
# Use already installed dependencies from the previous build, without changing that checkout.
$taskOld=Get-CandidateDependencySeed $PSScriptRoot $taskWorkspace
$taskStatus.dependencySeed=$taskOld
foreach ($taskRelative in @('oh_modules','entry\oh_modules','turbo_core\oh_modules')) {
  if (!$taskOld) { continue }
  $taskFrom=Join-Path $taskOld $taskRelative
  if (Test-Path -LiteralPath $taskFrom) {
    # OHPM local packages are junctions. Following an old checkout's junction
    # copies stale source back into our staged modules.
    & robocopy $taskFrom (Join-Path (Join-Path $taskStage 'harmony-sdk') $taskRelative) /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'Dependency staging failed' }
  }
}
# Restore and verify source after dependency reuse, including local core packages.
foreach ($taskModule in @('harmony-sdk','core-probe')) {
  $taskModuleSource=Join-Path $taskSource $taskModule
  & robocopy $taskModuleSource (Join-Path $taskStage $taskModule) /E /XJ /XD build .hvigor .idea oh_modules node_modules .git (Join-Path $taskSource 'harmony-sdk\entry\.cxx') /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'Source restoration failed' }
}
Assert-CandidateSource $taskSource $taskStage $taskBaseline $null $false
$env:DEVECO_HOME=$DevEcoHome
$env:DEVECO_SDK_HOME=Join-Path $DevEcoHome 'sdk'
$env:JAVA_HOME=Join-Path $DevEcoHome 'jbr'
$env:PATH=(Join-Path $DevEcoHome 'tools\node')+';'+(Join-Path $DevEcoHome 'tools\ohpm\bin')+';'+$env:PATH
Push-Location (Join-Path $taskStage 'harmony-sdk')
try {
  # Rebuild OHPM's path metadata after copying. Directory contents alone do not
  # establish native-library declarations in a different checkout.
  $taskOhpm=Join-Path $DevEcoHome 'tools\ohpm\bin\ohpm.bat'
  $taskInstallCache=Join-Path $taskStage '_candidate-ohpm-cache'
  $taskStatus.ohpmVersion=(& $taskOhpm --version | Out-String).Trim()
  $taskStatus.phase='dependency_install'
  Save-CandidateStatus
  $ErrorActionPreference='Continue'
  & $taskOhpm install --fetch_timeout 15000 --retry_times 0 --cache $taskInstallCache *> $taskDependencyLog
  $taskDependencyExit=$LASTEXITCODE
  $ErrorActionPreference='Stop'
  Copy-Item -LiteralPath $taskDependencyLog -Destination (Join-Path $taskRunDir 'dependencies-initial.log')
  if ($taskDependencyExit -ne 0 -and $AllowCachedSherpaFallback -and (Test-SherpaMetadataTimeout (Get-Content -LiteralPath $taskDependencyLog -Raw))) {
    $taskFallback=Initialize-CandidateSherpaFallback $taskStage $taskRunId $taskRunDir
    $taskStatus.fallbackUsed=$true
    $taskStatus.cachedDependencyEvidenceSha256=(Get-FileHash -LiteralPath (Join-Path $taskRunDir 'cached-sherpa-evidence.json')).Hash
    $taskStatus.phase='dependency_fallback_install'
    Save-CandidateStatus
    $ErrorActionPreference='Continue'
    & $taskOhpm install --fetch_timeout 15000 --retry_times 0 --cache $taskInstallCache *> (Join-Path $taskRunDir 'dependencies-fallback.log')
    $taskDependencyExit=$LASTEXITCODE
    $ErrorActionPreference='Stop'
    [IO.File]::AppendAllText($taskDependencyLog, "`r`nVERIFIED_STAGE_ONLY_SHERPA_FALLBACK run=$taskRunId`r`n"+(Get-Content -LiteralPath (Join-Path $taskRunDir 'dependencies-fallback.log') -Raw))
    if ($taskDependencyExit -eq 0) { Test-CandidateSherpaInstalled $taskStage $taskFallback }
  }
  if ($taskDependencyExit -ne 0) { $taskStatus.dependencyExitCode=$taskDependencyExit; throw 'Dependency metadata initialization failed; compiler not started' }
  $taskStatus.dependencySucceeded=$true
  Assert-CandidateSource $taskSource $taskStage $taskBaseline $taskFallback.stagedEntryManifestSha256
  $taskStatus.generatedStageLockDifferences=@(Get-CandidateGeneratedLockDifferences $taskStage $taskBaseline)
  # Preserve generated stage outputs before compiling. A missing output requires
  # fresh packaging and prevents an incremental success from reusing an old HAP.
  $taskOutputs=Join-Path $taskStage 'harmony-sdk\entry\build\default\outputs\default'
  $taskPriorHaps=@()
  if (Test-Path -LiteralPath $taskOutputs) {
    foreach ($taskPrior in (Get-ChildItem -LiteralPath $taskOutputs -Filter '*unsigned.hap' -File)) {
      if ($taskPrior.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected prior HAP refused' }
      $taskPriorArchive=Join-Path $taskStage ('_prior-haps\'+$taskRunId)
      New-Item -ItemType Directory -Path $taskPriorArchive -Force | Out-Null
      $taskPriorDestination=Join-Path $taskPriorArchive $taskPrior.Name
      $taskPriorHaps+=@{ path=$taskPriorDestination; sha256=(Get-FileHash -LiteralPath $taskPrior.FullName).Hash }
      Move-Item -LiteralPath $taskPrior.FullName -Destination $taskPriorDestination
    }
  }
  $taskStatus.priorStagedHaps=$taskPriorHaps
  $taskStatus.phase='compile'
  $taskStatus.compileStarted=$true
  $taskStatus.compileStartedUtc=[DateTime]::UtcNow.ToString('o')
  Save-CandidateStatus
  $ErrorActionPreference='Continue'
  & (Join-Path $DevEcoHome 'tools\node\node.exe') (Join-Path $DevEcoHome 'tools\hvigor\bin\hvigorw.js') assembleHap --mode module -p 'module=entry@default' -p 'product=default' -p 'buildMode=debug' --no-daemon *> $taskBuildLog
  $taskExit=$LASTEXITCODE
  $ErrorActionPreference='Stop'
  Get-Content -LiteralPath $taskBuildLog -Tail 45
  $taskStatus.compileExitCode=$taskExit
  if ($taskExit -ne 0) { throw 'Candidate build failed' }
  $taskHaps=@(Get-ChildItem -LiteralPath '.\entry\build\default\outputs\default' -Filter '*unsigned.hap')
  if ($taskHaps.Count -ne 1) { throw 'Expected exactly one unsigned candidate HAP' }
  $taskHap=$taskHaps[0]
  Assert-CandidateHapFresh $taskHap $taskStatus.compileStartedUtc
  $taskHapApp=Get-CandidateHapApp $taskHap.FullName
  Assert-CandidateRuntimePayload $taskHap.FullName
  if ($taskHapApp.versionName -cne $taskStatus.versionName -or $taskHapApp.versionCode -ne $taskStatus.versionCode -or $taskHapApp.bundleName -cne $taskApp.app.bundleName) { throw 'Candidate HAP version/bundle mismatch' }
  Assert-CandidateSource $taskSource $taskStage $taskBaseline $taskFallback.stagedEntryManifestSha256
  $taskStatus.generatedStageLockDifferences=@(Get-CandidateGeneratedLockDifferences $taskStage $taskBaseline)
  $taskOut=Join-Path $PSScriptRoot 'artifacts'
  New-Item -ItemType Directory -Path $taskOut -Force | Out-Null
  $taskRunOut=Join-Path (Join-Path $taskOut 'candidate-runs') $taskRunId
  Assert-CandidateDirectoryChain $taskRunOut
  New-Item -ItemType Directory -Path $taskRunOut -ErrorAction Stop | Out-Null
  [IO.File]::Copy($taskHap.FullName,(Join-Path $taskRunOut $taskHap.Name),$false)
  $taskStatus.hap=[ordered]@{ path=(Join-Path $taskRunOut $taskHap.Name); stagePath=$taskHap.FullName; bytes=$taskHap.Length; sha256=(Get-FileHash -LiteralPath $taskHap.FullName).Hash; versionName=$taskHapApp.versionName; versionCode=$taskHapApp.versionCode; bundleName=$taskHapApp.bundleName }
  $taskStatus.compileSucceeded=$true
  $taskStatus.phase='complete'
} finally { Pop-Location }
} catch {
  $taskStatus.failure=$_.Exception.Message
  $taskStatus.phase=if ($taskStatus.compileStarted) { 'compile_failed' } else { 'dependency_or_staging_failed' }
  throw
} finally {
  Restore-CandidateProcessTemp $taskProcessTemp
  if ($taskScratch) { $taskStatus.scratchCleanup=Complete-CandidateScratch $taskScratch $taskWorkspace.workspaceRoot (Join-Path $taskRunDir 'scratch-build.json') }
  $taskStatus.finishedUtc=[DateTime]::UtcNow.ToString('o')
  Save-CandidateStatus
  Copy-Item -LiteralPath $taskBuildLog -Destination (Join-Path $taskRunDir 'build.log') -Force
  Copy-Item -LiteralPath $taskDependencyLog -Destination (Join-Path $taskRunDir 'dependencies.log') -Force
}
} finally { Exit-CandidateBuildLock $taskBuildLock }
