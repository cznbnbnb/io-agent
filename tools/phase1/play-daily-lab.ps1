param([ValidateRange(5,65)][int]$DurationSec=60,
  [ValidatePattern('^[a-z0-9-]{1,40}$')][string]$ReportName='daily-speaker-playback')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'audio-endpoint.ps1')
$taskVoice=New-Object -ComObject SAPI.SpVoice
$taskOutputs=$taskVoice.GetAudioOutputs()
$taskToken=$null
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
  $taskScript='这是雷鸟眼镜日常智记的隔离测试。测试编号是四一二九。电脑扬声器正在播放合成语音。手机一边保存眼镜音频，一边分窗转写。请保留原始声音和恢复进度。这段话仅用于验证，不添加待办，不发送消息，不执行任务。'
  $taskVoice.Speak($taskScript,1)|Out-Null
  while([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$taskStarted -lt $DurationSec*1000){
    if($taskVoice.WaitUntilDone(0)){$taskVoice.Speak($taskScript,1)|Out-Null}
    Start-Sleep -Milliseconds 200
  }
}finally{
  $taskVoice.Speak('',3)|Out-Null
  [AudioInspect]::Set($taskEndpoint,$taskOriginal.volume)
  $taskRestored=[AudioInspect]::Read([string[]]@($taskEndpoint))[0]
  $taskReport=[pscustomobject]@{kind='p22_environment_speaker_attempt';started=$taskStarted;finished=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();durationRequested=$DurationSec;originalVolume=$taskOriginal.volume;temporaryVolume=.25;restoredVolume=$taskRestored.volume;mutePreserved=($taskRestored.muted -eq $taskOriginal.muted);systemDefaultChanged=$false;syntheticScriptId='daily-4129';physicalAcousticReceiptVerified=$false}
  $taskReport|ConvertTo-Json|Set-Content -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot ('../../rebuild/phase1/'+$ReportName+'.json'))
  [Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskVoice)|Out-Null
  if([Math]::Abs($taskRestored.volume-$taskOriginal.volume) -gt .001){throw 'Physical speaker volume restoration did not match'}
  $taskReport|ConvertTo-Json -Compress
}
