param(
  [string]$DeviceId='6HQ0226407055391',
  [string]$Hdc='D:\APP\DevEcoStudio\sdk\default\openharmony\toolchains\hdc.exe',
  [string]$CredentialFile=(Join-Path $PSScriptRoot '..\..\rebuild\phase1\device-private\device-unlock.json')
)
$ErrorActionPreference='Stop'
if ($DeviceId -notmatch '^[A-Za-z0-9_-]{1,128}$') { throw 'DEVICE_ID_INVALID' }
& $Hdc -t $DeviceId shell power-shell wakeup | Out-Null
function Wait-TaskEntry([int]$Checks) {
  for($taskCheck=0;$taskCheck -lt $Checks;$taskCheck++) {
    $taskLaunch=(& $Hdc -t $DeviceId shell aa start -b org.turboio.harmony.research -a EntryAbility) -join "`n"
    if($taskLaunch -match 'start ability successfully') { return $true }
    if($taskLaunch -notmatch '10106102|device screen is locked') { throw 'PHONE_STATE_UNKNOWN_NO_INPUT_SENT' }
    # Waking/unlocking is asynchronous. Retry observation, never PIN input.
    Start-Sleep -Milliseconds 500
  }
  return $false
}
if(Wait-TaskEntry 4) { Write-Output 'Phone already unlocked; iO foregrounded.'; return }
# An immediate aa failure can lag a successful wake. Require current system
# lock evidence too, rather than typing into an underlying application.
$taskLock=(& $Hdc -t $DeviceId shell hidumper -s ScreenlockService -a -all) -join "`n"
if($taskLock -notmatch 'screenLocked\s+true') { throw 'PHONE_LOCK_STATE_UNCONFIRMED_NO_INPUT_SENT' }
# Only the system's explicit locked response permits input. Never type into an
# arbitrary foreground application. The user-provided PIN stays in an ignored
# local file; no plaintext PIN is passed to a process, output or error message.
$taskCredential=$null
try {
  $taskFile=Get-Item -LiteralPath $CredentialFile
  if ($taskFile.Attributes -band [IO.FileAttributes]::ReparsePoint -or $taskFile.Length -gt 4096) { throw 'PRIVATE_CONFIG_INVALID' }
  try { $taskCredential=[IO.File]::ReadAllText($taskFile.FullName) | ConvertFrom-Json } catch { throw 'PRIVATE_CONFIG_INVALID' }
  if ($taskCredential.schema -ne 1 -or $taskCredential.device_id -ne $DeviceId -or
      $taskCredential.unlock_pin -isnot [string] -or $taskCredential.unlock_pin -notmatch '^[0-9]{4,12}$') { throw 'PRIVATE_CONFIG_INVALID' }
  & $Hdc -t $DeviceId shell uitest uiInput swipe 620 1600 620 400 2000 | Out-Null
  Start-Sleep -Milliseconds 500
  if(Wait-TaskEntry 2) { Write-Output 'Phone unlocked after wake; no PIN input needed.'; return }
  # Keyboard events did not unlock this phone. Read the secure keypad's actual
  # originalText labels and clickable bounds; never guess digit coordinates.
  # Refresh wake before observation: the lock UI overrides timeout to 10s.
  & $Hdc -t $DeviceId shell power-shell wakeup | Out-Null
  $taskDump=(& $Hdc -t $DeviceId shell uitest dumpLayout) -join "`n"
  if($taskDump -notmatch 'DumpLayout saved to:(/data/local/tmp/layout_[0-9]+\.json)') { throw 'PHONE_KEYPAD_LAYOUT_UNAVAILABLE_NO_INPUT_SENT' }
  $taskRemoteLayout=$Matches[1]
  $taskLocalLayout=Join-Path $taskFile.DirectoryName ('unlock-live-'+[guid]::NewGuid().ToString('N')+'.json')
  & $Hdc -t $DeviceId file recv $taskRemoteLayout $taskLocalLayout | Out-Null
  if($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $taskLocalLayout)) { throw 'PHONE_KEYPAD_LAYOUT_UNAVAILABLE_NO_INPUT_SENT' }
  $taskLayout=Get-Content -LiteralPath $taskLocalLayout -Raw | ConvertFrom-Json
  $taskKeypadRoots=[Collections.Generic.List[object]]::new()
  function Find-SystemKeypad($taskNode,[string]$taskBundle) {
    if($taskNode.attributes.bundleName) { $taskBundle=$taskNode.attributes.bundleName }
    if($taskNode.attributes.id -eq 'Digital_PSD_Input_Tip' -and $taskBundle -eq 'com.ohos.sceneboard') { $taskKeypadRoots.Add($taskNode) }
    foreach($taskChild in $taskNode.children) { Find-SystemKeypad $taskChild $taskBundle }
  }
  Find-SystemKeypad $taskLayout ''
  if($taskKeypadRoots.Count -ne 1) { throw 'PHONE_SYSTEM_KEYPAD_UNCONFIRMED_NO_INPUT_SENT' }
  $taskDigitKeys=@{}
  $taskEmptyKeypad=$false
  function Read-SystemKeys($taskNode,$taskClickable) {
    if($taskNode.attributes.clickable -eq 'true') { $taskClickable=$taskNode }
    $taskLabel=[string]$taskNode.attributes.originalText
    if($taskNode.attributes.type -eq 'Text' -and $taskClickable) {
      if($taskLabel -eq '返回') { $script:taskEmptyKeypad=$true }
      if($taskLabel -match '^[0-9]$') {
        if($taskDigitKeys.ContainsKey($taskLabel)) { throw 'PHONE_KEYPAD_AMBIGUOUS_NO_INPUT_SENT' }
        $taskBounds=[string]$taskClickable.attributes.bounds
        if($taskBounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$') { throw 'PHONE_KEYPAD_BOUNDS_INVALID_NO_INPUT_SENT' }
        $taskX1=[int]$Matches[1];$taskY1=[int]$Matches[2];$taskX2=[int]$Matches[3];$taskY2=[int]$Matches[4]
        if($taskX2 -le $taskX1 -or $taskY2 -le $taskY1) { throw 'PHONE_KEYPAD_BOUNDS_INVALID_NO_INPUT_SENT' }
        $taskDigitKeys[$taskLabel]=@([int](($taskX1+$taskX2)/2),[int](($taskY1+$taskY2)/2))
      }
    }
    foreach($taskChild in $taskNode.children) { Read-SystemKeys $taskChild $taskClickable }
  }
  Read-SystemKeys $taskKeypadRoots[0] $null
  if($taskDigitKeys.Count -ne 10 -or -not $taskEmptyKeypad) { throw 'PHONE_EMPTY_KEYPAD_UNCONFIRMED_NO_INPUT_SENT' }
  $taskLock=(& $Hdc -t $DeviceId shell hidumper -s ScreenlockService -a -all) -join "`n"
  if($taskLock -notmatch 'screenLocked\s+true' -or $taskLock -notmatch 'screenState\s+true') { throw 'PHONE_LOCK_CHANGED_NO_INPUT_SENT' }
  # This observed phone uses six dots and auto-submits. Do not type additional
  # characters into the app if a different length lock is configured later.
  if($taskCredential.unlock_pin.Length -ne 6) { throw 'PHONE_KEYPAD_PIN_LENGTH_UNSUPPORTED_NO_INPUT_SENT' }
  # uinput can return exit 0 with "parameter error". Use uitest's observed
  # click command and inspect its explicit result, never its exit code alone.
  foreach ($taskDigit in $taskCredential.unlock_pin.ToCharArray()) {
    $taskLock=(& $Hdc -t $DeviceId shell hidumper -s ScreenlockService -a -all) -join "`n"
    if($taskLock -notmatch 'screenLocked\s+true' -or $taskLock -notmatch 'screenState\s+true') { throw 'PHONE_LOCK_CHANGED_NO_FURTHER_INPUT_SENT' }
    $taskPoint=$taskDigitKeys[[string]$taskDigit]
    $taskInput=(& $Hdc -t $DeviceId shell uitest uiInput click $taskPoint[0] $taskPoint[1]) -join "`n"
    if($taskInput.Trim() -ne 'No Error') { throw 'PHONE_KEYPAD_CLICK_FAILED_NO_AUTOMATIC_RETRY' }
  }
  if(-not (Wait-TaskEntry 10)) { throw 'PHONE_UNLOCK_FAILED_NO_AUTOMATIC_RETRY' }
  Write-Output 'Phone unlocked through observed system keypad; iO foregrounded.'
} finally {
  $taskCredential=$null; $taskInput=$null; $taskDigit=$null; $taskPoint=$null; $taskDigitKeys=$null; $taskLayout=$null
  if($taskLocalLayout -and (Test-Path -LiteralPath $taskLocalLayout)) { Remove-Item -LiteralPath $taskLocalLayout }
}
