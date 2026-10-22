function Get-CandidateHapPayloadSnapshot([string]$Path) {
  # Compare decompressed entries, not ZIP timestamps/compression headers. No
  # extraction occurs, and signature blocks outside the ZIP remain separate.
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $payloadZip=[IO.Compression.ZipFile]::OpenRead($Path)
  $payloadSeen=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  $payloadRows=New-Object 'Collections.Generic.List[object]'
  $payloadTotal=[long]0
  try {
    foreach ($payloadEntry in $payloadZip.Entries) {
      if (-not $payloadSeen.Add($payloadEntry.FullName) -or $payloadEntry.FullName -match '(^/|\\|(^|/)\.\.($|/)|[\r\n|])') { throw 'Unsafe or duplicate HAP entry refused' }
      if ($payloadSeen.Count -gt 20000 -or $payloadEntry.Length -gt 536870912) { throw 'HAP payload limit exceeded' }
      $payloadTotal+=$payloadEntry.Length
      if ($payloadTotal -gt 2147483648) { throw 'HAP payload total limit exceeded' }
      $payloadStream=$payloadEntry.Open();$payloadSha=[Security.Cryptography.SHA256]::Create()
      try { $payloadDigest=([BitConverter]::ToString($payloadSha.ComputeHash($payloadStream))).Replace('-','').ToLowerInvariant() }
      finally { $payloadSha.Dispose();$payloadStream.Dispose() }
      $payloadRows.Add([pscustomobject]@{path=$payloadEntry.FullName;bytes=$payloadEntry.Length;sha256=$payloadDigest})
    }
  } finally { $payloadZip.Dispose() }
  $payloadSorted=@($payloadRows | Sort-Object path)
  $payloadLines=(@($payloadSorted | ForEach-Object { $_.path+'|'+$_.bytes+'|'+$_.sha256 }) -join "`n")+"`n"
  $payloadSha=[Security.Cryptography.SHA256]::Create()
  try { $payloadDigest=([BitConverter]::ToString($payloadSha.ComputeHash([Text.Encoding]::UTF8.GetBytes($payloadLines)))).Replace('-','').ToLowerInvariant() }
  finally { $payloadSha.Dispose() }
  return [pscustomobject]@{sha256=$payloadDigest;entryCount=$payloadSorted.Count;bytes=$payloadTotal;entries=$payloadSorted}
}

