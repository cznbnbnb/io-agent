param([Parameter(Mandatory=$true)][string]$RunId,[string]$DevEcoHome='D:\APP\DevEcoStudio',[string]$BuildWorkspaceRoot='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'candidate-build-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-run-support.ps1')
$nativeWorkspace=Get-CandidateWorkspacePolicy $PSScriptRoot $BuildWorkspaceRoot
$nativeInput=Get-CandidateSigningInput $PSScriptRoot $nativeWorkspace.workspaceRoot $RunId (Split-Path $PSScriptRoot -Parent) -AllowRepackedStage
$nativeProcessTemp=$null
$nativeScratch=''
try {
$nativeScratch=New-CandidateScratchDirectory $nativeWorkspace.workspaceRoot ('native-signature-'+$RunId)
$nativeProcessTemp=Enter-CandidateProcessTemp $nativeScratch
$nativeSigned=Join-Path $nativeInput.stageDirectory 'harmony-sdk\entry\build\default\outputs\default\entry-default-signed.hap'
$nativeUnsigned=$nativeInput.status.hap.stagePath
$nativePositive=Test-CandidateNativeSignature $nativeSigned $DevEcoHome $nativeInput.stageDirectory
if (-not $nativePositive.verified) { throw 'Actual signed HAP native verification failed' }
$nativePolicy=Assert-CandidateSignedPayload $nativeInput.unsigned $nativeSigned $nativePositive
$nativeNegative=Test-CandidateNativeSignature $nativeUnsigned $DevEcoHome $nativeInput.stageDirectory
if ($nativeNegative.verified -or $nativeNegative.exitCode -eq 0) { throw 'Actual unsigned HAP was not rejected' }
[ordered]@{kind='actual_sdk_signature_positive_unsigned_negative';runId=$RunId;signedVerified=$true;unsignedRejected=$true;productEntries=$nativePolicy.productEntries;generatedSigningEntry=$nativePolicy.generatedSigningEntry;nativeToolSha256=$nativePositive.toolSha256;signedHapSha256=$nativePositive.hapSha256;positiveLogSha256=$nativePositive.logSha256;negativeLogSha256=$nativeNegative.logSha256;phoneOperated=$false} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $nativeInput.runDirectory 'native-signature-test.json') -Encoding UTF8
Write-Output ('Actual signed HAP verified; unsigned HAP rejected; unchanged product entries='+$nativePolicy.productEntries)
} finally {
  Restore-CandidateProcessTemp $nativeProcessTemp
  if ($nativeScratch) { Complete-CandidateScratch $nativeScratch $nativeWorkspace.workspaceRoot (Join-Path $nativeInput.runDirectory ('scratch-'+(Split-Path $nativeScratch -Leaf)+'.json')) | Out-Null }
}
