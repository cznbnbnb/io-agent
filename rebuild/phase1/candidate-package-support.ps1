# Runtime assets are an installation requirement even when ArkTS compiles.
function Get-CandidateRuntimeLibraries {
  return @('libonnxruntime.so','libsherpa-onnx-c-api.so','libsherpa_onnx.so','libAMapOpenLocation.so','libAMapOpenNaviJNI.so','libOSL_MNN.so','libmindAlgo.so','libnui.so','libopenssl.so')
}
function Test-CandidateDependencySeed([string]$SdkRoot) {
  $seedRoot=Join-Path $SdkRoot 'oh_modules\.ohpm'
  if (!(Test-Path -LiteralPath $seedRoot -PathType Container)) { return $false }
  Assert-CandidateDirectoryChain $seedRoot
  foreach($name in (Get-CandidateRuntimeLibraries)) {
    # Enumerate only real files, never follow OHPM local-package junctions.
    $found=@(Get-ChildItem -LiteralPath $seedRoot -Filter $name -Recurse -File | Where-Object { $_.FullName -match '[\\/]libs[\\/]arm64-v8a[\\/]' -and $_.Length -gt 16 -and !($_.Attributes -band [IO.FileAttributes]::ReparsePoint) })
    if($found.Count -lt 1) { return $false }
  }
  return $true
}
function Get-CandidateDependencySeed([string]$PhaseRoot,$Workspace) {
  $ledgers=Join-Path $PhaseRoot 'candidate-runs'
  foreach($run in @(Get-ChildItem -LiteralPath $ledgers -Directory | Where-Object {$_.Name -cmatch '^[0-9]{8}-[0-9]{9}-[0-9a-f]{8}$'} | Sort-Object Name -Descending)) {
    $path=Join-Path $run.FullName 'status.json'
    if(!(Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    $status=Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    if($status.phase -cne 'complete' -or !$status.compileSucceeded) { continue }
    try { $stage=Resolve-CandidateRecordedStage $status $run.Name $Workspace.workspaceRoot $Workspace.legacyTempRoot } catch { continue }
    $sdk=Join-Path $stage 'harmony-sdk'
    if(Test-CandidateDependencySeed $sdk) { return $sdk }
  }
  $legacy=Join-Path $Workspace.legacyTempRoot 'TurboIO-refactor-01a11\harmony-sdk'
  if(Test-CandidateDependencySeed $legacy) { return $legacy }
  return '' # A partial cache must trigger a clean OHPM install, never reuse.
}
function Assert-CandidateRuntimePayload([string]$HapPath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=[IO.Compression.ZipFile]::OpenRead($HapPath)
  try {
    foreach($name in (Get-CandidateRuntimeLibraries)) {
      $entry=$zip.GetEntry('libs/arm64-v8a/'+$name)
      if(!$entry -or $entry.Length -lt 16) { throw ('Required native runtime missing: '+$name) }
      $stream=$entry.Open()
      try { $magic=New-Object byte[] 4; $count=$stream.Read($magic,0,4) } finally { $stream.Dispose() }
      if($count -ne 4 -or [BitConverter]::ToString($magic) -cne '7F-45-4C-46') { throw ('Invalid native runtime: '+$name) }
    }
    foreach($name in @('sensevoice/model.int8.onnx','diar/embedding_zh.onnx','prompter_ctc_zh/model.int8.onnx','vad/silero_vad.onnx')) {
      $entry=$zip.GetEntry('resources/rawfile/models/'+$name)
      if(!$entry -or $entry.Length -lt 1000000) { throw ('Required local model missing: '+$name) }
    }
  } finally { $zip.Dispose() }
}