function Write-CandidateJson($Path, $Value) {
  [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
}

function Get-CandidateTree($Path) {
  # Inspect directories before descent so junctions cannot change the attested package.
  $taskRootItem=Get-Item -LiteralPath $Path
  if (-not $taskRootItem.PSIsContainer -or ($taskRootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Redirected package refused' }
  $taskRoot=$taskRootItem.FullName.TrimEnd('\','/')
  $taskDirs=New-Object 'Collections.Generic.Queue[string]'
  $taskDirs.Enqueue($taskRoot)
  $taskFiles=New-Object 'Collections.Generic.List[object]'
  while ($taskDirs.Count -gt 0) {
    foreach ($taskChild in (Get-ChildItem -LiteralPath ($taskDirs.Dequeue()) -Force)) {
      if ($taskChild.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected package refused' }
      if ($taskChild.PSIsContainer) { $taskDirs.Enqueue($taskChild.FullName) }
      else {
        $taskFiles.Add([pscustomobject]@{ path=$taskChild.FullName.Substring($taskRoot.Length+1).Replace('\','/'); bytes=$taskChild.Length; sha256=(Get-FileHash -LiteralPath $taskChild.FullName -Algorithm SHA256).Hash.ToLowerInvariant() })
      }
    }
  }
  $taskPaths=[string[]]@($taskFiles | ForEach-Object { $_.path })
  [Array]::Sort($taskPaths, [StringComparer]::Ordinal)
  $taskSorted=@($taskPaths | ForEach-Object { $taskOnePath=$_; $taskFiles | Where-Object { $_.path -ceq $taskOnePath } })
  $taskLines=(@($taskSorted | ForEach-Object { $_.path+'|'+$_.bytes+'|'+$_.sha256 }) -join "`n")+"`n"
  $taskSha=[Security.Cryptography.SHA256]::Create()
  try { $taskDigest=([BitConverter]::ToString($taskSha.ComputeHash([Text.Encoding]::UTF8.GetBytes($taskLines)))).Replace('-','').ToLowerInvariant() } finally { $taskSha.Dispose() }
  return [pscustomobject]@{ sha256=$taskDigest; fileCount=$taskSorted.Count; bytes=($taskSorted | Measure-Object bytes -Sum).Sum; files=$taskSorted }
}

function Test-SherpaMetadataTimeout([string]$Log) {
  # A successful Sherpa fetch followed by another package timeout is ineligible.
  # Ambiguous concurrent metadata failures also remain normal install failures.
  $taskFetches=[regex]::Matches($Log, "MetaDataFetcher fetching meta info of package '([^']+)'")
  return ($taskFetches.Count -eq 1) -and ($taskFetches[0].Groups[1].Value -ceq 'sherpa_onnx') -and ($Log -notmatch "fetch meta info of package 'sherpa_onnx' success") -and ($Log -match '(ECONNABORTED|timeout of 15000ms exceeded)') -and ($Log -match 'Run install command failed')
}

function Initialize-CandidateSherpaFallback($Stage, $RunId, $RunDir, [string]$Reason='sherpa metadata fetch timeout') {
  $taskCached=Join-Path $Stage 'harmony-sdk\oh_modules\.ohpm\sherpa_onnx@1.13.3\oh_modules\sherpa_onnx'
  $taskManifestPath=Join-Path $Stage 'harmony-sdk\entry\oh-package.json5'
  $taskCachedManifest=Get-Content -LiteralPath (Join-Path $taskCached 'oh-package.json5') -Raw | ConvertFrom-Json
  $taskEntryManifest=Get-Content -LiteralPath $taskManifestPath -Raw | ConvertFrom-Json
  if ($taskCachedManifest.name -cne 'sherpa_onnx' -or $taskCachedManifest.version -cne '1.13.3' -or $taskEntryManifest.dependencies.sherpa_onnx -cne '1.13.3') { throw 'Cached Sherpa version does not match declared dependency' }
  $taskSnapshot=Get-CandidateTree $taskCached
  $taskExpectedTree='edf140ba74b47e2c5e09b218aa53dd7a5b31c0a37b4801ae975ed05f9ca46006'
  if ($taskSnapshot.sha256 -cne $taskExpectedTree -or $taskSnapshot.fileCount -ne 35 -or $taskSnapshot.bytes -ne 40131556) { throw 'Cached Sherpa snapshot mismatch' }
  $taskIsolated=Join-Path $Stage ('_verified-dependencies\'+$RunId+'\sherpa_onnx')
  if (Test-Path -LiteralPath $taskIsolated) { throw 'Fallback destination already exists' }
  New-Item -ItemType Directory -Path $taskIsolated -Force | Out-Null
  & robocopy $taskCached $taskIsolated /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8 -or (Get-CandidateTree $taskIsolated).sha256 -cne $taskExpectedTree) { throw 'Cached Sherpa snapshot copy mismatch' }
  $taskOriginalManifestHash=(Get-FileHash -LiteralPath $taskManifestPath).Hash
  $taskEntryManifest.dependencies.sherpa_onnx='file:../../_verified-dependencies/'+$RunId+'/sherpa_onnx'
  Write-CandidateJson $taskManifestPath $taskEntryManifest
  $taskEvidence=[ordered]@{ name='sherpa_onnx'; version='1.13.3'; source=$taskCached; isolatedCopy=$taskIsolated; reason=$Reason; snapshot=$taskSnapshot; sourceEntryManifestSha256=$taskOriginalManifestHash; stagedEntryManifestSha256=(Get-FileHash -LiteralPath $taskManifestPath).Hash; stagedDependency=$taskEntryManifest.dependencies.sherpa_onnx; limits='Attests an existing installed same-version package snapshot only; does not verify upstream HAR archive/signature. Only staging dependency manifest and OHPM-generated lock metadata may differ.' }
  Write-CandidateJson (Join-Path $RunDir 'cached-sherpa-evidence.json') $taskEvidence
  return $taskEvidence
}

function Test-CandidateSherpaInstalled($Stage, $Evidence) {
  $taskInstalled=Join-Path $Stage 'harmony-sdk\entry\oh_modules\sherpa_onnx'
  $taskInstalledManifest=Get-Content -LiteralPath (Join-Path $taskInstalled 'oh-package.json5') -Raw | ConvertFrom-Json
  if ($taskInstalledManifest.name -cne 'sherpa_onnx' -or $taskInstalledManifest.version -cne '1.13.3') { throw 'Installed fallback version mismatch' }
  foreach ($taskKey in @('Index.ets','libs/arm64-v8a/libsherpa_onnx.so','libs/arm64-v8a/libsherpa-onnx-c-api.so','src/main/cpp/types/libsherpa_onnx/oh-package.json5')) {
    if ((Get-FileHash -LiteralPath (Join-Path $taskInstalled $taskKey)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $Evidence.isolatedCopy $taskKey)).Hash) { throw ('Installed fallback file mismatch: '+$taskKey) }
  }
}

function Get-CandidateSourceFiles($Root, [string[]]$Modules) {
  # Apply the same directory exclusions as staging, before following children.
  # In particular, OHPM junctions must not contribute old local package source.
  $taskExcluded=@('build','.hvigor','.idea','oh_modules','node_modules','.git')
  $taskRootItem=Get-Item -LiteralPath $Root
  if (-not $taskRootItem.PSIsContainer -or ($taskRootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Redirected source root refused' }
  $taskRoot=$taskRootItem.FullName.TrimEnd('\','/')
  $taskFiles=New-Object 'Collections.Generic.List[object]'
  foreach ($taskModule in $Modules) {
    if ($taskModule -cnotin @('harmony-sdk','core-probe')) { throw ('Unexpected source module: '+$taskModule) }
    $taskModuleItem=Get-Item -LiteralPath (Join-Path $taskRoot $taskModule)
    if (-not $taskModuleItem.PSIsContainer -or ($taskModuleItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw ('Redirected source module refused: '+$taskModule) }
    $taskDirs=New-Object 'Collections.Generic.Queue[string]'
    $taskDirs.Enqueue($taskModuleItem.FullName)
    while ($taskDirs.Count -gt 0) {
      foreach ($taskChild in (Get-ChildItem -LiteralPath ($taskDirs.Dequeue()) -Force)) {
        if ($taskChild.PSIsContainer -and ($taskChild.Name -in $taskExcluded)) { continue }
        # This exact DevEco native compiler output is outside product source.
        # Do not ignore similarly named .cxx directories elsewhere in the tree.
        if ($taskChild.PSIsContainer -and $taskChild.FullName.Substring($taskRoot.Length+1).Replace('\','/') -ceq 'harmony-sdk/entry/.cxx') { continue }
        if ($taskChild.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected source file or directory refused' }
        if ($taskChild.PSIsContainer) { $taskDirs.Enqueue($taskChild.FullName) }
        else { $taskFiles.Add([pscustomobject]@{ path=$taskChild.FullName.Substring($taskRoot.Length+1).Replace('\','/'); fullName=$taskChild.FullName }) }
      }
    }
  }
  return @($taskFiles.ToArray() | Sort-Object path)
}

function Get-CandidateSourceSnapshot($Root, [string[]]$Modules) {
  return @(Get-CandidateSourceFiles $Root $Modules | ForEach-Object { [pscustomobject]@{ path=$_.path; sha256=(Get-FileHash -LiteralPath $_.fullName -Algorithm SHA256).Hash } })
}

function Assert-CandidatePathSet($Actual, $Baseline, [string]$Label) {
  $taskExpected=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  foreach ($taskEntry in $Baseline) {
    if ($taskEntry.path -cnotmatch '^(harmony-sdk|core-probe)/' -or $taskEntry.path -match '(^|/)(\.|\.\.)($|/)' -or $taskEntry.path -match '\\' -or -not $taskExpected.Add($taskEntry.path)) { throw 'Invalid or duplicate candidate baseline path' }
  }
  if ($taskExpected.Count -eq 0) { throw 'Empty candidate source baseline' }
  $taskSeen=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  foreach ($taskEntry in $Actual) {
    if (-not $taskSeen.Add($taskEntry.path)) { throw ('Duplicate '+$Label+' source path') }
  }
  $taskExtra=@($taskSeen | Where-Object { -not $taskExpected.Contains($_) } | Sort-Object)
  $taskMissing=@($taskExpected | Where-Object { -not $taskSeen.Contains($_) } | Sort-Object)
  if ($taskExtra.Count -gt 0 -or $taskMissing.Count -gt 0) {
    throw ($Label+' source path set mismatch; extra='+$taskExtra.Count+' ['+(@($taskExtra | Select-Object -First 8) -join ', ')+']; missing='+$taskMissing.Count+' ['+(@($taskMissing | Select-Object -First 8) -join ', ')+']. Rebuild in an empty staging directory; source files are never deleted automatically.')
  }
}

function Assert-CandidateSource($Source, $Stage, $Baseline, $ManifestOverride, [bool]$AllowGeneratedStageLocks=$true) {
  $taskModules=@($Baseline | ForEach-Object { ($_.path -split '/')[0] } | Select-Object -Unique)
  Assert-CandidatePathSet (Get-CandidateSourceFiles $Source $taskModules) $Baseline 'Checkout'
  Assert-CandidatePathSet (Get-CandidateSourceFiles $Stage $taskModules) $Baseline 'Staged'
  foreach ($taskEntry in $Baseline) {
    if ((Get-FileHash -LiteralPath (Join-Path $Source $taskEntry.path)).Hash -ne $taskEntry.sha256) { throw ('Source changed during candidate run: '+$taskEntry.path) }
    # Only a baseline lock may change after dependency installation. An extra
    # generated lock still fails the path-set check; checkout hashes stay strict.
    if ($AllowGeneratedStageLocks -and $taskEntry.path -match '(^|/)oh-package-lock\.json5$') { continue }
    $taskExpectedHash=$taskEntry.sha256
    if ($ManifestOverride -and $taskEntry.path -ceq 'harmony-sdk/entry/oh-package.json5') { $taskExpectedHash=$ManifestOverride }
    if ((Get-FileHash -LiteralPath (Join-Path $Stage $taskEntry.path)).Hash -ne $taskExpectedHash) { throw ('Staged source changed during candidate run: '+$taskEntry.path) }
  }
}

function Get-CandidateGeneratedLockDifferences($Stage, $Baseline) {
  return @($Baseline | Where-Object { $_.path -match '(^|/)oh-package-lock\.json5$' } | ForEach-Object {
    $taskGeneratedHash=(Get-FileHash -LiteralPath (Join-Path $Stage $_.path) -Algorithm SHA256).Hash
    if ($taskGeneratedHash -ne $_.sha256) { [pscustomobject]@{ path=$_.path; originalSha256=$_.sha256; generatedStageSha256=$taskGeneratedHash } }
  })
}

function Get-CandidateHapApp($Path) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $taskZip=[IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $taskEntry=$taskZip.GetEntry('module.json')
    if ($null -eq $taskEntry) { throw 'Candidate HAP has no module.json' }
    $taskReader=New-Object IO.StreamReader($taskEntry.Open())
    try { return ($taskReader.ReadToEnd() | ConvertFrom-Json).app } finally { $taskReader.Dispose() }
  } finally { $taskZip.Dispose() }
}

function Assert-CandidateHapFresh($Hap, [string]$StartedUtc) {
  if ($Hap.LastWriteTimeUtc -lt [DateTimeOffset]::Parse($StartedUtc).UtcDateTime.AddSeconds(-2)) { throw 'Candidate HAP predates this compilation' }
}

# Hvigor can reorder JSON object keys when the signing configuration triggers
# debug-map regeneration. This fallback is restricted to that one entry; code,
# resources, array order, scalar spellings and every other entry remain exact.
function Get-CandidateJsonValueIdentity($Element, [int]$Depth=0) {
  if ($Depth -gt 64) { throw 'Source map JSON depth refused' }
  if ($Element.ValueKind -eq [System.Text.Json.JsonValueKind]::Object) {
    $seen=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $keys=New-Object 'Collections.Generic.List[string]'
    foreach ($property in $Element.EnumerateObject()) {
      if (-not $seen.Add($property.Name)) { throw 'Duplicate source map JSON property refused' }
      $keys.Add($property.Name)
    }
    $sorted=$keys.ToArray();[Array]::Sort($sorted,[StringComparer]::Ordinal)
    $parts=foreach ($key in $sorted) { ($key | ConvertTo-Json -Compress)+':'+(Get-CandidateJsonValueIdentity ($Element.GetProperty($key)) ($Depth+1)) }
    return '{'+($parts -join ',')+'}'
  }
  if ($Element.ValueKind -eq [System.Text.Json.JsonValueKind]::Array) {
    $parts=foreach ($item in $Element.EnumerateArray()) { Get-CandidateJsonValueIdentity $item ($Depth+1) }
    return '['+($parts -join ',')+']'
  }
  return $Element.GetRawText()
}
function Get-CandidateSourceMapIdentity([string]$Path) {
  $zip=[IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $entries=@($zip.Entries | Where-Object {$_.FullName -ceq 'ets/sourceMaps.map'})
    if ($entries.Count -ne 1 -or $entries[0].Length -lt 1 -or $entries[0].Length -gt 4194304) { throw 'Source map size or entry count refused' }
    $reader=[IO.StreamReader]::new($entries[0].Open(),[Text.UTF8Encoding]::new($false,$true),$false)
    try { $text=$reader.ReadToEnd() } finally { $reader.Dispose() }
    $document=[System.Text.Json.JsonDocument]::Parse($text)
    try {
      if ($document.RootElement.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { throw 'Source map must be a JSON object' }
      $canonical=Get-CandidateJsonValueIdentity $document.RootElement
    } finally { $document.Dispose() }
    $sha=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
  } finally { $zip.Dispose() }
}
function Compare-CandidateProductEntries($Frozen, $Other, [string]$FrozenPath, [string]$OtherPath, [switch]$AllowNativeSigningPage) {
  $index=New-Object 'Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
  foreach ($entry in $Other.entries) { $index.Add($entry.path,$entry) }
  $proofs=New-Object 'Collections.Generic.List[object]'
  foreach ($entry in $Frozen.entries) {
    if (-not $index.ContainsKey($entry.path) -or $index[$entry.path].bytes -ne $entry.bytes) { throw 'HAP product entry differs from frozen build (size or presence)' }
    $actual=$index[$entry.path]
    if ($actual.sha256 -cne $entry.sha256) {
      if ($entry.path -cne 'ets/sourceMaps.map') { throw 'HAP product entry differs from frozen build' }
      $before=Get-CandidateSourceMapIdentity $FrozenPath;$after=Get-CandidateSourceMapIdentity $OtherPath
      if ($before -cne $after) { throw 'HAP source map JSON values differ from frozen build' }
      $proofs.Add([pscustomobject]@{path=$entry.path;rule='strict_json_object_order_identity';bytes=$entry.bytes;frozenRawSha256=$entry.sha256;otherRawSha256=$actual.sha256;jsonIdentitySha256=$before})
    }
    $index.Remove($entry.path) | Out-Null
  }
  if ($index.Count -and (-not $AllowNativeSigningPage -or $index.Count -ne 1 -or -not $index.ContainsKey('.pages.info'))) { throw 'HAP has an unexpected additional entry' }
  $generated=if ($index.Count) {$index['.pages.info']} else {$null}
  return [pscustomobject]@{sourceMapOrderProofs=@($proofs.ToArray());generatedSigningEntry=$generated}
}
