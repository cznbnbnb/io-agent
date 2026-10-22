param([Parameter(Mandatory=$true)][string]$RunId,[string]$DevEcoHome='D:\APP\DevEcoStudio',[string]$BuildWorkspaceRoot='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'candidate-build-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-run-support.ps1')
# This verifies an already-produced signed HAP; it never signs or installs.
$taskWorkspace=Get-CandidateWorkspacePolicy $PSScriptRoot $BuildWorkspaceRoot
$taskOperationLock=Enter-CandidateBuildLock $taskWorkspace.workspaceRoot $PSScriptRoot
try {
$taskFinalInput=Get-CandidateSigningInput $PSScriptRoot $taskWorkspace.workspaceRoot $RunId (Split-Path $PSScriptRoot -Parent) -AllowRepackedStage
$taskProcessTemp=$null
$taskScratch=''
try {
  $taskScratch=New-CandidateScratchDirectory $taskWorkspace.workspaceRoot ('finalize-'+$RunId)
  $taskProcessTemp=Enter-CandidateProcessTemp $taskScratch
  Complete-CandidateSignedBuild $PSScriptRoot $taskWorkspace.workspaceRoot $RunId (Split-Path $PSScriptRoot -Parent) $DevEcoHome | ConvertTo-Json -Compress
} finally {
  Restore-CandidateProcessTemp $taskProcessTemp
  if ($taskScratch) { Complete-CandidateScratch $taskScratch $taskWorkspace.workspaceRoot (Join-Path $taskFinalInput.runDirectory ('scratch-'+(Split-Path $taskScratch -Leaf)+'.json')) | Out-Null }
}
} finally { Exit-CandidateBuildLock $taskOperationLock }
