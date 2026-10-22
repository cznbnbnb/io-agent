# Isolated live sync launcher. Bearer travels in a private file, never argv.
# A running application is refused: finish capture before a cold lab start.
param(
  [string]$Hdc = 'D:/APP/DevEcoStudio/sdk/default/openharmony/toolchains/hdc.exe',
  [string]$Credential = 'rebuild/material-server/private/phone-live.json',
  [string]$ServerId = '80384449-a5c6-4630-bf1b-524a30454c92',
  [string]$BaseUrl = 'https://cznbnb.cn/io-api/v1',
  [string]$Owner = 'turboio-user',
  [string]$Producer = 'phone-live',
  [string]$Bundle = 'org.turboio.harmony.research',
  [string]$Ability = 'PersistenceLabAbility',
  [ValidateSet('transport-live','coordinator-live','coordinator-resume','coordinator-offline','coordinator-online')][string]$Phase = 'transport-live',
  [string]$RunId = ''
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Credential)) { throw 'CREDENTIAL_FILE_MISSING' }
if ((Get-Item -LiteralPath $Credential).Length -gt 4096) { throw 'CREDENTIAL_INVALID' }
$credentialData = Get-Content -Raw -LiteralPath $Credential | ConvertFrom-Json
$token = $credentialData.token
if ($token.Length -ne 43 -or $token -notmatch '^[A-Za-z0-9_-]{43}$') { throw 'CREDENTIAL_INVALID' }
if ([DateTimeOffset]::Parse($credentialData.expires_at) -le [DateTimeOffset]::UtcNow) { throw 'CREDENTIAL_EXPIRED' }
if ($Bundle -notmatch '^[A-Za-z0-9_.]+$' -or $Ability -ne 'PersistenceLabAbility') { throw 'INVALID_LAB_ENTRY' }
if ($BaseUrl -ne 'https://cznbnb.cn/io-api/v1') { throw 'INVALID_LIVE_TARGET' }
foreach ($identity in @($Owner,$Producer,$ServerId)) {
  if ($identity -notmatch '^[A-Za-z0-9_.:-]{1,128}$') { throw 'INVALID_IDENTITY' }
}
if ((& $Hdc shell pidof $Bundle | Out-String).Trim()) { throw 'APPLICATION_ALREADY_ACTIVE' }
if ($LASTEXITCODE -ne 0) { throw 'DEVICE_QUERY_FAILED' }
if ($RunId -and ($Phase -notin @('coordinator-resume','coordinator-online') -or $RunId -notmatch '^[0-9]{13}$')) { throw 'INVALID_RESUME_RUN_ID' }
if ($Phase -in @('coordinator-resume','coordinator-online') -and -not $RunId) { throw 'RESUME_RUN_ID_REQUIRED' }
$run = if($RunId){$RunId}else{[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()}
$privateDir = Join-Path $PWD 'rebuild/phase1/device-private'
New-Item -ItemType Directory -Force -Path $privateDir | Out-Null
[IO.File]::WriteAllText((Join-Path $privateDir 'live-sync-run.txt'), $run)
[IO.File]::WriteAllText((Join-Path $privateDir 'live-sync-credential.txt'), (Split-Path -Leaf $Credential))
$deviceDir = 'data/storage/el2/base/haps/entry/files/p31-material-outbox-lab'
# Keep native tool staging paths ASCII on PowerShell 5.1; verify device bytes.
$stageDir = Join-Path ([IO.Path]::GetTempPath()) ('turboio-live-sync-' + [Guid]::NewGuid().ToString('N'))
if ($stageDir -match '[^\x00-\x7F]') { throw 'HDC_STAGING_PATH_UNSUPPORTED' }
New-Item -ItemType Directory -Path $stageDir | Out-Null
$target = Join-Path $stageDir 'sync-target.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$activated = $false
$started = $false
try {
  $config = @{schema=1;base_url=$BaseUrl;token=$token;owner_id=$Owner;producer_id=$Producer;server_id=$ServerId}
  [IO.File]::WriteAllText($target,($config | ConvertTo-Json -Compress),$utf8)
  $hashInput = [IO.File]::ReadAllBytes($target)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $expectedHash = [BitConverter]::ToString($hasher.ComputeHash($hashInput)).Replace('-','').ToLowerInvariant() }
  finally { $hasher.Dispose(); [Array]::Clear($hashInput,0,$hashInput.Length) }
  # Debug bundle transfer is required; shell UID cannot write the real app path.
  # App is cold throughout transfer. Only the complete verified bytes may launch.
  $transferReply = (& $Hdc file send -b $Bundle $target ($deviceDir + '/sync-target.json') | Out-String)
  $activated = $true
  if ($LASTEXITCODE -ne 0 -or $transferReply -notmatch 'FileTransfer finish') { throw 'PRIVATE_FILE_TRANSFER_FAILED' }
  $remoteHash = (& $Hdc shell -b $Bundle sha256sum ($deviceDir + '/sync-target.json') | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $remoteHash -notmatch ('^' + $expectedHash + '\s')) { throw 'PRIVATE_FILE_HASH_MISMATCH' }
  & $Hdc shell power-shell wakeup | Out-Null
  $startReply = (& $Hdc shell aa start -b $Bundle -a $Ability --ps phase $Phase --ps run_id $run | Out-String)
  # HDC can exit zero when Ability Manager rejects a locked-screen launch.
  if ($LASTEXITCODE -ne 0 -or $startReply -notmatch 'start ability successfully') {
    if ($startReply -match '10106102') { throw 'LAB_SCREEN_LOCKED' }
    throw 'LAB_START_FAILED'
  }
  $started = $true
} finally {
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
  $token = $null
  $credentialData = $null
  $config = $null
  # Debug mount allows file transfer but denies shell unlink/chmod/rename.
  # On a failed start, overwrite the exact config with a non-secret tombstone.
  # Cable loss can prevent device cleanup; local secret has already been removed.
  try {
    if ($activated -and -not $started) {
      [IO.File]::WriteAllText($target,'{"schema":1,"cleared":true}',$utf8)
      & $Hdc file send -b $Bundle $target ($deviceDir + '/sync-target.json') | Out-Null
    }
  } catch {
    # Do not replace the original transfer/start failure with cleanup diagnostics.
  }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
  if (Test-Path -LiteralPath $stageDir) { Remove-Item -LiteralPath $stageDir }
}
$live = (& $Hdc shell pidof $Bundle | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $live) { throw 'LAB_NOT_RUNNING' }
[IO.File]::WriteAllText((Join-Path $privateDir 'live-sync-pid.txt'), $live)
[pscustomobject]@{ run_id = $run; producer = $Producer; base_url = $BaseUrl; credential_transport = 'private_file'; app_pid = $live } | ConvertTo-Json
