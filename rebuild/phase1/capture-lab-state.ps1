param([Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9-]{1,40}$')][string]$Label,
  [string]$HdcPath='D:\APP\DevEcoStudio\sdk\default\openharmony\toolchains\hdc.exe', [string]$PythonPath='python')
$ErrorActionPreference='Stop'
$taskTargets=@(& $HdcPath list targets | Where-Object { $_ -and $_ -notmatch 'Empty' })
if ($taskTargets.Count -ne 1) { throw 'Expected exactly one connected test phone' }
$taskPrivate=Join-Path $PSScriptRoot 'device-private'
New-Item -ItemType Directory -Path $taskPrivate -Force | Out-Null
$taskRemote='/data/local/tmp/turboio-phase1-lab-layout.json'
& $HdcPath shell uitest dumpLayout -b org.turboio.harmony.research -p $taskRemote | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'App-only layout dump failed' }
$taskRaw=Join-Path $taskPrivate ($Label+'.json')
& $HdcPath file recv $taskRemote $taskRaw | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'App-only layout transfer failed' }
$taskRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& $PythonPath (Join-Path $taskRoot 'tools\phase1\summarize-lab.py') $taskRaw (Join-Path $PSScriptRoot ('device-summary-'+$Label+'.json'))
if ($LASTEXITCODE -ne 0) { throw 'Metadata summary failed' }
