$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'candidate-build-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-run-support.ps1')
$runChecks=0
function Assert-RunTest($Condition,[string]$Message) { if (-not $Condition) { throw $Message }; $script:runChecks++ }
function Assert-RunThrows($Action,[string]$Pattern) { $runCaught=$false;try { & $Action } catch { $runCaught=$_.Exception.Message -match $Pattern };Assert-RunTest $runCaught ('Expected rejection: '+$Pattern) }
$runWorkspace=Get-CandidateWorkspacePolicy $PSScriptRoot
$runFixture=New-CandidateScratchDirectory $runWorkspace.workspaceRoot 'candidate-run-test'
try {
$runA='20261014-235900001-11111111';$runB='20261014-235900002-22222222'
$runStageA=New-CandidateStage $runFixture $runA
[IO.File]::WriteAllText((Join-Path $runStageA 'old.ets'),'old')
Assert-RunThrows { New-CandidateStage $runFixture $runA } 'already exists'
Assert-RunThrows { Get-CandidateStagePath $runFixture '../escape' } 'Invalid candidate run'
$runStageB=New-CandidateStage $runFixture $runB
Assert-RunTest (@(Get-ChildItem -LiteralPath $runStageB -Force).Count -eq 0) 'A new run must not inherit old source'
Assert-RunTest ([IO.File]::ReadAllText((Join-Path $runStageA 'old.ets')) -ceq 'old') 'Old staging evidence must remain untouched'
# Keep the script ASCII, but exercise the real UTF-8 ledger path situation.
$runPhase=Join-Path $runFixture ('phase-'+[char]0x6D4B);$runSource=Join-Path $runFixture 'source'
foreach($runRoot in @($runSource,$runStageB)) {
  New-Item -ItemType Directory -Path (Join-Path $runRoot 'harmony-sdk\entry') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $runRoot 'core-probe') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $runRoot 'harmony-sdk\entry\Source.ets'),'export const sample = 1;')
  [IO.File]::WriteAllText((Join-Path $runRoot 'harmony-sdk\oh-package-lock.json5'),'{}')
  [IO.File]::WriteAllText((Join-Path $runRoot 'core-probe\Source.ts'),'export const core = 1;')
}
$runDir=Join-Path $runPhase ('candidate-runs\'+$runB)
$runOut=Join-Path $runPhase ('artifacts\candidate-runs\'+$runB)
$runHapStage=Join-Path $runStageB 'harmony-sdk\entry\build\default\outputs\default'
foreach($runDirPath in @($runDir,$runOut,$runHapStage)){New-Item -ItemType Directory -Path $runDirPath -Force | Out-Null}
$runUnsigned=Join-Path $runOut 'entry-default-unsigned.hap'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$runZip=[IO.Compression.ZipFile]::Open($runUnsigned,[IO.Compression.ZipArchiveMode]::Create)
try {$runWriter=New-Object IO.StreamWriter($runZip.CreateEntry('module.json').Open());try{$runWriter.Write('{"app":{"versionName":"0.1.68","versionCode":10068,"bundleName":"fixture"}}')}finally{$runWriter.Dispose()}}finally{$runZip.Dispose()}
$runStagedUnsigned=Join-Path $runHapStage 'entry-default-unsigned.hap'
Copy-Item -LiteralPath $runUnsigned -Destination $runStagedUnsigned
$runManifest=Join-Path $runDir 'source-hashes.json'
$runBaseline=@(Get-CandidateSourceSnapshot $runSource @('harmony-sdk','core-probe'))
Write-CandidateJson $runManifest $runBaseline
$runStatus=[ordered]@{runId=$runB;runDirectory=$runDir;stageDirectory=$runStageB;phase='complete';compileSucceeded=$true;dependencySucceeded=$true;compileExitCode=0;fallbackUsed=$false;sourceHashManifestSha256=(Get-FileHash -LiteralPath $runManifest).Hash;generatedStageLockDifferences=@();versionName='0.1.68';versionCode=10068;hap=@{path=$runUnsigned;stagePath=$runStagedUnsigned;bytes=(Get-Item -LiteralPath $runUnsigned).Length;sha256=(Get-FileHash -LiteralPath $runUnsigned).Hash;bundleName='fixture'}}
function Save-RunFixture { Write-CandidateJson (Join-Path $runDir 'status.json') $runStatus; Write-CandidateJson (Join-Path $runPhase 'candidate-run-status.json') $runStatus }
Save-RunFixture
$runInput=Get-CandidateSigningInput $runPhase $runFixture $runB $runSource
Assert-RunTest ($runInput.runId -ceq $runB -and $runInput.unsigned -ceq $runUnsigned) 'Signing must resolve the actual run artifact'
Assert-RunTest ((Get-CandidateSigningInput $runPhase $runFixture '' $runSource).runId -ceq $runB) 'Latest ledger must resolve through the immutable per-run ledger'
$runStatus.stageDirectory=$runStageA;Save-RunFixture
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource } 'run/stage mismatch'
$runStatus.stageDirectory=$runStageB;$runStatus.phase='compile_failed';Save-RunFixture
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource } 'did not complete'
$runStatus.phase='complete';$runStatus.compileSucceeded='false';Save-RunFixture
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource } 'did not complete'
$runStatus.compileSucceeded=$true;Save-RunFixture
[IO.File]::AppendAllText($runManifest,' ')
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource } 'manifest digest'
Write-CandidateJson $runManifest $runBaseline
[IO.File]::WriteAllText((Join-Path $runStageB 'core-probe\Unexpected.ts'),'unrecorded')
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource } 'source path set mismatch'
# Exact single fixture files only; no recursive cleanup or changes to host caches.
Remove-Item -LiteralPath (Join-Path $runStageB 'core-probe\Unexpected.ts')
$runOriginalSource=[IO.File]::ReadAllBytes((Join-Path $runSource 'core-probe\Source.ts'))
[IO.File]::AppendAllText((Join-Path $runSource 'core-probe\Source.ts'),'changed')
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource } 'Source changed'
[IO.File]::WriteAllBytes((Join-Path $runSource 'core-probe\Source.ts'),$runOriginalSource)
[IO.File]::WriteAllText((Join-Path $runStageB 'harmony-sdk\oh-package-lock.json5'),'{"generated":1}')
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource } 'lock set changed'
$runStatus.generatedStageLockDifferences=@(Get-CandidateGeneratedLockDifferences $runStageB $runBaseline);Save-RunFixture
Assert-RunTest ((Get-CandidateSigningInput $runPhase $runFixture $runB $runSource).runId -ceq $runB) 'Recorded generated locks must pass'
[IO.File]::WriteAllText((Join-Path $runStageB 'harmony-sdk\oh-package-lock.json5'),'{"generated":2}')
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource } 'lock digest changed'
[IO.File]::WriteAllText((Join-Path $runStageB 'harmony-sdk\oh-package-lock.json5'),'{"generated":1}')
$runOriginalHap=[IO.File]::ReadAllBytes($runStagedUnsigned)
[IO.File]::AppendAllText($runStagedUnsigned,'changed')
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource } 'artifact digest mismatch'
[IO.File]::WriteAllBytes($runStagedUnsigned,$runOriginalHap)
$runStatus.versionCode=10069;Save-RunFixture
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource } 'embedded metadata mismatch'
$runStatus.versionCode=10068;$runStatus.hap.path=Join-Path $runOut 'another.hap';Save-RunFixture
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource } 'artifact path mismatch'
$runStatus.hap.path=$runUnsigned;$runStatus.fallbackUsed=$true;$runStatus.cachedDependencyEvidenceSha256='bad';Save-RunFixture
Write-CandidateJson (Join-Path $runDir 'cached-sherpa-evidence.json') @{sourceEntryManifestSha256='bad';stagedEntryManifestSha256='bad'}
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource } 'fallback evidence digest mismatch'
$runStatus.fallbackUsed=$false;Save-RunFixture
Assert-RunTest ((Get-CandidateSigningInput $runPhase $runFixture $runB $runSource).statusSha256 -eq (Get-FileHash -LiteralPath (Join-Path $runDir 'status.json')).Hash) 'Compile ledger digest must bind the signing input'
$runPayloadOriginal=Get-CandidateHapPayloadSnapshot $runUnsigned
$runRepacked=Join-Path $runOut 'repacked-fixture.hap'
$runZip=[IO.Compression.ZipFile]::Open($runRepacked,[IO.Compression.ZipArchiveMode]::Create)
try {$runEntry=$runZip.CreateEntry('module.json',[IO.Compression.CompressionLevel]::NoCompression);$runEntry.LastWriteTime=[DateTimeOffset]::new(2020,1,1,0,0,0,[TimeSpan]::Zero);$runWriter=New-Object IO.StreamWriter($runEntry.Open());try{$runWriter.Write('{"app":{"versionName":"0.1.68","versionCode":10068,"bundleName":"fixture"}}')}finally{$runWriter.Dispose()}}finally{$runZip.Dispose()}
Assert-RunTest ((Get-FileHash -LiteralPath $runRepacked).Hash -ne (Get-FileHash -LiteralPath $runUnsigned).Hash) 'Real ZIP repack must change the container digest'
Assert-RunTest ((Get-CandidateHapPayloadSnapshot $runRepacked).sha256 -ceq $runPayloadOriginal.sha256) 'Identical decompressed entries must match despite ZIP packaging'
[IO.File]::Copy($runRepacked,$runStagedUnsigned,$true)
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource } 'artifact digest mismatch'
$runRepackedInput=Get-CandidateSigningInput $runPhase $runFixture $runB $runSource -AllowRepackedStage
Assert-RunTest (-not $runRepackedInput.stagedUnsignedContainerMatched) 'Only post-sign verification can accept content-identical repacking'
$runZip=[IO.Compression.ZipFile]::Open($runStagedUnsigned,[IO.Compression.ZipArchiveMode]::Update)
try {$runWriter=New-Object IO.StreamWriter($runZip.CreateEntry('unrecorded.txt').Open());try{$runWriter.Write('unexpected code')}finally{$runWriter.Dispose()}}finally{$runZip.Dispose()}
Assert-RunThrows { Get-CandidateSigningInput $runPhase $runFixture $runB $runSource -AllowRepackedStage } 'repacked unsigned payload mismatch'
[IO.File]::WriteAllBytes($runStagedUnsigned,$runOriginalHap)
Assert-RunThrows { [IO.File]::Copy($runUnsigned,$runRepacked,$false) } 'already exists|exists'
Assert-RunTest ((Get-CandidateHapPayloadSnapshot $runUnsigned).sha256 -ceq $runPayloadOriginal.sha256) 'The frozen archive remains untouched after all refusal cases'
$runPolicySigned=Join-Path $runOut 'synthetic-policy-signed.hap'
[IO.File]::Copy($runUnsigned,$runPolicySigned,$false)
$runZip=[IO.Compression.ZipFile]::Open($runPolicySigned,[IO.Compression.ZipArchiveMode]::Update)
try {$runWriter=New-Object IO.StreamWriter($runZip.CreateEntry('.pages.info').Open());try{$runWriter.Write('synthetic bitmap')}finally{$runWriter.Dispose()}}finally{$runZip.Dispose()}
# Pure archive-policy fixture only. Real SDK positive/unsigned-negative tests are
# separate; this object is not evidence that the fixture is actually signed.
$runPolicyProof=@{verified=$false;hapSha256=(Get-FileHash -LiteralPath $runPolicySigned).Hash}
Assert-RunThrows { Assert-CandidateSignedPayload $runUnsigned $runPolicySigned $runPolicyProof } 'native signature verification missing'
$runPolicyProof.verified=$true
$runPolicyResult=Assert-CandidateSignedPayload $runUnsigned $runPolicySigned $runPolicyProof
Assert-RunTest ($runPolicyResult.productEntries -eq 1 -and $runPolicyResult.generatedSigningEntry.path -ceq '.pages.info') 'Verified signing metadata does not remove the original product entry comparison'
$runPolicyProof.hapSha256='wrong'
Assert-RunThrows { Assert-CandidateSignedPayload $runUnsigned $runPolicySigned $runPolicyProof } 'unbound'
$runPolicyProof.hapSha256=(Get-FileHash -LiteralPath $runPolicySigned).Hash
$runZip=[IO.Compression.ZipFile]::Open($runPolicySigned,[IO.Compression.ZipArchiveMode]::Update)
try {$runWriter=New-Object IO.StreamWriter($runZip.CreateEntry('unexpected.ets').Open());try{$runWriter.Write('code')}finally{$runWriter.Dispose()}}finally{$runZip.Dispose()}
$runPolicyProof.hapSha256=(Get-FileHash -LiteralPath $runPolicySigned).Hash
Assert-RunThrows { Assert-CandidateSignedPayload $runUnsigned $runPolicySigned $runPolicyProof } 'unexpected additional entry'
$runZip=[IO.Compression.ZipFile]::Open($runPolicySigned,[IO.Compression.ZipArchiveMode]::Update)
try {$runZip.GetEntry('unexpected.ets').Delete();$runZip.GetEntry('module.json').Delete();$runWriter=New-Object IO.StreamWriter($runZip.CreateEntry('module.json').Open());try{$runWriter.Write('changed product metadata')}finally{$runWriter.Dispose()}}finally{$runZip.Dispose()}
$runPolicyProof.hapSha256=(Get-FileHash -LiteralPath $runPolicySigned).Hash
Assert-RunThrows { Assert-CandidateSignedPayload $runUnsigned $runPolicySigned $runPolicyProof } 'product entry differs'
# No compiler or SDK is invoked: inspect the build entry point and exercise
# publication with a tiny real ZIP and an explicit native-verifier test double.
$runParseTokens=$null;$runParseErrors=$null
$runBuildAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'build-candidate.ps1'),[ref]$runParseTokens,[ref]$runParseErrors)
Assert-RunTest ($runParseErrors.Count -eq 0) 'Build entry point must remain valid PowerShell'
$runGenericCopies=@($runBuildAst.FindAll({param($node)
  $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Copy-Item' -and $node.Extent.Text -match '\$taskHap\.FullName'
},$true))
Assert-RunTest ($runGenericCopies.Count -eq 0) 'Build must not copy the unsigned HAP to an overwriteable generic path'
$runFrozenCopies=@($runBuildAst.FindAll({param($node)
  $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Member.Value -eq 'Copy' -and
  $node.Extent.Text -match '\$taskHap\.FullName' -and $node.Extent.Text -match '\$taskRunOut' -and $node.Extent.Text -match '\$false\)'
},$true))
Assert-RunTest ($runFrozenCopies.Count -eq 1) 'Build must retain its separate non-overwrite frozen unsigned input'
$runSignedStage=Join-Path $runHapStage 'entry-default-signed.hap'
[IO.File]::Copy($runUnsigned,$runSignedStage,$false)
$runZip=[IO.Compression.ZipFile]::Open($runSignedStage,[IO.Compression.ZipArchiveMode]::Update)
try {$runWriter=New-Object IO.StreamWriter($runZip.CreateEntry('.pages.info').Open());try{$runWriter.Write('synthetic publication bitmap')}finally{$runWriter.Dispose()}}finally{$runZip.Dispose()}
$runGenericSigned=Join-Path $runPhase 'artifacts\entry-default-signed.hap'
[IO.File]::WriteAllText($runGenericSigned,'existing generic marker must remain untouched')
$runGenericHash=(Get-FileHash -LiteralPath $runGenericSigned).Hash
$runFrozenHash=(Get-FileHash -LiteralPath $runUnsigned).Hash
$runCompileStatusHash=(Get-FileHash -LiteralPath (Join-Path $runDir 'status.json')).Hash
Write-CandidateJson (Join-Path $runDir 'sign-status.json') @{runId=$runB;stageDirectory=$runStageB;compileStatusSha256=$runCompileStatusHash;phase='signing';startedUtc=[DateTime]::UtcNow.AddSeconds(-1).ToString('o')}
$runNativeVerifier=(Get-Item Function:\Test-CandidateNativeSignature).ScriptBlock
function Test-CandidateNativeSignature([string]$Path,[string]$DevEcoHome,[string]$StageRoot) {
  if ($Path -cne $runSignedStage -or $StageRoot -cne $runStageB -or $DevEcoHome -cne 'synthetic-no-sdk') { throw 'Publication test double scope mismatch' }
  return [pscustomobject]@{verified=$true;exitCode=0;hapSha256=(Get-FileHash -LiteralPath $Path).Hash;toolSha256='synthetic-test-double';logSha256='synthetic-test-double'}
}
try {
  $runPublished=Complete-CandidateSignedBuild $runPhase $runFixture $runB $runSource 'synthetic-no-sdk'
  $runPublishedHash=(Get-FileHash -LiteralPath $runSignedStage).Hash
  Assert-RunTest ($runPublished.Verified -and $runPublished.Candidate -ceq (Join-Path $runOut 'entry-default-signed.hap') -and
    (Get-FileHash -LiteralPath $runPublished.Candidate).Hash -ceq $runPublishedHash) 'Publication must preserve the verified per-run signed canonical package'
  Assert-RunTest ((Get-FileHash -LiteralPath $runGenericSigned).Hash -ceq $runGenericHash) 'Publication must not overwrite an existing generic signed HAP'
  $runPublishedLedger=Get-Content -LiteralPath (Join-Path $runDir 'sign-finalization-status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-RunTest ($runPublishedLedger.phase -ceq 'complete' -and $runPublishedLedger.verified -and
    $runPublishedLedger.hap.path -ceq $runPublished.Candidate -and $runPublishedLedger.hap.sha256 -ceq $runPublishedHash) 'Signed publication ledger must still bind the canonical path and exact hash'
  Assert-RunTest ((Get-FileHash -LiteralPath $runUnsigned).Hash -ceq $runFrozenHash -and
    (Get-FileHash -LiteralPath (Join-Path $runDir 'status.json')).Hash -ceq $runCompileStatusHash) 'Publishing must preserve the frozen unsigned input and immutable compile ledger'
  Assert-RunThrows { Complete-CandidateSignedBuild $runPhase $runFixture $runB $runSource 'synthetic-no-sdk' } 'already exists'
  Assert-RunTest ((Get-FileHash -LiteralPath $runPublished.Candidate).Hash -ceq $runPublishedHash) 'Repeated publication must not overwrite the signed canonical package'
} finally { Set-Item Function:\Test-CandidateNativeSignature -Value $runNativeVerifier }
} finally {
$runTestLogDir=Join-Path (Join-Path $PSScriptRoot 'candidate-runs') 'guard-tests'
Assert-CandidateDirectoryChain $runTestLogDir
New-Item -ItemType Directory -Path $runTestLogDir -Force | Out-Null
$runTestCleanup=Complete-CandidateScratch $runFixture $runWorkspace.workspaceRoot (Join-Path $runTestLogDir ('run-ps'+$PSVersionTable.PSVersion.Major+'.json'))
Assert-RunTest $runTestCleanup.cleaned 'Completed run guard fixtures leave only small logs'
}
Write-Output ($runChecks.ToString()+' candidate-run checks passed; only small run logs retained')
