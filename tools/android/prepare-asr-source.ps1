$ErrorActionPreference = 'Stop'
$asrRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../rebuild/android-app/.private/phone-r4-source-2026-10-21'))
$asrFile = Join-Path $asrRoot 'official-asr-synthetic-direct.wav'
if (-not (Test-Path -LiteralPath $asrRoot)) { throw 'Prepared private evidence directory required' }
if (Test-Path -LiteralPath $asrFile) { throw 'Existing source must be verified before reuse' }
Add-Type -AssemblyName System.Speech
$asrVoice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $asrChinese = @($asrVoice.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-CN' })
  if ($asrChinese.Count -eq 0) { throw 'Local Chinese voice unavailable' }
  $asrVoice.SelectVoice($asrChinese[0].VoiceInfo.Name)
  $asrVoice.Rate = 1
  $asrFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
  $asrVoice.SetOutputToWaveFile($asrFile,$asrFormat)
  $asrVoice.Speak('只做预览，不要修改文件。补充条件，保留全部资料，星期五再执行。')
  $asrVoice.SetOutputToNull()
} finally { $asrVoice.Dispose() }
'Local synthetic speech source generated; microphone and playback were not started.'
