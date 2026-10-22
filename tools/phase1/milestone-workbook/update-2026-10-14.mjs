import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';

// Explicit manual update. Native XML is read only, except the established
// unsupported-view repair; all cell authoring uses bundled Artifact Tool.
const root=fileURLToPath(new URL('../../../',import.meta.url));
const output=path.join(root,'outputs/01a125f7-847d-73b1-8cb7-7351c4b49628');
const target=path.join(output,'雷鸟iO开发里程碑.xlsx');
const phase=path.join(root,'rebuild/phase1');
const runtime='C:/Users/LENOVO/.cache/codex-runtimes/codex-primary-runtime/dependencies';
const python=path.join(runtime,'python/python.exe');
const powershell=path.join(runtime,'native/powershell/pwsh.exe');
const temporary=path.join(output,'.milestone-2026-10-14.tmp');
const original=await fs.readFile(target);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const nativeReader=String.raw`
import json,sys,zipfile,xml.etree.ElementTree as E
N={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def canonical(e):
 return None if e is None else [e.tag,dict(sorted(e.attrib.items())),e.text or '',[canonical(c) for c in e]]
with zipfile.ZipFile(sys.argv[1]) as z:
 def xml(name):return E.fromstring(z.read(name))
 sheet=xml('xl/worksheets/sheet1.xml');table=xml('xl/tables/table1.xml');book=xml('xl/workbook.xml');styles=xml('xl/styles.xml')
 strings=[]
 if 'xl/sharedStrings.xml' in z.namelist():
  strings=[''.join(x.itertext()) for x in xml('xl/sharedStrings.xml').findall('s:si',N)]
 formats={int(x.get('numFmtId')):x.get('formatCode') for x in styles.findall('s:numFmts/s:numFmt',N)}
 xfs=styles.findall('s:cellXfs/s:xf',N)
 def fmt(c):
  i=int(xfs[int(c.get('s','0'))].get('numFmtId','0'));return formats.get(i,str(i))
 def value(c):
  typ=c.get('t','n');v=c.find('s:v',N)
  if typ=='s':return strings[int(v.text)]
  if typ=='inlineStr':return ''.join(c.find('s:is',N).itertext())
  if v is None:return None
  return float(v.text) if typ=='n' else v.text
 cells={c.get('r'):{'type':c.get('t','n'),'value':value(c),'format':fmt(c),'style':canonical(xfs[int(c.get('s','0'))])} for c in sheet.findall('s:sheetData/s:row/s:c',N)}
 parts={name:[E.tostring(e,encoding='unicode') for e in sheet.findall('s:'+name,N)] for name in ['cols','sheetViews','sheetFormatPr','conditionalFormatting','mergeCells','dataValidations','sheetProtection','autoFilter']}
 partkeys={name:[canonical(e) for e in sheet.findall('s:'+name,N)] for name in parts}
 rows=[dict(sorted({k:v for k,v in r.attrib.items() if k!='spans'}.items())) for r in sheet.findall('s:sheetData/s:row',N)]
 columns=[e.get('name') for e in table.findall('s:tableColumns/s:tableColumn',N)]
 result={**parts,'partkeys':partkeys,'rows':rows,'cells':cells,'formulas':[[c.get('r'),c.find('s:f',N).text] for c in sheet.findall('s:sheetData/s:row/s:c',N) if c.find('s:f',N) is not None],
 'table':{'name':table.get('name'),'ref':table.get('ref'),'style':canonical(table.find('s:tableStyleInfo',N)),'filter':canonical(table.find('s:autoFilter',N)),'columns':columns},
 'sheet_names':[s.get('name') for s in book.findall('s:sheets/s:sheet',N)],'definedNames':canonical(book.find('s:definedNames',N)),
 'dataBar':canonical(sheet.find('s:conditionalFormatting[@sqref="I7:I22"]/s:cfRule/s:dataBar',N)),'errors':[c.get('r') for c in sheet.findall('s:sheetData/s:row/s:c',N) if c.get('t')=='e']}
 print(json.dumps(result,ensure_ascii=False))
`;
const native=file=>JSON.parse(execFileSync(python,['-c',nativeReader,file],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'},maxBuffer:4*1024*1024}));
const beforeNative=native(target);
const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(target));
const sheet=workbook.worksheets.getItem('开发里程碑');
const before=sheet.getRange('A1:I22').values;
const formulas=sheet.getUsedRange().formulas;
assert.deepEqual(sheet.getRange('A7:A22').values.map(r=>r[0]),Array.from({length:16},(_,i)=>'M'+String(i+1).padStart(2,'0')));
assert.equal(before[5][7],'本次进度（0.1.54）');
assert.equal(sheet.tables.items.length,1);
if(process.argv.includes('--inspect')){
 console.log(JSON.stringify({tail:sheet.getUsedRange().values.slice(22),oldDate:before[2][4],nativeDate:beforeNative.cells.E3,table:beforeNative.table}));
 const image=await workbook.render({sheetName:sheet.name,range:'A2:I6',scale:1,format:'png'});
 await fs.writeFile(path.join(output,'milestone-header-before-2026-10-14.png'),new Uint8Array(await image.arrayBuffer()));
 process.exit(0);
}
assert(process.argv.includes('--apply'),'EXPLICIT_APPLY_REQUIRED');
const updates=[
 '基线与复用登记保持。手机已装0.1.62，新证据分代码、本机、真机记录。原录音和设置继续复用，官方清单仍逐项走查。',
 '旋转换焦点、短按当前项、点头添加、摇头删除的实测结论保持。任意多选、自由语音、自定义按钮与动画仍待测。',
 '固定CLI与受控Hermes会话已验证真实模型公网原任务问答、排队、取消和正常重启。正式skill资料接入、既有CLI/TUI及硬崩溃等待栈仍待验。',
 '设计稿仍待评审。继续沿用现有页面做小范围修正，尚未批量重写视觉或关闭多设备验收。',
 '三组契约保持交付。资料1.2字典和拆句父引用已贯通手机、服务器、CLI。存储、镜片显示、用户回答、Agent接收和任务完成仍分开。',
 '普通合成资料同ID第1–10版已存云端，CLI第10版1.2正文一致。普通智记删除取得410/撤回，冷启不复活，原音/ASR/第10版保留。录音页删除及真实日常长程待验。',
 '既有熄屏采集与分窗转写证据保持。0.1.61/62仅验证前台凭据解锁恢复，不证明后台上传。8小时、未充电功耗、平台后台资格及真实双人识别仍待验。',
 '普通页七类人工校正已真机通过，第10版字典/拆句引用已云CLI读回。真实双人、90%归属、自动“我”和弹窗竞态待验。',
 '校时、连接按钮及普通智记删除已实测。最新导出/日汇总、录音页删除和全部BASE仍待验收。总结修订绑定仅26项隔离候选，未合并/编译。',
 '腾讯云r3资料1.2正式上线，HTTPS可达，正常手机修订/墓碑已存储并由CLI核对。网站后台与队列沿用。原音归档、容量、流量授权查询及自动轮换待验。',
 '0.1.59正常正式配置导入及资料第1–10版同步通过，0.1.60智记删除云撤回通过。0.1.62三轮解锁恢复并撤旧提示。Picker、新配置断网、后台/原音和轮换待验。',
 '查询CLI与skill支持1.2字典及拆句来源引用，已读回普通手机资料。Hermes正式skill使用新凭据、P34真实日常资料结合办公消息分析仍待验。',
 '电脑独占连接、队列对账与受控Hermes真实模型问答可复用。生产任务身份、普通手机委托/回答/取消端到端、硬崩溃恢复及8小时常驻仍待验。',
 '电脑真实模型问答工具可复用。眼镜正式请求、回复回原任务、自由语音和任意多选仍未完成。',
 '无新增眼镜语音委托验收。先完成普通手机文字闭环，再接现有眼镜收音和手机转写。',
 '已覆盖安装0.1.62并保留资料、配置和绑定，三轮短时恢复通过。正式替代仍待完整官方功能、8小时/功耗、多设备、任务闭环及升级回退验收。'
];
const percentages=[1,.60,.85,.30,1,.95,.65,.65,.60,.90,.90,.70,.85,.20,.05,.15];
const priorH=sheet.getRange('H7:H22').values;
const priorPercentages=sheet.getRange('I7:I22').values.map(r=>r[0]);
const initialHistory=JSON.stringify(sheet.getRange('A7:F22').values);
const metadataPath=path.join(phase,'milestone-features-before-2026-10-14.json');
await fs.writeFile(metadataPath,JSON.stringify(beforeNative,null,2)+'\n');
sheet.getRange('G7:G22').copyFrom(sheet.getRange('H7:H22'),'values');
sheet.getRange('B3').copyFrom(sheet.getRange('E3'),'values');
const snapshotUtc=new Date();
const snapshotDate=new Date(snapshotUtc.getTime()+8*3600000); // Excel floating wall time, Shanghai.
const excelOrigin=Date.UTC(1899,11,30);
const serial=value=>typeof value==='number'?value:(new Date(value).getTime()-excelOrigin)/86400000;
const oldSerial=serial(before[2][4]);assert(Number.isFinite(oldSerial)&&oldSerial>46000);
sheet.getRange('B3').values=[[oldSerial]];
sheet.getRange('E3').values=[[serial(snapshotDate)]];
sheet.getRange('B4').values=[['0.1.54 至 0.1.62']];
sheet.getRange('E4').values=[['普通资料出口与同步恢复（50b7b70）']];
const headers=[...before[5]];headers[6]='上次进度（0.1.54）';headers[7]='本次进度（0.1.62）';
let table=sheet.tables.items[0];
table.getHeaderRowRange().values=[headers];
sheet.getRange('H7:H22').values=updates.map(v=>[v]);
sheet.getRange('I7:I22').values=percentages.map(v=>[v]);
// Source/context update is limited to existing source/footer cells, if present.
const used=sheet.getUsedRange().values;
const sourceRows=[];
for(let row=22;row<used.length;row++)for(let col=0;col<used[row].length;col++){
 const value=used[row][col];
 if(typeof value==='string'&&/PRD\.md|DEVELOPMENT-PLAN\.md|DEVELOPMENT-STATUS\.md/.test(value)){
  sheet.getCell(row,col).values=[['需求和开发计划。当前证据截至2026-10-14，0.1.62 / 50b7b70。百分比为各里程碑开发粗估，不代表PRD验收。']];sourceRows.push({row:row+1,col:col+1});
 }
}
workbook.recalculate();
assert.equal(JSON.stringify(sheet.getRange('A7:F22').values),initialHistory);
assert.deepEqual(sheet.getRange('G7:G22').values,priorH);
assert.deepEqual(sheet.getUsedRange().formulas,formulas);
const settings={name:table.name,style:table.style,showTotals:table.showTotals,showBandedColumns:table.showBandedColumns,showFilterButton:table.showFilterButton};
await(await SpreadsheetFile.exportXlsx(workbook)).save(temporary);
let afterNative=native(temporary),tableRebuilt=false;
if(JSON.stringify(afterNative.table.columns)!==JSON.stringify(headers)){
 table.delete();table=sheet.tables.add('A6:I22',true,settings.name);
 if(settings.style)table.style=settings.style;
 table.showTotals=settings.showTotals;table.showBandedColumns=settings.showBandedColumns;table.showFilterButton=settings.showFilterButton;
 workbook.recalculate();tableRebuilt=true;
 await(await SpreadsheetFile.exportXlsx(workbook)).save(temporary);afterNative=native(temporary);
}
assert.deepEqual(afterNative.table.columns,headers);
assert(original.equals(await fs.readFile(target)),'WORKBOOK_CHANGED_DURING_EDIT');
await fs.rename(temporary,target);
const repairable=['cols','sheetViews','sheetFormatPr','conditionalFormatting'];
const repaired=repairable.filter(k=>JSON.stringify(beforeNative.partkeys[k])!==JSON.stringify(afterNative.partkeys[k]));
if(repaired.length){
 execFileSync(powershell,['-NoProfile','-File',path.join(root,'tools/phase1/milestone-workbook/preserve-view-metadata.ps1'),'-Workbook',target,'-Metadata',metadataPath],{encoding:'utf8'});
 afterNative=native(target);
}
const saved=await SpreadsheetFile.importXlsx(await FileBlob.load(target));
const savedSheet=saved.worksheets.getItem(sheet.name);
assert.equal(JSON.stringify(savedSheet.getRange('A7:F22').values),initialHistory);
assert.deepEqual(savedSheet.getRange('G7:G22').values,priorH);
assert.deepEqual(savedSheet.getRange('H7:H22').values,updates.map(v=>[v]));
assert.deepEqual(savedSheet.getRange('I7:I22').values,percentages.map(v=>[v]));
assert.deepEqual(savedSheet.getUsedRange().formulas,formulas);
const checks={initial_columns_preserved:true,previous_H_to_G_exact:true,all_formulas_preserved:true,
 native_parts_preserved:Object.keys(beforeNative.partkeys).every(k=>JSON.stringify(beforeNative.partkeys[k])===JSON.stringify(afterNative.partkeys[k])),
 row_dimensions_preserved:JSON.stringify(beforeNative.rows)===JSON.stringify(afterNative.rows),
 table_name_range_style_filter_preserved:['name','ref','style','filter'].every(k=>JSON.stringify(beforeNative.table[k])===JSON.stringify(afterNative.table[k])),
 table_headers_match_cells:JSON.stringify(afterNative.table.columns)===JSON.stringify(headers),
 sheet_inventory_preserved:JSON.stringify(beforeNative.sheet_names)===JSON.stringify(afterNative.sheet_names),
 defined_names_preserved:JSON.stringify(beforeNative.definedNames)===JSON.stringify(afterNative.definedNames),
 B3_original_E3_numeric_serial_preserved:afterNative.cells.B3.type==='n'&&Math.abs(afterNative.cells.B3.value-oldSerial)<1e-10&&afterNative.cells.B3.format===beforeNative.cells.B3.format,
 E3_numeric_date:afterNative.cells.E3.type==='n'&&Math.abs(afterNative.cells.E3.value-serial(snapshotDate))<1e-10&&afterNative.cells.E3.format===beforeNative.cells.E3.format,
 all_cell_styles_preserved:Object.entries(beforeNative.cells).every(([key,c])=>JSON.stringify(c.style)===JSON.stringify(afterNative.cells[key]?.style)),
 progress_typed_formatted:percentages.every((v,i)=>afterNative.cells['I'+(i+7)].type==='n'&&Math.abs(afterNative.cells['I'+(i+7)].value-v)<1e-12&&afterNative.cells['I'+(i+7)].format==='9'),
 data_bar_preserved:JSON.stringify(beforeNative.dataBar)===JSON.stringify(afterNative.dataBar),no_excel_error_cells:afterNative.errors.length===0};
assert(Object.values(checks).every(Boolean),JSON.stringify(checks));
saved.recalculate();
for(const [name,range] of [['milestone-comparison','G6:I22'],['milestone-header','A2:I6']]){
 const image=await saved.render({sheetName:sheet.name,range,scale:1,format:'png'});
 await fs.writeFile(path.join(output,name+'-2026-10-14.png'),new Uint8Array(await image.arrayBuffer()));
}
await fs.writeFile(path.join(output,'milestone-inspection-2026-10-14.ndjson'),(await saved.inspect({kind:'table',range:'开发里程碑!G6:I22',include:'values,formulas',tableMaxRows:17,tableMaxCols:3,maxChars:15000})).ndjson);
const scan=await saved.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}});
await fs.writeFile(path.join(output,'milestone-formula-scan-2026-10-14.ndjson'),scan.ndjson);
const report={kind:'explicit_milestone_update',as_of_commit:'50b7b70',installed_version:'0.1.62',milestones:16,snapshot_utc:snapshotUtc.toISOString(),snapshot_local_time:snapshotDate.toISOString().replace(/Z$/,'+08:00'),
 checks,prior_percentages:priorPercentages.map(v=>Math.round(v*100)),percentages:percentages.map(v=>Math.round(v*100)),percentages_are_acceptance:false,
 changes:updates.map((text,i)=>({id:before[i+6][0],milestone:before[i+6][2],previous_progress:priorH[i][0],current_progress:text,old_percent:Math.round(priorPercentages[i]*100),new_percent:Math.round(percentages[i]*100)})),
 table_rebuilt_only_if_required:tableRebuilt,unsupported_native_parts_repaired:repaired,source_rows_updated:sourceRows,date_numeric_serials:{old_E3:oldSerial,new_B3:afterNative.cells.B3.value,new_E3:afterNative.cells.E3.value},
 P24_summary_candidate_counted_as_delivered:false,sha256:digest(await fs.readFile(target))};
await fs.writeFile(path.join(phase,'milestone-snapshot-2026-10-14.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({path:target,sha256:report.sha256,checks,old_percentages:report.prior_percentages,percentages:report.percentages,table_rebuilt:tableRebuilt,repaired,sourceRows}));
