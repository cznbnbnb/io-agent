import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';

// Explicit workbook refresh only: never operates the phone or server.
const root=fileURLToPath(new URL('../../../',import.meta.url));
const output=path.join(root,'outputs/01a125f7-847d-73b1-8cb7-7351c4b49628');
const target=path.join(output,'雷鸟iO开发里程碑.xlsx');
const phase=path.join(root,'rebuild/phase1');
const runtime='C:/Users/LENOVO/.cache/codex-runtimes/codex-primary-runtime/dependencies';
const data=JSON.parse(await fs.readFile(new URL('./global-capabilities-current.json',import.meta.url),'utf8'));
assert(/^[a-z0-9-]{1,80}$/.test(data.refreshId),'Safe explicit refresh ID required');
const sha=b=>createHash('sha256').update(b).digest('hex');
const source=await fs.readFile(target);
const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(target));
const sheet=workbook.worksheets.getItem('全局功能能力');
const before=sheet.getRange('A1:K55').values;
assert.equal(before[7][0],'F01'); assert.equal(before[54][0],'F48');
assert.equal(sheet.tables.items.length,1);
const snapshotPath=path.join(phase,`global-capabilities-before-${data.refreshId}.json`);
if(process.argv.includes('--inspect')){
  await fs.writeFile(snapshotPath,JSON.stringify({sha256:sha(source),values:before},null,2)+'\n',{flag:'wx'});
  const preview=await workbook.render({sheetName:sheet.name,range:'A2:K11',scale:1,format:'png'});
  await fs.writeFile(path.join(output,`global-capabilities-before-${data.refreshId}.png`),new Uint8Array(await preview.arrayBuffer()));
  console.log((await workbook.inspect({kind:'workbook,sheet,table',maxChars:1400,tableMaxRows:1,tableMaxCols:3})).ndjson);
  console.log(JSON.stringify({sha256:sha(source),header:before.slice(1,7),rowCount:48}));
  process.exit(0);
}
assert(process.argv.includes('--apply'),'Explicit --apply required');
const baseline=JSON.parse(await fs.readFile(snapshotPath,'utf8'));
assert.equal(sha(source),baseline.sha256,'Workbook changed since inspection');
assert.deepEqual(before,baseline.values);
assert.equal(data.asOfDate,'2026-10-16');
assert.equal(data.previousVersion,'0.1.84');assert.equal(data.currentInstalledVersion,'0.1.84');assert.equal(data.candidateVersion,'0.1.96');assert.equal(data.candidateDelivered,false);
assert(before[6][5].includes(data.previousVersion),'Previous current header must match the inspected snapshot');
const install=JSON.parse((await fs.readFile(path.join(phase,'reply084-native-2026-10-15.json'),'utf8')).replace(/^\uFEFF/,''));
assert.equal(install.version,data.currentInstalledVersion);assert.equal(install.version_code,10084);assert.equal(install.installed,true);
assert.equal(install.official_native_signature_verified,true);assert.equal(install.tested_and_built_source_snapshot_match,true);
const candidate=JSON.parse((await fs.readFile(path.join(phase,'scan096-source-audit-offline-2026-10-16.json'),'utf8')).replace(/^\uFEFF/,''));
assert.equal(candidate.version,data.candidateVersion);assert.equal(candidate.candidate_installed,false);
assert.equal(candidate.tests_and_compile_sources_identical,true);assert.equal(candidate.staged_sources_matched,true);
assert.equal(candidate.native_build_succeeded,true);assert.equal(candidate.native_signature_verified,true);
assert.equal(candidate.full_suite_passed,1952);assert.equal(candidate.phone_installed_version_last_verified,data.currentInstalledVersion);
assert.equal(data.overallEstimate,0.45);assert.deepEqual(data.overallEstimateRange,[0.4,0.5]);
const duration=JSON.parse((await fs.readFile(path.join(phase,'card-duration084-joint-2026-10-15.json'),'utf8')).replace(/^\uFEFF/,''));
assert.equal(duration.human_after_disappearance,'returned_to_time_home');assert.equal(duration.two_minute_continuous_lens_visibility_verified,false);assert.equal(duration.final_app_cleanup_verified,true);
const statuses=['已验证可用','部分可用','仅实验可用','代码待验','尚未可用','待评审'];
const values=before.slice(7,55).map(row=>[...row]);
const seen=new Set();
for(const row of values){
  row[4]=row[5]; row[9]=row[10];
  const change=data.updates[row[0]];
  if(change){
    seen.add(row[0]);
    for(const [key,col] of Object.entries({ability:5,availability:6,evidence:7,gap:8,estimate:10})){
      if(Object.hasOwn(change,key))row[col]=change[key];
    }
  }
  assert(statuses.includes(row[6]));
  assert(Number.isFinite(row[9])&&Number.isFinite(row[10])&&row[10]>=0&&row[10]<=1);
  assert(!/无新增|本次新增|本版本新增|同上/.test(row[5]));
}
assert.equal(seen.size,Object.keys(data.updates).length);
const headers=[...before[6]];
headers[4]='上次能做到什么\n10月15日快照';headers[5]='当前累计能力\n'+data.candidateVersion+'候选／安装'+data.currentInstalledVersion;
headers[9]='上次程度\n粗估';
sheet.tables.items[0].getHeaderRowRange().values=[headers];
sheet.getRange('A8:K55').values=values;
sheet.getRange('C3').values=[['2026-10-15 上次快照（安装'+data.previousVersion+'）']];
sheet.getRange('E3').values=[['安装：'+data.currentInstalledVersion+'；'+data.candidateVersion+'已验签待安装；0.1.97开发中']];
const now=new Date();
const wall=new Date(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now).replace(' ','T')+'Z');
assert.equal(wall.toISOString().slice(0,10),data.asOfDate,'Client reporting date mismatch');
sheet.getRange('C4').values=[[wall.getTime()/86400000+25569]];
sheet.getRange('E4').values=[['上次列原样保留上次当前能力和百分比；本次对照累计可用范围。']];
const percent=n=>Math.round(n*100)+'%';
sheet.getRange('E5').values=[['整体PRD约'+percent(data.overallEstimate)+'（'+data.overallEstimateRange.map(percent).join('～')+'，上次约40%）。综合粗估，非分项平均或验收通过率。']];
sheet.getRange('A6').values=[['依据：PRD、计划/状态、人工验收TODO、0.1.84实测及0.1.96源码/构建审计；0.1.97开发中，不计真机或语音闭环通过。']];
for(let i=0;i<values.length;i++){
  if(!data.updates[values[i][0]])continue;
  const longest=Math.max(...values[i].slice(4,9).filter(v=>typeof v==='string').map(v=>v.length));
  if(longest>88)sheet.getRange(`A${i+8}:K${i+8}`).format.rowHeight=longest>130?126:104;
}
workbook.recalculate();
assert.deepEqual(sheet.getRange('A8:K55').values,values);
const inspected=await workbook.inspect({kind:'table',range:'全局功能能力!A7:K55',include:'values,formulas',tableMaxRows:49,tableMaxCols:11,maxChars:48000});
await fs.writeFile(path.join(output,`global-capabilities-inspection-${data.refreshId}.ndjson`),inspected.ndjson);
const errors=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}});
await fs.writeFile(path.join(output,`global-capabilities-error-scan-${data.refreshId}.ndjson`),errors.ndjson);
const temp=path.join(output,`.global-capabilities-${data.refreshId}.tmp.xlsx`);
await(await SpreadsheetFile.exportXlsx(workbook)).save(temp);
const saved=await SpreadsheetFile.importXlsx(await FileBlob.load(temp));
const savedSheet=saved.worksheets.getItem('全局功能能力');
assert.deepEqual(savedSheet.getRange('A8:K55').values,values);
assert.deepEqual(savedSheet.getRange('A7:K7').values[0],headers);
const python=path.join(runtime,'python/python.exe');
// Import/export regenerates relationship IDs and does not update native table
// header names. Preserve original native parts; carry only artifact-authored
// cell content and the explicitly adjusted row heights into that package.
execFileSync(python,[path.join(path.dirname(fileURLToPath(import.meta.url)),'preserve-global-native.py'),target,temp],
  {encoding:'utf8',env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
const checker=path.join(path.dirname(fileURLToPath(import.meta.url)),'verify-global-refresh.py');
const native=JSON.parse(execFileSync(python,[checker,target,temp],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}}));
assert.equal(native.passed,true);
const nativeSaved=await SpreadsheetFile.importXlsx(await FileBlob.load(temp));
assert.deepEqual(nativeSaved.worksheets.getItem('全局功能能力').getRange('A8:K55').values,values);
for(const [label,range] of [['header','A2:K12'],['materials','C22:K29'],['sync','C31:K33'],['agent','E42:K46'],['official','E54:K55']]){
  const preview=await nativeSaved.render({sheetName:sheet.name,range,scale:1,format:'png'});
  await fs.writeFile(path.join(output,`global-capabilities-${label}-${data.refreshId}.png`),new Uint8Array(await preview.arrayBuffer()));
}
assert(source.equals(await fs.readFile(target)),'Workbook changed during refresh');
await fs.copyFile(temp,target);
const report={kind:'explicit_global_capability_update',atUtc:now.toISOString(),date:data.asOfDate,
  installedSourceCommit:install.source_commit,sourceEvidence:data.sourceEvidence,
  previousVersion:data.previousVersion,currentInstalledVersion:data.currentInstalledVersion,candidateVersion:data.candidateVersion,candidateDelivered:false,candidateState:data.candidateState,candidateSourceCommit:candidate.source_commit,candidateRunId:candidate.run_id,candidateNativeSignatureVerified:true,candidateFullSuitePassed:candidate.full_suite_passed,
  originalSha256:sha(source),workbookSha256:sha(await fs.readFile(target)),rows:48,
  updatedFeatureIds:[...seen],previousCurrentAbilitiesPreservedExactly:true,previousCurrentEstimatesPreservedExactly:true,
  overallEstimate:data.overallEstimate,overallEstimateRange:data.overallEstimateRange,overallIsAcceptanceRate:false,overallIsRowAverage:false,diskCleanupIncreasesProductProgress:false,
  native,features:values.map(r=>({id:r[0],feature:r[2],previousAbility:r[4],currentAbility:r[5],availability:r[6],evidence:r[7],gap:r[8],previousEstimate:r[9],currentEstimate:r[10]}))};
await fs.writeFile(path.join(phase,`global-capabilities-snapshot-${data.refreshId}.json`),JSON.stringify(report,null,2)+'\n');
await fs.unlink(temp);
console.log(JSON.stringify({file:target,features:48,updatedFeatureIds:[...seen],native,sha256:report.workbookSha256}));
