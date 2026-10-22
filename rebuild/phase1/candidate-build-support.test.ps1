$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'candidate-build-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-run-support.ps1')
Write-Output ('CANDIDATE_BUILD_TEST_HOST '+([ordered]@{ executable=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName; psVersion=$PSVersionTable.PSVersion.ToString(); psEdition=$PSVersionTable.PSEdition } | ConvertTo-Json -Compress))
$candidateChecks=0
function Assert-CandidateTest($Condition, $Message) {
  if (-not $Condition) { throw $Message }
  $script:candidateChecks++
}
function Assert-CandidateThrows($Action, $Message, [string]$ExpectedError='') {
  $candidateCaught=$false
  try { & $Action } catch { $candidateCaught=($ExpectedError -eq '' -or $_.Exception.Message -match $ExpectedError) }
  Assert-CandidateTest $candidateCaught $Message
}
$candidateWorkspace=Get-CandidateWorkspacePolicy $PSScriptRoot
$candidateFixture=New-CandidateScratchDirectory $candidateWorkspace.workspaceRoot 'candidate-build-test'
$candidateTimeout="ohpm INFO: MetaDataFetcher fetching meta info of package 'sherpa_onnx' from registry`nohpm WARN: ECONNABORTED timeout of 15000ms exceeded`nohpm ERROR: Run install command failed"
Assert-CandidateTest (Test-SherpaMetadataTimeout $candidateTimeout) 'Sherpa metadata timeout should be eligible'
Assert-CandidateTest (-not (Test-SherpaMetadataTimeout ($candidateTimeout.Replace('sherpa_onnx','other_package')))) 'Other package timeout must not fall back'
Assert-CandidateTest (-not (Test-SherpaMetadataTimeout 'hvigor timeout of 15000ms exceeded')) 'Compiler timeout must not fall back'
Assert-CandidateTest (-not (Test-SherpaMetadataTimeout ($candidateTimeout+"`nMetaDataFetcher fetching meta info of package 'other_package'"))) 'Ambiguous multiple metadata fetches must not fall back'
Assert-CandidateTest (-not (Test-SherpaMetadataTimeout ($candidateTimeout+"`nfetch meta info of package 'sherpa_onnx' success"))) 'A successful Sherpa fetch must not fall back'
$candidateTree=Join-Path $candidateFixture 'tree'
New-Item -ItemType Directory -Path $candidateTree | Out-Null
[IO.File]::WriteAllText((Join-Path $candidateTree 'z'), 'one')
[IO.File]::WriteAllText((Join-Path $candidateTree 'a'), 'two')
$candidateFirst=Get-CandidateTree $candidateTree
Assert-CandidateTest (($candidateFirst.fileCount -eq 2) -and ($candidateFirst.files[0].path -ceq 'a') -and ($candidateFirst.bytes -eq 6)) 'Tree order and size must be deterministic'
[IO.File]::WriteAllText((Join-Path $candidateTree 'z'), 'ONE')
Assert-CandidateTest ((Get-CandidateTree $candidateTree).sha256 -cne $candidateFirst.sha256) 'Same-size corruption must change the snapshot hash'
$candidateStage=Join-Path $candidateFixture 'stage'
$candidateCached=Join-Path $candidateStage 'harmony-sdk\oh_modules\.ohpm\sherpa_onnx@1.13.3\oh_modules\sherpa_onnx'
$candidateEntry=Join-Path $candidateStage 'harmony-sdk\entry\oh-package.json5'
New-Item -ItemType Directory -Path $candidateCached -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path $candidateEntry -Parent) -Force | Out-Null
Write-CandidateJson (Join-Path $candidateCached 'oh-package.json5') @{ name='sherpa_onnx'; version='1.13.4' }
Write-CandidateJson $candidateEntry @{ dependencies=@{ sherpa_onnx='1.13.3' } }
$candidateEntryHash=(Get-FileHash -LiteralPath $candidateEntry).Hash
Assert-CandidateThrows { Initialize-CandidateSherpaFallback $candidateStage 'test' $candidateFixture } 'Wrong cached version must be refused'
Write-CandidateJson (Join-Path $candidateCached 'oh-package.json5') @{ name='sherpa_onnx'; version='1.13.3' }
Assert-CandidateThrows { Initialize-CandidateSherpaFallback $candidateStage 'test' $candidateFixture } 'Unverified cached tree must be refused'
Assert-CandidateTest ((Get-FileHash -LiteralPath $candidateEntry).Hash -ceq $candidateEntryHash) 'Refused fallback must leave the staged manifest untouched'
$candidateSource=Join-Path $candidateFixture 'source'
New-Item -ItemType Directory -Path (Join-Path $candidateSource 'harmony-sdk\entry') -Force | Out-Null
Copy-Item -LiteralPath $candidateEntry -Destination (Join-Path $candidateSource 'harmony-sdk\entry\oh-package.json5')
$candidateBaseline=@([pscustomobject]@{ path='harmony-sdk/entry/oh-package.json5'; sha256=$candidateEntryHash })
Write-CandidateJson $candidateEntry @{ dependencies=@{ sherpa_onnx='file:./verified' } }
Assert-CandidateThrows { Assert-CandidateSource $candidateSource $candidateStage $candidateBaseline $null } 'Undocumented staged manifest change must fail'
Assert-CandidateSource $candidateSource $candidateStage $candidateBaseline (Get-FileHash -LiteralPath $candidateEntry).Hash
Assert-CandidateTest $true 'Only the documented staging override is allowed'
[IO.File]::AppendAllText((Join-Path $candidateSource 'harmony-sdk\entry\oh-package.json5'), ' ')
Assert-CandidateThrows { Assert-CandidateSource $candidateSource $candidateStage $candidateBaseline (Get-FileHash -LiteralPath $candidateEntry).Hash } 'Product source changes must fail even with a staging override'

