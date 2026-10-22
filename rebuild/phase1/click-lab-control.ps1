param([Parameter(Mandatory=$true)][ValidatePattern('^(p12-|p22-|lab-)[a-z0-9-]+$')][string]$Id)
$ErrorActionPreference='Stop'
$taskHdc='D:\APP\DevEcoStudio\sdk\default\openharmony\toolchains\hdc.exe'
& (Join-Path $PSScriptRoot 'capture-lab-state.ps1') -Label control-observed | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not observe isolated app'}
$taskTree=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'device-private/control-observed.json') | ConvertFrom-Json
function Find-LabNode($Node){
  if($Node.attributes.id -eq $Id){$Node.attributes}
  foreach($taskChild in $Node.children){Find-LabNode $taskChild}
}
$taskMatches=@(Find-LabNode $taskTree)
if($taskMatches.Count -ne 1 -or $taskMatches[0].enabled -ne 'true'){throw 'Expected one enabled isolated lab control'}
$taskBounds=$taskMatches[0].bounds
if($taskBounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$'){throw 'Invalid observed bounds'}
$taskX=[int](([int]$Matches[1]+[int]$Matches[3])/2)
$taskY=[int](([int]$Matches[2]+[int]$Matches[4])/2)
& $taskHdc shell uitest uiInput click $taskX $taskY
if($LASTEXITCODE -ne 0){throw 'Lab control click failed'}
[pscustomobject]@{id=$Id;bounds=$taskBounds;source='fresh app-only layout'}|ConvertTo-Json -Compress
