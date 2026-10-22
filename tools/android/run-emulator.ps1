param([switch]$CheckOnly,[ValidateSet(30,36)][int]$Api=36)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../rebuild/android-app'))
$taskSdk=Join-Path $taskRoot '.tools/sdk'
$taskAvd=Join-Path $taskRoot '.tools/avd'
$taskHome=Join-Path $taskRoot '.private/android-user'
# The upstream Windows launcher splits paths containing spaces when spawning
# emulator-check. ASCII junctions avoid copying SDK/images to C:.
$taskAlias=Join-Path ([IO.Path]::GetTempPath()) 'io-agent-android-01a15382'
New-Item -ItemType Directory -Force $taskAlias,$taskAvd,$taskHome | Out-Null
foreach($taskLink in @(@('sdk',$taskSdk),@('avd',$taskAvd),@('home',$taskHome))){
 $taskPath=Join-Path $taskAlias $taskLink[0]
 if(Test-Path -LiteralPath $taskPath){
  $taskExisting=Get-Item -LiteralPath $taskPath -Force
  if($taskExisting.LinkType -ne 'Junction' -or [IO.Path]::GetFullPath(@($taskExisting.Target)[0]) -ne [IO.Path]::GetFullPath($taskLink[1])){throw 'Existing emulator alias is not ours'}
 }else{New-Item -ItemType Junction -Path $taskPath -Target $taskLink[1]|Out-Null}
}
$env:ANDROID_SDK_ROOT=Join-Path $taskAlias 'sdk'
$env:ANDROID_HOME=$env:ANDROID_SDK_ROOT
$env:ANDROID_AVD_HOME=Join-Path $taskAlias 'avd'
$env:ANDROID_USER_HOME=Join-Path $taskAlias 'home'
$env:ANDROID_EMULATOR_HOME=Join-Path $taskAlias 'home'
$taskExe=Join-Path $env:ANDROID_SDK_ROOT 'emulator/emulator.exe'
if($CheckOnly){& $taskExe -accel-check;exit $LASTEXITCODE}
$taskName='io-agent-api'+$Api
$taskPort=if($Api -eq 30){5580}else{5582}
$taskProfile=Join-Path $env:ANDROID_AVD_HOME ($taskName+'.avd')
New-Item -ItemType Directory -Force $taskProfile|Out-Null
$taskIni=Join-Path $env:ANDROID_AVD_HOME ($taskName+'.ini')
if(-not(Test-Path -LiteralPath $taskIni)){
 @("avd.ini.encoding=UTF-8","path=$taskProfile","target=android-$Api")|Set-Content -LiteralPath $taskIni -Encoding ascii
}
$taskConfig=Join-Path $taskProfile 'config.ini'
if(-not(Test-Path -LiteralPath $taskConfig)){
 @("AvdId=$taskName","avd.ini.displayname=iO Agent API $Api",'avd.ini.encoding=UTF-8','abi.type=x86_64','hw.cpu.arch=x86_64','hw.cpu.ncore=4','hw.ramSize=2048','hw.lcd.width=720','hw.lcd.height=1280','hw.lcd.density=320','hw.keyboard=yes','hw.gpu.enabled=yes','hw.gpu.mode=swiftshader','hw.audioInput=no','hw.audioOutput=no','hw.camera.back=none','hw.camera.front=none','disk.dataPartition.size=4G','showDeviceFrame=no',"image.sysdir.1=system-images/android-$Api/google_apis/x86_64/",'tag.id=google_apis','tag.display=Google APIs','PlayStore.enabled=false','fastboot.forceColdBoot=yes','fastboot.forceFastBoot=no')|Set-Content -LiteralPath $taskConfig -Encoding ascii
}
[pscustomobject]@{profile=$taskName;serial="emulator-$taskPort";api=$Api;phone_io=$false;sdk_alias=$env:ANDROID_SDK_ROOT;avd_alias=$env:ANDROID_AVD_HOME;headless=$true}|ConvertTo-Json|Set-Content -Encoding utf8 (Join-Path $taskRoot '.private/emulator-runtime.json')
& $taskExe -avd $taskName -port $taskPort -no-window -no-snapshot -no-audio -no-metrics -no-boot-anim -gpu swiftshader -accel on -writable-system
exit $LASTEXITCODE
