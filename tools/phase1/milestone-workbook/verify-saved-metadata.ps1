param()
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$taskTarget=Join-Path $taskRoot 'outputs\01a125f7-847d-73b1-8cb7-7351c4b49628\雷鸟iO开发里程碑.xlsx'
$taskMeta=Get-Content -LiteralPath (Join-Path $taskRoot 'rebuild\phase1\milestone-features-before-2026-10-13.json') -Raw -Encoding UTF8|ConvertFrom-Json
$taskSnapshotPath=Join-Path $taskRoot 'rebuild\phase1\milestone-snapshot-2026-10-13.json'
$taskSnapshot=Get-Content -LiteralPath $taskSnapshotPath -Raw -Encoding UTF8|ConvertFrom-Json
$taskZip=[IO.Compression.ZipFile]::OpenRead($taskTarget)
function Read-TaskXml($Name){
  $taskEntry=$taskZip.GetEntry($Name)
  if($null -eq $taskEntry){throw 'WORKBOOK_PART_MISSING'}
  $taskReader=[IO.StreamReader]::new($taskEntry.Open())
  try{return [xml]$taskReader.ReadToEnd()}finally{$taskReader.Dispose()}
}
try{
  $taskSheet=Read-TaskXml 'xl/worksheets/sheet1.xml'
  $taskNs=[Xml.XmlNamespaceManager]::new($taskSheet.NameTable)
  $taskNs.AddNamespace('x','http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $taskChecks=[ordered]@{}
  foreach($taskName in @('cols','sheetViews','sheetFormatPr','mergeCells','conditionalFormatting','dataValidations','sheetProtection')){
    $taskActual=@($taskSheet.SelectNodes('/x:worksheet/x:'+$taskName,$taskNs)|ForEach-Object{$_.OuterXml})
    $taskExpected=@($taskMeta.$taskName)
    $taskChecks[$taskName+'_preserved']=($taskActual.Count -eq $taskExpected.Count -and (ConvertTo-Json -InputObject $taskActual -Compress) -ceq (ConvertTo-Json -InputObject $taskExpected -Compress))
  }
  $taskRows=@($taskSheet.SelectNodes('/x:worksheet/x:sheetData/x:row',$taskNs)|ForEach-Object{
    [pscustomobject]@{r=$_.GetAttribute('r');ht=$(if($_.HasAttribute('ht')){$_.GetAttribute('ht')}else{$null});hidden=$(if($_.HasAttribute('hidden')){$_.GetAttribute('hidden')}else{$null});customHeight=$(if($_.HasAttribute('customHeight')){$_.GetAttribute('customHeight')}else{$null})}
  })
  $taskChecks.row_dimensions_preserved=(ConvertTo-Json -InputObject $taskRows -Depth 5 -Compress) -ceq (ConvertTo-Json -InputObject @($taskMeta.rows) -Depth 5 -Compress)
  $taskChecks.data_bar_present=$taskSheet.SelectNodes('/x:worksheet/x:conditionalFormatting[@sqref="I7:I22"]/x:cfRule/x:dataBar',$taskNs).Count -eq 1
  $taskChecks.numeric_progress_values_match=$true
  for($taskI=0;$taskI -lt 16;$taskI++){
    $taskValue=$taskSheet.SelectSingleNode('/x:worksheet/x:sheetData/x:row/x:c[@r="I'+($taskI+7)+'"]/x:v',$taskNs)
    if($null -eq $taskValue -or [double]::Parse($taskValue.InnerText,[Globalization.CultureInfo]::InvariantCulture) -ne ([double]$taskSnapshot.percentages[$taskI]/100)){$taskChecks.numeric_progress_values_match=$false}
  }
  $taskChecks.no_excel_error_cells=$taskSheet.SelectNodes('/x:worksheet/x:sheetData/x:row/x:c[@t="e"]',$taskNs).Count -eq 0
  $taskTable=Read-TaskXml 'xl/tables/table1.xml'
  $taskChecks.table_range_preserved=$taskTable.DocumentElement.GetAttribute('ref') -ceq 'A6:I22'
  $taskColumns=@($taskTable.DocumentElement.ChildNodes|Where-Object{$_.LocalName -eq 'tableColumns'}|ForEach-Object{$_.ChildNodes})
  $taskChecks.comparison_headers_saved=$taskColumns.Count -eq 9 -and $taskColumns[6].GetAttribute('name') -ceq '上次进度（CLI实测）' -and $taskColumns[7].GetAttribute('name') -ceq '本次进度（0.1.54）'
  $taskWorkbook=Read-TaskXml 'xl/workbook.xml'
  $taskChecks.single_original_sheet=$taskWorkbook.DocumentElement.ChildNodes.Where({$_.LocalName -eq 'sheets'}).ChildNodes.Count -eq 1
}finally{$taskZip.Dispose()}
if(@($taskChecks.Values|Where-Object{$_ -ne $true}).Count -gt 0){throw ('WORKBOOK_VERIFICATION_FAILED: '+(ConvertTo-Json $taskChecks -Compress))}
$taskHash=(Get-FileHash -LiteralPath $taskTarget -Algorithm SHA256).Hash.ToLowerInvariant()
$taskReport=[ordered]@{kind='saved_workbook_feature_verification';checks=$taskChecks;sha256=$taskHash;worksheet='开发里程碑';progress_cells='I7:I22'}
$taskReport|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $taskRoot 'rebuild\phase1\milestone-features-after-2026-10-13.json') -Encoding utf8
$taskSnapshot.sha256=$taskHash
$taskSnapshot|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $taskSnapshotPath -Encoding utf8
$taskReport|ConvertTo-Json -Depth 10
