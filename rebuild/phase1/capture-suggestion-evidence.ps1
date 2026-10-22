param([Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9-]{1,40}$')][string]$Label,
  [string]$HdcPath='D:\APP\DevEcoStudio\sdk\default\openharmony\toolchains\hdc.exe')
$ErrorActionPreference='Stop'
$taskTargets=@(& $HdcPath list targets | Where-Object { $_ -and $_ -notmatch 'Empty' })
if ($taskTargets.Count -ne 1) { throw 'Expected exactly one connected test phone' }
$taskPrivate=Join-Path $PSScriptRoot 'device-private'
New-Item -ItemType Directory -Path $taskPrivate -Force | Out-Null
$taskRaw=Join-Path $taskPrivate ('suggestion-'+$Label+'.json')
& $HdcPath file recv /data/app/el2/100/base/org.turboio.harmony.research/haps/entry/files/suggestion-test.json $taskRaw | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Experiment journal transfer failed' }
$taskJournal=Get-Content -Raw -Encoding UTF8 -LiteralPath $taskRaw | ConvertFrom-Json
$taskEvents=@($taskJournal.events | ForEach-Object {
  $taskEvent=$_ | ConvertFrom-Json
  if ($taskEvent.uid -cmatch '^p10-[a-z0-9]+-[a-z0-9]+-[a-f0-9]{16}$' -and
      $taskEvent.event -cmatch '^[a-z0-9-]{1,40}$' -and
      $taskEvent.phase -cmatch '^[a-z_]{1,30}$' -and $taskEvent.cmd -in @(0,1,2)) {
    $taskEvent | Select-Object at,event,type,uid,cmd,phase
  }
})
$taskReport=[ordered]@{captured_at_utc=[DateTime]::UtcNow.ToString('o');kind='device_suggestion_journal';
  events=$taskEvents;cleanup_pending=[bool]$taskJournal.cleanupUid;
  raw_sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $taskRaw).Hash;
  raw_location='ignored device-private; peer address excluded from this report';
  limitations='Semantic commands only. Human observation required for display, crown, gesture and animation.'}
$taskOutput=Join-Path $PSScriptRoot ('device-suggestion-'+$Label+'.json')
$taskReport | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath $taskOutput
[pscustomobject]@{Evidence=$taskOutput;Events=$taskEvents.Count;CleanupPending=$taskReport.cleanup_pending} | ConvertTo-Json -Compress
