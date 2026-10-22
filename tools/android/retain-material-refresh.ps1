param([switch]$DateDiscovery)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../rebuild/android-app'))
function Read-Record([string]$name){Get-Content -LiteralPath (Join-Path $taskRoot $name) -Raw|ConvertFrom-Json}
$taskCurrent=Read-Record 'candidate.json'
$taskRollback=Read-Record 'rollback-candidate.json'
$taskUi=Read-Record $(if($DateDiscovery){'phone-material-date-ui-2026-10-21.json'}else{'phone-material-refresh-ui-2026-10-21.json'})
$taskAudit=Read-Record $(if($DateDiscovery){'phone-formal-material-audit-dev6-2026-10-21.json'}else{'phone-formal-material-audit-dev5-2026-10-21.json'})
$taskServer=Read-Record $(if($DateDiscovery){'phone-formal-material-readback-dev6-2026-10-21.json'}else{'phone-formal-material-readback-dev5-2026-10-21.json'})
$taskExpectedCurrent=if($DateDiscovery){'0.5.2-dev6'}else{'0.5.2-dev5'}
$taskExpectedRollback=if($DateDiscovery){'0.5.2-dev5'}else{'0.5.2-dev2'}
if($taskCurrent.version -ne $taskExpectedCurrent -or -not $taskCurrent.installed -or $taskRollback.version -ne $taskExpectedRollback -or -not $taskRollback.installed -or -not $taskUi.passed -or -not $taskServer.passed -or $taskServer.stored_versions -ne 6 -or -not $taskAudit.cleanup.driver_absent){throw 'Current delivery evidence missing'}
if(Test-Path -LiteralPath (Join-Path $taskRoot 'build/build.lock')){throw 'Build active'}
$taskAdb=Join-Path $taskRoot '.tools/sdk/platform-tools/adb.exe'
$taskSerial=(Read-Record '.private/phone-login-install-2026-10-20/verified-target.json').serial
$taskPackage=(& $taskAdb -s $taskSerial shell pm path com.rayneo.venus.pub).Trim()
if($LASTEXITCODE -ne 0 -or $taskPackage -notmatch '^package:(/data/app/[A-Za-z0-9._~=/+-]+/base\.apk)$'){throw 'Installed package not verified'}
$taskInstalled=(& $taskAdb -s $taskSerial shell sha256sum $Matches[1]).Split(' ')[0]
if($LASTEXITCODE -ne 0 -or $taskInstalled -ne $taskCurrent.sha256){throw 'Installed hash mismatch'}
$taskDriver=(& $taskAdb -s $taskSerial shell pm path com.turboio.androidtests)
if($taskDriver -match '^package:'){throw 'Driver still installed'}
function Checked-File([string]$relative,[string]$hash){
 $file=[IO.Path]::GetFullPath((Join-Path $taskRoot $relative))
 if([IO.Path]::GetDirectoryName($file) -ne (Join-Path $taskRoot 'artifacts')){throw 'APK outside artifacts'}
 $item=Get-Item -LiteralPath $file -Force
 if($item.LinkType -and $item.LinkType -ne 'HardLink'){throw 'Unexpected APK link'}
 if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower() -ne $hash){throw 'APK hash mismatch'}
 [ordered]@{path=$relative;absolute=$file;sha256=$hash;bytes=$item.Length}
}
$taskKeep=@((Checked-File $taskCurrent.apk $taskCurrent.sha256),(Checked-File $taskRollback.apk $taskRollback.sha256))
$taskRemove=if($DateDiscovery){@((Checked-File 'artifacts/iO-Agent-Android-0.5.2-dev2.apk' '2d337a917a65834c7327e21cc8b62451efe8d5e7afcca95f10de4010cb3bb817'))}else{@((Checked-File 'artifacts/iO-Agent-Android-0.5.2-dev1.apk' '2f390a2f51443c2b9ccb7689e699bcfe0a3b9e34356ed4b51f07e7dcfac8185c'),(Checked-File 'artifacts/iO-Agent-Android-0.5.2-dev3.apk' '4856a45f24dc8af2fd237c1d06eff73498cfd194164599c532616ec80862db21'),(Checked-File 'artifacts/iO-Agent-Android-0.5.2-dev4.apk' '98abc881f270c1f4cd325b230baf163a9adea6007ba0c31ffa249d83c04b623d'))}
$taskRemove=@($taskRemove)
$taskKnown=@($taskKeep.absolute)+@($taskRemove.absolute)
foreach($item in Get-ChildItem -LiteralPath (Join-Path $taskRoot 'artifacts') -Filter '*.apk' -File){if($item.FullName -notin $taskKnown){throw 'Unknown APK'}}
$taskBuild=[IO.Path]::GetFullPath((Join-Path $taskRoot 'build'))
$taskGenerated=@()
foreach($name in @('classes','dex','addon.jar','javac.args','lifelog-source-tests','material-tests','emulator-input/classes','emulator-input/dex','emulator-input/voice-source','emulator-input/input.jar')){
 $target=[IO.Path]::GetFullPath((Join-Path $taskBuild $name))
 if(-not $target.StartsWith($taskBuild+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Generated path escaped build'}
 if(Test-Path -LiteralPath $target){
  $item=Get-Item -LiteralPath $target -Force
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Generated target is linked'}
  $items=@($item);if($item.PSIsContainer){$items+=@(Get-ChildItem -LiteralPath $target -Recurse -Force)}
  if($items|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}){throw 'Generated descendant is linked'}
  $bytes=($items|Where-Object {-not $_.PSIsContainer}|Measure-Object -Property Length -Sum).Sum
  $taskGenerated+=,[ordered]@{path=('build/'+$name);absolute=$target;bytes=$bytes}
 }
}
$taskRecord=[ordered]@{schema=1;at=[DateTime]::UtcNow.ToString('o');state='verified_before_cleanup';current=$taskKeep[0];rollback=$taskKeep[1];installed_sha256=$taskInstalled;removed_apks=$taskRemove;removed_generated=$taskGenerated;source_stage='build/host-107';user_materials_touched=$false;rollback_limit=$(if($DateDiscovery){'dev5 supports the same schema3 ledger; date discovery entry is unavailable after rollback'}else{'dev2 cannot read schema3; restore dev5 without uninstalling or clearing data'});evidence=$(if($DateDiscovery){'phone-formal-material-readback-dev6-2026-10-21.json'}else{'phone-formal-material-readback-dev5-2026-10-21.json'})}
$taskRecordPath=Join-Path $taskRoot $(if($DateDiscovery){'material-date-retention-2026-10-21.json'}else{'material-refresh-retention-2026-10-21.json'})
$taskRecord|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $taskRecordPath -Encoding utf8
foreach($item in $taskRemove){Remove-Item -LiteralPath $item.absolute -Force}
foreach($item in $taskGenerated){Remove-Item -LiteralPath $item.absolute -Recurse -Force}
$taskRecord.state='complete'
$taskRecord['removed_bytes']=0L
foreach($item in (@($taskRemove)+@($taskGenerated))){$taskRecord['removed_bytes']+=[long]$item.bytes}
if(@(Get-ChildItem -LiteralPath (Join-Path $taskRoot 'artifacts') -Filter '*.apk' -File).Count -ne 2){throw 'Expected two retained APKs'}
$taskRecord|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $taskRecordPath -Encoding utf8
Write-Output ('Retained '+$taskExpectedCurrent+' current + '+$taskExpectedRollback+' rollback; generated bytes removed: '+$taskRecord.removed_bytes)
