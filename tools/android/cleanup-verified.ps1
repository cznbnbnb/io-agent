$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../rebuild/android-app'))
$taskCandidate=Get-Content -LiteralPath (Join-Path $taskRoot 'candidate.json') -Raw|ConvertFrom-Json
$taskRollback=Get-Content -LiteralPath (Join-Path $taskRoot 'rollback-candidate.json') -Raw|ConvertFrom-Json
$taskOld=Get-Content -LiteralPath (Join-Path $taskRoot 'superseded-candidate.json') -Raw|ConvertFrom-Json
$taskEvidence=Get-Content -LiteralPath (Join-Path $taskRoot 'emulator-offline-ui-2026-10-19.json') -Raw|ConvertFrom-Json
if($taskCandidate.version -ne '0.2.0-dev2' -or $taskOld.version -ne '0.2.0-dev1' -or -not $taskRollback.installed -or $taskCandidate.sha256 -ne $taskEvidence.apk_sha256 -or -not $taskEvidence.checks.full_answer_result_ui_updated_without_refresh){throw 'Expected validated Android checkpoint not present'}
if(Test-Path -LiteralPath (Join-Path $taskRoot 'build/build.lock')){throw 'Build owns the current stage'}
$taskAdb=Join-Path $taskRoot '.tools/sdk/platform-tools/adb.exe'
$taskPackage=(& $taskAdb -s emulator-5582 shell pm path com.rayneo.venus.pub|Select-Object -First 1).Trim()
if($taskPackage -notmatch '^package:(/data/app/[^\s]+/base\.apk)$'){throw 'Unexpected emulator package path'}
$taskInstalledHash=(& $taskAdb -s emulator-5582 shell sha256sum $Matches[1]).Split(' ')[0]
if($taskInstalledHash -ne $taskCandidate.sha256){throw 'Emulator still runs a different APK'}
foreach($taskRetained in @($taskCandidate,$taskRollback)){
 $taskFile=[IO.Path]::GetFullPath((Join-Path $taskRoot $taskRetained.apk))
 if(-not $taskFile.StartsWith($taskRoot+'\artifacts\',[StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash.ToLower() -ne $taskRetained.sha256){throw 'Retained APK path/hash mismatch'}
}
$taskEmulators=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(qemu-system-|emulator\.exe$)'})
if(-not ($taskEmulators|Where-Object {$_.Name -match '^qemu-system-x86_64' -and $_.CommandLine -match 'io-agent-api36'}) -or ($taskEmulators|Where-Object {$_.CommandLine -match 'io-agent-api30'})){throw 'Android30 use/Android36 ownership is not established'}
$taskImage=[IO.Path]::GetFullPath((Join-Path $taskRoot '.tools/sdk/system-images/android-30/google_apis/x86_64'))
$taskAvd=[IO.Path]::GetFullPath((Join-Path $taskRoot '.tools/avd/io-agent-api30.avd'))
$taskIni=[IO.Path]::GetFullPath((Join-Path $taskRoot '.tools/avd/io-agent-api30.ini'))
$taskSuperseded=[IO.Path]::GetFullPath((Join-Path $taskRoot $taskOld.apk))
foreach($taskTarget in @($taskImage,$taskAvd,$taskIni,$taskSuperseded)){
 if(-not $taskTarget.StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Cleanup target escapes workspace'}
 if((Get-Item -LiteralPath $taskTarget -Force).LinkType){throw 'Cleanup target must not be a link'}
}
if((Get-Content -LiteralPath (Join-Path $taskImage 'source.properties') -Raw) -notmatch '(?m)^AndroidVersion\.ApiLevel\s*=\s*30\s*$' -or (Get-Content -LiteralPath (Join-Path $taskAvd 'config.ini') -Raw) -notmatch '(?m)^AvdId\s*=\s*io-agent-api30\s*$'){throw 'Failed-environment identity mismatch'}
if((Get-FileHash -LiteralPath $taskSuperseded -Algorithm SHA256).Hash.ToLower() -ne $taskOld.sha256){throw 'Superseded APK hash mismatch'}
$taskBefore=(Get-PSDrive D).Free
$taskRecord=[ordered]@{schema=1;at=[DateTime]::UtcNow.ToString('o');phone_operations=$false;installed_emulator_apk_sha256=$taskInstalledHash;current=$taskCandidate.apk;rollback=$taskRollback.apk;rollback_is_last_phone_install=$true;superseded_apk_sha256=$taskOld.sha256;removed=@();source_stage='build/host-107';state='verified_before_cleanup'}
$taskRecordPath=Join-Path $taskRoot 'retention-2026-10-19.json'
$taskRecord|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $taskRecordPath -Encoding utf8
# All absolute targets above have been checked inside this project and are idle.
Remove-Item -LiteralPath $taskImage -Recurse -Force
Remove-Item -LiteralPath $taskAvd -Recurse -Force
Remove-Item -LiteralPath $taskIni -Force
Remove-Item -LiteralPath $taskSuperseded -Force
$taskRecord.removed=@('.tools/sdk/system-images/android-30/google_apis/x86_64','.tools/avd/io-agent-api30.avd','.tools/avd/io-agent-api30.ini',$taskOld.apk)
$taskRecord.state='complete'
$taskRecord.free_bytes_increase=(Get-PSDrive D).Free-$taskBefore
$taskRecord.retained_signed_product_apks=@(Get-ChildItem -LiteralPath (Join-Path $taskRoot 'artifacts') -Filter '*.apk' -File|Select-Object -ExpandProperty Name)
if($taskRecord.retained_signed_product_apks.Count -ne 2){throw 'Expected exactly current + phone rollback APKs'}
$taskRecord|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $taskRecordPath -Encoding utf8
Write-Output ('Verified cleanup complete; free disk bytes increased by '+$taskRecord.free_bytes_increase)
