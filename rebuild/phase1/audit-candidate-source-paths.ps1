param(
  [Parameter(Mandatory=$true)][string]$RunId,
  [string]$SourceRoot=(Split-Path $PSScriptRoot -Parent),
  [string]$StageRoot='',
  [string]$OutputPath,
  [string]$BuildWorkspaceRoot=''
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'candidate-build-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-run-support.ps1')
if ($RunId -cnotmatch '^\d{8}-\d{9}-[0-9a-f]{8}$') { throw 'Invalid candidate run ID' }
$taskRun=Join-Path (Join-Path $PSScriptRoot 'candidate-runs') $RunId
$taskManifest=Join-Path $taskRun 'source-hashes.json'
Assert-CandidateDirectoryChain $taskRun
foreach ($taskLedgerPath in @((Join-Path $taskRun 'status.json'),$taskManifest)) {
  $taskLedgerItem=Get-Item -LiteralPath $taskLedgerPath -Force
  if ($taskLedgerItem.PSIsContainer -or ($taskLedgerItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Redirected candidate audit ledger refused' }
}
$taskStatus=Get-Content -LiteralPath (Join-Path $taskRun 'status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskParsedBaseline=Get-Content -LiteralPath $taskManifest -Raw -Encoding UTF8 | ConvertFrom-Json
$taskBaseline=@($taskParsedBaseline)
$taskWorkspace=Get-CandidateWorkspacePolicy $PSScriptRoot $BuildWorkspaceRoot
if ($taskStatus.runDirectory -ine $taskRun) { throw 'Candidate audit run/stage mismatch' }
$taskExpectedStage=Resolve-CandidateRecordedStage $taskStatus $RunId $taskWorkspace.workspaceRoot
if ($StageRoot -and $StageRoot -ine $taskExpectedStage) { throw 'Candidate audit explicit stage must match the recorded run stage' }
$StageRoot=$taskExpectedStage
$taskManifestHash=(Get-FileHash -LiteralPath $taskManifest -Algorithm SHA256).Hash
if ($taskManifestHash -cne $taskStatus.sourceHashManifestSha256) { throw 'Original source baseline hash changed' }
if (-not $OutputPath) { $OutputPath=Join-Path $PSScriptRoot ('candidate-source-path-audit-'+$RunId+'.json') }
$taskEvidence=[ordered]@{
  kind='post_build_source_path_and_hash_audit'; verifiedUtc=[DateTime]::UtcNow.ToString('o'); runId=$RunId;
  originalStatusPreserved=$true; sourceRoot=$SourceRoot; stageRoot=$StageRoot;
  originalStatusSha256=(Get-FileHash -LiteralPath (Join-Path $taskRun 'status.json') -Algorithm SHA256).Hash;
  sourceHashManifestSha256=$taskManifestHash; baselineFiles=$taskBaseline.Count;
  directoryNameExclusions=@('build','.hvigor','.idea','oh_modules','node_modules','.git');
  exactNativeBuildOutputExclusion='harmony-sdk/entry/.cxx';
  passed=$false; readOnlyProductSourceAndStage=$true; rebuilt=$false; signed=$false; phoneOperated=$false;
  limits='Checks current post-build source and staging paths/hashes against the immutable original run baseline. It cannot retrospectively attest the path set at the exact compiler invocation, and it does not verify phone behavior. Native build outputs and baseline-recorded generated lock hashes are separate from product source.'
}
function Get-CandidatePathDigest($Files) {
  $taskPaths=[string[]]@($Files | ForEach-Object { $_.path })
  [Array]::Sort($taskPaths,[StringComparer]::Ordinal)
  $taskSha=[Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($taskSha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($taskPaths -join "`n")+"`n")))).Replace('-','').ToLowerInvariant() } finally { $taskSha.Dispose() }
}
try {
  $taskModules=@($taskBaseline | ForEach-Object { ($_.path -split '/')[0] } | Select-Object -Unique)
  $taskCheckoutFiles=@(Get-CandidateSourceFiles $SourceRoot $taskModules)
  $taskStageFiles=@(Get-CandidateSourceFiles $StageRoot $taskModules)
  Assert-CandidateSource $SourceRoot $StageRoot $taskBaseline $null
  $taskEvidence.checkoutFiles=$taskCheckoutFiles.Count
  $taskEvidence.stagedSourceFiles=$taskStageFiles.Count
  $taskEvidence.baselinePathSetSha256=Get-CandidatePathDigest $taskBaseline
  $taskEvidence.checkoutPathSetSha256=Get-CandidatePathDigest $taskCheckoutFiles
  $taskEvidence.stagePathSetSha256=Get-CandidatePathDigest $taskStageFiles
  $taskEvidence.checkoutExtraPaths=@(); $taskEvidence.checkoutMissingPaths=@()
  $taskEvidence.stageExtraSourcePaths=@(); $taskEvidence.stageMissingSourcePaths=@()
  $taskEvidence.checkoutHashesVerified=$true
  $taskEvidence.stagedNonLockHashesVerified=$true
  $taskEvidence.stagedNonLockFilesVerified=@($taskBaseline | Where-Object { $_.path -notmatch '(^|/)oh-package-lock\.json5$' }).Count
  $taskEvidence.generatedStageLockDifferences=@(Get-CandidateGeneratedLockDifferences $StageRoot $taskBaseline)
  $taskNativeOutput=Join-Path $StageRoot 'harmony-sdk\entry\.cxx'
  $taskEvidence.excludedNativeOutputFileCount=if (Test-Path -LiteralPath $taskNativeOutput) { @(Get-ChildItem -LiteralPath $taskNativeOutput -Recurse -File -Force).Count } else { 0 }
  $taskEvidence.helperSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'candidate-build-support.ps1') -Algorithm SHA256).Hash
  $taskEvidence.builderSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'build-candidate.ps1') -Algorithm SHA256).Hash
  $taskEvidence.passed=$true
} catch {
  $taskEvidence.failure=$_.Exception.Message
  Write-CandidateJson $OutputPath $taskEvidence
  throw
}
Write-CandidateJson $OutputPath $taskEvidence
Write-Output ('SOURCE_PATH_AND_HASH_AUDIT_PASS baseline='+$taskBaseline.Count+' stage='+$taskStageFiles.Count+' excluded-native-output='+$taskEvidence.excludedNativeOutputFileCount+' report='+$OutputPath)
