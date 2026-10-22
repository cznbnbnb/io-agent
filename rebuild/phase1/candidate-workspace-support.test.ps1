$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'candidate-build-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-run-support.ps1')
$workspaceChecks=0
function Assert-WorkspaceTest($Condition,[string]$Message) { if (-not $Condition) { throw $Message };$script:workspaceChecks++ }
function Assert-WorkspaceThrows($Action,[string]$Pattern) {
  $workspaceRejected=$false;$workspaceObserved='no error'
  try { & $Action | Out-Null } catch { $workspaceObserved=$_.Exception.Message;$workspaceRejected=$workspaceObserved -match $Pattern }
  Assert-WorkspaceTest $workspaceRejected ('Expected workspace refusal: '+$Pattern+'; observed='+$workspaceObserved)
}
$workspacePolicy=Get-CandidateWorkspacePolicy $PSScriptRoot
$workspaceFixture=New-CandidateScratchDirectory $workspacePolicy.workspaceRoot 'workspace-policy-test'
$workspacePhase=Join-Path $workspaceFixture 'phase'
New-Item -ItemType Directory -Path (Join-Path $workspacePhase 'device-private') -Force | Out-Null
$workspaceConfig=Join-Path $workspacePhase 'device-private\build-workspace.json'
$workspaceDefault=Get-CandidateWorkspacePolicy $workspacePhase
Assert-WorkspaceTest ($workspaceDefault.workspaceRoot -ceq 'D:\TurboIO-builds\01a125f7') 'New builds default to the dedicated D workspace'
Assert-WorkspaceTest ($workspaceDefault.legacyTempRoot -ieq (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'Temp')) 'Legacy permission comes from the native profile, never current TEMP'
$workspaceCustom=Join-Path $workspaceFixture 'explicit-workspace'
Write-CandidateJson $workspaceConfig @{schema=1;workspaceRoot=$workspaceCustom}
Assert-WorkspaceTest ((Get-CandidateWorkspacePolicy $workspacePhase).workspaceRoot -ceq $workspaceCustom) 'Private machine configuration is explicit'
$workspaceOverride=Join-Path $workspaceFixture 'parameter-workspace'
Assert-WorkspaceTest ((Get-CandidateWorkspacePolicy $workspacePhase $workspaceOverride).workspaceRoot -ceq $workspaceOverride) 'Explicit entry parameter overrides the private default'
foreach ($workspaceBadConfig in @(@{schema=2;workspaceRoot=$workspaceCustom},@{schema=$true;workspaceRoot=$workspaceCustom},@{schema='1';workspaceRoot=$workspaceCustom},@{schema=1;workspaceRoot=$workspaceCustom;unexpected='extra'})) {
  Write-CandidateJson $workspaceConfig $workspaceBadConfig
  Assert-WorkspaceThrows { Get-CandidateWorkspacePolicy $workspacePhase } 'Invalid private build workspace configuration'
}
Write-CandidateJson $workspaceConfig @{schema=1;workspaceRoot=$workspaceCustom}
foreach ($workspaceBadPath in @('relative','C:relative','\\server\share\workspace','D:\','D:\root\..\escape','D:\bad|root','D:\bad:stream')) {
  Assert-WorkspaceThrows { Assert-CandidateWorkspaceRoot $workspaceBadPath } 'workspace'
}
$workspaceNonAscii='D:\'+[char]0x6D4B
Assert-WorkspaceThrows { Assert-CandidateWorkspaceRoot $workspaceNonAscii } 'ASCII'
$workspaceRun='20261015-220000001-12345678'
$workspaceOtherRun='20261015-220000002-87654321'
$workspaceStage=New-CandidateStage $workspaceCustom $workspaceRun
$workspaceLegacy=Join-Path $workspaceFixture 'legacy-temp'
$workspaceLegacyStage=New-CandidateStage $workspaceLegacy $workspaceRun
$workspaceStatus=[pscustomobject]@{runId=$workspaceRun;stageDirectory=$workspaceStage;buildWorkspaceRoot=$workspaceCustom}
Assert-WorkspaceTest ((Resolve-CandidateRecordedStage $workspaceStatus $workspaceRun $workspaceCustom $workspaceLegacy) -ceq $workspaceStage) 'A new workspace run resolves only its recorded stage'
$workspaceOldStatus=[pscustomobject]@{runId=$workspaceRun;stageDirectory=$workspaceLegacyStage}
Assert-WorkspaceTest ((Resolve-CandidateRecordedStage $workspaceOldStatus $workspaceRun $workspaceCustom $workspaceLegacy) -ceq $workspaceLegacyStage) 'Legacy per-run status does not need a new workspace field'
$workspaceOldStatus.stageDirectory=$workspaceStage
Assert-WorkspaceTest ((Resolve-CandidateRecordedStage $workspaceOldStatus $workspaceRun $workspaceCustom $workspaceLegacy) -ceq $workspaceStage) 'Both explicit roots work; process TEMP is irrelevant'
$workspaceBadStatus=[pscustomobject]@{runId=$workspaceRun;stageDirectory=(Join-Path $workspaceFixture ('untrusted\TurboIO-phase1-01a125f7-runs\'+$workspaceRun))}
Assert-WorkspaceThrows { Resolve-CandidateRecordedStage $workspaceBadStatus $workspaceRun $workspaceCustom $workspaceLegacy } 'run/stage mismatch'
$workspaceBadStatus.stageDirectory=Get-CandidateStagePath $workspaceCustom $workspaceOtherRun
Assert-WorkspaceThrows { Resolve-CandidateRecordedStage $workspaceBadStatus $workspaceRun $workspaceCustom $workspaceLegacy } 'run/stage mismatch'
$workspaceBadStatus.runId=$workspaceOtherRun
New-CandidateStage $workspaceLegacy $workspaceOtherRun | Out-Null
Assert-WorkspaceThrows { Resolve-CandidateRecordedStage $workspaceBadStatus $workspaceOtherRun $workspaceCustom $workspaceLegacy } 'unavailable or archived'
New-Item -ItemType Junction -Path $workspaceBadStatus.stageDirectory -Target $workspaceStage | Out-Null
Assert-WorkspaceThrows { Resolve-CandidateRecordedStage $workspaceBadStatus $workspaceOtherRun $workspaceCustom $workspaceLegacy } 'Redirected candidate directory'
$workspaceStatus.buildWorkspaceRoot=$workspaceLegacy
Assert-WorkspaceThrows { Resolve-CandidateRecordedStage $workspaceStatus $workspaceRun $workspaceCustom $workspaceLegacy } 'workspace/stage mismatch'
$workspaceStatus.buildWorkspaceRoot=$workspaceCustom
Assert-WorkspaceThrows { Get-CandidateSigningInput $workspacePhase $workspaceCustom '../escape' $workspaceFixture } 'Invalid candidate run'
$workspaceJunction=Join-Path $workspaceFixture 'redirected-workspace'
New-Item -ItemType Junction -Path $workspaceJunction -Target $workspaceCustom | Out-Null
Assert-WorkspaceThrows { Assert-CandidateWorkspaceRoot $workspaceJunction } 'Redirected candidate directory'
$workspaceBeforeTemp=[Environment]::GetEnvironmentVariable('TEMP','Process')
$workspaceBeforeTmp=[Environment]::GetEnvironmentVariable('TMP','Process')
$workspaceBeforeUser=[Environment]::GetEnvironmentVariable('TEMP','User')
$workspaceBeforeMachine=[Environment]::GetEnvironmentVariable('TEMP','Machine')
$workspaceTempState=$null
try {
  $workspaceTempState=Enter-CandidateProcessTemp $workspaceFixture
  Assert-WorkspaceTest ($env:TEMP -ceq $workspaceFixture -and $env:TMP -ceq $workspaceFixture) 'Only child-process scratch locations are redirected'
  Assert-WorkspaceTest ((Get-CandidateWorkspacePolicy $workspacePhase).legacyTempRoot -ieq $workspaceDefault.legacyTempRoot) 'Legacy root remains native after process TEMP changes'
  throw 'intentional scoped failure'
} catch { if ($_.Exception.Message -cne 'intentional scoped failure') { throw } }
finally { Restore-CandidateProcessTemp $workspaceTempState }
Assert-WorkspaceTest ([Environment]::GetEnvironmentVariable('TEMP','Process') -ceq $workspaceBeforeTemp -and [Environment]::GetEnvironmentVariable('TMP','Process') -ceq $workspaceBeforeTmp) 'Process TEMP/TMP are restored after failure'
Assert-WorkspaceTest ([Environment]::GetEnvironmentVariable('TEMP','User') -ceq $workspaceBeforeUser -and [Environment]::GetEnvironmentVariable('TEMP','Machine') -ceq $workspaceBeforeMachine) 'User and system TEMP are never modified'
Assert-WorkspaceThrows { Assert-CandidateAvailableBytes 8589934591 } 'at least 8589934592'
Assert-WorkspaceThrows { Assert-CandidateAvailableBytes 0 } 'no build started'
Assert-CandidateAvailableBytes 8589934592
Assert-WorkspaceTest $true 'Exactly 8GiB passes the preflight threshold'
$workspaceCapacity=Get-CandidateWorkspaceCapacity $workspacePolicy.workspaceRoot
Assert-WorkspaceTest ($workspaceCapacity.availableFreeBytes -ge 8589934592) 'Actual workspace volume passed the read-only capacity check'
$workspaceCapacityRoot=Join-Path $workspaceFixture 'stage-capacity'
Assert-WorkspaceTest ((Get-CandidateStageCapacity $workspaceCapacityRoot).stageDirectories -eq 0) 'A missing runs parent is empty without scanning another root'
Assert-WorkspaceTest (-not (Test-Path -LiteralPath $workspaceCapacityRoot)) 'Read-only capacity preflight creates no directories'
foreach ($workspaceUnrelated in @('source','_scratch\old-run','other-agent\workspace','archive\old-stage')) {
  New-Item -ItemType Directory -Path (Join-Path $workspaceCapacityRoot $workspaceUnrelated) -Force | Out-Null
}
Assert-WorkspaceTest ((Get-CandidateStageCapacity $workspaceCapacityRoot).stageDirectories -eq 0) 'Source, scratch, archives and other-agent directories outside the exact runs parent are not counted'
$workspaceCapacityA=New-CandidateStage $workspaceCapacityRoot $workspaceRun
Assert-WorkspaceTest ((Get-CandidateStageCapacity $workspaceCapacityRoot).stageDirectories -eq 1) 'A newly created unfinished stage with no run ledger counts immediately'
$workspaceCreationLock=[IO.File]::Open((Join-Path (Split-Path $workspaceCapacityA -Parent) '.candidate-stage-create.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {
  Assert-WorkspaceThrows { New-CandidateStage $workspaceCapacityRoot $workspaceOtherRun } '.'
  Assert-WorkspaceTest (-not (Test-Path -LiteralPath (Get-CandidateStagePath $workspaceCapacityRoot $workspaceOtherRun))) 'A competing creation lock prevents an unchecked new stage'
} finally { $workspaceCreationLock.Dispose() }
$workspaceCapacityB=New-CandidateStage $workspaceCapacityRoot $workspaceOtherRun
[IO.File]::WriteAllText((Join-Path (Split-Path $workspaceCapacityB -Parent) 'small-ledger.json'),'{}')
Assert-WorkspaceThrows { Get-CandidateStageCapacity $workspaceCapacityRoot } 'limit reached: 2/2'
Assert-WorkspaceThrows { New-CandidateStage $workspaceCapacityRoot '20261015-220000003-abcdef12' } 'limit reached: 2/2'
Assert-WorkspaceTest (-not (Test-Path -LiteralPath (Get-CandidateStagePath $workspaceCapacityRoot '20261015-220000003-abcdef12'))) 'The third stage is refused before its directory is created'
$workspaceUnknownRoot=Join-Path $workspaceFixture 'unledgered-capacity'
foreach ($workspaceUnknown in @('unknown-candidate-a','unknown-candidate-b')) {
  New-Item -ItemType Directory -Path (Join-Path $workspaceUnknownRoot ('TurboIO-phase1-01a125f7-runs\'+$workspaceUnknown)) -Force | Out-Null
}
Assert-WorkspaceThrows { Get-CandidateStageCapacity $workspaceUnknownRoot } 'limit reached: 2/2'
# The installed .82 C stage is retained; resolution below reads it without edits,
# signing, compilation or device access. An archived stage is never substituted.
$workspaceActualRun='20261015-155726672-6f13c5fe'
$workspaceActualStatusPath=Join-Path $PSScriptRoot ('candidate-runs\'+$workspaceActualRun+'\status.json')
$workspaceActualBefore=(Get-FileHash -LiteralPath $workspaceActualStatusPath).Hash
$workspaceActualStatus=Get-Content -LiteralPath $workspaceActualStatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
$workspaceActualResolved=Resolve-CandidateRecordedStage $workspaceActualStatus $workspaceActualRun $workspacePolicy.workspaceRoot
Assert-WorkspaceTest ($workspaceActualResolved -ieq (Get-CandidateStagePath $workspacePolicy.legacyTempRoot $workspaceActualRun)) 'Actual retained .82 legacy C run still resolves to its original path'
Assert-WorkspaceTest ((Get-FileHash -LiteralPath $workspaceActualStatusPath).Hash -ceq $workspaceActualBefore) 'Legacy compile status is unchanged'
Assert-WorkspaceThrows { & (Join-Path $PSScriptRoot 'audit-candidate-source-paths.ps1') -RunId $workspaceActualRun -StageRoot (Join-Path $workspaceFixture 'another-identical-copy') } 'explicit stage must match the recorded run stage'
foreach ($workspaceScript in @('candidate-workspace-support.ps1','candidate-run-support.ps1','build-candidate.ps1','sign-candidate.ps1','audit-candidate-source-paths.ps1','finalize-candidate-signature.ps1','candidate-native-signature.test.ps1','verify-native.ps1','candidate-cached-dependency.test.ps1')) {
  $workspaceParseTokens=$null;$workspaceParseErrors=$null
  [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $workspaceScript),[ref]$workspaceParseTokens,[ref]$workspaceParseErrors) | Out-Null
  Assert-WorkspaceTest ($workspaceParseErrors.Count -eq 0) ('PowerShell entry syntax: '+$workspaceScript)
}
foreach ($workspaceTestLink in @($workspaceJunction,$workspaceBadStatus.stageDirectory)) {
  if (-not ([IO.Path]::GetFullPath($workspaceTestLink)).StartsWith($workspaceFixture+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or
    -not ((Get-Item -LiteralPath $workspaceTestLink -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Workspace test junction scope mismatch' }
  [IO.Directory]::Delete($workspaceTestLink,$false)
}
$workspaceLogDir=Join-Path (Join-Path $PSScriptRoot 'candidate-runs') 'guard-tests'
Assert-CandidateDirectoryChain $workspaceLogDir
New-Item -ItemType Directory -Path $workspaceLogDir -Force | Out-Null
$workspaceCleanup=Complete-CandidateScratch $workspaceFixture $workspacePolicy.workspaceRoot (Join-Path $workspaceLogDir ('workspace-ps'+$PSVersionTable.PSVersion.Major+'.json'))
Assert-WorkspaceTest $workspaceCleanup.cleaned 'Completed workspace guard fixtures leave only small run logs'
Write-Output ($workspaceChecks.ToString()+' candidate-workspace checks passed; only small run logs retained')
