param(
  [string]$Workbook=(Join-Path $PSScriptRoot '..\..\..\outputs\01a125f7-847d-73b1-8cb7-7351c4b49628\雷鸟iO开发里程碑.xlsx'),
  [string]$Metadata=(Join-Path $PSScriptRoot '..\..\..\rebuild\phase1\milestone-features-before-2026-10-13.json')
)
# Preserve unsupported view metadata only. All spreadsheet values/formulas are
# authored and checked with Artifact Tool; this never writes a cell or style.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskTarget=[IO.Path]::GetFullPath($Workbook)
$taskDir=[IO.Path]::GetDirectoryName($taskTarget)
if([IO.Path]::GetFileName($taskTarget) -ne '雷鸟iO开发里程碑.xlsx' -or
   (Get-Item -LiteralPath $taskTarget).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'WORKBOOK_TARGET_UNCONFIRMED'}
$taskSource=Get-Content -LiteralPath $Metadata -Raw -Encoding UTF8|ConvertFrom-Json
$taskOriginalHash=(Get-FileHash -LiteralPath $taskTarget -Algorithm SHA256).Hash
$taskTemporary=Join-Path $taskDir ('.turboio-milestone-meta-'+[guid]::NewGuid().ToString('N')+'.tmp')
$taskBackup=Join-Path $taskDir ('.turboio-milestone-meta-'+[guid]::NewGuid().ToString('N')+'.bak')
if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($taskTemporary)) -ne $taskDir){throw 'WORKBOOK_TEMP_OUTSIDE_TARGET_DIRECTORY'}
try{
  Copy-Item -LiteralPath $taskTarget -Destination $taskTemporary
  $taskZip=[IO.Compression.ZipFile]::Open($taskTemporary,[IO.Compression.ZipArchiveMode]::Update)
  try{
    $taskEntry=$taskZip.GetEntry('xl/worksheets/sheet1.xml')
    $taskReader=[IO.StreamReader]::new($taskEntry.Open())
    try{$taskSheet=[xml]$taskReader.ReadToEnd()}finally{$taskReader.Dispose()}
    $taskNs=[Xml.XmlNamespaceManager]::new($taskSheet.NameTable)
    $taskNs.AddNamespace('x','http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    $taskCellData=$taskSheet.SelectSingleNode('/x:worksheet/x:sheetData',$taskNs).OuterXml
    foreach($taskName in @('cols','sheetViews','sheetFormatPr','conditionalFormatting')){
      $taskNodes=@($taskSheet.SelectNodes('/x:worksheet/x:'+$taskName,$taskNs))
      $taskSaved=@($taskSource.$taskName)
      if($taskNodes.Count -ne $taskSaved.Count){throw 'WORKBOOK_METADATA_COUNT_CHANGED'}
      for($taskIndex=0;$taskIndex -lt $taskNodes.Count;$taskIndex++){
        $taskFragment=[xml]$taskSaved[$taskIndex]
        if($taskFragment.DocumentElement.LocalName -ne $taskName -or
           $taskFragment.DocumentElement.NamespaceURI -ne 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'){throw 'WORKBOOK_METADATA_INVALID'}
        $taskImported=$taskSheet.ImportNode($taskFragment.DocumentElement,$true)
        $taskSheet.DocumentElement.ReplaceChild($taskImported,$taskNodes[$taskIndex])|Out-Null
      }
    }
    if($taskSheet.SelectSingleNode('/x:worksheet/x:sheetData',$taskNs).OuterXml -cne $taskCellData){throw 'WORKBOOK_CELL_DATA_CHANGED'}
    $taskEntry.Delete()
    $taskReplacement=$taskZip.CreateEntry('xl/worksheets/sheet1.xml',[IO.Compression.CompressionLevel]::Optimal)
    $taskWriter=[IO.StreamWriter]::new($taskReplacement.Open(),[Text.UTF8Encoding]::new($false))
    try{$taskWriter.Write($taskSheet.OuterXml)}finally{$taskWriter.Dispose()}
  }finally{$taskZip.Dispose()}
  if((Get-FileHash -LiteralPath $taskTarget -Algorithm SHA256).Hash -cne $taskOriginalHash){throw 'WORKBOOK_CHANGED_DURING_METADATA_REPAIR'}
  # PowerShell binds $null to an empty backup path on some .NET versions.
  # Use an explicit same-directory backup for the atomic replacement.
  [IO.File]::Replace($taskTemporary,$taskTarget,$taskBackup)
  Write-Output 'Original column widths, frozen view/zoom/selection and conditional rules restored; cell payload unchanged.'
}finally{
  if(Test-Path -LiteralPath $taskTemporary){Remove-Item -LiteralPath $taskTemporary}
  if(Test-Path -LiteralPath $taskBackup){Remove-Item -LiteralPath $taskBackup}
}
