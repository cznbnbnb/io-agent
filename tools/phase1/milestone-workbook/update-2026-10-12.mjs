import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';

// Manual, explicitly authorized snapshot update only. Never called by builds.
const output=new URL('../../../outputs/01a125f7-847d-73b1-8cb7-7351c4b49628/',import.meta.url);
const target=new URL('雷鸟iO开发里程碑.xlsx',output);
const original=await fs.readFile(target);
const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(target)));
const sheet=workbook.worksheets.getItem('开发里程碑');
if(process.argv.includes('--help-view-preservation')){
 console.log(workbook.help('worksheet',{search:'zoom|selection',include:'index,examples,notes',maxChars:3000}).ndjson);process.exit(0);
}
if(process.argv.includes('--finish-2026-10-13')){
 if(sheet.getRange('H6').values[0][0]!=='本次进度（0.1.54）')throw new Error('CURRENT_SNAPSHOT_REQUIRED');
 const initial=JSON.stringify(sheet.getRange('A7:G22').values),percentages=JSON.stringify(sheet.getRange('I7:I22').values);
 sheet.getRange('H9').values=[['固定CLI与受控Hermes会话已验证真实模型公网问答、排队、取消和正常重启。答案接收核对已修复。既有CLI/TUI等待栈及硬崩溃恢复待验。']];
 sheet.getRange('H14').values=[['段内校正与标签查询已有本机回归，两项审查兼容问题已修复，待复审。普通页接线、真机校正及双人准确率待验。']];
 workbook.recalculate();
 if(JSON.stringify(sheet.getRange('A7:G22').values)!==initial||JSON.stringify(sheet.getRange('I7:I22').values)!==percentages)throw new Error('HISTORY_OR_PROGRESS_CHANGED');
 const preview=await workbook.render({sheetName:'开发里程碑',range:'G6:I22',scale:1,format:'png'});
 await fs.writeFile(new URL('milestone-comparison-2026-10-13.png',output),new Uint8Array(await preview.arrayBuffer()));
 await fs.writeFile(new URL('milestone-inspection-2026-10-13.ndjson',output),(await workbook.inspect({kind:'table',range:'开发里程碑!G6:I22',include:'values,formulas',tableMaxRows:17,tableMaxCols:3,maxChars:14000})).ndjson);
 if(!original.equals(await fs.readFile(target)))throw new Error('WORKBOOK_CHANGED_DURING_EDIT');
 await(await SpreadsheetFile.exportXlsx(workbook)).save(fileURLToPath(target));
 const reportPath=new URL('../../../rebuild/phase1/milestone-snapshot-2026-10-13.json',import.meta.url),report=JSON.parse(await fs.readFile(reportPath,'utf8'));
 report.p23Status='core_and_server_local_tests_passed_review_fixes_done_final_review_and_phone_wiring_pending';
 report.sha256=createHash('sha256').update(await fs.readFile(target)).digest('hex');
 await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exit(0);
}
if(process.argv.includes('--refresh-2026-10-13')){
 const ids=sheet.getRange('A7:A22').values.map(v=>v[0]);
 if(ids.some((v,i)=>v!=='M'+String(i+1).padStart(2,'0'))||sheet.getRange('I6').values[0][0]!=='开发进度（估算）')throw new Error('EXPECTED_MILESTONE_LAYOUT');
 const native=JSON.parse(await fs.readFile(new URL('../../../rebuild/phase1/manual-transcript-native-device-2026-10-13.json',import.meta.url),'utf8'));
 const review=JSON.parse(await fs.readFile(new URL('../../../rebuild/phase1/manual-transcript-native-output-review-2026-10-13.json',import.meta.url),'utf8'));
 if(native.version!=='0.1.54'||native.actual_inference!=='completed_single_synthetic_fixture'||native.published_revision!==2||native.covered_ms!==13200||
    native.canonical_input_result_and_mirror_text_identical!==true||native.restore_pending!==false||review.status!=='consistency_passed_recognition_not_exact')throw new Error('NATIVE_EVIDENCE_REQUIRED');
 const initial=JSON.stringify(sheet.getRange('A7:F22').values),formulas=JSON.stringify(sheet.getRange('A1:I22').formulas);
 const previous=sheet.getRange('H7:H22').values,previousPercentages=sheet.getRange('I7:I22').values;
 const priorDate=sheet.getRange('E3').values[0][0];
 const updates=[
  '基线与复用登记保持完成。已安装0.1.54，新增验证按层级记录。原录音与设置继续复用，官方参考版逐项走查仍开放。',
  '无新增旋钮验收。旋转改焦点、短按当前项、点头添加、摇头删除的实测结论保持。任意多选、按钮文案与动画仍待验证。',
  '固定CLI与受控Hermes会话已做真实模型公网问答、排队、取消和正常重启。答案接收核对已修复。既有CLI/TUI等待栈与硬崩溃恢复仍待验。',
  '设计稿仍待评审。继续沿用现有页面做小范围修正，尚未批量重写视觉或关闭多设备验收。',
  '三组基础契约保持交付。说话人标签协议1.2正在扩展，手机接线与验收未完成。服务器存储、用户回答、Agent接收和任务完成仍分开。',
  '0.1.52删除修复已安装并通过隔离冷启。0.1.54正常页实际转写13.2秒合成音频，资料修订和兼容结果一致，原音保留。查看、导出与公网出口待验。',
  '已有熄屏有声采集与分窗转写证据保持。完整转写实际模型已有短合成样本，准确率未验收。8小时、未充电功耗和后台网络仍待验证。',
  'P23段内改名、合并、拆分和未知校正核心已有本机回归。标签存储与查询扩展开发中。普通页接线、真机校正和真实双人准确率尚未通过。',
  '0.1.53眼镜时钟修复已获用户确认。0.1.54资料转写修订已安装。普通页查看、编辑、删除及官方BASE清单仍需逐项验收。',
  '腾讯云r2已上线，HTTPS资料服务与后台可用。说话人1.2存储、查询扩展正在本机回归，未部署。原音归档、容量、流量授权查询和轮换待验。',
  '前台增量队列与合成资料断网恢复已有真机证据。0.1.54手动转写现可进入资料修订。普通资料至公网、后台网络、原音与凭据轮换待验。',
  '查询CLI与skill保持交付，正在补充说话人标签和拆句引用。电脑已读回公网合成资料。P34真实日常资料结合办公消息分析仍未验收。',
  '云端r2与受控Hermes会话已有真实模型公网原任务问答。答案重试对账已实现并回归。普通手机委托、回答和取消端到端仍待验证。',
  '电脑真实模型问答工具可复用。眼镜正式请求、回复回原任务、自由语音和任意多选仍未完成。',
  '无新增眼镜语音委托验收。先完成普通手机文字闭环，再接现有眼镜收音和手机转写。',
  '已覆盖安装0.1.54并保留资料、配置和绑定。尚未达到正式替代标准，完整官方对齐、全天稳定性与功耗、多设备及任务闭环仍待验收。'
 ];
 // Coarse development estimates for these existing milestones, not PRD acceptance or test-pass percentages.
 const progress=[1,.60,.85,.30,1,.85,.65,.25,.45,.90,.85,.60,.85,.20,.05,.10];
 sheet.getRange('G7:G22').values=previous;
 sheet.getRange('G6').values=[['上次进度（CLI实测）']];sheet.getRange('H6').values=[['本次进度（0.1.54）']];
 sheet.getRange('H7:H22').values=updates.map(v=>[v]);sheet.getRange('I7:I22').values=progress.map(v=>[v]);
 sheet.getRange('B3').values=[[new Date(priorDate)]];
 sheet.getRange('E3').values=[[new Date(Date.now()+8*3600000)]];
 sheet.getRange('B3').setNumberFormat('yyyy-mm-dd hh:mm');sheet.getRange('E3').setNumberFormat('yyyy-mm-dd hh:mm');
 sheet.getRange('B4').values=[['0.1.50 至 0.1.54']];sheet.getRange('E4').values=[['真机转写发布 / P23段内校正开发']];
 const table=sheet.tables.items[0],settings={name:table.name,style:table.style,showTotals:table.showTotals,showBandedColumns:table.showBandedColumns,showFilterButton:table.showFilterButton};
 table.delete();const replacement=sheet.tables.add('A6:I22',true,settings.name);
 if(settings.style)replacement.style=settings.style;
 replacement.showTotals=settings.showTotals;replacement.showBandedColumns=settings.showBandedColumns;replacement.showFilterButton=settings.showFilterButton;
 workbook.recalculate();
 if(JSON.stringify(sheet.getRange('A7:F22').values)!==initial||JSON.stringify(sheet.getRange('G7:G22').values)!==JSON.stringify(previous)||JSON.stringify(sheet.getRange('A1:I22').formulas)!==formulas)throw new Error('MILESTONE_HISTORY_OR_FORMULAS_CHANGED');
 await fs.writeFile(new URL('milestone-inspection-2026-10-13.ndjson',output),(await workbook.inspect({kind:'table',range:'开发里程碑!G6:I22',include:'values,formulas',tableMaxRows:17,tableMaxCols:3,maxChars:14000})).ndjson);
 await fs.writeFile(new URL('milestone-formula-scan-2026-10-13.ndjson',output),(await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}})).ndjson);
 for(const [name,range]of [['milestone-comparison','G6:I22'],['milestone-header','A2:I6']]){
  const preview=await workbook.render({sheetName:'开发里程碑',range,scale:1,format:'png'});
  await fs.writeFile(new URL(name+'-2026-10-13.png',output),new Uint8Array(await preview.arrayBuffer()));
 }
 if(!original.equals(await fs.readFile(target)))throw new Error('WORKBOOK_CHANGED_DURING_EDIT');
 await(await SpreadsheetFile.exportXlsx(workbook)).save(fileURLToPath(target));
 const saved=(await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(target)))).worksheets.getItem('开发里程碑');
 if(JSON.stringify(saved.getRange('A7:F22').values)!==initial||JSON.stringify(saved.getRange('G7:G22').values)!==JSON.stringify(previous)||
    JSON.stringify(saved.getRange('H7:H22').values)!==JSON.stringify(updates.map(v=>[v]))||JSON.stringify(saved.getRange('I7:I22').values)!==JSON.stringify(progress.map(v=>[v])))throw new Error('SAVED_MILESTONE_SNAPSHOT_MISMATCH');
 const report={kind:'explicit_milestone_update',milestones:16,priorSnapshotPreserved:true,initialColumnsPreserved:true,installedVersion:'0.1.54',p23Status:'core_and_server_local_tests_passed_phone_connection_pending',
  nativeEvidence:'manual-transcript-native-device-2026-10-13.json',previousPercentages:previousPercentages.map(v=>Math.round(v[0]*100)),percentages:progress.map(v=>Math.round(v*100)),
  percentagesAreAcceptance:false,sha256:createHash('sha256').update(await fs.readFile(target)).digest('hex')};
 await fs.writeFile(new URL('../../../rebuild/phase1/milestone-snapshot-2026-10-13.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));process.exit(0);
}
if(process.argv.includes('--inspect-2026-10-13')){
 console.log((await workbook.inspect({kind:'workbook,sheet',maxChars:2500})).ndjson);
 console.log((await workbook.inspect({kind:'table',range:'开发里程碑!G6:I22',include:'values,formulas',tableMaxRows:17,tableMaxCols:3,maxChars:12000})).ndjson);
 console.log(JSON.stringify({comparison:sheet.getRange('B3:E4').values,headers:sheet.getRange('G6:I6').values}));
 const preview=await workbook.render({sheetName:'开发里程碑',range:'G6:I22',scale:1,format:'png'});
 await fs.writeFile(new URL('milestone-before-2026-10-13.png',output),new Uint8Array(await preview.arrayBuffer()));
 process.exit(0);
}
if(process.argv.includes('--refresh-runtime')){
 if(sheet.getRange('B4').values[0][0]!=='0.1.47 至 0.1.50'||sheet.getRange('H6').values[0][0]!=='本次进度（0.1.50）')throw new Error('EXPECTED_PRE_RUNTIME_SNAPSHOT');
 const evidence=async relative=>JSON.parse(await fs.readFile(new URL('../../../'+relative,import.meta.url),'utf8'));
 const provider=await evidence('rebuild/phase1/hermes-real-provider-cancel-2026-10-12.json');
 const reconciliation=await evidence('rebuild/phase1/hermes-managed-reconciliation-runtime-2026-10-12.json');
 const review=await evidence('rebuild/agent-bridge/hermes/verification/reconciliation-result.json');
 const buildBytes=await fs.readFile(new URL('../../../rebuild/phase1/candidate-build.log',import.meta.url));
 const build=buildBytes.toString(buildBytes[0]===0xff&&buildBytes[1]===0xfe?'utf16le':'utf8');
 const candidate=await fs.readFile(new URL('../../../rebuild/harmony-sdk/AppScope/app.json5',import.meta.url),'utf8');
 if(provider.status!=='passed'||provider.profile!=='io-question-cli-v1'||provider.checks.length!==7||provider.checks.some(v=>v.passed!==true)||
    reconciliation.passed!==true||reconciliation.checks.length!==9||reconciliation.reconciliation?.synthetic_attestation!==true||
    review.status!=='passed'||!build.includes('BUILD SUCCESSFUL')||!candidate.includes('0.1.51'))throw new Error('RUNTIME_EVIDENCE_REQUIRED');
 // Evidence belongs to completed isolated experiments. New lifecycle edits are
 // still under regression and are explicitly not counted as a deployed feature.
 const stable=JSON.stringify(sheet.getRange('A7:F22').values),formulas=JSON.stringify(sheet.getRange('A1:I22').formulas);
 const previous=sheet.getRange('H7:H22').values,previousPercentages=sheet.getRange('I7:I22').values;
 const previousDate=sheet.getRange('E3').values[0][0];
 const updates=[
  '基线与复用清单保持完成。继续复用原录音和设置，手机已装版本为0.1.50。本次未操作手机或眼镜。',
  '无新增硬件验收。旋转改焦点、短按当前项、点头添加、摇头删除结论保持。任意多选、按钮文案及动画仍待验证。',
  '新增真实模型CLI问答、原任务继续、排队、取消和正常重启验证。中文编码及环境隔离已修复。旧CLI/TUI会话接入、崩溃后等待栈恢复仍未验收。',
  '设计稿仍待评审。现有任务页仅作局部修正，未批量重写页面，不计作视觉定稿。',
  '三组契约保持完成。服务器存储、用户回答、Agent接收、任务继续和完成分开。问题期限与取消收尾新增实现仍在回归，未部署。',
  '资料模型、修订、删除与真机冷启动证据保持。本次未新增真实日常资料或完整资料体验验收。',
  '熄屏有声采集和分窗转写证据保持。解锁助手已修正。8小时、未充电功耗、间歇零帧及后台上传仍待验证。',
  '无新增双人或身份识别验收。段内分离准确率、人工校正和“我”的识别未完成。',
  '0.1.51候选加入取消或过期问题的回答入口限制，DevEco编译通过，未签名安装。手机仍为0.1.50。官方BASE-01–10与多设备适配未完成。',
  '线上仍为独立资料服务和HTTPS后台。问题过期/撤回的服务器收尾仅在本机回归，未发布。带权限流量查询、原音、容量和轮换待验。',
  '真机断网积压、恢复后沿用原事件补传的证据保持。本次无新增手机测试。丢回包、后台上传、原音和真实历史启用仍待验。',
  'P33查询CLI与skill保持交付，电脑已读回手机公网合成资料。真实日常资料结合办公消息的P34分析仍未验收。',
  '真实Hermes模型的CLI问答、排队和取消通过。新增实际子进程崩溃、保留执行不明及明确合成对账后恢复队列验证。生产身份、云端任务、手机闭环和8小时待验。',
  '电脑侧真实模型已能在原任务等待并接收答案。眼镜正式问答、自由语音、任意多选和手机云端端到端尚未验收。',
  '无新增眼镜语音委托验收。仍需接通正式手机文字任务，再复用眼镜收音和手机转写。',
  '手机已装0.1.50，0.1.51候选仅编译通过。正式替代仍需完整官方对齐、全天稳定性与功耗、多设备、真实任务闭环及升级回退验收。'
 ];
 // Coarse per-milestone development estimates; never average into PRD acceptance.
 const progress=[1,.60,.80,.30,1,.80,.65,.15,.40,.85,.85,.55,.80,.20,.05,.10];
 sheet.getRange('G7:G22').values=previous;
 sheet.getRange('G6').values=[['上次进度（0.1.50）']];sheet.getRange('H6').values=[['本次进度（CLI实测）']];
 sheet.getRange('H7:H22').values=updates.map(v=>[v]);sheet.getRange('I7:I22').values=progress.map(v=>[v]);
 sheet.getRange('B3').values=[[new Date(previousDate)]];
 sheet.getRange('E3').values=[[new Date(Date.now()+8*3600000)]];
 sheet.getRange('B3').setNumberFormat('yyyy-mm-dd hh:mm');sheet.getRange('E3').setNumberFormat('yyyy-mm-dd hh:mm');
 sheet.getRange('B4').values=[['0.1.50 至 0.1.51候选']];sheet.getRange('E4').values=[['CLI实测 / 取消与异常对账']];
 // Import/export preserves a table's separately stored column labels; update
 // that one table through the public API while retaining its name and options.
 const table=sheet.tables.items[0],settings={name:table.name,style:table.style,showTotals:table.showTotals,showBandedColumns:table.showBandedColumns,showFilterButton:table.showFilterButton};
 table.delete();const replacement=sheet.tables.add('A6:I22',true,settings.name);
 if(settings.style)replacement.style=settings.style;
 replacement.showTotals=settings.showTotals;replacement.showBandedColumns=settings.showBandedColumns;replacement.showFilterButton=settings.showFilterButton;
 workbook.recalculate();
 if(JSON.stringify(sheet.getRange('A7:F22').values)!==stable||JSON.stringify(sheet.getRange('G7:G22').values)!==JSON.stringify(previous)||JSON.stringify(sheet.getRange('A1:I22').formulas)!==formulas)throw new Error('HISTORY_CHANGED');
 await fs.writeFile(new URL('runtime-inspection.ndjson',output),(await workbook.inspect({kind:'table',range:'开发里程碑!G6:I22',include:'values,formulas',tableMaxRows:17,tableMaxCols:3,maxChars:15000})).ndjson);
 await fs.writeFile(new URL('runtime-formula-scan.ndjson',output),(await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}})).ndjson);
 for(const [name,range]of [['runtime-comparison','G6:I22'],['runtime-overview','A1:C22']]){
  const preview=await workbook.render({sheetName:'开发里程碑',range,scale:1,format:'png'});
  await fs.writeFile(new URL(name+'-2026-10-12.png',output),new Uint8Array(await preview.arrayBuffer()));
 }
 if(!original.equals(await fs.readFile(target)))throw new Error('WORKBOOK_CHANGED_DURING_EDIT');
 await(await SpreadsheetFile.exportXlsx(workbook)).save(fileURLToPath(target));
 const saved=(await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(target)))).worksheets.getItem('开发里程碑');
 if(JSON.stringify(saved.getRange('A7:F22').values)!==stable||JSON.stringify(saved.getRange('G7:G22').values)!==JSON.stringify(previous)||JSON.stringify(saved.getRange('H7:H22').values)!==JSON.stringify(updates.map(v=>[v]))||JSON.stringify(saved.getRange('I7:I22').values)!==JSON.stringify(progress.map(v=>[v])))throw new Error('SAVED_SNAPSHOT_MISMATCH');
 const report={milestones:16,priorSnapshotPreserved:true,installedVersion:'0.1.50',candidateVersion:'0.1.51',candidateStatus:'unsigned_build_passed',previousPercentages:previousPercentages.map(v=>Math.round(v[0]*100)),percentages:progress.map(v=>Math.round(v*100)),sha256:createHash('sha256').update(await fs.readFile(target)).digest('hex')};
 await fs.writeFile(new URL('../../../rebuild/phase1/milestone-runtime-snapshot-2026-10-12.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));process.exit(0);
}
if(process.argv.includes('--record-unlock')){
 const evidence=JSON.parse(await fs.readFile(new URL('../../../rebuild/phase1/phone-unlock-keypad-verification-2026-10-12.json',import.meta.url),'utf8'));
 if(evidence.status!=='passed'||evidence.after_independently_observed?.screenLocked!==false||sheet.getRange('B4').values[0][0]!=='0.1.47 至 0.1.50')throw new Error('UNLOCK_EVIDENCE_REQUIRED');
 const before=JSON.stringify(sheet.getRange('A7:G22').values),formulas=JSON.stringify(sheet.getRange('A1:I22').formulas);
 const old=sheet.getRange('H13').values[0][0],needle='当前解锁助手单次尝试失败，操作方式继续排查。';
 if(!old.endsWith(needle))throw new Error('EXPECTED_UNLOCK_PENDING_SNAPSHOT');
 sheet.getRange('H13').values=[[old.replace(needle,'解锁助手已修正，真实锁屏到解锁通过；仅此项不增加转写进度。')]];
 workbook.recalculate();
 if(JSON.stringify(sheet.getRange('A7:G22').values)!==before||JSON.stringify(sheet.getRange('A1:I22').formulas)!==formulas)throw new Error('HISTORY_CHANGED');
 const preview=await workbook.render({sheetName:'开发里程碑',range:'G12:I14',scale:1,format:'png'});
 await fs.writeFile(new URL('release-unlock-2026-10-12.png',output),new Uint8Array(await preview.arrayBuffer()));
 if(!original.equals(await fs.readFile(target)))throw new Error('WORKBOOK_CHANGED_DURING_EDIT');
 await(await SpreadsheetFile.exportXlsx(workbook)).save(fileURLToPath(target));
 const saved=(await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(target)))).worksheets.getItem('开发里程碑');
 if(JSON.stringify(saved.getRange('A7:G22').values)!==before||saved.getRange('H13').values[0][0]!==old.replace(needle,'解锁助手已修正，真实锁屏到解锁通过；仅此项不增加转写进度。'))throw new Error('SAVED_SNAPSHOT_MISMATCH');
 console.log(JSON.stringify({unlockEvidenceUpdated:true,priorSnapshotPreserved:true,percentagesUnchanged:true}));process.exit(0);
}
if(process.argv.includes('--refresh-release')){
 if(sheet.getRange('I6').values[0][0]!=='开发进度（估算）'||sheet.getRange('B4').values[0][0]!=='0.1.46 至 0.1.47')throw new Error('EXPECTED_0147_SNAPSHOT');
 const readEvidence=async name=>JSON.parse(await fs.readFile(new URL('../../../rebuild/phase1/'+name,import.meta.url),'utf8'));
 const deployed=await readEvidence('io-server-20261012-r1-deploy.json'),publicCheck=await readEvidence('io-server-20261012-r1-public.json');
 if(deployed.status!=='deployed'||publicCheck.status!=='passed'||publicCheck.checks.length!==5)throw new Error('RELEASE_EVIDENCE_REQUIRED');
 const stable=JSON.stringify(sheet.getRange('A7:F22').values),formulas=JSON.stringify(sheet.getRange('A1:I22').formulas);
 const previous=sheet.getRange('H7:H22').values,previousDate=sheet.getRange('E3').values;
 const updates=[
  '基线与复用清单保持完成。录音链路继续复用，新增任务组件和独立服务发布均保留原有资料。',
  '无新增硬件验收。旋转改焦点、短按当前项、点头添加、摇头删除结论保持。任意多选、按钮文案及动画仍未验证。',
  'Hermes 实验适配器的原会话等待、排队、取消和正常重启已通过安装版 ACP/MCP 本机联调，模型为合成。真实模型与崩溃等待点恢复未验收。',
  '设计稿仍待评审。新增任务页沿用现有页面结构，未批量重写视觉，不计作设计定稿。',
  '三组契约保持完成。原委托期限已上线，资料存储、用户回答、Agent 接收、原任务继续和任务完成分别表示。',
  '资料模型、修订和删除保持。同步回执独立保存，真机冷启动及合成资料恢复通过。真实日常资料、完整资料体验仍待收口。',
  '熄屏有声采集及分窗转写证据保持。8小时、未充电功耗和间歇零帧仍待验证。当前解锁助手单次尝试失败，操作方式继续排查。',
  '无新增双人或身份识别验收。仍保留匿名与未知标签，段内分离准确率、人工校正和“我”的识别未完成。',
  '0.1.50 新增普通电脑任务页和独立设置。真机默认关闭、发送禁用及录音入口检查通过。完整资料页面、官方 BASE-01–10 和多设备适配未完成。',
  '独立服务多文件包已上线。公网 HTTPS、后台页面和静态资源通过，原代码可回退。统计需专用权限，带权限查询未验；原音、容量、轮换未完成。',
  '0.1.48 真机无默认网络时积压3版本，恢复网络并冷启动后沿用原事件补传，电脑验证修订与删除。途中丢回包、后台上传、原音和真实历史启用待验。',
  'P33 查询工具和 skill 已交付。电脑已读回手机公网合成资料及删除。真实日常资料结合办公消息的 P34 综合分析仍未验收。',
  '0.1.50 普通任务页已安装，含文字委托、待答、结果、撤回和取消。离线账本与原会话适配器已实现。真实任务凭据、模型和手机云端闭环未验收。',
  '原任务提问/答案工具和手机待答代码已有。合成模型同任务继续通过，眼镜正式问答、自由语音、多选及真实 Agent 端到端未验收。',
  '无新增眼镜语音委托验收。先打通手机文字任务和真实原会话问答，再接现有眼镜收音与手机转写。',
  '0.1.50 已覆盖安装并保留资料。任务页与录音入口单项检查通过。正式替代仍需完整官方对齐、全天功耗、多设备、真实任务闭环及升级回退验收。'
 ];
 // Coarse development estimates, not acceptance scores or an overall PRD average.
 const progress=[1,.60,.60,.30,1,.80,.65,.15,.40,.85,.85,.55,.70,.20,.05,.10];
 sheet.getRange('G7:G22').values=previous;
 sheet.getRange('G6').values=[['上次进度（0.1.47）']];sheet.getRange('H6').values=[['本次进度（0.1.50）']];
 sheet.getRange('H7:H22').values=updates.map(v=>[v]);sheet.getRange('I7:I22').values=progress.map(v=>[v]);
 sheet.getRange('B3').values=previousDate;
 sheet.getRange('E3').values=[[new Date(Date.now()+8*3600000)]];sheet.getRange('B3').setNumberFormat('yyyy-mm-dd hh:mm');sheet.getRange('E3').setNumberFormat('yyyy-mm-dd hh:mm');
 sheet.getRange('B4').values=[['0.1.47 至 0.1.50']];sheet.getRange('E4').values=[['任务页安装 / 后台上线']];
 const table=sheet.tables.items[0],settings={name:table.name,style:table.style,showTotals:table.showTotals,showBandedColumns:table.showBandedColumns,showFilterButton:table.showFilterButton};
 table.delete();const replacement=sheet.tables.add('A6:I22',true,settings.name);
 if(settings.style)replacement.style=settings.style;
 replacement.showTotals=settings.showTotals;replacement.showBandedColumns=settings.showBandedColumns;replacement.showFilterButton=settings.showFilterButton;
 workbook.recalculate();
 if(JSON.stringify(sheet.getRange('A7:F22').values)!==stable||JSON.stringify(sheet.getRange('G7:G22').values)!==JSON.stringify(previous)||JSON.stringify(sheet.getRange('A1:I22').formulas)!==formulas)throw new Error('HISTORY_CHANGED');
 await fs.writeFile(new URL('release-formula-scan.ndjson',output),(await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}})).ndjson);
 await fs.writeFile(new URL('release-inspection.ndjson',output),(await workbook.inspect({kind:'table',range:'开发里程碑!G6:I22',include:'values,formulas',tableMaxRows:17,tableMaxCols:3,maxChars:14000})).ndjson);
 for(const [name,range]of [['release-comparison','G6:I22'],['release-overview','A1:D22']]){
  const preview=await workbook.render({sheetName:'开发里程碑',range,scale:1,format:'png'});
  await fs.writeFile(new URL(name+'-2026-10-12.png',output),new Uint8Array(await preview.arrayBuffer()));
 }
 if(!original.equals(await fs.readFile(target)))throw new Error('WORKBOOK_CHANGED_DURING_EDIT');
 await(await SpreadsheetFile.exportXlsx(workbook)).save(fileURLToPath(target));
 const saved=(await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(target)))).worksheets.getItem('开发里程碑');
 if(JSON.stringify(saved.getRange('A7:F22').values)!==stable||JSON.stringify(saved.getRange('G7:G22').values)!==JSON.stringify(previous)||JSON.stringify(saved.getRange('H7:H22').values)!==JSON.stringify(updates.map(v=>[v]))||JSON.stringify(saved.getRange('I7:I22').values)!==JSON.stringify(progress.map(v=>[v])))throw new Error('SAVED_SNAPSHOT_MISMATCH');
 console.log(JSON.stringify({milestones:16,priorSnapshotPreserved:true,percentages:progress.map(v=>Math.round(v*100)),sha256:createHash('sha256').update(await fs.readFile(target)).digest('hex')}));
 process.exit(0);
}
if(process.argv.includes('--refresh-current')){
 if(sheet.getRange('I6').values[0][0]!=='开发进度（估算）')throw new Error('EXPECTED_PROGRESS_SNAPSHOT');
 const evidence=JSON.parse(await fs.readFile(new URL('../../../rebuild/phase1/phone-coordinator-cloud-verification-2026-10-12.json',import.meta.url),'utf8'));
 if(evidence.status!=='passed'||evidence.candidate!=='0.1.47'||evidence.acknowledgements.length!==3)throw new Error('CURRENT_DEVICE_EVIDENCE_REQUIRED');
 const initialValues=JSON.stringify(sheet.getRange('A7:F22').values),allFormulas=JSON.stringify(sheet.getRange('A1:I22').formulas);
 const previous=JSON.stringify(sheet.getRange('H7:H22').values);
 const updates=[
  '基线与复用清单保持完成。已有录音继续复用，新增组件通过回归，没有重建录音链路。',
  '无新增硬件验收。旋转改焦点、短按提交当前选项、点头添加和摇头删除的实测结论保持。任意多选、按钮文案和动画仍未验证。',
  '新增 Hermes 实验适配器：安装运行时 ACP/MCP 的同任务问答、排队、取消和正常重启通过本机联调，模型为合成。真实模型和中断等待点恢复仍未验收。',
  '设计方案仍待评审，未批量重写页面。本次仅加入资料同步的设置与状态组件，不能视为视觉定稿。',
  '三组契约保持。已明确文字存储回执、原音上传、答案送达和任务完成的区别，继续按独立状态验收。',
  '已接 Ability 生命周期的前台同步协调器和最新修订状态视图，文字回执不改写原始资料版本。既有本机资料与录音回归通过，正式资料体验仍待收口。',
  '熄屏有声采集与七窗转写证据保持。8小时、未充电功耗、间歇零帧和积压恢复日常验证仍未完成。同步前台恢复不能代替后台上传验收。',
  '无新增双人或身份识别验收。匿名、未知状态保留，段内准确率与人工校正仍待完善。',
  '加入小范围文字同步设置和积压状态显示，原生编译通过。完整资料页面、BASE-01–10 官方体验及多设备适配仍待逐项验收。',
  '已放行腾讯云 TCP 443，公网 HTTPS 恢复。手机合成资料及电脑独立查询通过。原音归档、容量和凭据轮换未验收；管理后台目前仅本机预览。',
  '0.1.47 真机自动发现合成原文、修订、删除并上传 HTTPS。冷启动后三条回执原样恢复且未重投。日常前台调度已接入；真实资料启用、断网真机恢复、原音和后台上传待验收。',
  'P33 查询工具和 skill 已交付。电脑已独立读回手机公网合成资料并感知删除。P34 真实日常资料结合办公消息的综合分析尚未验收。',
  '实验 Hermes 适配器已接连接程序：会话锁、持久排队、原问题等待、答案原路继续、取消及安全关闭通过本机真实 ACP/MCP 联调，模型为合成。真实模型、云端任务、手机委托页和执行未知对账待完成。',
  '持久提问/答案工具已接实验适配器，合成任务原问题继续通过。眼镜正式问答、自由语音、多选及真实 Agent 端到端尚未验收。',
  '无新增语音委托验收。等待手机文字委托和真实原任务问答链稳定后，接入现有眼镜收音与手机转写。',
  '0.1.47 已覆盖安装，隔离合成资料及回执保留验证通过。仍未达到正式替代标准：完整官方对齐、全天功耗、多设备及真实任务闭环待验收。'
 ];
 const progress=[1,.60,.60,.30,1,.80,.65,.15,.35,.80,.75,.55,.60,.20,.05,.05];
 sheet.getRange('G7:G22').values=sheet.getRange('H7:H22').values;
 sheet.getRange('G6').values=[['上次进度（2026-10-12）']];
 sheet.getRange('H6').values=[['本次进度（2026-10-12 中午）']];
 sheet.getRange('H7:H22').values=updates.map(value=>[value]);
 sheet.getRange('I7:I22').values=progress.map(value=>[value]);
 sheet.getRange('B3').values=[[new Date('2026-10-12T00:00:00Z')]];
 sheet.getRange('E3').values=[[new Date(Date.now()+8*3600000)]];sheet.getRange('E3').setNumberFormat('yyyy-mm-dd hh:mm');
 sheet.getRange('B4').values=[['0.1.46 至 0.1.47']];
 sheet.getRange('E4').values=[['公网同步通过 / 日常同步接入']];
 // Refresh only the existing table header names while retaining native style,
 // banding, filter visibility, ranges and conditional percentage bars.
 const table=sheet.tables.items[0],settings={name:table.name,style:table.style,showTotals:table.showTotals,showBandedColumns:table.showBandedColumns,showFilterButton:table.showFilterButton};
 table.delete();const replacement=sheet.tables.add('A6:I22',true,settings.name);
 if(settings.style)replacement.style=settings.style;
 replacement.showTotals=settings.showTotals;replacement.showBandedColumns=settings.showBandedColumns;replacement.showFilterButton=settings.showFilterButton;
 workbook.recalculate();
 if(JSON.stringify(sheet.getRange('A7:F22').values)!==initialValues||JSON.stringify(sheet.getRange('G7:G22').values)!==previous||JSON.stringify(sheet.getRange('A1:I22').formulas)!==allFormulas)throw new Error('HISTORY_CHANGED');
 const scan=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}});
 await fs.writeFile(new URL('current-formula-scan.ndjson',output),scan.ndjson);
 await fs.writeFile(new URL('current-inspection.ndjson',output),(await workbook.inspect({kind:'table',range:'开发里程碑!G6:I22',include:'values,formulas',tableMaxRows:17,tableMaxCols:3,maxChars:14000})).ndjson);
 for(const [name,range] of [['current-comparison','G6:I22'],['current-overview','A1:D22']]){
  const preview=await workbook.render({sheetName:'开发里程碑',range,scale:1,format:'png'});
  await fs.writeFile(new URL(name+'-2026-10-12.png',output),new Uint8Array(await preview.arrayBuffer()));
 }
 if(!original.equals(await fs.readFile(target)))throw new Error('WORKBOOK_CHANGED_DURING_EDIT');
 await(await SpreadsheetFile.exportXlsx(workbook)).save(fileURLToPath(target));
 const saved=(await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(target)))).worksheets.getItem('开发里程碑');
 if(JSON.stringify(saved.getRange('A7:F22').values)!==initialValues||JSON.stringify(saved.getRange('G7:G22').values)!==previous||JSON.stringify(saved.getRange('H7:H22').values)!==JSON.stringify(updates.map(value=>[value]))||JSON.stringify(saved.getRange('I7:I22').values)!==JSON.stringify(progress.map(value=>[value])))throw new Error('SAVED_SNAPSHOT_MISMATCH');
 console.log(JSON.stringify({milestones:16,priorSnapshotPreserved:true,percentages:progress.map(v=>Math.round(v*100)),sha256:createHash('sha256').update(await fs.readFile(target)).digest('hex')}));
 process.exit(0);
}
if(process.argv.includes('--add-progress')){
 if(sheet.getRange('I6').values[0][0]||sheet.getRange('H6').values[0][0]!=='本次进度（2026-10-12）')throw new Error('EXPECTED_SNAPSHOT_WITHOUT_PROGRESS');
 const priorValues=JSON.stringify(sheet.getRange('A1:H22').values);
 const priorFormulas=JSON.stringify(sheet.getRange('A1:H22').formulas);
 // Coarse milestone estimates based on the existing H-column evidence.
 // These are not test pass rates, overall PRD weights or acceptance scores.
 const progress=[1,.60,.50,.30,1,.75,.65,.15,.35,.75,.55,.50,.45,.15,.05,.05];
 sheet.getRange('I6').copyFrom(sheet.getRange('H6'),'all');
 sheet.getRange('I6').values=[['开发进度（估算）']];
 sheet.getRange('I3:I4').values=[['开发估算，不代表验收通过'],['100% 表示该里程碑交付完成']];
 sheet.getRange('I3:I4').format.font={name:'Arial',size:10,color:'#52616D'};
 sheet.getRange('I3:I4').format.wrapText=false;
 sheet.getRange('I6:I22').format.columnWidthPx=230;
 sheet.getRange('I7:I22').values=progress.map(value=>[value]);
 sheet.getRange('I7:I22').setNumberFormat('0%');
 sheet.getRange('I7:I22').format.font={name:'Arial',size:11,color:'#243746'};
 sheet.getRange('I7:I22').format.horizontalAlignment='right';
 sheet.getRange('I7:I22').format.verticalAlignment='center';
 sheet.getRange('I7:I22').format.wrapText=false;
 sheet.getRange('I7:I22').conditionalFormats.add('dataBar',{
  color:'#8DB7DE',gradient:false,showValue:true,minLength:0,maxLength:100,
  thresholds:[{type:'num',value:0},{type:'num',value:1}]
 });
 sheet.getRange('I2').format.borders={bottom:{style:'thin',color:'#9AA7B2'}};
 const table=sheet.tables.items[0];
 const settings={name:table.name,style:table.style,showTotals:table.showTotals,showBandedColumns:table.showBandedColumns,showFilterButton:table.showFilterButton};
 table.delete();
 const extended=sheet.tables.add('A6:I22',true,settings.name);
 if(settings.style)extended.style=settings.style;
 extended.showTotals=settings.showTotals;
 extended.showBandedColumns=settings.showBandedColumns;
 extended.showFilterButton=settings.showFilterButton;
 workbook.recalculate();
 if(JSON.stringify(sheet.getRange('A1:H22').values)!==priorValues||JSON.stringify(sheet.getRange('A1:H22').formulas)!==priorFormulas)throw new Error('EXISTING_SNAPSHOT_CHANGED');
 const inspection=await workbook.inspect({kind:'table',range:'开发里程碑!H6:I22',include:'values,formulas',tableMaxRows:17,tableMaxCols:2,maxChars:7000});
 await fs.writeFile(new URL('progress-inspection.ndjson',output),inspection.ndjson);
 const errors=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}});
 await fs.writeFile(new URL('progress-formula-scan.ndjson',output),errors.ndjson);
 const preview=await workbook.render({sheetName:'开发里程碑',range:'H3:I22',scale:1.2,format:'png'});
 await fs.writeFile(new URL('progress-bars-2026-10-12.png',output),new Uint8Array(await preview.arrayBuffer()));
 if(!original.equals(await fs.readFile(target)))throw new Error('WORKBOOK_CHANGED_DURING_EDIT');
 await(await SpreadsheetFile.exportXlsx(workbook)).save(fileURLToPath(target));
 const saved=(await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(target)))).worksheets.getItem('开发里程碑');
 if(JSON.stringify(saved.getRange('A1:H22').values)!==priorValues||JSON.stringify(saved.getRange('I7:I22').values)!==JSON.stringify(progress.map(value=>[value])))throw new Error('SAVED_PROGRESS_MISMATCH');
 console.log(JSON.stringify({milestones:16,existingSnapshotPreserved:true,percentages:progress.map(value=>Math.round(value*100)),sha256:createHash('sha256').update(await fs.readFile(target)).digest('hex')}));
 process.exit(0);
}
if(process.argv.includes('--inspect-progress')){
 console.log(workbook.help('range.conditionalFormats', {search:'dataBar',include:'index,examples,notes',maxChars:5000}).ndjson);
 const preview=await workbook.render({sheetName:'开发里程碑',range:'G6:H22',scale:1,format:'png'});
 await fs.writeFile(new URL('before-progress-bars.png',output),new Uint8Array(await preview.arrayBuffer()));
 console.log((await workbook.inspect({kind:'table',range:'开发里程碑!H6:I22',tableMaxRows:17,tableMaxCols:2,maxChars:5500})).ndjson);
 process.exit(0);
}
if(process.argv.includes('--inspect')){
 console.log((await workbook.inspect({kind:'table',range:'开发里程碑!A2:H22',include:'values,formulas',tableMaxRows:22,tableMaxCols:8,maxChars:14000})).ndjson);
 const preview=await workbook.render({sheetName:'开发里程碑',range:'D6:G22',scale:1,format:'png'});
 await fs.writeFile(new URL('before-2026-10-12.png',output),new Uint8Array(await preview.arrayBuffer()));
 process.exit(0);
}
if(!process.argv.includes('--apply'))throw new Error('EXPLICIT_APPLY_REQUIRED');
if(sheet.getRange('H6').values[0][0]||sheet.getRange('G6').values[0][0]!=='本次进度')throw new Error('EXPECTED_PRIOR_SNAPSHOT');
const deploy=JSON.parse(await fs.readFile(new URL('../../../rebuild/phase1/server-store-deploy-2026-10-12.json',import.meta.url),'utf8'));
if(deploy.status!=='deployed'||deploy.applied!==true||deploy.after_source_sha256?.['store.mjs']!=='58df925b679aaa6d2209e8687168e6fc56e1752ef9546d75abf66646a471123b')throw new Error('DEPLOYMENT_NOT_VERIFIED');
const prior=JSON.stringify(sheet.getRange('A7:G22').values);
const formulas=JSON.stringify(sheet.getRange('A7:G22').formulas);
const updates=[
 '保持完成。新增接手代码质量审计，已修复会话路由、状态隔离和重复执行风险。既有录音继续复用。',
 '无新增硬件验收。二态选择和头势结论保持，任意多选、按钮自定义和动画仍待验证。',
 '新增原生 ACP/MCP 组件联调：提问后等待，同一合成调用接收答案并继续。真实模型、原运行进程重启后恢复仍未通过。',
 '无新增页面交付。设计稿仍待评审，未批量重写页面。',
 '三组契约保持。落实队列鉴权、回执隔离和问题期限校验，端到端仍需逐项验收。',
 '保持已有真机资料验证。新增同步与修订服务代码审计，正式资料页面和完整日常链路仍待验收。',
 '保持熄屏有声采集与七窗转写证据。8小时、未充电功耗、间歇零帧和积压恢复日常验证仍未完成。',
 '无新增双人或身份识别验收。匿名、未知状态保留，段内准确率与人工校正仍待完善。',
 '无新增正式页面或官方对齐验收。BASE-01–10 仍需逐项关闭，不能视为已全部调通。',
 '腾讯云独立服务与 HTTPS 已部署。本次三项队列修复已上线，备份、源码哈希、服务健康及 TLS 回环验证通过。公网443仍待连通，原音归档和容量未验收。',
 '手机 0.1.46 已安装并尝试真实同步，联网未通过。已有持久队列可复用，公网连接、正式调度、凭据轮换和原音上传仍待完成。',
 'P33 查询工具与调用 skill 已交付，本机真实 CLI 查询验证通过。P34 真实日常资料结合办公消息的综合分析尚未验收。',
 'P40 队列已上线，P41 持久出站连接与进程协议本机通过。新增独占锁、崩溃保护、事件ACK和持久问题账本。P42 完整适配器、真实云端出站、P43 手机闭环及P44恢复取消仍未完成。',
 '新增持久提问/答案 MCP 工具，并通过原生 Hermes 合成会话联调。尚未连通认证服务器与眼镜，正式原任务闭环、语音和多选未通过。',
 '无新增语音委托验收。等待原任务路由和眼镜问答链稳定后接入现有收音转写。',
 '尚未达到正式替代标准。官方对齐、全天稳定性/功耗、多设备、真实任务闭环及升级验收仍需完成。'
];
sheet.getRange('E3').values=[[new Date('2026-10-12T00:00:00Z')]];
sheet.getRange('E3').setNumberFormat('yyyy-mm-dd');
sheet.getRange('B4').values=[['0.1.45 至 0.1.46']];
sheet.getRange('E4').values=[['服务端修复上线 / P42 原生协议联调']];
sheet.getRange('D6:H6').values=[['初始状态','初始已经达到','初始待完成或验证','上次进度（0.1.45）','本次进度（2026-10-12）']];
sheet.getRange('H6:H22').copyFrom(sheet.getRange('G6:G22'),'all');
sheet.getRange('H6').values=[['本次进度（2026-10-12）']];
sheet.getRange('H7:H22').values=updates.map(value=>[value]);
sheet.getRange('H6:H22').format.columnWidthPx=460;
sheet.getRange('H2').format.borders={bottom:{style:'thin',color:'#9AA7B2'}};
const table=sheet.tables.items[0];
const settings={name:table.name,style:table.style,showTotals:table.showTotals,showBandedColumns:table.showBandedColumns,showFilterButton:table.showFilterButton};
table.delete();
const extended=sheet.tables.add('A6:H22',true,settings.name);
if(settings.style)extended.style=settings.style;
extended.showTotals=settings.showTotals;
extended.showBandedColumns=settings.showBandedColumns;
extended.showFilterButton=settings.showFilterButton;
for(const [row,height]of [[9,84],[16,100],[17,84],[18,84],[19,116],[20,84],[22,70]])sheet.getRange(`A${row}:H${row}`).format.rowHeight=height;
workbook.recalculate();
if(JSON.stringify(sheet.getRange('A7:G22').values)!==prior||JSON.stringify(sheet.getRange('A7:G22').formulas)!==formulas)throw new Error('PRIOR_SNAPSHOT_CHANGED');
await fs.writeFile(new URL('inspection.ndjson',output),(await workbook.inspect({kind:'table',range:'开发里程碑!A2:H22',include:'values,formulas',tableMaxRows:22,tableMaxCols:8,maxChars:22000})).ndjson);
await fs.writeFile(new URL('formula-scan.ndjson',output),(await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}})).ndjson);
for(const [name,range]of [['comparison','G6:H22'],['overview','A1:D22']]){
 const preview=await workbook.render({sheetName:'开发里程碑',range,scale:1.25,format:'png'});
 await fs.writeFile(new URL(`${name}-2026-10-12.png`,output),new Uint8Array(await preview.arrayBuffer()));
}
if(!original.equals(await fs.readFile(target)))throw new Error('WORKBOOK_CHANGED_DURING_EDIT');
await(await SpreadsheetFile.exportXlsx(workbook)).save(fileURLToPath(target));
const saved=(await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(target)))).worksheets.getItem('开发里程碑');
if(JSON.stringify(saved.getRange('A7:G22').values)!==prior||JSON.stringify(saved.getRange('H7:H22').values)!==JSON.stringify(updates.map(value=>[value])))throw new Error('SAVED_SNAPSHOT_MISMATCH');
console.log(JSON.stringify({milestones:16,priorSnapshotPreserved:true,sha256:createHash('sha256').update(await fs.readFile(target)).digest('hex')}));
