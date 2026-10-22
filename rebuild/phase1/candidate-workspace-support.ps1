# Machine-local workspaces. ASCII-only for Windows PowerShell 5.1.
function Assert-CandidateWorkspaceRoot([string]$Path) {
  if (-not $Path -or $Path -cnotmatch '^[A-Za-z]:[\\/]' -or $Path -match '[^\x20-\x7E]' -or $Path -match '(^|[\\/])\.\.?($|[\\/])' -or
    $Path -match '[<>"|?*]' -or $Path.Substring(2).Contains(':') -or $Path -match '[. ]([\\/]|$)') { throw 'Absolute ASCII local candidate workspace required' }
  $workspaceFull=[IO.Path]::GetFullPath($Path).TrimEnd('\','/')
  if ($workspaceFull.Length -le 3 -or $workspaceFull -match '[<>"|?*]' -or $workspaceFull.Substring(2).Contains(':')) { throw 'Candidate workspace must be a dedicated local directory' }
  Assert-CandidateDirectoryChain $workspaceFull
  return $workspaceFull
}

function Get-CandidateWorkspacePolicy([string]$PhaseRoot,[string]$BuildWorkspaceRoot='') {
  $workspaceDefault='D:\TurboIO-builds\01a125f7'
  $workspaceConfig=Join-Path $PhaseRoot 'device-private\build-workspace.json'
  $workspaceConfigured=$workspaceDefault
  if (Test-Path -LiteralPath $workspaceConfig) {
    Assert-CandidateDirectoryChain (Split-Path $workspaceConfig -Parent)
    $workspaceConfigItem=Get-Item -LiteralPath $workspaceConfig -Force
    if ($workspaceConfigItem.PSIsContainer -or ($workspaceConfigItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $workspaceConfigItem.Length -gt 4096) { throw 'Invalid private build workspace configuration' }
    $workspaceValue=Get-Content -LiteralPath $workspaceConfig -Raw -Encoding UTF8 | ConvertFrom-Json
    $workspaceKeys=@($workspaceValue.PSObject.Properties.Name)
    if ($workspaceKeys.Count -ne 2 -or 'schema' -cnotin $workspaceKeys -or 'workspaceRoot' -cnotin $workspaceKeys -or $workspaceValue.schema -isnot [ValueType] -or $workspaceValue.schema -ne 1 -or $workspaceValue.schema -is [bool] -or $workspaceValue.workspaceRoot -isnot [string]) { throw 'Invalid private build workspace configuration' }
    $workspaceConfigured=$workspaceValue.workspaceRoot
  }
  if ($BuildWorkspaceRoot) { $workspaceConfigured=$BuildWorkspaceRoot }
  # Resolve the native Windows profile location, never a sandbox/process TEMP.
  $workspaceLegacy=Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'Temp'
  return [pscustomobject]@{
    workspaceRoot=(Assert-CandidateWorkspaceRoot $workspaceConfigured)
    legacyTempRoot=(Assert-CandidateWorkspaceRoot $workspaceLegacy)
    configurationPath=$workspaceConfig
  }
}

function Resolve-CandidateRecordedStage($Status,[string]$RunId,[string]$WorkspaceRoot,[string]$LegacyTempRoot='') {
  if ($RunId -cnotmatch '^[0-9]{8}-[0-9]{9}-[0-9a-f]{8}$' -or $Status.runId -cne $RunId) { throw 'Candidate ledger run/stage mismatch' }
  if (-not $LegacyTempRoot) { $LegacyTempRoot=Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'Temp' }
  $workspaceAllowed=Assert-CandidateWorkspaceRoot $WorkspaceRoot
  $workspaceLegacy=Assert-CandidateWorkspaceRoot $LegacyTempRoot
  $workspaceExpected=Get-CandidateStagePath $workspaceAllowed $RunId
  $workspaceLegacyExpected=Get-CandidateStagePath $workspaceLegacy $RunId
  # Do not infer a trusted parent from a ledger. Only these explicit roots pass.
  if ($Status.stageDirectory -isnot [string] -or ($Status.stageDirectory -ine $workspaceExpected -and $Status.stageDirectory -ine $workspaceLegacyExpected)) { throw 'Candidate ledger run/stage mismatch; only configured workspace or native legacy TEMP permitted' }
  $workspaceRecorded=if ($Status.stageDirectory -ieq $workspaceExpected) { $workspaceExpected } else { $workspaceLegacyExpected }
  if ($Status.PSObject.Properties.Name -contains 'buildWorkspaceRoot') {
    $workspaceRecordedRoot=if ($workspaceRecorded -ieq $workspaceExpected) { $workspaceAllowed } else { $workspaceLegacy }
    if ($Status.buildWorkspaceRoot -isnot [string] -or $Status.buildWorkspaceRoot -ine $workspaceRecordedRoot) { throw 'Candidate ledger workspace/stage mismatch' }
  }
  Assert-CandidateDirectoryChain $workspaceRecorded
  if (-not (Test-Path -LiteralPath $workspaceRecorded -PathType Container)) { throw 'Recorded candidate stage unavailable or archived; no alternate stage is selected' }
  return $workspaceRecorded
}

function New-CandidateScratchDirectory([string]$WorkspaceRoot,[string]$Label) {
  if ($Label -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$') { throw 'Invalid candidate scratch label' }
  $workspaceRootFull=Assert-CandidateWorkspaceRoot $WorkspaceRoot
  $workspaceScratchParent=Join-Path $workspaceRootFull '_scratch'
  $workspaceScratch=Join-Path $workspaceScratchParent ($Label+'-'+[Guid]::NewGuid().ToString('N'))
  Assert-CandidateDirectoryChain $workspaceScratch
  if (-not (Test-Path -LiteralPath $workspaceScratchParent)) { New-Item -ItemType Directory -Path $workspaceScratchParent -ErrorAction Stop -Force | Out-Null }
  Assert-CandidateDirectoryChain $workspaceScratchParent
  New-Item -ItemType Directory -Path $workspaceScratch -ErrorAction Stop | Out-Null
  Assert-CandidateDirectoryChain $workspaceScratch
  if (@(Get-ChildItem -LiteralPath $workspaceScratch -Force).Count -ne 0) { throw 'New candidate scratch is not empty' }
  $workspaceOwner=[ordered]@{schema=1;ownerId=[Guid]::NewGuid().ToString('N');processId=$PID;directory=$workspaceScratch;workspaceRoot=$workspaceRootFull;createdUtc=[DateTime]::UtcNow.ToString('o')}
  $workspaceOwnerJson=$workspaceOwner | ConvertTo-Json -Depth 4
  [IO.File]::WriteAllText((Join-Path $workspaceScratch '.candidate-scratch-owner.json'),$workspaceOwnerJson,(New-Object Text.UTF8Encoding($false)))
  if (-not (Get-Variable -Name CandidateScratchOwners -Scope Script -ErrorAction SilentlyContinue)) {
    $script:CandidateScratchOwners=New-Object 'Collections.Generic.Dictionary[string,string]' ([StringComparer]::OrdinalIgnoreCase)
  }
  $script:CandidateScratchOwners.Add($workspaceScratch,$workspaceOwnerJson)
  return $workspaceScratch
}

function Complete-CandidateScratch([string]$Directory,[string]$WorkspaceRoot,[string]$LogPath) {
  if (-not $Directory) { return }
  $scratchLogSafe=$false
  $scratchReport=[ordered]@{schema=1;directory=$Directory;completedUtc=[DateTime]::UtcNow.ToString('o');cleaned=$false;removedFiles=0;removedBytes=[long]0;failure='';failureType='';directoryRetained=$true}
  try {
    $scratchRoot=Assert-CandidateWorkspaceRoot $WorkspaceRoot
    $scratchFull=[IO.Path]::GetFullPath($Directory)
    $scratchPrefix=$scratchFull+[IO.Path]::DirectorySeparatorChar
    $scratchLogFull=[IO.Path]::GetFullPath($LogPath)
    if ($scratchLogFull -ieq $scratchFull -or $scratchLogFull.StartsWith($scratchPrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Scratch cleanup log must be outside the cleaned directory' }
    Assert-CandidateDirectoryChain (Split-Path $scratchLogFull -Parent)
    if (Test-Path -LiteralPath $scratchLogFull) {
      $scratchLogExisting=Get-Item -LiteralPath $scratchLogFull -Force
      if ($scratchLogExisting.PSIsContainer -or ($scratchLogExisting.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Redirected scratch cleanup summary refused' }
    }
    $scratchLogSafe=$true
    $scratchParent=Join-Path $scratchRoot '_scratch'
    if ($Directory -ine $scratchFull -or (Split-Path $scratchFull -Parent) -ine $scratchParent -or
      (Split-Path $scratchFull -Leaf) -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,100}-[a-f0-9]{32}$' -or
      -not (Get-Variable -Name CandidateScratchOwners -Scope Script -ErrorAction SilentlyContinue) -or -not $script:CandidateScratchOwners.ContainsKey($scratchFull)) { throw 'Unowned candidate scratch refused' }
    Assert-CandidateDirectoryChain $scratchFull
    $scratchOwnerPath=Join-Path $scratchFull '.candidate-scratch-owner.json'
    $scratchOwnerItem=Get-Item -LiteralPath $scratchOwnerPath -Force
    if ($scratchOwnerItem.PSIsContainer -or ($scratchOwnerItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $scratchOwnerItem.Length -gt 4096 -or
      [IO.File]::ReadAllText($scratchOwnerPath,[Text.Encoding]::UTF8) -cne $script:CandidateScratchOwners[$scratchFull]) { throw 'Candidate scratch owner marker changed' }
    $scratchQueue=New-Object 'Collections.Generic.Queue[string]'
    $scratchFiles=New-Object 'Collections.Generic.List[string]'
    $scratchDirs=New-Object 'Collections.Generic.List[string]'
    $scratchQueue.Enqueue($scratchFull)
    # Validate the entire owned tree before deleting a single file. No junction
    # is followed, and removal below never uses recursive shell deletion.
    while ($scratchQueue.Count -gt 0) {
      $scratchCurrent=$scratchQueue.Dequeue();Assert-CandidateDirectoryChain $scratchCurrent
      foreach ($scratchChild in (Get-ChildItem -LiteralPath $scratchCurrent -Force)) {
        if (-not $scratchChild.FullName.StartsWith($scratchPrefix,[StringComparison]::OrdinalIgnoreCase) -or ($scratchChild.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Redirected or out-of-scope candidate scratch refused' }
        if ($scratchChild.PSIsContainer) { $scratchDirs.Add($scratchChild.FullName);$scratchQueue.Enqueue($scratchChild.FullName) }
        elseif ($scratchChild.FullName -ine $scratchOwnerPath) { $scratchFiles.Add($scratchChild.FullName) }
        if ($scratchDirs.Count -gt 20000 -or $scratchFiles.Count -gt 100000) { throw 'Candidate scratch cleanup tree limit exceeded' }
      }
    }
    foreach ($scratchFile in $scratchFiles) {
      Assert-CandidateDirectoryChain (Split-Path $scratchFile -Parent)
      $scratchFileItem=Get-Item -LiteralPath $scratchFile -Force
      if ($scratchFileItem.PSIsContainer -or ($scratchFileItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Candidate scratch file changed before cleanup' }
      $scratchSize=$scratchFileItem.Length
      Remove-Item -LiteralPath $scratchFile -Force -ErrorAction Stop
      $scratchReport.removedFiles++;$scratchReport.removedBytes+=$scratchSize
    }
    foreach ($scratchDir in @($scratchDirs | Sort-Object Length -Descending)) { Assert-CandidateDirectoryChain $scratchDir;[IO.Directory]::Delete($scratchDir,$false) }
    if ([IO.File]::ReadAllText($scratchOwnerPath,[Text.Encoding]::UTF8) -cne $script:CandidateScratchOwners[$scratchFull]) { throw 'Candidate scratch owner changed before completion' }
    Remove-Item -LiteralPath $scratchOwnerPath -ErrorAction Stop
    [IO.Directory]::Delete($scratchFull,$false)
    $script:CandidateScratchOwners.Remove($scratchFull) | Out-Null
    $scratchReport.cleaned=$true;$scratchReport.directoryRetained=$false
  } catch { $scratchReport.failure='SCRATCH_SCOPE_OR_CLEANUP_REJECTED';$scratchReport.failureType=$_.Exception.GetType().FullName }
  try {
    if (-not $scratchLogSafe) { throw 'Unsafe scratch cleanup summary path' }
    Assert-CandidateDirectoryChain (Split-Path ([IO.Path]::GetFullPath($LogPath)) -Parent)
    if (Test-Path -LiteralPath $LogPath) {
      $scratchLogItem=Get-Item -LiteralPath $LogPath -Force
      if ($scratchLogItem.PSIsContainer -or ($scratchLogItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Redirected scratch cleanup summary refused' }
    }
    [IO.File]::WriteAllText($LogPath,($scratchReport | ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
  }
  catch { Write-Warning 'Scratch cleanup summary could not be saved; original result is unchanged' }
  if (-not $scratchReport.cleaned) { Write-Warning ('Owned scratch retained after incomplete cleanup; see '+$LogPath) }
  return [pscustomobject]$scratchReport
}

function Open-CandidateExclusiveBuildFile([string]$Path) {
  Assert-CandidateDirectoryChain (Split-Path $Path -Parent)
  if (Test-Path -LiteralPath $Path) {
    $workspaceLockItem=Get-Item -LiteralPath $Path -Force
    if ($workspaceLockItem.PSIsContainer -or ($workspaceLockItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Redirected candidate build lock refused' }
  }
  try { return [IO.File]::Open($Path,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
  catch { throw 'Candidate build already active or lock unavailable; no run, shared log or status changed' }
}

function Enter-CandidateBuildLock([string]$WorkspaceRoot,[string]$PhaseRoot) {
  $workspaceLockRoot=Assert-CandidateWorkspaceRoot $WorkspaceRoot
  $workspaceProjectPrivate=Join-Path $PhaseRoot 'device-private'
  Assert-CandidateDirectoryChain $workspaceProjectPrivate
  if (-not (Test-Path -LiteralPath $workspaceProjectPrivate)) { New-Item -ItemType Directory -Path $workspaceProjectPrivate -Force -ErrorAction Stop | Out-Null }
  $workspaceProjectLock=Open-CandidateExclusiveBuildFile (Join-Path $workspaceProjectPrivate 'candidate-build.lock')
  try {
    if (-not (Test-Path -LiteralPath $workspaceLockRoot)) { New-Item -ItemType Directory -Path $workspaceLockRoot -Force -ErrorAction Stop | Out-Null }
    $workspaceBuildLock=Open-CandidateExclusiveBuildFile (Join-Path $workspaceLockRoot '.candidate-build.lock')
    return [pscustomobject]@{project=$workspaceProjectLock;workspace=$workspaceBuildLock}
  } catch { $workspaceProjectLock.Dispose();throw }
}

function Exit-CandidateBuildLock($Lock) {
  if ($null -eq $Lock) { return }
  try { $Lock.workspace.Dispose() } finally { $Lock.project.Dispose() }
}

function Get-CandidateArtifactCapacity([string]$PhaseRoot,[long]$MaximumBytes=2147483648) {
  if ($MaximumBytes -lt 1) { throw 'Invalid candidate artifact budget' }
  $workspaceArtifacts=Join-Path $PhaseRoot 'artifacts'
  Assert-CandidateDirectoryChain $workspaceArtifacts
  $workspaceArtifactFiles=New-Object 'Collections.Generic.List[object]'
  if (Test-Path -LiteralPath $workspaceArtifacts -PathType Container) {
    foreach ($workspaceArtifactEntry in (Get-ChildItem -LiteralPath $workspaceArtifacts -Force)) {
      if ($workspaceArtifactEntry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected candidate artifact refused' }
      if (-not $workspaceArtifactEntry.PSIsContainer -and $workspaceArtifactEntry.Extension -ieq '.hap') { $workspaceArtifactFiles.Add($workspaceArtifactEntry) }
    }
    $workspaceArtifactRuns=Join-Path $workspaceArtifacts 'candidate-runs'
    if (Test-Path -LiteralPath $workspaceArtifactRuns -PathType Container) {
      foreach ($workspaceArtifactRun in (Get-ChildItem -LiteralPath $workspaceArtifactRuns -Force)) {
        if ($workspaceArtifactRun.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected candidate artifact run refused' }
        if (-not $workspaceArtifactRun.PSIsContainer) { continue }
        foreach ($workspaceArtifactHap in (Get-ChildItem -LiteralPath $workspaceArtifactRun.FullName -Force)) {
          if ($workspaceArtifactHap.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected candidate artifact entry refused' }
          if (-not $workspaceArtifactHap.PSIsContainer -and $workspaceArtifactHap.Extension -ieq '.hap') { $workspaceArtifactFiles.Add($workspaceArtifactHap) }
        }
      }
    }
  }
  $workspaceArtifactBytes=[long]0
  foreach ($workspaceArtifactFile in $workspaceArtifactFiles) {
    if ($workspaceArtifactFile.Length -lt 0 -or $workspaceArtifactFile.Length -gt ($MaximumBytes-$workspaceArtifactBytes)) { throw ('Candidate artifact budget exceeded: limit='+$MaximumBytes+' logical bytes. Explicitly clean ended candidate HAPs before a new build; no package was deleted') }
    $workspaceArtifactBytes+=$workspaceArtifactFile.Length
  }
  return [pscustomobject]@{logicalBytes=$workspaceArtifactBytes;maximumLogicalBytes=$MaximumBytes;hapPaths=$workspaceArtifactFiles.Count;hardlinksCountedPerPath=$true;checkedUtc=[DateTime]::UtcNow.ToString('o')}
}

function Assert-CandidateAvailableBytes([long]$AvailableBytes,[long]$MinimumBytes=8589934592) {
  if ($MinimumBytes -lt 1 -or $AvailableBytes -lt $MinimumBytes) { throw ('Candidate workspace needs at least '+$MinimumBytes+' free bytes; available='+$AvailableBytes+'; no build started') }
}

function Get-CandidateWorkspaceCapacity([string]$WorkspaceRoot) {
  $workspaceCapacityRoot=Assert-CandidateWorkspaceRoot $WorkspaceRoot
  $workspaceDrive=New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($workspaceCapacityRoot))
  if (-not $workspaceDrive.IsReady) { throw 'Candidate workspace volume unavailable; no build started' }
  Assert-CandidateAvailableBytes $workspaceDrive.AvailableFreeSpace
  return [pscustomobject]@{workspaceRoot=$workspaceCapacityRoot;minimumFreeBytes=[long]8589934592;availableFreeBytes=$workspaceDrive.AvailableFreeSpace;checkedUtc=[DateTime]::UtcNow.ToString('o')}
}

function Get-CandidateStageCapacity([string]$WorkspaceRoot) {
  $workspaceStageRoot=Assert-CandidateWorkspaceRoot $WorkspaceRoot
  $workspaceRunsParent=Join-Path $workspaceStageRoot 'TurboIO-phase1-01a125f7-runs'
  Assert-CandidateDirectoryChain $workspaceRunsParent
  $workspaceStageCount=0
  if (Test-Path -LiteralPath $workspaceRunsParent -PathType Container) {
    # Count every direct directory, including unfinished or unledgered runs.
    # Never recurse into workspaces, scratch, source, archives or legacy TEMP.
    foreach ($workspaceEntry in (Get-ChildItem -LiteralPath $workspaceRunsParent -Force)) {
      if (-not $workspaceEntry.PSIsContainer) { continue }
      if ($workspaceEntry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected candidate stage refused during capacity check' }
      $workspaceStageCount++
    }
  }
  if ($workspaceStageCount -ge 2) { throw ('Candidate stage limit reached: '+$workspaceStageCount+'/2. Explicitly clean ended candidates before a new build; no stage was deleted, and unfinished stages also count') }
  return [pscustomobject]@{workspaceRoot=$workspaceStageRoot;stageDirectories=$workspaceStageCount;maximumStageDirectories=2;checkedUtc=[DateTime]::UtcNow.ToString('o')}
}

function Enter-CandidateProcessTemp([string]$Directory) {
  $workspaceTemp=Assert-CandidateWorkspaceRoot $Directory
  if (-not (Test-Path -LiteralPath $workspaceTemp -PathType Container)) { throw 'Candidate process temporary directory missing' }
  $workspaceBefore=[pscustomobject]@{temp=[Environment]::GetEnvironmentVariable('TEMP','Process');tmp=[Environment]::GetEnvironmentVariable('TMP','Process')}
  [Environment]::SetEnvironmentVariable('TEMP',$workspaceTemp,'Process')
  [Environment]::SetEnvironmentVariable('TMP',$workspaceTemp,'Process')
  return $workspaceBefore
}

function Restore-CandidateProcessTemp($State) {
  if ($null -eq $State) { return }
  [Environment]::SetEnvironmentVariable('TEMP',$State.temp,'Process')
  [Environment]::SetEnvironmentVariable('TMP',$State.tmp,'Process')
}
