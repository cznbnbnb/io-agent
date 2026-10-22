$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'candidate-build-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-run-support.ps1')
. (Join-Path $PSScriptRoot 'candidate-package-support.ps1')
$workspace=Get-CandidateWorkspacePolicy $PSScriptRoot
$fixture=New-CandidateScratchDirectory $workspace.workspaceRoot 'runtime-package-test'
$checks=0
function Expect-Failure($Action,[string]$Pattern){
 $failed=$false
 try{& $Action}catch{$failed=$_.Exception.Message -match $Pattern}
 if(!$failed){throw 'RUNTIME_GUARD_DID_NOT_REJECT'}
 $script:checks++
}
function Make-Package([string]$Name,[string]$Omit='', [bool]$InvalidElf=$false){
 $path=Join-Path $fixture $Name
 $zip=[IO.Compression.ZipFile]::Open($path,[IO.Compression.ZipArchiveMode]::Create)
 try{
  foreach($lib in (Get-CandidateRuntimeLibraries)){
   if($lib -ceq $Omit){continue}
   $stream=$zip.CreateEntry('libs/arm64-v8a/'+$lib).Open()
   try{$data=New-Object byte[] 32;$data[0]=127;$data[1]=69;$data[2]=76;$data[3]=70;if($InvalidElf){$data[0]=0};$stream.Write($data,0,$data.Length)}finally{$stream.Dispose()}
  }
  foreach($model in @('sensevoice/model.int8.onnx','diar/embedding_zh.onnx','prompter_ctc_zh/model.int8.onnx','vad/silero_vad.onnx')){
   if($model -ceq $Omit){continue}
   $stream=$zip.CreateEntry('resources/rawfile/models/'+$model).Open()
   try{$data=New-Object byte[] 1000000;$stream.Write($data,0,$data.Length)}finally{$stream.Dispose()}
  }
 }finally{$zip.Dispose()}
 return $path
}
try{
 if(Test-CandidateDependencySeed $fixture){throw 'EMPTY_CACHE_ACCEPTED'};$checks++
 $valid=Make-Package 'valid.hap';Assert-CandidateRuntimePayload $valid;$checks++
 foreach($lib in (Get-CandidateRuntimeLibraries)){
  $missing=Make-Package ($lib+'.hap') $lib
  Expect-Failure {Assert-CandidateRuntimePayload $missing} 'Required native runtime missing'
 }
 $invalid=Make-Package 'invalid.hap' '' $true
 Expect-Failure {Assert-CandidateRuntimePayload $invalid} 'Invalid native runtime'
 $modelMissing=Make-Package 'missing-model.hap' 'sensevoice/model.int8.onnx'
 Expect-Failure {Assert-CandidateRuntimePayload $modelMissing} 'Required local model missing'
 Write-Output ($checks.ToString()+' runtime package checks passed')
}finally{
 $report=Join-Path $PSScriptRoot ('candidate-runs/guard-tests/runtime-package-ps'+$PSVersionTable.PSVersion.Major+'.json')
 $null=Complete-CandidateScratch $fixture $workspace.workspaceRoot $report
}
