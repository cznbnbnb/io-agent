import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {FileBlob,SpreadsheetFile,Workbook} from '@oai/artifact-tool';

// Manual capability snapshot only. Never operates the phone, cloud, or App.
const root=fileURLToPath(new URL('../../../',import.meta.url));
const relative='outputs/01a125f7-847d-73b1-8cb7-7351c4b49628/雷鸟iO开发里程碑.xlsx';
const target=path.join(root,relative),output=path.dirname(target);
const phase=path.join(root,'rebuild/phase1');
const runtime='C:/Users/LENOVO/.cache/codex-runtimes/codex-primary-runtime/dependencies';
const git=path.join(runtime,'native/git/cmd/git.exe');
const python=path.join(runtime,'python/python.exe');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const sourceHead=execFileSync(git,['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const baselineRef='6cee04c3808534c2c0392284518a194d469083d3';
const baseline=execFileSync(git,['show',baselineRef+':'+relative],{cwd:root,maxBuffer:2*1024*1024});
assert.equal(sha(baseline),'a616da1bcaf1463bec58bc770c629a685d8f824516c6a01aa28fa3f8dcbf79bf','Expected 0.1.62 workbook baseline');
const original=await fs.readFile(target);
const before=await SpreadsheetFile.importXlsx(baseline);
const prior=before.worksheets.getItemAt(0);
assert.equal(prior.getRange('H6').values[0][0],'本次进度（0.1.62）');
if(process.argv.includes('--inspect')){
  console.log((await before.inspect({kind:'workbook,sheet,table',maxChars:1800,tableMaxRows:2,tableMaxCols:3})).ndjson);
  const preview=await before.render({sheetName:prior.name,range:'G6:I22',scale:1,format:'png'});
  await fs.writeFile(path.join(output,'global-capabilities-before-2026-10-14.png'),new Uint8Array(await preview.arrayBuffer()));
  console.log(JSON.stringify({baselineSha256:sha(baseline),previousVersion:'0.1.62',sheets:1}));
  process.exit(0);
}
assert(process.argv.includes('--apply'),'EXPLICIT_APPLY_REQUIRED');
const app=await json(path.join(root,'rebuild/harmony-sdk/AppScope/app.json5'));
const install=await json(path.join(phase,'device-private/summary063-install-ledger.json'));
const build=await json(path.join(phase,'journal-summary063-build-2026-10-14.json'));
assert.equal(app.app.versionName,'0.1.63');assert.equal(install.version_code,10063);
assert.equal(install.hap_sha256,build.signed_hap_sha256);
assert.equal(build.full_app_tests_passed,842);
const canonical=await json(path.join(phase,'device-private/reload062-retained-revision.bin'));
const actualExport=await json(path.join(phase,'device-private/summary063-r10-export.json'));
assert.deepEqual(actualExport,canonical);
const actualMD=await fs.readFile(path.join(phase,'device-private/summary063-r10-export.md'),'utf8');
assert(actualMD.includes(canonical.text)&&actualMD.includes('资料修订：10；文字修订：9'));
const standard=(group,feature,requirement,ability,state,evidence,gap,percent)=>
  [group,feature,requirement,ability,ability,state,evidence,gap,percent,percent];
// Percentages are retrospective, coarse estimates for these newly separated
// functional scopes. They are not the old milestone scores or acceptance rates.
const rows=[
  standard('连接与设备','眼镜连接与重连','BASE-01 / P20','可连接已保存眼镜、核对身份并重连；地址变更后经认证和状态回读更新保存。','部分可用','实际连接、认证和冷启重连有记录。','首次配对、权限拒绝、长断线及全部异常恢复待逐项验收。',85),
  standard('连接与设备','电量与硬件设置','BASE-02 / P25','可读取设备状态；大部分设置接口已有实现，可复用已调通项目。','部分可用','用户确认大部分接口可调；部分值已回读。','亮度、唤醒、头势、显示等逐项动作与失败反馈尚未全部验收。',70),
  standard('连接与设备','眼镜时间同步','BASE-02','可向眼镜发送正确类型的 UTC 校时字段与时区；已解决八小时偏差。','已验证可用','用户确认镜片时间与手机一致。','其他时区、夏令时、长期漂移及失败重试待验。',90),
  standard('录音与转写','主动录音起停和归档','BASE-03 / P20','既有录音链可起停、接收并保存原音；录音与智记共用资料基础。','部分可用','用户确认既有录音；短时采音与封口实测。','新增调度后的普通录音、助手抢占、切页和长期无回退验收待补。',85),
  standard('录音与转写','原音回放和音频导出','BASE-03 / P24','保留原始音频，已有 WAV/OGG 导出及回放入口；主动录音 WAV 保留双声道。','部分可用','音频封装和原件哈希有实测；已有入口复用。','全部普通回放、跳转时间点和导出目标文件读回待逐项验证。',70),
  standard('录音与转写','手动转写和资料发布','P21–P24','可在普通页调用本机模型转写智记；主动录音有配置后的云转写入口，结果建立资料修订。','部分可用','普通智记合成样本实际模型产字并持久化。','主动录音云转写普通页、真实准确率和完整失败恢复仍待验。',85),
  standard('录音与转写','智记持续采集与熄屏产字','BASE-04 / P22','已实现分窗转写、保留原音和处理预算；短时熄屏采集中可产生文字，不要求只在充电时产字。','部分可用','短时充电熄屏实测；原音和转写范围独立核对。','未充电功耗、八小时、平台后台资格、长断线及助手共存待验。',65),
  standard('录音与转写','转写积压与重启恢复','P22','已有耐久作业、窗口检查点、重试和预算；能继续处理未完成的同一段，不重开采集。','部分可用','同段尾窗恢复和队列清空有真机记录。','真实日常长积压、低电/热限、系统回收及普通页恢复待验。',80),
  standard('录音与转写','静音筛选与多段合批','P22','手机既有 VAD 会筛掉明显非语音；多段拼批有桌面原型及原音时间映射、失败回退检查。','仅实验可用','桌面真实模型对照；拼接间隔落词需回退。','合批尚未接入正式手机路径；不能宣称已交付加速或准确率提升。',45),
  standard('录音与转写','左右声道分别识别','P12 / P23','主动录音可保留双声道；隔离入口可分别识别左、右及混合声道。','仅实验可用','个人朗读左强、环境音右强的单项观察。','正式音轨选择、智记原始声道及硬件来源待验；声道不能直接代表身份。',55),
  standard('说话人与文字','自动段内说话人区分','P23 / AC-SPK','模型可输出匿名说话人簇；短窗文字可标明说话人分析待处理及未知归属。','代码待验','单人样本及组件结果；无真实双人准确率验收。','至少20段真实样本、双人归属90%门槛、重叠发言和精修待验。',45),
  standard('说话人与文字','人工更正文字和说话人','P23','普通页可改名、改字、拆句、设未知、重分配、合并及人工标记本人；建立修订并保留原ASR。','部分可用','七类人工操作真机第4–10版；冷启、云字典与拆句引用核对。','跨修订确认弹窗真机竞态、更多真实资料和可用性体验待验。',90),
  standard('说话人与文字','自动识别“我”','P23 / AC-SPK','可由用户明确人工标记本人；已有角色候选基础，自动本人身份尚不能可靠确认。','尚未可用','人工本人标记已实测；不等于自动识别。','可靠身份依据、串音/多人/跨会话验证；不能靠左右声道直接定身份。',20),
  standard('资料与总结','稳定资料ID和修订历史','P21 / P32','资料有稳定ID、资料/文字修订和删除标记；校正与转写保留可追溯历史，不覆盖原音和原ASR。','已验证可用','普通页修订、不同进程冷启及服务器读回有记录。','更广历史兼容、容量和所有异常迁移场景继续验收。',95),
  standard('资料与总结','时间线和原文查看','P24','可按日期查看录音与智记时间线，在普通页打开最新文字和当前说话人标签。','部分可用','第10版普通页正文精确读回；校正后渲染已验证。','与原音逐句跳转、完整历史筛选和所有来源的详情体验待补。',80),
  ['资料与总结','MD和JSON文字导出','P24','可生成带资料ID和修订的MD/JSON；系统保存流程有历史实测，最新校正版本的普通页导出尚待核对。',
    '普通页可导出第10版MD/JSON；App内生成内容与该修订一致，系统保存返回成功。',
    '部分可用','专用合成资料普通页保存；App内源文件已读回比对。','系统目标文件尚未独立读回；缺原音、历史资料及大文件继续验收。',75,85],
  ['资料与总结','每日汇总和AI总结','BASE-04 / P24','可合并当日录音与智记并请求AI总结；历史文件日期、总时长和生成期间来源变化存在缺口。',
    '可构造带时间轴、覆盖范围和修订引用的日汇总；历史日期和数学时长已修正，可请求AI总结。',
    '部分可用','组件与真实编译通过；历史日已打开保存选择器，最终保存未完成。','真机AI及最终保存、历史总结读取/编辑、总结结构、缓存和关联去重未完成。',45,55],
  ['资料与总结','总结与来源版本一致','P24','生成摘要时使用原输入，但返回后可能读取新正文；导出仍复用会被日缓存更新覆盖的文件。',
    '代码冻结来源ID与资料/文字修订，拒绝过时摘要；导出使用内容摘要命名的独立快照。',
    '代码待验','实际页面/服务方法回归和编译安装通过。','真机AI期间更正/删除、前后台切换与选择器等待期间缓存更新仍待验。',20,65],
  standard('资料与总结','App资料筛选','P24','能选择日期查看记录；电脑查询工具支持更多检索条件，手机完整筛选界面尚未形成。','部分可用','日期选择普通页可用。','手机时间段、关键词、说话人和项目标签组合筛选待实现。',35),
  standard('资料与总结','智记删除与云端撤回','P21 / P24 / P32','普通智记删除先保存同ID墓碑，再清理原件；收到云存储确认后查询返回删除状态，冷启不复活。','已验证可用','专用合成记录手机删除、云410/撤回及冷启通过。','真实长期资料、清理失败恢复及更多来源组合继续验收。',90),
  standard('资料与总结','主动录音删除','BASE-03 / P24','录音删除已接墓碑、来源清理与选中详情保护；不让迟到转写复活被删除记录。','代码待验','组件/真实文件回归通过；录音页独立真机出口未关闭。','普通录音页删除至云端、重启、清理失败及取消等真机验收。',75),
  standard('资料与总结','原音缺失时保留文字','P21 / P24','资料把文字、音频可用性和完整性分开；缺原音仍可保留文字，汇总与导出代码支持该场景。','代码待验','组件和兼容边界回归；无原音文字样本可构造。','正常页缺原音查看/导出及不能回放提示需真机验证。',75),
  standard('资料与云服务','自有服务器文字资料','P30','腾讯云已部署资料1.2文本服务，可保存修订和墓碑，并按权限查询、分页及增量获取。','已验证可用','正式手机合成修订/删除至公网及真实CLI读回。','原音归档、容量、自动凭据轮换和持续运维待完成。',90),
  standard('资料与云服务','手机前台文字增量同步','P31–P32','正式资料配置可登记并明确开启；手机将同ID修订排队发送，持久化服务器存储回执。','部分可用','普通手机第1–10版、删除、不同PID配置/账本恢复。','有效文件的系统选择器导入、新配置断网和真实日常持续同步待验。',90),
  standard('资料与云服务','解锁回前台自动恢复','P31','锁屏导致凭据暂不可读后，回前台可有界重试并恢复同步，撤销旧错误提示，不必再次保存。','已验证可用','三轮真实锁屏/解锁、同PID自动恢复。','不证明熄屏持续公网同步；原生保存/重建竞态及新消息恢复待验。',90),
  standard('资料与云服务','离线积压与后台联网','P12 / P31','队列和游标可持久化；隔离手机断网补传和短时熄屏联网有证据，正式后台持续上传未验。','部分可用','隔离恢复、普通配置冷启；短时后台HTTP为实验。','正式配置物理断网、丢回包、后台资格和长期积压恢复待验。',65),
  standard('资料与云服务','自有服务器原音归档','P30–P32','原音在手机可靠保存并可导出；自有资料服务器尚无已交付的原音校验上传与云回放闭环。','尚未可用','已有本地原音与通用上传基础；非云归档验收。','独立音频上传队列、校验、网络策略、存储确认、下载和回放。',15),
  standard('资料与云服务','服务器任务和消息中转','P14 / P40','服务器耐久保存任务、问题、答案、消息和回执；支持首答竞争、去重及离线收件游标，各交付阶段分别表示。','部分可用','云队列回归与真实电脑/Hermes公网问答；手机角色由电脑代发。','正常手机首答竞争、各端硬崩溃与长离线验收；存储成功不能代表镜片显示或任务完成。',90),
  standard('电脑与Agent','资料查询CLI','P33','电脑可检索资料、取原文和获取增量，返回资料版本、说话人字典和拆句来源引用。','已验证可用','真实CLI读回普通手机的1.2修订和删除。','真实日常持续资料及正式Hermes skill调用仍需分别验收。',90),
  standard('电脑与Agent','Hermes查询和办公分析','P33–P34','查询工具和skill说明已有；尚未完成Hermes查询真实日常对话并结合办公消息分析、回存。','尚未可用','工具前提具备；正式skill及综合分析未验。','正式查询身份、实际skill调用、双方来源引用及10组人工标注分析用例。',25),
  standard('电脑与Agent','指定Hermes会话问答','P11 / P42','固定CLI在登记的独占会话可提问、等答案、继续原任务；真实模型可排队和取消。','已验证可用','电脑至真实云及模型实验；手机角色由电脑代发。','正式路由身份、既有任意CLI/TUI等待栈和运行中崩溃恢复未支持验收。',85),
  standard('电脑与Agent','电脑常驻连接程序','P41','程序已有耐久出箱、去重、游标和对账；可出站连接云服务，实验队列能离线恢复及正常重启。','部分可用','本机和公网实验；结清后重启。','正式生产登记、长时间常驻、运行中硬崩溃和异常状态恢复待验。',80),
  standard('电脑与Agent','手机发任务和回答','P43','手机任务/待答页和配置入口已有代码，默认关闭；实际手机到正式Hermes原任务的闭环未验。','代码待验','手机默认关闭态有记录；端到端手机角色仍由电脑测试代发。','手机真实委托、提问、回答、原任务继续、结果返回及首答竞争。',50),
  standard('电脑与Agent','取消、期限和执行不明','P44','云队列及实验会话支持取消、过期和去重；无法证明执行结果时保留不明，不报假完成。','部分可用','真实模型取消和队列过期；不明恢复部分为合成对账。','正式手机生命周期、真实模型期限策略和硬崩溃后的原工具栈恢复。',75),
  standard('眼镜任务交互','原厂建议卡与旋钮','P10 / P51–P52','实验卡标题/正文可自定义；旋转换焦点、短按当前项，点头固定添加、摇头固定删除。','仅实验可用','用户镜片观察及操作回传；实验不创建待办或执行任务。','按钮固定添加/删除；任意多选、自定义按钮和结果动画未验证。',60),
  standard('眼镜任务交互','Agent通过眼镜提问','P50–P54','电脑问答和原厂二态卡原语已有；正式问题到镜片、答案回原任务的共享链尚未打通。','尚未可用','仅各段独立实验，不能算完整闭环。','请求与卡UID绑定、正式显示与回答、稍后/撤回/过期及占用共存。',20),
  standard('眼镜任务交互','眼镜语音回复和委托','P53 / P60–P63','既有眼镜收音与手机识别可复用；语音答案和新委托尚未可靠路由至指定电脑任务。','尚未可用','无正式眼镜语音任务端到端验收。','活动问题/新任务分流、附加条件、目标澄清、取消与镜片结果反馈。',5),
  standard('官方基础体验','AI助手基础体验','BASE-05 / P25','已有眼镜唤起、收音、手机模型问答和显示的复用链；与智记暂停恢复的代码存在。','部分可用','既有用户确认；当前完整助手流程未逐项回归。','正式参考版手势、继续/退出、错误恢复及录音/智记共存待验。',55),
  standard('官方基础体验','看板、日程和待办','BASE-06 / P25','本地工作区、待办页与设备同步已有代码；旧待办卡显示有用户记录。','部分可用','旧镜片卡片；建议卡实验不等于新增真实待办。','当前普通页完整增改完删、日程/看板范围、离线与重连一致性。',45),
  standard('官方基础体验','提词器','BASE-08 / P25','已有文稿、传输和开始/控制代码，列表与业务握手已作修正。','代码待验','组件通过；当前整套镜片控制未验。','正常传稿、镜片菜单、滚动/暂停/退出、设备反馈及异常恢复。',50),
  standard('官方基础体验','实时字幕和翻译','BASE-07 / P25','有显示与语音协议资料可复用，尚无完整已验证的字幕/翻译产品流程。','尚未可用','没有当前官方对齐证据。','模式、语言和服务权益、鸿蒙入口、开始/结束、镜片展示及断网反馈。',15),
  standard('官方基础体验','手机系统通知及回复','BASE-09 / P25','App内手动通知基础已有；手机系统通知订阅转发和完整回复尚未接通。','尚未可用','旧手动通知观察；不等于系统通知转发。','鸿蒙资格与授权、来源筛选、勿扰、来电/消息、回复及撤回。',10),
  standard('官方基础体验','导航、天气和文字看板','BASE-06 / P25','有地图/导航、天气配置和文字卡基础；旧模拟导航可显示，当前真实定位闭环未验。','代码待验','历史模拟或局部接口；不能当实际导航或真实天气通过。','地图显示、真实GNSS、偏航/到达、天气来源和镜片更新。',40),
  standard('服务器与维护','后台管理和流量查看','P30 / P40','已部署后台页面及受鉴权保护的统计API，可区分生产方请求/响应正文流量。','部分可用','公网页面/API核验；流量中的手机角色曾为电脑代发。','正常登录浏览器交互、真实手机长期流量；不代表TLS开销或云计费总流量。',70),
  standard('服务器与维护','鸿蒙设计与多设备','P13 / P73','已有设计草案；目前沿用既有页面做局部修正，视觉体系尚未定稿。','待评审','草案，未批量视觉验收。','设计确认、深浅色、大字、折叠切换、材质降级及其他设备形态。',30),
  standard('服务器与维护','隐私、账户、固件维护','BASE-10 / P25','保留原厂固件和既有绑定；设置及私有配置可复用，完整维护/账户/备份路径尚未形成。','部分可用','部分设置和配置；无完整维护对照。','官方实际存在的激活、升级、账户权益、隐私、帮助和备份迁移逐项核对。',25),
  standard('服务器与维护','覆盖升级与资料保留','P74','可通过DevEco签名覆盖安装，保留绑定、配置及既有资料。','部分可用','多轮覆盖安装及部分资料/账本冷启保持；本批导出修订未改变。','全部历史兼容、原音完整核对、正式升级/回退与异常安装验收。',75),
  standard('正式交付','全天稳定性与功耗','P71–P72 / AC-MEM','已有短时熄屏采集、转写、联网和解锁恢复证据；尚不能认定全天或正式替代可用。','尚未可用','短时单项；没有八小时与官方功耗对照。','八小时佩戴、未充电功耗/温度/时效、所有BASE、多设备及任务闭环。',15)
];
assert.equal(rows.length,48);
const statuses=['已验证可用','部分可用','仅实验可用','代码待验','尚未可用','待评审'];
for(const row of rows){
  assert.equal(row.length,10);assert(statuses.includes(row[5]));
  assert(row[3].length>15&&row[4].length>15&&row[6]&&row[7]);
  assert(!/无新增|本次新增|本版本新增|同上/.test(row[3]+row[4]));
  assert(Number.isInteger(row[8])&&row[8]>=0&&row[8]<=100&&row[9]>=row[8]&&row[9]<=100);
}
const workbook=Workbook.create(),sheet=workbook.worksheets.add('全局功能能力');
sheet.showGridLines=false;
const first=8,last=first+rows.length-1;
const headers=['编号','功能分组','功能','需求/计划','上一版能做到什么\n0.1.62','当前能做到什么\n0.1.63','当前可用性','已验证范围','仍缺什么/下一步','上一版程度\n回溯粗估','当前程度\n粗估'];
const values=rows.map((r,i)=>['F'+String(i+1).padStart(2,'0'),...r.slice(0,8),r[8]/100,r[9]/100]);
sheet.getRange('A7:K7').values=[headers];sheet.getRange('A8:K'+last).values=values;
sheet.getRange('A2').values=[['雷鸟 iO 全局功能能力']];
sheet.getRange('A3').values=[['上一版']];
sheet.getRange('C3').values=[['0.1.62 已安装、已提交']];
sheet.getRange('E3').values=[['当前：0.1.63 已安装，代码未提交']];
sheet.getRange('A4').values=[['截至']];
const utc=new Date(),wall=new Date(utc.getTime()+8*3600000);
sheet.getRange('C4').values=[[wall.getTime()/86400000+25569]];sheet.getRange('C4').setNumberFormat('yyyy-mm-dd hh:mm');
sheet.getRange('E4').values=[['上一版按相同功能范围回溯；本表列累计能力，不列版本更新日志。']];
sheet.getRange('E5').values=[['程度是分项开发粗估，不能当可用率或整份PRD完成率。正式替代尚未达标。']];
sheet.getRange('A6').values=[['依据：PRD、开发计划/状态、各批验收记录及0.1.63实际构建/安装记录。']];
sheet.getRange('A1:K'+last).format.font={name:'Arial',size:10,color:'#233746'};
sheet.getRange('A2:K2').format.rowHeight=27;sheet.getRange('A2').format.font={size:16,bold:true,color:'#233746'};
sheet.getRange('A2:K2').format.borders={preset:'doubleBottom',style:'thin',color:'#AAB8C4'};
sheet.getRange('A3:K5').format.rowHeight=22;sheet.getRange('A6:K6').format.rowHeight=26;
sheet.getRange('A3:D5').format.font={size:10,color:'#526777'};
sheet.getRange('E3').format.font={bold:true,color:'#233746'};
sheet.getRange('E5').format.font={color:'#9A5700'};
sheet.getRange('A6:K6').format.font={size:10,color:'#526777'};
sheet.getRange('A7:K7').format={fill:'#233746',font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},wrapText:true,horizontalAlignment:'center',verticalAlignment:'center'};
sheet.getRange('A7:K7').format.rowHeight=39;
sheet.getRange('A8:K'+last).format.rowHeight=70;
sheet.getRange('A8:K'+last).format.verticalAlignment='center';
sheet.getRange('B8:I'+last).format.wrapText=true;
sheet.getRange('A8:D'+last).format.font={color:'#526777',size:10};
sheet.getRange('E8:F'+last).format.font={color:'#233746',size:10};
sheet.getRange('G8:G'+last).format.horizontalAlignment='center';
sheet.getRange('J8:K'+last).format.horizontalAlignment='right';
sheet.getRange('J8:K'+last).setNumberFormat('0%');
const widths=[7,13,22,15,44,44,14,27,43,12,12];
for(let i=0;i<widths.length;i++)sheet.getRangeByIndexes(0,i,last,1).format.columnWidth=widths[i];
// Resizing is bounded to this redesigned table. No unrelated sheet exists.
const table=sheet.tables.add('A7:K'+last,true,'GlobalCapabilities');
table.style='TableStyleLight9';table.showBandedColumns=false;table.showFilterButton=true;
for(let i=0;i<rows.length;i++){
  const row=first+i;
  if(i%2===0)sheet.getRange('A'+row+':K'+row).format.fill='#EFF4F8';
  if(i===0||rows[i-1][0]!==rows[i][0]){
    sheet.getRange('A'+row+':K'+row).format.borders={top:{style:'thin',color:'#9AADB9'}};
    sheet.getRange('B'+row).format.font={bold:true,color:'#233746',size:10};
  }
  if(Math.max(rows[i][3].length,rows[i][4].length,rows[i][6].length,rows[i][7].length)>88)sheet.getRange('A'+row+':K'+row).format.rowHeight=84;
}
sheet.getRange('J8:J'+last).conditionalFormats.add('dataBar',{color:'#B6C3CF',thresholds:[0,1],gradient:false});
sheet.getRange('K8:K'+last).conditionalFormats.add('dataBar',{color:'#80B3D6',thresholds:[0,1],gradient:false});
const colors={'已验证可用':['#E4F2E8','#215A36'],'部分可用':['#FFF2D5','#855512'],'仅实验可用':['#E6EEF8','#345D88'],'代码待验':['#ECEEF3','#505D74'],'尚未可用':['#F9E8E6','#913D35'],'待评审':['#EFE8F6','#6C4F83']};
for(const [status,[fill,color]]of Object.entries(colors))sheet.getRange('G8:G'+last).conditionalFormats.addCustom('$G8="'+status+'"',{fill,font:{color}});
sheet.freezePanes.freezeRows(7);sheet.freezePanes.freezeColumns(3);
workbook.recalculate();
assert.deepEqual(sheet.getRange('A8:K'+last).values,values);
const errors=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30}});
await fs.writeFile(path.join(output,'global-capabilities-error-scan-2026-10-14.ndjson'),errors.ndjson);
await fs.writeFile(path.join(output,'global-capabilities-inspection-2026-10-14.ndjson'),(await workbook.inspect({kind:'table',range:'全局功能能力!A7:K'+last,include:'values,formulas',tableMaxRows:rows.length+1,tableMaxCols:11,maxChars:26000})).ndjson);
assert(original.equals(await fs.readFile(target)),'WORKBOOK_CHANGED_DURING_EDIT');
await(await SpreadsheetFile.exportXlsx(workbook)).save(target);
const reader=[
 'import sys,json,zipfile,xml.etree.ElementTree as E',
 'N={"s":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}',
 'with zipfile.ZipFile(sys.argv[1]) as z:',
 ' s=E.fromstring(z.read("xl/worksheets/sheet1.xml"));t=E.fromstring(z.read("xl/tables/table1.xml"));b=E.fromstring(z.read("xl/workbook.xml"))',
 ' p=s.find("s:sheetViews/s:sheetView/s:pane",N)',
 ' bars=[{"range":c.get("sqref"),"values":[v.attrib for v in c.findall("s:cfRule/s:dataBar/s:cfvo",N)]} for c in s.findall("s:conditionalFormatting",N) if c.find("s:cfRule/s:dataBar",N) is not None]',
 ' print(json.dumps({"sheets":[x.get("name") for x in b.findall("s:sheets/s:sheet",N)],"table_name":t.get("name"),"table_ref":t.get("ref"),"table_filter":t.find("s:autoFilter",N) is not None,"headers":[x.get("name") for x in t.findall("s:tableColumns/s:tableColumn",N)],"bars":bars,"pane":p.attrib if p is not None else None,"excel_errors":[c.get("r") for c in s.findall(".//s:c",N) if c.get("t")=="e"]}))'
].join('\n');
const native=JSON.parse(execFileSync(python,['-c',reader,target],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}}));
assert.deepEqual(native.sheets,['全局功能能力']);assert.deepEqual(native.headers,headers);
assert.equal(native.table_name,'GlobalCapabilities');assert.equal(native.table_ref,'A7:K'+last);assert(native.table_filter);
assert.deepEqual(native.bars.map(b=>b.range).sort(),['J8:J'+last,'K8:K'+last].sort());
for(const bar of native.bars)assert.deepEqual(bar.values,[{type:'num',val:'0'},{type:'num',val:'1'}]);
assert.equal(native.excel_errors.length,0);
assert.deepEqual(native.pane,{xSplit:'3',ySplit:'7',topLeftCell:'D8',activePane:'bottomRight',state:'frozen'});
const saved=await SpreadsheetFile.importXlsx(await FileBlob.load(target));
const savedSheet=saved.worksheets.getItem('全局功能能力');
assert.deepEqual(savedSheet.getRange('A8:K'+last).values,values);
assert.equal(savedSheet.tables.items.length,1);
for(const [label,range]of [
 ['header','A2:K7'],['core','A7:K21'],['materials','A22:K34'],['agent','A35:K45'],['official','A46:K'+last]
]){
 const png=await saved.render({sheetName:savedSheet.name,range,scale:1,format:'png'});
 await fs.writeFile(path.join(output,'global-capabilities-'+label+'-2026-10-14.png'),new Uint8Array(await png.arrayBuffer()));
}
const report={kind:'explicit_global_capability_redesign',at_utc:utc.toISOString(),previous_version:'0.1.62',current_installed_version:'0.1.63',
 current_code_committed:false,source_head:sourceHead,comparison_baseline_ref:baselineRef,source_workbook_sha256:sha(baseline),workbook_sha256:sha(await fs.readFile(target)),
 function_rows:rows.length,stable_function_ids:values.map(r=>r[0]),percentages_are_retrospective_coarse_estimates:true,percentages_are_acceptance:false,overall_percentage_computed:false,
 all_rows_have_complete_previous_and_current_abilities:true,version_changelog_language_absent:true,previous_and_current_same_scope:true,
 native,saved_values_exact:true,source_install_ledger_version:install.version,source_build_run:build.run_id,
 generated_md_json_match_revision:true,external_saved_file_bytes_independently_read:false,day_export_final_save_completed:false,ai_summary_native_boundaries_verified:false,
 rows:values.map(r=>({id:r[0],group:r[1],feature:r[2],requirement:r[3],previous_ability:r[4],current_ability:r[5],availability:r[6],validation_scope:r[7],gap:r[8],previous_estimate:r[9],current_estimate:r[10]}))};
await fs.writeFile(path.join(phase,'global-capabilities-snapshot-2026-10-14.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({file:target,functions:rows.length,versions:['0.1.62','0.1.63'],native,sha256:report.workbook_sha256}));
