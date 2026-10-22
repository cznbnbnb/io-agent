# Run-specific staging and signing provenance. ASCII-only for PowerShell 5.1.
. (Join-Path $PSScriptRoot 'candidate-workspace-support.ps1')
function Assert-CandidateDirectoryChain([string]$Path) {
  $candidateDirectory=[IO.Path]::GetFullPath($Path)
  while ($candidateDirectory) {
    if (Test-Path -LiteralPath $candidateDirectory) {
      $candidateItem=Get-Item -LiteralPath $candidateDirectory -Force
      if (-not $candidateItem.PSIsContainer -or ($candidateItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Redirected candidate directory refused' }
    }
    $candidateParent=[IO.Path]::GetDirectoryName($candidateDirectory.TrimEnd('\','/'))
    if ($candidateParent -eq $candidateDirectory) { break }
    $candidateDirectory=$candidateParent
  }
}

function Get-CandidateStagePath([string]$TempRoot, [string]$RunId) {
  if ($RunId -cnotmatch '^[0-9]{8}-[0-9]{9}-[0-9a-f]{8}$') { throw 'Invalid candidate run ID' }
  if (-not [IO.Path]::IsPathRooted($TempRoot)) { throw 'Absolute candidate temporary root required' }
  $candidateTemp=[IO.Path]::GetFullPath($TempRoot)
  if ($candidateTemp -match '[^\x00-\x7F]') { throw 'ASCII candidate temporary root required' }
  Assert-CandidateDirectoryChain $candidateTemp
  $candidateStage=Join-Path (Join-Path $candidateTemp 'TurboIO-phase1-01a125f7-runs') $RunId
  Assert-CandidateDirectoryChain $candidateStage
  return $candidateStage
}

function New-CandidateStage([string]$TempRoot, [string]$RunId) {
  $candidateStage=Get-CandidateStagePath $TempRoot $RunId
  if (Test-Path -LiteralPath $candidateStage) { throw 'Candidate stage already exists; no source is deleted or repaired' }
  $candidateParent=Split-Path $candidateStage -Parent
  if (-not (Test-Path -LiteralPath $candidateParent)) { New-Item -ItemType Directory -Path $candidateParent -ErrorAction Stop | Out-Null }
  Assert-CandidateDirectoryChain $candidateParent
  $candidateCreateLockPath=Join-Path $candidateParent '.candidate-stage-create.lock'
  if (Test-Path -LiteralPath $candidateCreateLockPath) {
    $candidateCreateLockItem=Get-Item -LiteralPath $candidateCreateLockPath -Force
    if ($candidateCreateLockItem.PSIsContainer -or ($candidateCreateLockItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Redirected candidate stage creation lock refused' }
  }
  # Serialize the final count + mkdir. A preflight alone can race another build.
  $candidateCreateLock=[IO.File]::Open($candidateCreateLockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try {
    Get-CandidateStageCapacity $TempRoot | Out-Null
    New-Item -ItemType Directory -Path $candidateStage -ErrorAction Stop | Out-Null
    if (@(Get-ChildItem -LiteralPath $candidateStage -Force).Count -ne 0) { throw 'New candidate stage is not empty' }
  } finally { $candidateCreateLock.Dispose() }
  return $candidateStage
}

function Get-CandidateSigningInput([string]$PhaseRoot, [string]$TempRoot, [string]$RunId, [string]$SourceRoot, [switch]$AllowRepackedStage) {
  if (-not $RunId) {
    $candidateLatest=Get-Content -LiteralPath (Join-Path $PhaseRoot 'candidate-run-status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $RunId=$candidateLatest.runId
  }
  if ($RunId -cnotmatch '^[0-9]{8}-[0-9]{9}-[0-9a-f]{8}$') { throw 'Invalid candidate run ID' }
  $candidateRunDir=Join-Path (Join-Path $PhaseRoot 'candidate-runs') $RunId
  Assert-CandidateDirectoryChain $candidateRunDir
  $candidateStatusPath=Join-Path $candidateRunDir 'status.json'
  if ((Get-Item -LiteralPath $candidateStatusPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected candidate ledger refused' }
  $candidateStatus=Get-Content -LiteralPath $candidateStatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($candidateStatus.runId -cne $RunId -or $candidateStatus.runDirectory -ine $candidateRunDir) { throw 'Candidate ledger run/stage mismatch; legacy fixed stages require a fresh build' }
  $candidateExpectedStage=Resolve-CandidateRecordedStage $candidateStatus $RunId $TempRoot
  if ($candidateStatus.phase -cne 'complete' -or $candidateStatus.compileSucceeded -isnot [bool] -or $candidateStatus.compileSucceeded -ne $true -or $candidateStatus.dependencySucceeded -isnot [bool] -or $candidateStatus.dependencySucceeded -ne $true -or $candidateStatus.compileExitCode -ne 0 -or $candidateStatus.fallbackUsed -isnot [bool]) { throw 'Candidate compile did not complete successfully' }
  $candidateManifestPath=Join-Path $candidateRunDir 'source-hashes.json'
  if ((Get-Item -LiteralPath $candidateManifestPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected candidate manifest refused' }
  if ((Get-FileHash -LiteralPath $candidateManifestPath).Hash -ine $candidateStatus.sourceHashManifestSha256) { throw 'Candidate source manifest digest mismatch' }
  # PS 5.1 emits a parsed JSON array as one pipeline item; normalize only after
  # assignment, or the whole manifest becomes a nested array of one item.
  $candidateParsedBaseline=Get-Content -LiteralPath $candidateManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $candidateBaseline=@($candidateParsedBaseline)
  $candidateOverride=$null
  if ($candidateStatus.fallbackUsed) {
    $candidateFallbackPath=Join-Path $candidateRunDir 'cached-sherpa-evidence.json'
    if ((Get-Item -LiteralPath $candidateFallbackPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected fallback ledger refused' }
    if ((Get-FileHash -LiteralPath $candidateFallbackPath).Hash -ine $candidateStatus.cachedDependencyEvidenceSha256) { throw 'Candidate fallback evidence digest mismatch' }
    $candidateFallback=Get-Content -LiteralPath $candidateFallbackPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $candidateEntry=@($candidateBaseline | Where-Object { $_.path -ceq 'harmony-sdk/entry/oh-package.json5' })
    if ($candidateEntry.Count -ne 1 -or $candidateFallback.sourceEntryManifestSha256 -ine $candidateEntry[0].sha256) { throw 'Candidate fallback source mismatch' }
    $candidateOverride=$candidateFallback.stagedEntryManifestSha256
  }
  Assert-CandidateSource $SourceRoot $candidateExpectedStage $candidateBaseline $candidateOverride
  $candidateLocks=@(Get-CandidateGeneratedLockDifferences $candidateExpectedStage $candidateBaseline)
  $candidateRecordedLocks=@($candidateStatus.generatedStageLockDifferences)
  if ($candidateLocks.Count -ne $candidateRecordedLocks.Count) { throw 'Candidate generated lock set changed after compile' }
  foreach ($candidateLock in $candidateLocks) {
    $candidateRecorded=@($candidateRecordedLocks | Where-Object { $_.path -ceq $candidateLock.path })
    if ($candidateRecorded.Count -ne 1 -or $candidateRecorded[0].originalSha256 -ine $candidateLock.originalSha256 -or $candidateRecorded[0].generatedStageSha256 -ine $candidateLock.generatedStageSha256) { throw 'Candidate generated lock digest changed after compile' }
  }
  $candidateUnsigned=Join-Path (Join-Path (Join-Path $PhaseRoot 'artifacts\candidate-runs') $RunId) 'entry-default-unsigned.hap'
  $candidateStagedUnsigned=Join-Path $candidateExpectedStage 'harmony-sdk\entry\build\default\outputs\default\entry-default-unsigned.hap'
  if ($candidateStatus.hap.path -ine $candidateUnsigned -or $candidateStatus.hap.stagePath -ine $candidateStagedUnsigned) { throw 'Candidate unsigned artifact path mismatch' }
  $candidateContainerMatched=$true;$candidatePayload=$null;$candidateRepackProof=$null
  foreach ($candidateHapPath in @($candidateUnsigned,$candidateStagedUnsigned)) {
    Assert-CandidateDirectoryChain (Split-Path $candidateHapPath -Parent)
    $candidateHap=Get-Item -LiteralPath $candidateHapPath
    if ($candidateHap.PSIsContainer -or ($candidateHap.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Redirected candidate unsigned artifact refused' }
    if ($candidateHap.Length -ne $candidateStatus.hap.bytes -or (Get-FileHash -LiteralPath $candidateHapPath).Hash -ine $candidateStatus.hap.sha256) {
      if (-not $AllowRepackedStage -or $candidateHapPath -ine $candidateStagedUnsigned) { throw 'Candidate unsigned artifact digest mismatch' }
      $candidatePayload=Get-CandidateHapPayloadSnapshot $candidateUnsigned
      $candidateRepacked=Get-CandidateHapPayloadSnapshot $candidateStagedUnsigned
      if ($candidatePayload.bytes -ne $candidateRepacked.bytes -or $candidatePayload.entryCount -ne $candidateRepacked.entryCount) { throw 'Candidate repacked unsigned payload mismatch' }
      try { $candidateRepackProof=Compare-CandidateProductEntries $candidatePayload $candidateRepacked $candidateUnsigned $candidateStagedUnsigned }
      catch { throw ('Candidate repacked unsigned payload mismatch: '+$_.Exception.Message) }
      $candidateContainerMatched=$false
    }
    $candidateApp=Get-CandidateHapApp $candidateHapPath
    if ($candidateApp.versionCode -ne $candidateStatus.versionCode -or $candidateApp.versionName -cne $candidateStatus.versionName -or $candidateApp.bundleName -cne $candidateStatus.hap.bundleName) { throw 'Candidate unsigned embedded metadata mismatch' }
  }
  return [pscustomobject]@{ runId=$RunId; runDirectory=$candidateRunDir; stageDirectory=$candidateExpectedStage; manifest=$candidateBaseline; stagedManifestOverride=$candidateOverride; status=$candidateStatus; unsigned=$candidateUnsigned; stagedUnsignedContainerMatched=$candidateContainerMatched; unsignedPayload=$candidatePayload; repackedPayloadProof=$candidateRepackProof; statusSha256=(Get-FileHash -LiteralPath $candidateStatusPath).Hash }
}

function Test-CandidateNativeSignature([string]$Path, [string]$DevEcoHome, [string]$StageRoot) {
  Assert-CandidateDirectoryChain $StageRoot
  $signatureCheckDir=Join-Path $StageRoot ('_private-signature-checks\'+[Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $signatureCheckDir -ErrorAction Stop | Out-Null
  $signatureJar=Join-Path $DevEcoHome 'sdk\default\openharmony\toolchains\lib\hap-sign-tool.jar'
  $signatureLog=Join-Path $signatureCheckDir 'verify.log'
  $signatureBefore=(Get-FileHash -LiteralPath $Path).Hash
  $ErrorActionPreference='Continue'
  & (Join-Path $DevEcoHome 'jbr\bin\java.exe') -jar $signatureJar verify-app -inFile $Path -outCertChain (Join-Path $signatureCheckDir 'certificate.cer') -outProfile (Join-Path $signatureCheckDir 'profile.p7b') -inForm zip *> $signatureLog
  $signatureExit=$LASTEXITCODE
  $ErrorActionPreference='Stop'
  $signatureAfter=(Get-FileHash -LiteralPath $Path).Hash
  $signatureText=Get-Content -LiteralPath $signatureLog -Raw
  $signatureVerified=$signatureExit -eq 0 -and $signatureText -match 'Digest verify result: true' -and $signatureText -match 'verify-app success' -and (Test-Path -LiteralPath (Join-Path $signatureCheckDir 'certificate.cer')) -and (Test-Path -LiteralPath (Join-Path $signatureCheckDir 'profile.p7b')) -and $signatureBefore -ceq $signatureAfter
  return [pscustomobject]@{verified=[bool]$signatureVerified;exitCode=$signatureExit;hapSha256=$signatureAfter;toolSha256=(Get-FileHash -LiteralPath $signatureJar).Hash;logSha256=(Get-FileHash -LiteralPath $signatureLog).Hash}
}

function Assert-CandidateSignedPayload($Frozen, $Signed, $Verification) {
  if ($Verification.verified -isnot [bool] -or $Verification.verified -ne $true -or $Verification.hapSha256 -ine (Get-FileHash -LiteralPath $Signed).Hash) { throw 'Signed HAP native signature verification missing or unbound' }
  $payloadFrozen=Get-CandidateHapPayloadSnapshot $Frozen
  $payloadSigned=Get-CandidateHapPayloadSnapshot $Signed
  $payloadComparison=Compare-CandidateProductEntries $payloadFrozen $payloadSigned $Frozen $Signed -AllowNativeSigningPage
  # The SDK code signer generates this page-permission bitmap. It is accepted
  # only inside the exact HAP independently verified by the native SDK tool.
  # Code/resources remain byte-exact. A strictly equivalent debug-map object
  # order has a separate recorded proof; any other addition/change is refused.
  return [pscustomobject]@{frozenSha256=$payloadFrozen.sha256;signedSha256=$payloadSigned.sha256;productEntries=$payloadFrozen.entryCount;productBytes=$payloadFrozen.bytes;generatedSigningEntry=$payloadComparison.generatedSigningEntry;sourceMapOrderProofs=$payloadComparison.sourceMapOrderProofs}
}

function Complete-CandidateSignedBuild([string]$PhaseRoot, [string]$TempRoot, [string]$RunId, [string]$SourceRoot, [string]$DevEcoHome) {
  $finalInput=Get-CandidateSigningInput $PhaseRoot $TempRoot $RunId $SourceRoot -AllowRepackedStage
  $finalOriginalSignPath=Join-Path $finalInput.runDirectory 'sign-status.json'
  $finalOriginalSign=Get-Content -LiteralPath $finalOriginalSignPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($finalOriginalSign.runId -cne $RunId -or $finalOriginalSign.stageDirectory -ine $finalInput.stageDirectory -or $finalOriginalSign.compileStatusSha256 -ine $finalInput.statusSha256 -or $finalOriginalSign.phase -cnotin @('signing','sign_failed')) { throw 'Signed-build finalization ledger mismatch' }
  $finalSigned=Join-Path $finalInput.stageDirectory 'harmony-sdk\entry\build\default\outputs\default\entry-default-signed.hap'
  $finalSignedItem=Get-Item -LiteralPath $finalSigned
  if ($finalSignedItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected final signed HAP refused' }
  Assert-CandidateHapFresh $finalSignedItem $finalOriginalSign.startedUtc
  $finalOutput=Join-Path (Split-Path $finalInput.unsigned -Parent) 'entry-default-signed.hap'
  if (Test-Path -LiteralPath $finalOutput) { throw 'Final signed artifact already exists; refusing overwrite' }
  $finalLedger=[ordered]@{runId=$RunId;phase='verifying';verified=$false;startedUtc=[DateTime]::UtcNow.ToString('o');originalSignStatusSha256=(Get-FileHash -LiteralPath $finalOriginalSignPath).Hash;compileStatusSha256=$finalInput.statusSha256;originalFailedSigningPreserved=($finalOriginalSign.phase -ceq 'sign_failed');phoneOperated=$false}
  $finalLedgerPath=Join-Path $finalInput.runDirectory 'sign-finalization-status.json'
  if (Test-Path -LiteralPath $finalLedgerPath) { throw 'Finalization evidence already exists; refusing overwrite' }
  try {
    Write-CandidateJson $finalLedgerPath $finalLedger
    $finalVerification=Test-CandidateNativeSignature $finalSigned $DevEcoHome $finalInput.stageDirectory
    $finalPayload=Assert-CandidateSignedPayload $finalInput.unsigned $finalSigned $finalVerification
    $finalAfter=Get-CandidateSigningInput $PhaseRoot $TempRoot $RunId $SourceRoot -AllowRepackedStage
    if ($finalAfter.statusSha256 -ine $finalInput.statusSha256 -or (Get-FileHash -LiteralPath $finalOriginalSignPath).Hash -ine $finalLedger.originalSignStatusSha256 -or (Get-FileHash -LiteralPath $finalSigned).Hash -ine $finalVerification.hapSha256) { throw 'Signed-build evidence changed during finalization' }
    [IO.File]::Copy($finalSigned,$finalOutput,$false)
    if ((Get-FileHash -LiteralPath $finalOutput).Hash -ine $finalVerification.hapSha256) { throw 'Published signed artifact digest mismatch' }
    $finalLedger.phase='complete';$finalLedger.verified=$true
    $finalLedger.sourceFiles=$finalInput.manifest.Count
    $finalLedger.unsignedContainerRepacked=(-not $finalAfter.stagedUnsignedContainerMatched)
    $finalLedger.repackedPayloadProof=$finalAfter.repackedPayloadProof
    $finalLedger.nativeSignature=$finalVerification;$finalLedger.payload=$finalPayload
    $finalLedger.hap=[ordered]@{path=$finalOutput;bytes=(Get-Item -LiteralPath $finalOutput).Length;sha256=$finalVerification.hapSha256;versionCode=$finalInput.status.versionCode;versionName=$finalInput.status.versionName;bundleName=$finalInput.status.hap.bundleName}
  } catch {
    $finalLedger.phase='verification_failed';$finalLedger.failure='Signed artifact finalization failed; no verified success declared'
    throw
  } finally {
    $finalLedger.finishedUtc=[DateTime]::UtcNow.ToString('o')
    Write-CandidateJson $finalLedgerPath $finalLedger
  }
  return [pscustomobject]@{RunId=$RunId;Candidate=$finalOutput;Bytes=$finalLedger.hap.bytes;SHA256=$finalLedger.hap.sha256;Verified=$true}
}
