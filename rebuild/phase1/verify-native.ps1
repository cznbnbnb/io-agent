param([string]$VsHome='D:\APP\VS',[string]$BuildWorkspaceRoot='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'candidate-run-support.ps1')
$taskWorkspace=Get-CandidateWorkspacePolicy $PSScriptRoot $BuildWorkspaceRoot
$taskCmake=Join-Path $VsHome 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$taskCtest=Join-Path (Split-Path $taskCmake) 'ctest.exe'
$taskBuild=Join-Path $taskWorkspace.workspaceRoot 'TurboIO-native-regression-01a125f7'
Assert-CandidateDirectoryChain $taskBuild
$taskRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$taskProcessTemp=$null
$taskScratch=''
$taskNativeRun=Join-Path (Join-Path $PSScriptRoot 'candidate-runs') ('native-regression-'+[Guid]::NewGuid().ToString('N'))
Assert-CandidateDirectoryChain $taskNativeRun
New-Item -ItemType Directory -Path $taskNativeRun -Force | Out-Null
try {
  $taskScratch=New-CandidateScratchDirectory $taskWorkspace.workspaceRoot 'native-regression'
  $taskProcessTemp=Enter-CandidateProcessTemp $taskScratch
& $taskCmake -S (Join-Path $taskRoot 'rebuild\harmony-sdk\tests\native') -B $taskBuild -G 'Visual Studio 17 2022' -A x64 "-DCMAKE_GENERATOR_INSTANCE=$VsHome" *> (Join-Path $PSScriptRoot 'native-configure.log')
if ($LASTEXITCODE -ne 0) {throw 'Native configure failed; see native-configure.log'}
& $taskCmake --build $taskBuild --config Debug --parallel 4 *> (Join-Path $PSScriptRoot 'native-build.log')
if ($LASTEXITCODE -ne 0) {throw 'Native build failed; see native-build.log'}
& $taskCtest --test-dir $taskBuild -C Debug --output-on-failure *> (Join-Path $PSScriptRoot 'native-tests.log')
if ($LASTEXITCODE -ne 0) {throw 'Native regression failed; see native-tests.log'}
Get-Content (Join-Path $PSScriptRoot 'native-tests.log')
} finally {
  Restore-CandidateProcessTemp $taskProcessTemp
  if ($taskScratch) { Complete-CandidateScratch $taskScratch $taskWorkspace.workspaceRoot (Join-Path $taskNativeRun 'scratch-native-regression.json') | Out-Null }
}
