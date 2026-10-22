param([ValidateRange(5,40)][int]$DurationSec=30,
  [ValidatePattern('^[a-z0-9-]{1,40}$')][string]$ReportName='reply-capture-speaker')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'audio-endpoint.ps1')
$taskVoice=New-Object -ComObject SAPI.SpVoice
$taskToken=$null
$taskOutputs=$taskVoice.GetAudioOutputs()
for($taskI=0;$taskI -lt $taskOutputs.Count;$taskI++){
 if($taskOutputs.Item($taskI).GetDescription() -eq '扬声器 (Realtek(R) Audio)'){$taskToken=$taskOutputs.Item($taskI)}
}
if(!$taskToken){throw 'Expected physical Realtek speaker was not found'}
$taskEndpoint=$taskToken.Id.Split('\')[-1]
$taskOriginal=[AudioInspect]::Read([string[]]@($taskEndpoint))[0]
if($taskOriginal.muted){throw 'Physical speaker is muted; its mute setting was preserved'}
$taskStarted=0
try{
 [AudioInspect]::Set($taskEndpoint,.25)
 $taskVoice.AudioOutput=$taskToken
 $taskVoice.Voice=$taskVoice.GetVoices('Language=804').Item(0)
 $taskVoice.Rate=-1;$taskVoice.Volume=65
 $taskStarted=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
 $taskText='用新价格，但运费沿用上次。测试编号七六零一。这是电脑播放的合成语音，不执行真实任务。'
 $taskVoice.Speak($taskText,1)|Out-Null
 while([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$taskStarted -lt $DurationSec*1000){
  if($taskVoice.WaitUntilDone(0)){$taskVoice.Speak($taskText,1)|Out-Null}
  Start-Sleep -Milliseconds 200
 }
}finally{
 $taskVoice.Speak('',3)|Out-Null
 [AudioInspect]::Set($taskEndpoint,$taskOriginal.volume)
 $taskRestored=[AudioInspect]::Read([string[]]@($taskEndpoint))[0]
 $taskReport=[ordered]@{kind='reply_capture_speaker_attempt';started=$taskStarted;finished=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();durationRequested=$DurationSec;originalVolume=$taskOriginal.volume;temporaryVolume=.25;restoredVolume=$taskRestored.volume;mutePreserved=($taskRestored.muted -eq $taskOriginal.muted);systemDefaultChanged=$false;syntheticScriptId='reply-7601';physicalAcousticReceiptVerified=$false}
 $taskReport|ConvertTo-Json|Set-Content -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot ('../../rebuild/phase1/'+$ReportName+'.json'))
 [Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskVoice)|Out-Null
 if([Math]::Abs($taskRestored.volume-$taskOriginal.volume) -gt .001){throw 'Physical speaker volume restoration did not match'}
 $taskReport|ConvertTo-Json -Compress
}
