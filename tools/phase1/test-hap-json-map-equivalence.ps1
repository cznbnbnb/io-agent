$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\..\rebuild\phase1\candidate-build-support.ps1')
$caseRoot=Join-Path (Join-Path $PSScriptRoot '..\..\rebuild\phase1\device-private') ('payload-map-tests-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $caseRoot|Out-Null
$script:caseNumber=0;$script:passed=0
function New-MapZip($Map,[string]$Code='abc',[string]$Extra='') {
  $script:caseNumber++;$path=Join-Path $caseRoot ($script:caseNumber.ToString()+'.hap')
  $zip=[IO.Compression.ZipFile]::Open($path,[IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach($row in @(@('ets/sourceMaps.map',$Map),@('ets/modules.abc',$Code),@($Extra,'extra'))) {
      if(!$row[0]){continue};$entry=$zip.CreateEntry($row[0]);$stream=$entry.Open()
      try{$bytes=if($row[1] -is [byte[]]){$row[1]}else{[Text.Encoding]::UTF8.GetBytes([string]$row[1])};$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
    }
  }finally{$zip.Dispose()}
  return $path
}
function Compare-MapZip([string]$Before,[string]$After) {
  return Compare-CandidateProductEntries (Get-CandidateHapPayloadSnapshot $Before) (Get-CandidateHapPayloadSnapshot $After) $Before $After
}
function Reject-Map([scriptblock]$Case) {
  $rejected=$false;try{& $Case|Out-Null}catch{$rejected=$true};if(!$rejected){throw 'Expected payload rejection'};$script:passed++
}
$a='{"version":3,"sources":["a","b"],"mappings":"AAAA"}'
$b='{"mappings":"AAAA","sources":["a","b"],"version":3}'
$left=New-MapZip $a;$right=New-MapZip $b
$proof=Compare-MapZip $left $right
if($proof.sourceMapOrderProofs.Count -ne 1 -or $proof.sourceMapOrderProofs[0].frozenRawSha256 -ceq $proof.sourceMapOrderProofs[0].otherRawSha256){throw 'Expected strict map identity proof'};$script:passed++
$exact=Compare-MapZip $left $left;if($exact.sourceMapOrderProofs.Count -ne 0){throw 'Exact payload must remain exact'};$script:passed++
Reject-Map {Compare-MapZip $left (New-MapZip ($b.Replace('AAAA','AAAB')))}
Reject-Map {Compare-MapZip $left (New-MapZip ($b.Replace('["a","b"]','["b","a"]')))}
Reject-Map {Compare-MapZip $left (New-MapZip $b 'xyz')}
Reject-Map {Compare-MapZip $left (New-MapZip $b 'abc' 'unexpected.bin')}
Reject-Map {Compare-MapZip (New-MapZip '{"a":0,"a":1}') (New-MapZip '{"a":1,"a":0}')}
Reject-Map {Compare-MapZip (New-MapZip '{"a":1,}') (New-MapZip '{"a":1 }')}
Reject-Map {Compare-MapZip (New-MapZip '{"A":1,"b":2}') (New-MapZip '{"a":1,"b":2}')}
Reject-Map {Compare-MapZip (New-MapZip ([byte[]]@(255))) (New-MapZip ([byte[]]@(254)))}
Reject-Map {Get-CandidateHapPayloadSnapshot (New-MapZip $a 'abc' '../escape')}
Reject-Map {Get-CandidateHapPayloadSnapshot (New-MapZip $a 'abc' 'ets/modules.abc')}
Reject-Map {Compare-MapZip (New-MapZip ('{"a":"'+('a'*4194304)+'"}')) (New-MapZip ('{"a":"'+('b'*4194304)+'"}'))}
[pscustomobject]@{kind='synthetic_zip_payload_regression';passed=$script:passed;device_operated=$false;bytecode_resources_remain_exact=$true;map_arrays_scalars_and_duplicates_protected=$true}|ConvertTo-Json -Compress
