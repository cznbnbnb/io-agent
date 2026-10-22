param([string]$DevEcoHome = 'D:\APP\DevEcoStudio')
$ErrorActionPreference = 'Stop'
$taskSource = $PSScriptRoot
$taskStage = Join-Path $env:TEMP 'TurboIO-refactor-01a11'
# Hvigor rejects Unicode paths and canonicalizes junctions. Use a real ASCII staging directory.
if ($taskStage -match '[^\x00-\x7F]') { throw 'TEMP must be an ASCII path for the Harmony build toolchain' }
if (Test-Path -LiteralPath $taskStage) {
  $taskItem = Get-Item -LiteralPath $taskStage
  if ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a redirected staging directory' }
}
New-Item -ItemType Directory -Path $taskStage -Force | Out-Null
foreach ($taskModule in @('harmony-sdk', 'core-probe')) {
  & robocopy (Join-Path $taskSource $taskModule) (Join-Path $taskStage $taskModule) /E /XD build .hvigor .idea oh_modules node_modules .git /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'Unable to stage the project for compilation' }
}
$env:DEVECO_HOME = $DevEcoHome
$env:DEVECO_SDK_HOME = Join-Path $DevEcoHome 'sdk'
$env:JAVA_HOME = Join-Path $DevEcoHome 'jbr'
$env:PATH = (Join-Path $DevEcoHome 'tools\node') + ';' + (Join-Path $DevEcoHome 'tools\ohpm\bin') + ';' + $env:PATH
$taskLog = Join-Path $taskSource 'build-check.log'
Push-Location (Join-Path $taskStage 'harmony-sdk')
try {
  & (Join-Path $DevEcoHome 'tools\ohpm\bin\ohpm.bat') install
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
  # Native warnings use stderr; capture without treating them as a terminating error.
  $ErrorActionPreference = 'Continue'
  & (Join-Path $DevEcoHome 'tools\node\node.exe') (Join-Path $DevEcoHome 'tools\hvigor\bin\hvigorw.js') assembleHap --mode module -p 'module=entry@default' -p 'product=default' -p 'buildMode=debug' --no-daemon *> $taskLog
  $taskExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  Get-Content -LiteralPath $taskLog -Tail 55
  if ($taskExit -ne 0) { throw 'Harmony compilation failed; see build-check.log' }
  $taskOutput = Join-Path $taskSource 'artifacts'
  New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
  Get-ChildItem -LiteralPath '.\entry\build\default\outputs\default' -Filter '*unsigned.hap' | Copy-Item -Destination $taskOutput -Force
} finally { Pop-Location }
