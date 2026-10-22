$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'candidate-build-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-run-support.ps1')
$growthChecks=0
function Assert-Growth($Condition,[string]$Message) { if (-not $Condition) { throw $Message };$script:growthChecks++ }
function Reject-Growth($Action,[string]$Pattern) { $caught=$false;try { & $Action | Out-Null } catch { $caught=$_.Exception.Message -match $Pattern };Assert-Growth $caught ('Expected refusal: '+$Pattern) }
function Remove-GrowthJunction([string]$Path,[string]$Fixture) {
  $full=[IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($Fixture+'\',[StringComparison]::OrdinalIgnoreCase) -or -not ((Get-Item -LiteralPath $full -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Test junction scope mismatch' }
  [IO.Directory]::Delete($full,$false)
}
$growthPolicy=Get-CandidateWorkspacePolicy $PSScriptRoot
$growthFixture=New-CandidateScratchDirectory $growthPolicy.workspaceRoot 'workspace-growth-test'
$growthLogs=Join-Path (Join-Path $PSScriptRoot 'candidate-runs') 'guard-tests'
Assert-CandidateDirectoryChain $growthLogs
New-Item -ItemType Directory -Path $growthLogs -Force | Out-Null
function Growth-Log([string]$Name) { return Join-Path $growthLogs ('growth-ps'+$PSVersionTable.PSVersion.Major+'-'+$Name+'.json') }
$growthPhase=Join-Path $growthFixture 'phase'
$growthRoot=Join-Path $growthFixture 'root'
$growthOtherRoot=Join-Path $growthFixture 'other-root'
$growthLock=Enter-CandidateBuildLock $growthRoot $growthPhase
try {
  $growthShared=Join-Path $growthPhase 'candidate-build.log';[IO.File]::WriteAllText($growthShared,'untouched original log')
  Reject-Growth { Enter-CandidateBuildLock $growthRoot $growthPhase } 'already active or lock unavailable'
  Reject-Growth { Enter-CandidateBuildLock $growthOtherRoot $growthPhase } 'already active or lock unavailable'
  Assert-Growth (-not (Test-Path -LiteralPath $growthOtherRoot)) 'The project lock prevents competing builds even with another workspace'
  Reject-Growth { Enter-CandidateBuildLock $growthRoot (Join-Path $growthFixture 'other-phase') } 'already active or lock unavailable'
  Assert-Growth ([IO.File]::ReadAllText($growthShared) -ceq 'untouched original log') 'Rejected competitors do not touch shared build logs'
} finally { Exit-CandidateBuildLock $growthLock }
$growthLock=Enter-CandidateBuildLock $growthRoot $growthPhase;Exit-CandidateBuildLock $growthLock
Assert-Growth $true 'Locks are released and a subsequent explicit build can acquire them'
$growthRedirectRoot=Join-Path $growthFixture 'redirect-root';New-Item -ItemType Directory -Path $growthRedirectRoot | Out-Null
$growthRedirect=Join-Path $growthRedirectRoot '.candidate-build.lock'
New-Item -ItemType Junction -Path $growthRedirect -Target $growthRoot | Out-Null
Reject-Growth { Enter-CandidateBuildLock $growthRedirectRoot (Join-Path $growthFixture 'redirect-phase') } 'Redirected candidate build lock'
Remove-GrowthJunction $growthRedirect $growthFixture
$growthArtifactPhase=Join-Path $growthFixture 'artifact-phase'
Assert-Growth ((Get-CandidateArtifactCapacity $growthArtifactPhase).logicalBytes -eq 0) 'Missing artifact tree is zero without creating a directory'
Assert-Growth (-not (Test-Path -LiteralPath $growthArtifactPhase)) 'Artifact preflight is read-only'
$growthArtifacts=Join-Path $growthArtifactPhase 'artifacts';$growthRun=Join-Path $growthArtifacts 'candidate-runs\unknown-run'
New-Item -ItemType Directory -Path (Join-Path $growthRun 'not-recursed') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $growthArtifacts 'root.HAP'),'123456')
[IO.File]::WriteAllText((Join-Path $growthRun 'unknown.hap'),'abcdef')
[IO.File]::WriteAllText((Join-Path $growthRun 'not-recursed\deep.hap'),'not charged outside the specified direct scope')
[IO.File]::WriteAllText((Join-Path $growthArtifacts 'ignored.txt'),'not a HAP')
$growthBudget=Get-CandidateArtifactCapacity $growthArtifactPhase 12
Assert-Growth ($growthBudget.logicalBytes -eq 12 -and $growthBudget.hapPaths -eq 2) 'Root plus direct unknown-run HAPs are combined and exactly the limit is allowed'
Reject-Growth { Get-CandidateArtifactCapacity $growthArtifactPhase 11 } 'artifact budget exceeded'
New-Item -ItemType HardLink -Path (Join-Path $growthArtifacts 'version-alias.hap') -Target (Join-Path $growthRun 'unknown.hap') | Out-Null
Assert-Growth ((Get-CandidateArtifactCapacity $growthArtifactPhase).logicalBytes -eq 18) 'Hardlink names conservatively count separately'
foreach ($growthLink in @((Join-Path $growthArtifacts 'root-link'),(Join-Path $growthArtifacts 'candidate-runs\linked-run'),(Join-Path $growthRun 'linked-child'))) {
  New-Item -ItemType Junction -Path $growthLink -Target $growthRoot | Out-Null
  Reject-Growth { Get-CandidateArtifactCapacity $growthArtifactPhase } 'Redirected candidate artifact'
  Remove-GrowthJunction $growthLink $growthFixture
}
$growthOwned=New-CandidateScratchDirectory $growthFixture 'owned-success'
New-Item -ItemType Directory -Path (Join-Path $growthOwned 'nested') | Out-Null
[IO.File]::WriteAllText((Join-Path $growthOwned 'nested\worker.tmp'),'temporary worker bytes')
$growthAdjacent=Join-Path $growthFixture 'adjacent.txt';[IO.File]::WriteAllText($growthAdjacent,'must remain')
$growthReport=Complete-CandidateScratch $growthOwned $growthFixture (Growth-Log 'owned-success')
Assert-Growth ($growthReport.cleaned -and -not (Test-Path -LiteralPath $growthOwned) -and $growthReport.removedFiles -eq 1) 'Only the factory-owned scratch is removed after completion'
Assert-Growth ([IO.File]::ReadAllText($growthAdjacent) -ceq 'must remain') 'Adjacent workspace files survive owned cleanup'
Assert-Growth ((Get-Item -LiteralPath (Growth-Log 'owned-success')).Length -lt 4096) 'Only a small summary remains in the run log directory'
$growthUnknown=Join-Path (Join-Path $growthFixture '_scratch') ('unknown-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $growthUnknown | Out-Null
[IO.File]::WriteAllText((Join-Path $growthUnknown 'important.txt'),'preserved')
$growthReport=Complete-CandidateScratch $growthUnknown $growthFixture (Growth-Log 'unowned')
Assert-Growth (-not $growthReport.cleaned -and (Test-Path -LiteralPath (Join-Path $growthUnknown 'important.txt'))) 'Unknown scratch is retained even with a valid-looking name'
$growthOwned=New-CandidateScratchDirectory $growthFixture 'changed-owner'
$growthMarker=Join-Path $growthOwned '.candidate-scratch-owner.json';$growthMarkerOriginal=[IO.File]::ReadAllText($growthMarker)
[IO.File]::WriteAllText($growthMarker,'{}')
$growthReport=Complete-CandidateScratch $growthOwned $growthFixture (Growth-Log 'changed-owner')
Assert-Growth (-not $growthReport.cleaned -and (Test-Path -LiteralPath $growthOwned)) 'Changed owner marker refuses cleanup'
[IO.File]::WriteAllText($growthMarker,$growthMarkerOriginal,(New-Object Text.UTF8Encoding($false)))
$growthOwned=New-CandidateScratchDirectory $growthFixture 'redirected-child'
[IO.File]::WriteAllText((Join-Path $growthOwned 'must-stay.txt'),'untouched before full tree validation')
$growthLink=Join-Path $growthOwned 'junction';New-Item -ItemType Junction -Path $growthLink -Target $growthRoot | Out-Null
$growthReport=Complete-CandidateScratch $growthOwned $growthFixture (Growth-Log 'redirected-child')
Assert-Growth (-not $growthReport.cleaned -and (Test-Path -LiteralPath (Join-Path $growthOwned 'must-stay.txt'))) 'Any reparse rejects the entire cleanup before deleting a file'
Remove-GrowthJunction $growthLink $growthFixture
$growthOwned=New-CandidateScratchDirectory $growthFixture 'busy-child'
$growthBusy=Join-Path $growthOwned 'busy.tmp';[IO.File]::WriteAllText($growthBusy,'in use')
$growthBusyHandle=[IO.File]::Open($growthBusy,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try { $growthReport=Complete-CandidateScratch $growthOwned $growthFixture (Growth-Log 'busy-child');Assert-Growth (-not $growthReport.cleaned -and (Test-Path -LiteralPath $growthBusy)) 'In-use scratch files are retained and failure is logged' }
finally { $growthBusyHandle.Dispose() }
$growthReport=Complete-CandidateScratch $growthOwned $growthFixture (Growth-Log 'busy-child-retry')
Assert-Growth $growthReport.cleaned 'An explicit later retry cleans the same still-owned scratch'
$growthOwned=New-CandidateScratchDirectory $growthFixture 'internal-log'
[IO.File]::WriteAllText((Join-Path $growthOwned 'must-stay.tmp'),'keep this on refusal')
$growthInternalLog=Join-Path $growthOwned 'cleanup.json'
$growthReport=Complete-CandidateScratch $growthOwned $growthFixture $growthInternalLog
Assert-Growth (-not $growthReport.cleaned -and (Test-Path -LiteralPath (Join-Path $growthOwned 'must-stay.tmp')) -and -not (Test-Path -LiteralPath $growthInternalLog)) 'An internal cleanup log refuses removal and is never written into that scratch'
foreach ($growthEntry in @('sign-candidate.ps1','finalize-candidate-signature.ps1')) {
  $growthTokens=$null;$growthErrors=$null
  $growthAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $growthEntry),[ref]$growthTokens,[ref]$growthErrors)
  Assert-Growth ($growthErrors.Count -eq 0) ('Entry syntax: '+$growthEntry)
  $growthProtected=@($growthAst.FindAll({param($node) $node -is [Management.Automation.Language.TryStatementAst] -and $node.Finally -and $node.Body.Extent.Text -match 'Get-CandidateSigningInput' -and $node.Finally.Extent.Text -match 'Exit-CandidateBuildLock'},$true))
  Assert-Growth ($growthProtected.Count -eq 1 -and $growthAst.Extent.Text.IndexOf('Enter-CandidateBuildLock') -lt $growthAst.Extent.Text.IndexOf('Get-CandidateSigningInput')) ('Whole signing/finalization entry shares the project/workspace lock: '+$growthEntry)
}
# The outer fixture is also factory-owned. All deliberate junctions are already
# removed; this test retains small logs only, with no fixture/archive copies.
$growthReport=Complete-CandidateScratch $growthFixture $growthPolicy.workspaceRoot (Growth-Log 'test-fixture')
Assert-Growth $growthReport.cleaned 'The completed guard fixture is cleaned without recursive shell deletion'
Write-Output ($growthChecks.ToString()+' workspace-growth checks passed; only small logs retained in '+$growthLogs)
