import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Workbook,SpreadsheetFile,FileBlob} from '@oai/artifact-tool';
import {createHash} from 'node:crypto';

// Manual creation only. Never invoke from builds, tests, automation or progress
// reporting. Future updates require the user's explicit request and import/edit.
const output=new URL('../../../outputs/01a125f7-847d-73b1-8cb7-7351c4b49628/',import.meta.url);
const target=new URL('雷鸟iO开发里程碑.xlsx',output);
// This one-off, explicitly requested comparison imports the existing snapshot.
// No build, progress report or automation should invoke this manual operation.
if(process.argv.includes('--update-0.1.45')){
 const original=await fs.readFile(target);
 const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(target)));
 const sheet=workbook.worksheets.getItem('开发里程碑');
 if(sheet.getRange('E4').values[0][0]!=='0.1.39'||sheet.getRange('G6').values[0][0])throw new Error('EXPECTED_UNEDITED_0_1_39_SNAPSHOT');
 const prior=JSON.stringify(sheet.getRange('A7:F22').values);
 const priorFormulas=JSON.stringify(sheet.getRange('A7:F22').formulas);
 const deltas=[
  '本次无新增。基线与复用清单保持完成，功能回归继续。',
  '本次无新增真机结论。任意多选、按钮文案和结果动画仍待验证。',
  '本次无新增会话验收。真实模型任务及重启后原等待点恢复仍待验证。',
  '本次无页面重写。设计方案仍待评审。',
  '本次无契约变更。后续实现继续按三组契约分别验收。',
  '新增真机验证：新采集文字已写入带版本资料，七窗覆盖、原音摘要和正文一致性通过。正式资料页面及完整日常链路仍待验收。',
  '新增真机验证：熄屏收音期间已产出文字，61.92秒原音七窗完整转写。修复等待音频页误清PCM及预算到期唤醒。8小时、未充电功耗及间歇零帧仍未通过。',
  '本次无新增说话人验收。新转写仍标记待处理，双人区分与身份识别未验证。',
  '本次无正式页面交付。官方 BASE-01–10 逐项对齐仍待验收。',
  '本次无云端部署。服务器维持本机通过，腾讯云 HTTPS、原音归档和容量仍待验证。',
  '新增手机持久队列、历史修订发现、过期先查账再换发和账户隔离。真机重启及旧账本升级通过。真机 HTTPS 传输、正式调度与原音上传尚未完成。',
  '已开始 P33 查询接口核对，尚无新增查询工具或 skill 交付。真实办公消息综合分析未开始。',
  '本次无新增交付。常驻连接、原会话路由及恢复对账仍待开发。',
  '本次无新增闭环验收。眼镜问题、用户答案到原任务的端到端链路仍待开发。',
  '本次无新增委托验收。指定电脑 Agent、会话委托及反馈仍待开发。',
  '新增隔离实验资料覆盖升级后保留的证据。完整官方功能、全天功耗和多设备正式验收尚未开始。'
 ];
 sheet.getRange('A3').values=[['上次快照']];
 sheet.getRange('D3').values=[['本次更新']];
 sheet.getRange('E3').values=[[new Date('2026-10-11T00:00:00Z')]];
 sheet.getRange('E3').setNumberFormat('yyyy-mm-dd');
 sheet.getRange('A4').values=[['版本对比']];
 sheet.getRange('B4').values=[['0.1.39 至 0.1.45']];
 sheet.getRange('D4').values=[['当前推进']];
 sheet.getRange('E4').values=[['P22 调度验证 / P33 查询工具启动']];
 sheet.getRange('D6:G6').values=[['上次状态','上次已经达到','上次待完成或验证','本次进度']];
 sheet.getRange('G7:G22').values=deltas.map(text=>[text]);
 // Recreate only this extended table through the documented API, retaining
 // its name, style, filter/totals/banding settings and all historical cells.
 const table=sheet.tables.items[0];
 const settings={name:table.name,style:table.style,showTotals:table.showTotals,showBandedColumns:table.showBandedColumns,showFilterButton:table.showFilterButton};
 table.delete();
 const extended=sheet.tables.add('A6:G22',true,settings.name);
 if(settings.style)extended.style=settings.style;
 extended.showTotals=settings.showTotals;
 extended.showBandedColumns=settings.showBandedColumns;
 extended.showFilterButton=settings.showFilterButton;
 sheet.getRange('G6:G22').format.font={name:'Arial',size:11,color:'#243746'};
 sheet.getRange('G6:G22').format.columnWidthPx=430;
 sheet.getRange('G6:G22').format.wrapText=true;
 sheet.getRange('G6:G22').format.verticalAlignment='center';
 sheet.getRange('G7:G22').format.horizontalAlignment='left';
 sheet.getRange('G6').format={fill:'#243746',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},horizontalAlignment:'center',verticalAlignment:'center'};
 sheet.getRange('G2').format.borders={bottom:{style:'thin',color:'#9AA7B2'}};
 for(const [row,height] of [[12,70],[13,86],[17,86],[18,64],[22,64]])sheet.getRange(`A${row}:G${row}`).format.rowHeight=height;
 workbook.recalculate();
 if(JSON.stringify(sheet.getRange('A7:F22').values)!==prior||JSON.stringify(sheet.getRange('A7:F22').formulas)!==priorFormulas)throw new Error('HISTORICAL_SNAPSHOT_CHANGED');
 const inspection=await workbook.inspect({kind:'table',range:'开发里程碑!A2:G22',include:'values,formulas',tableMaxRows:22,tableMaxCols:7,maxChars:16000});
 await fs.writeFile(new URL('inspection.ndjson',output),inspection.ndjson);
 const errors=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},summary:'formula errors'});
 await fs.writeFile(new URL('formula-scan.ndjson',output),errors.ndjson);
 const preview=await workbook.render({sheetName:'开发里程碑',range:'A1:G22',scale:1.25,format:'png'});
 await fs.writeFile(new URL('preview.png',output),new Uint8Array(await preview.arrayBuffer()));
 if(!original.equals(await fs.readFile(target)))throw new Error('WORKBOOK_CHANGED_DURING_EDIT');
 const xlsx=await SpreadsheetFile.exportXlsx(workbook);
 await xlsx.save(fileURLToPath(target));
 const reopened=await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(target)));
 const saved=reopened.worksheets.getItem('开发里程碑');
 if(JSON.stringify(saved.getRange('A7:F22').values)!==prior||JSON.stringify(saved.getRange('G7:G22').values)!==JSON.stringify(deltas.map(text=>[text])))throw new Error('EXPORTED_COMPARISON_MISMATCH');
 process.stdout.write(JSON.stringify({output:fileURLToPath(target),milestones:deltas.length,previousVersion:'0.1.39',currentVersion:'0.1.45',historicalCellsPreserved:true,sha256:createHash('sha256').update(await fs.readFile(target)).digest('hex')})+'\n');
 process.exit(0);
}
try{await fs.access(target);throw new Error('EXISTING_TRACKER_REQUIRES_AUTHORIZED_EDIT');}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.mkdir(output,{recursive:true});
const rows=[
 ['M01','P00–P02','基线与复用清单','已完成','已登记源码、安装包、官方差距与可复用能力','后续功能仍需逐项回归'],
 ['M02','P10','原厂建议卡与旋钮','部分真机通过','旋转换选项、短按当前项、点头添加、摇头删除','任意多选、按钮文案与结果动画仍未证实'],
 ['M03','P11','Hermes 会话接入','部分验证通过','真实接口已验证指定会话问答、忙时、重连和取消','重启后原等待点恢复、真实模型任务待验'],
 ['M04','P13','鸿蒙页面设计','待评审','已有设计稿，尚未批量重写页面','视觉方案确认后实施正式页面'],
 ['M05','P14','三组接口契约','已完成','资料修订、消息回执、任务请求答案已有契约与样例','后续实现按契约分别验收'],
 ['M06','P20–P21','资料模型与修订','部分真机通过','历史全文、覆盖状态、更正、墓碑与重启恢复已验证','合成资料已真机验证，真实日常链路仍需回归'],
 ['M07','P22','后台持续转写','开发中','已实现白天分窗、预算调度、断点和 PCM 复用','新采集曾出现零帧，连续 8 小时和功耗未通过'],
 ['M08','P23','段内说话人区分','待完善','保留匿名标签、未知和待处理状态','双人段内准确率、人工校正和“我”的识别待验'],
 ['M09','P24–P25','资料页面与官方基础','开发中','复用已有录音和多项硬件设置能力','资料页面完善，官方 BASE-01–10 逐项对齐'],
 ['M10','P30','服务器资料服务','本机通过','真实落盘、鉴权、查询、去重、崩溃恢复及备份通过','腾讯云部署、HTTPS、原音归档和容量待验'],
 ['M11','P31–P32','手机增量同步','开发中','持久队列核心、重启对账和本机 HTTP 联测通过','尚未接正式手机网络调度、凭据轮换和原音上传'],
 ['M12','P33–P34','Agent 查询日常资料','未完成','服务已有文字、时间和说话人查询接口','查询工具与 skill、真实办公消息综合分析待做'],
 ['M13','P40–P44','电脑常驻连接与路由','未完成','Hermes 接口验证可复用','持久消息队列、原会话路由和恢复对账待做'],
 ['M14','P50–P54','眼镜提问与回答','未完成','原厂二态卡实验可复用','问题到原任务的端到端闭环、语音和多选待做'],
 ['M15','P60–P63','眼镜语音委托任务','未完成','已有收音和转写能力可复用','指定电脑、Agent 与会话委托及反馈待做'],
 ['M16','P70–P74','正式替代验收','未开始','尚未通过完整 PRD 正式验收','官方功能、全天稳定性、功耗、多设备及升级验收']
];
const workbook=Workbook.create(),sheet=workbook.worksheets.add('开发里程碑');sheet.showGridLines=false;sheet.tabColor='#243746';
sheet.getRange('A2').values=[['雷鸟 iO 开发里程碑']];
sheet.getRange('A3').values=[['进度截至']];sheet.getRange('B3').values=[[new Date('2026-10-11T00:00:00Z')]];sheet.getRange('B3').setNumberFormat('yyyy-mm-dd');
sheet.getRange('D3').values=[['验收口径']];sheet.getRange('E3').values=[['代码、本机、真机、端到端分开记录']];
sheet.getRange('A4').values=[['当前开发']];sheet.getRange('B4').values=[['P31 手机持久同步']];sheet.getRange('D4').values=[['手机版本']];sheet.getRange('E4').values=[['0.1.39']];
sheet.getRange('A6:F6').values=[['编号','任务范围','里程碑','当前状态','已经达到','尚待完成或验证']];sheet.getRange('A7:F22').values=rows;
sheet.tables.add('A6:F22',true,'MilestoneTable');
sheet.getRange('A2:F22').format.font={name:'Arial',size:11,color:'#243746'};
sheet.getRange('A2:F22').format.verticalAlignment='center';sheet.getRange('A2:F22').format.rowHeight=24;
sheet.getRange('A2').format.font={name:'Arial',size:16,bold:true,color:'#243746'};
sheet.getRange('A2:F2').format.rowHeight=32;sheet.getRange('A2:F2').format.borders={bottom:{style:'thin',color:'#9AA7B2'}};
sheet.getRange('A3:F4').format.font={name:'Arial',size:10,color:'#52616D'};
sheet.getRange('A6:F6').format={fill:'#243746',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},horizontalAlignment:'center',verticalAlignment:'center',rowHeight:28};
sheet.getRange('A7:F22').format.rowHeight=50;sheet.getRange('A7:F22').format.wrapText=true;
sheet.getRange('A7:D22').format.horizontalAlignment='left';sheet.getRange('E7:F22').format.verticalAlignment='center';
for(const [column,width] of [['A',70],['B',145],['C',185],['D',130],['E',340],['F',340]])sheet.getRange(`${column}2:${column}22`).format.columnWidthPx=width;
const states={已完成:['#E5F1E9','#245B39'],本机通过:['#E3EDF8','#214F82'],部分真机通过:['#FFF0D8','#865600'],部分验证通过:['#FFF0D8','#865600'],开发中:['#E3EDF8','#214F82'],待完善:['#FFF0D8','#865600'],待评审:['#EEE6F5','#62427D'],未完成:['#EEF0F2','#64717C'],未开始:['#EEF0F2','#64717C']};
for(const [state,[fill,color]] of Object.entries(states))sheet.getRange('D7:D22').conditionalFormats.addCustom(`$D7="${state}"`,{fill,font:{color,bold:true}});
sheet.freezePanes.freezeRows(6);
workbook.recalculate();
const inspect=await workbook.inspect({kind:'table',range:'开发里程碑!A2:F22',include:'values,formulas',tableMaxRows:22,tableMaxCols:6,maxChars:16000});
await fs.writeFile(new URL('inspection.ndjson',output),inspect.ndjson);
const errors=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},summary:'formula errors'});
await fs.writeFile(new URL('formula-scan.ndjson',output),errors.ndjson);
const preview=await workbook.render({sheetName:'开发里程碑',range:'A1:F22',scale:1.5,format:'png'});
await fs.writeFile(new URL('preview.png',output),new Uint8Array(await preview.arrayBuffer()));
const xlsx=await SpreadsheetFile.exportXlsx(workbook);await xlsx.save(fileURLToPath(target));
process.stdout.write(JSON.stringify({output:fileURLToPath(target),milestones:rows.length})+'\n');
