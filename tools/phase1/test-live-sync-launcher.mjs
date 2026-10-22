// Security regression for the desktop launcher. HDC is a local inert fixture;
// no phone or server access, and no real credential is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const launcher=fileURLToPath(new URL('./run-live-sync.ps1',import.meta.url));
const syntheticToken='S'.repeat(43);
function run(t,{active=false,expired=false,transferFailure=false,locked=false,hashMismatch=false}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'io-launcher-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const log=path.join(dir,'commands.ndjson'),copy=path.join(dir,'transferred.json');
  const hdc=path.join(dir,'hdc-fixture.ps1'),credential=path.join(dir,'credential.json');
  fs.writeFileSync(credential,JSON.stringify({token:syntheticToken,expires_at:new Date(Date.now()+(expired?-60000:60000)).toISOString()}));
  fs.writeFileSync(hdc,`
$items = @($args | ForEach-Object { [string]$_ })
[IO.File]::AppendAllText($env:IO_TEST_LOG, (ConvertTo-Json -InputObject $items -Compress) + [Environment]::NewLine)
$global:LASTEXITCODE = 0
if ($items[0] -eq 'shell' -and $items[1] -eq 'aa') {
  if ($env:IO_TEST_LOCKED -eq '1') { Write-Output 'error: failed to start ability. Error Code:10106102' }
  else { Write-Output 'start ability successfully.' }
}
if ($items[0] -eq 'file' -and $items[1] -eq 'send') {
  Copy-Item -LiteralPath $items[4] -Destination $env:IO_TEST_COPY
  Write-Output 'FileTransfer finish'
  if ($env:IO_TEST_TRANSFER_FAIL -eq '1') { $global:LASTEXITCODE = 1 }
}
if ($items[0] -eq 'shell' -and $items[3] -eq 'sha256sum') {
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $digest = [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($env:IO_TEST_COPY))).Replace('-','').ToLowerInvariant() }
  finally { $hasher.Dispose() }
  if ($env:IO_TEST_HASH_MISMATCH -eq '1') { $digest = '0' * 64 }
  Write-Output ($digest + '  ' + $items[4])
}
if ($items[0] -eq 'shell' -and $items[1] -eq 'pidof') {
  $n = @(Get-Content -LiteralPath $env:IO_TEST_LOG | Where-Object { $_ -match 'pidof' }).Count
  if ($env:IO_TEST_ACTIVE -eq '1' -or $n -gt 1) { Write-Output '12345' }
}
`);
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',launcher,'-Hdc',hdc,'-Credential',credential],{
    cwd:dir,encoding:'utf8',timeout:15000,windowsHide:true,
    env:{...process.env,IO_TEST_LOG:log,IO_TEST_COPY:copy,IO_TEST_ACTIVE:active?'1':'0',IO_TEST_TRANSFER_FAIL:transferFailure?'1':'0',IO_TEST_LOCKED:locked?'1':'0',IO_TEST_HASH_MISMATCH:hashMismatch?'1':'0'}});
  if(result.error)throw result.error;
  const raw=fs.existsSync(log)?fs.readFileSync(log,'utf8'):'';
  assert(!raw.includes(syntheticToken),'bearer must never enter subprocess argv');
  assert(!(result.stdout+result.stderr).includes(syntheticToken),'bearer must never enter launcher output');
  const privateDir=path.join(dir,'rebuild','phase1','device-private');
  if(fs.existsSync(privateDir))assert(!fs.readdirSync(privateDir).some(name=>name.startsWith('live-sync-target-')),'staging secret must be removed');
  const commands=raw.trim()?raw.trim().split(/\r?\n/).map(JSON.parse):[];
  for(const command of commands.filter(args=>args[0]==='file'&&args[1]==='send')){
    assert.equal(command[2],'-b');assert.equal(command[3],'org.turboio.harmony.research');
    assert(!/[^\x00-\x7f]/.test(command[4]));assert(!fs.existsSync(command[4]),'temporary bearer file removed');
    assert(!fs.existsSync(path.dirname(command[4])),'owned temporary directory removed');
  }
  return {result,commands,copy};
}
test('launcher transfers a private file and starts with no credential arguments',t=>{
  const {result,commands,copy}=run(t);assert.equal(result.status,0,result.stderr);
  const target=JSON.parse(fs.readFileSync(copy,'utf8'));assert.equal(target.token,syntheticToken);
  assert.equal(target.base_url,'https://cznbnb.cn/io-api/v1');
  const start=commands.find(args=>args[0]==='shell'&&args[1]==='aa');assert(start);
  assert(!start.includes('token')&&!start.includes('base_url'));
  assert(commands.some(args=>args[3]==='sha256sum'));
  assert(commands.findIndex(args=>args[3]==='sha256sum')<commands.indexOf(start));
  assert.equal(JSON.parse(result.stdout).credential_transport,'private_file');
});
test('launcher refuses a running application without stopping it',t=>{
  const {result,commands}=run(t,{active:true});assert.notEqual(result.status,0);
  assert.match(result.stderr,/APPLICATION_ALREADY_ACTIVE/);assert.equal(commands.length,1);
});
test('launcher refuses expired credentials before contacting the device',t=>{
  const {result,commands}=run(t,{expired:true});assert.notEqual(result.status,0);
  assert.match(result.stderr,/CREDENTIAL_EXPIRED/);assert.equal(commands.length,0);
});
test('transfer failure prevents activation and launch and removes local secret',t=>{
  const {result,commands}=run(t,{transferFailure:true});assert.notEqual(result.status,0);
  assert.match(result.stderr,/PRIVATE_FILE_TRANSFER_FAILED/);
  assert(!commands.some(args=>args[1]==='mv'||args[1]==='aa'));
});
test('zero exit with locked-screen rejection fails and removes the activated device credential',t=>{
  const {result,commands,copy}=run(t,{locked:true});assert.notEqual(result.status,0);
  assert.match(result.stderr,/LAB_SCREEN_LOCKED/);
  assert.equal(commands.filter(args=>args[0]==='file'&&args[1]==='send').length,2);
  assert.equal(JSON.parse(fs.readFileSync(copy, 'utf8')).cleared,true);
  assert.equal(commands.filter(args=>args[1]==='aa').length,1);
});
test('a different device checksum prevents activation and launch',t=>{
  const {result,commands}=run(t,{hashMismatch:true});assert.notEqual(result.status,0);
  assert.match(result.stderr,/PRIVATE_FILE_HASH_MISMATCH/);assert(!commands.some(args=>args[1]==='mv'||args[1]==='aa'));
});
