param(
  [string]$DevEcoHome = 'D:\APP\DevEcoStudio',
  [string]$SigningProject = 'D:\Project\turboio-harmony\harmony-sdk',
  [string]$StageRoot = (Join-Path $env:TEMP 'TurboIO-refactor-01a11')
)
$ErrorActionPreference = 'Stop'
$taskProject = Join-Path $StageRoot 'harmony-sdk'
$taskProfilePath = Join-Path $taskProject 'build-profile.json5'
$taskOriginalBytes = [IO.File]::ReadAllBytes($taskProfilePath)
$taskProfile = [Text.Encoding]::UTF8.GetString($taskOriginalBytes).TrimStart([char]0xFEFF) | ConvertFrom-Json
$taskSigning = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $SigningProject 'build-profile.json5') | ConvertFrom-Json
$taskOriginalProduct = @($taskSigning.app.products | Where-Object { $_.name -eq 'default' })[0]
$taskSigningConfig = @($taskSigning.app.signingConfigs | Where-Object { $_.name -eq $taskOriginalProduct.signingConfig })[0]
if (!$taskSigningConfig) { throw 'Original signing configuration is unavailable' }
foreach ($taskKey in @('certpath', 'profile', 'storeFile')) {
  if (!(Test-Path -LiteralPath $taskSigningConfig.material.$taskKey)) { throw "Missing signing material: $taskKey" }
}
$taskProfile.app.signingConfigs = @($taskSigningConfig)
@($taskProfile.app.products | Where-Object { $_.name -eq 'default' })[0] |
  Add-Member -NotePropertyName signingConfig -NotePropertyValue $taskSigningConfig.name -Force
$env:DEVECO_SDK_HOME = Join-Path $DevEcoHome 'sdk'
$env:JAVA_HOME = Join-Path $DevEcoHome 'jbr'
$env:PATH = (Join-Path $DevEcoHome 'tools\node') + ';' + (Join-Path $DevEcoHome 'tools\ohpm\bin') + ';' + $env:PATH
$taskLog = Join-Path $PSScriptRoot 'sign-check.log'
try {
  # Existing private keys remain in their original location. Only the temporary
  # build profile references them, and the unsigned profile is restored below.
  [IO.File]::WriteAllText($taskProfilePath, ($taskProfile | ConvertTo-Json -Depth 30), (New-Object Text.UTF8Encoding($false)))
  Push-Location $taskProject
  try {
    $ErrorActionPreference = 'Continue'
    & (Join-Path $DevEcoHome 'tools\node\node.exe') (Join-Path $DevEcoHome 'tools\hvigor\bin\hvigorw.js') assembleHap --mode module -p 'module=entry@default' -p 'product=default' -p 'buildMode=debug' --no-daemon *> $taskLog
    $taskExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($taskExit -ne 0) { throw 'Signing build failed; inspect sign-check.log' }
    $taskSignedHap = Join-Path $taskProject 'entry\build\default\outputs\default\entry-default-signed.hap'
    if (!(Test-Path -LiteralPath $taskSignedHap)) { throw 'Signed HAP was not generated' }
    $taskOutput = Join-Path $PSScriptRoot 'artifacts\entry-default-signed.hap'
    Copy-Item -LiteralPath $taskSignedHap -Destination $taskOutput -Force
    [pscustomobject]@{ SignedHap=$taskOutput; Bytes=(Get-Item -LiteralPath $taskOutput).Length; SHA256=(Get-FileHash -Algorithm SHA256 -LiteralPath $taskOutput).Hash } | ConvertTo-Json -Compress
  } finally { Pop-Location }
} finally {
  [IO.File]::WriteAllBytes($taskProfilePath, $taskOriginalBytes)
}