# Reproduce the actual /E staging failure: a deleted .ets file remains in the
# reused destination, and a surviving importer can still compile against it.
$candidatePathSource=Join-Path $candidateFixture 'path-source'
$candidatePathStage=Join-Path $candidateFixture 'path-stage'
$candidatePathModule=Join-Path $candidatePathSource 'harmony-sdk\entry\src\main\ets'
New-Item -ItemType Directory -Path $candidatePathModule -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $candidatePathModule 'Importer.ets'), "import { deleted } from './Deleted';")
[IO.File]::WriteAllText((Join-Path $candidatePathModule 'Deleted.ets'), 'export const deleted = true;')
$candidatePathLock=Join-Path $candidatePathSource 'harmony-sdk\oh-package-lock.json5'
[IO.File]::WriteAllText($candidatePathLock, '{}')
New-Item -ItemType Directory -Path (Join-Path $candidatePathStage 'harmony-sdk') -Force | Out-Null
& robocopy (Join-Path $candidatePathSource 'harmony-sdk') (Join-Path $candidatePathStage 'harmony-sdk') /E /XJ /XD build .hvigor .idea oh_modules node_modules .git /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
Assert-CandidateTest ($LASTEXITCODE -lt 8) 'The first actual /E fixture staging must succeed'
Remove-Item -LiteralPath (Join-Path $candidatePathModule 'Deleted.ets')
& robocopy (Join-Path $candidatePathSource 'harmony-sdk') (Join-Path $candidatePathStage 'harmony-sdk') /E /XJ /XD build .hvigor .idea oh_modules node_modules .git /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
Assert-CandidateTest (($LASTEXITCODE -lt 8) -and (Test-Path -LiteralPath (Join-Path $candidatePathStage 'harmony-sdk\entry\src\main\ets\Deleted.ets'))) 'Actual /E must reproduce the residual deleted source'
$candidatePathBaseline=@(Get-CandidateSourceSnapshot $candidatePathSource @('harmony-sdk'))
Assert-CandidateThrows { Assert-CandidateSource $candidatePathSource $candidatePathStage $candidatePathBaseline $null } 'Residual deleted product source must be refused before compiling' 'Staged source path set mismatch; extra=1 \[harmony-sdk/entry/src/main/ets/Deleted\.ets\]'
Remove-Item -LiteralPath (Join-Path $candidatePathStage 'harmony-sdk\entry\src\main\ets\Deleted.ets')
Assert-CandidateSource $candidatePathSource $candidatePathStage $candidatePathBaseline $null $false
Assert-CandidateTest $true 'Exact source and stage paths/hashes pass before dependency installation'
foreach ($candidateExcluded in @('build','.hvigor','.idea','oh_modules','node_modules','.git')) {
  $candidateIgnoredDir=Join-Path $candidatePathStage ('harmony-sdk\'+$candidateExcluded)
  New-Item -ItemType Directory -Path $candidateIgnoredDir -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $candidateIgnoredDir 'Ignored.ets'), 'existing build or dependency output')
}
Assert-CandidateSource $candidatePathSource $candidatePathStage $candidatePathBaseline $null $false
Assert-CandidateTest $true 'The existing six build/cache/dependency directory exclusions remain allowed'
$candidateNativeOutput=Join-Path $candidatePathStage 'harmony-sdk\entry\.cxx\default\debug'
New-Item -ItemType Directory -Path $candidateNativeOutput -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $candidateNativeOutput 'CMakeCache.txt'), 'known native build output')
Assert-CandidateSource $candidatePathSource $candidatePathStage $candidatePathBaseline $null $false
Assert-CandidateTest $true 'Only the exact known entry/.cxx native build output is excluded'
$candidateWrongNativeDir=Join-Path $candidatePathStage 'harmony-sdk\entry\src\.cxx'
New-Item -ItemType Directory -Path $candidateWrongNativeDir -Force | Out-Null
$candidateWrongNativeFile=Join-Path $candidateWrongNativeDir 'Stale.ets'
[IO.File]::WriteAllText($candidateWrongNativeFile, 'old product source')
Assert-CandidateThrows { Assert-CandidateSource $candidatePathSource $candidatePathStage $candidatePathBaseline $null } 'An arbitrary .cxx directory cannot hide stale product source' 'Staged source path set mismatch; extra=1'
Remove-Item -LiteralPath $candidateWrongNativeFile
$candidateExtraSource=Join-Path $candidatePathModule 'AddedDuringBuild.ets'
[IO.File]::WriteAllText($candidateExtraSource, 'export const added = true;')
Assert-CandidateThrows { Assert-CandidateSource $candidatePathSource $candidatePathStage $candidatePathBaseline $null } 'New checkout source absent from baseline must fail' 'Checkout source path set mismatch; extra=1'
Remove-Item -LiteralPath $candidateExtraSource
$candidateStagedImporter=Join-Path $candidatePathStage 'harmony-sdk\entry\src\main\ets\Importer.ets'
Remove-Item -LiteralPath $candidateStagedImporter
Assert-CandidateThrows { Assert-CandidateSource $candidatePathSource $candidatePathStage $candidatePathBaseline $null } 'Missing staged product source must fail' 'Staged source path set mismatch; extra=0.*missing=1'
Copy-Item -LiteralPath (Join-Path $candidatePathModule 'Importer.ets') -Destination $candidateStagedImporter
$candidateStagedLock=Join-Path $candidatePathStage 'harmony-sdk\oh-package-lock.json5'
[IO.File]::WriteAllText($candidateStagedLock, '{"generated":true}')
Assert-CandidateThrows { Assert-CandidateSource $candidatePathSource $candidatePathStage $candidatePathBaseline $null $false } 'Lock metadata cannot change before installation' 'Staged source changed'
Assert-CandidateSource $candidatePathSource $candidatePathStage $candidatePathBaseline $null
Assert-CandidateTest $true 'A recorded baseline stage lock may be regenerated after installation'
$candidateGeneratedLocks=@(Get-CandidateGeneratedLockDifferences $candidatePathStage $candidatePathBaseline)
Assert-CandidateTest ($candidateGeneratedLocks.Count -eq 1 -and $candidateGeneratedLocks[0].path -ceq 'harmony-sdk/oh-package-lock.json5' -and $candidateGeneratedLocks[0].generatedStageSha256 -ceq (Get-FileHash -LiteralPath $candidateStagedLock).Hash) 'A generated lock exception must record its exact path and actual hashes'
$candidateUnrecordedLock=Join-Path $candidatePathStage 'harmony-sdk\entry\oh-package-lock.json5'
[IO.File]::WriteAllText($candidateUnrecordedLock, '{}')
Assert-CandidateThrows { Assert-CandidateSource $candidatePathSource $candidatePathStage $candidatePathBaseline $null } 'A new unrecorded lock path cannot bypass path equality' 'Staged source path set mismatch; extra=1'
Remove-Item -LiteralPath $candidateUnrecordedLock
[IO.File]::WriteAllText($candidatePathLock, '{"changed":true}')
Assert-CandidateThrows { Assert-CandidateSource $candidatePathSource $candidatePathStage $candidatePathBaseline $null } 'Checkout locks are immutable even when generated stage locks are allowed' 'Source changed during candidate run'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$candidateZipPath=Join-Path $candidateFixture 'fixture.hap'
$candidateZip=[IO.Compression.ZipFile]::Open($candidateZipPath,[IO.Compression.ZipArchiveMode]::Create)
try {
  $candidateModule=$candidateZip.CreateEntry('module.json')
  $candidateWriter=New-Object IO.StreamWriter($candidateModule.Open())
  try { $candidateWriter.Write('{"app":{"versionName":"0.1.55","versionCode":10055,"bundleName":"fixture"}}') } finally { $candidateWriter.Dispose() }
} finally { $candidateZip.Dispose() }
$candidateHapApp=Get-CandidateHapApp $candidateZipPath
Assert-CandidateTest (($candidateHapApp.versionName -ceq '0.1.55') -and ($candidateHapApp.versionCode -eq 10055)) 'HAP evidence must read the actual embedded version'
$candidateEmptyZipPath=Join-Path $candidateFixture 'empty.hap'
$candidateEmptyZip=[IO.Compression.ZipFile]::Open($candidateEmptyZipPath,[IO.Compression.ZipArchiveMode]::Create)
$candidateEmptyZip.Dispose()
Assert-CandidateThrows { Get-CandidateHapApp $candidateEmptyZipPath } 'A HAP without embedded module metadata must fail closed'
$candidateFresh=[pscustomobject]@{ LastWriteTimeUtc=[DateTime]::SpecifyKind((New-Object DateTime(2026,10,13,14,56,11)),[DateTimeKind]::Utc) }
Assert-CandidateHapFresh $candidateFresh '2026-10-13T14:55:41.2632351Z'
Assert-CandidateTest $true 'ISO UTC and filesystem UTC must be compared in the same time zone'
Assert-CandidateHapFresh $candidateFresh '2026-10-13T22:55:41.2632351+08:00'
Assert-CandidateTest $true 'An explicit +08:00 timestamp must represent the same UTC start'
Assert-CandidateThrows { Assert-CandidateHapFresh $candidateFresh '2026-10-13T14:57:00.0000000Z' } 'A genuinely old HAP must still be refused'
$candidateRealCached=Join-Path $candidateWorkspace.legacyTempRoot 'TurboIO-phase1-01a125f7\harmony-sdk\oh_modules\.ohpm\sherpa_onnx@1.13.3\oh_modules\sherpa_onnx'
$candidateRealTree=Get-CandidateTree $candidateRealCached
Assert-CandidateTest ($candidateRealTree.sha256 -ceq 'edf140ba74b47e2c5e09b218aa53dd7a5b31c0a37b4801ae975ed05f9ca46006') 'The actual installed cache must match the pinned snapshot'
$candidateTestLogDir=Join-Path (Join-Path $PSScriptRoot 'candidate-runs') 'guard-tests'
Assert-CandidateDirectoryChain $candidateTestLogDir
New-Item -ItemType Directory -Path $candidateTestLogDir -Force | Out-Null
$candidateTestCleanup=Complete-CandidateScratch $candidateFixture $candidateWorkspace.workspaceRoot (Join-Path $candidateTestLogDir ('build-ps'+$PSVersionTable.PSVersion.Major+'.json'))
Assert-CandidateTest $candidateTestCleanup.cleaned 'Completed build guard fixtures leave only small logs'
Write-Output ($candidateChecks.ToString()+' candidate-build checks passed; only small run logs retained')
