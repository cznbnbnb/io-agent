'use strict';
const paths={
 tasks:'M6 4h12a2 2 0 0 1 2 2v14H4V6a2 2 0 0 1 2-2ZM8 9h8M8 13h8M8 17h4',
 file:'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8M8 17h5',
 settings:'M9 3h6l.6 3 2.5 1.5L21 7l2 5-2.4 2 .1 3-4.6 3-2.5-1.4h-3L8 20l-4.6-3 .1-3L1 12l2-5 2.9.5L8.4 6 9 3Zm6 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
 layers:'m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
 glasses:'M2 10h7l2 2h2l2-2h7v6a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3v-2h-4v2a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-6Zm0 0 2-5h3m15 5-2-5h-3',
 chevron:'m9 5 7 7-7 7',back:'m15 5-7 7 7 7',close:'m6 6 12 12M6 18 18 6',minus:'M5 12h14',plus:'M12 5v14M5 12h14',
 check:'m5 12 4 4L19 6',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
 laptop:'M5 4h14v12H5V4ZM2 20h20l-3-4H5l-3 4Z',mic:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Zm-3 7a6 6 0 0 0 12 0m-6 6v4m-4 0h8',
 send:'m3 3 18 9-18 9 4-9-4-9Zm4 9h14',sync:'M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2',
 bell:'M6 10a6 6 0 0 1 12 0v5l2 3H4l2-3v-5Zm4 11h4',moon:'M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11Z',
 calendar:'M4 5h16v16H4V5Zm0 5h16M8 3v4m8-4v4M8 14h2m4 0h2m-8 4h2',search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
 cloud:'M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 6 6 0 0 1 0 11H6Zm3-6 3-3 3 3m-3-3v7',more:'M5 12h.01M12 12h.01M19 12h.01',
 tool:'m15 3-4 4 1 4 4 1 4-4a7 7 0 0 1-9 9l-6 6-4-4 6-6a7 7 0 0 1 8-10Z',info:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v6m0-10v.01',
 play:'m8 4 12 8-12 8V4Z',pause:'M8 4v16M16 4v16',download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
 sparkle:'m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8L12 2Z',folder:'M3 6h7l2 3h9v11H3V6Z',book:'M3 4h6l3 2 3-2h6v15h-6l-3 2-3-2H3V4Zm9 2v15'
};
const icon=(name,cls='')=>`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.info}"/></svg>`;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=selector=>document.querySelector(selector);
const btn=(action,text,cls='primary',attrs='')=>`<button class="${cls}" data-action="${action}" ${attrs}>${text}</button>`;
const avatar=(name='claude',large=false)=>`<span class="agent-avatar ${name==='codex'?'codex':''} ${large?'large':''}" aria-hidden="true">${name==='codex'?'⌘':'✳'}</span>`;
let state,stack=[],toastTimer,previousFocus=null,savedStack=[],scrollPositions={};
function reset(){
 state={route:'tasks',tab:'running',mode:'floating',selected:-1,extra:'',answered:false,receipt:0,replyQueued:false,extraConnections:[],day:23,synced:false,offline:false,notice:true,quiet:false,materialId:0,taskId:'meeting',newTasks:[],draft:'',delegateAgent:'codex',lastRoute:'tasks',connectionPauses:{},connectionId:'codex',defaultTarget:{id:'codex',workspace:'AI 眼镜项目'},defaultDraft:null,defaultReturn:'',delegateWorkspace:'AI 眼镜项目',taskControls:{},instructionDrafts:{},syncEnabled:true,audioExports:{},documentExports:{},exportFormat:'docx',taskSequence:0,importAsDefault:false};
 stack=[];savedStack=[];scrollPositions={};$('#overlay').innerHTML='';render();
}
const notes={
 tasks:['任务优先','需要决定，<br>也能随时调整。','待回复优先。任务列表保持固定高度，暂停和新指示直接回到原任务。','试试任务行的「暂停并指示」，或切换任务状态。'],
 question:['专心回答','问题和条件，<br>在同一页说清楚。','来源明确到 Agent 和主题。推荐不是默认选择，完整补充一起送达。','主动选择一个方案，再补充条件并确认回复。'],
 receipt:['回执清晰','发送成功，<br>也有不同的进度。','手机已发送、Agent 已收到、任务继续执行，分别呈现。','点击演示回执，查看原任务继续的状态。'],
 materials:['自动同步','资料自动到位，<br>进度清楚可见。','日常不必手动同步。新文字定时增量上传，完整原音独立保存。','打开「查看进度」，或按带圆点的日期查找资料。'],
 settings:['安静的设置','默认目标明确，<br>开关都有去处。','默认 Agent 与工作区服务于新委托；连接、提醒和同步分别管理。','设置默认目标，再打开新委托看自动选中的去向。'],
 host:['轻量入口','熟悉的原厂页面，<br>多一个 Agent 入口。','收起后保留页面和草稿。主动唤起使用明确的默认目标。','点击 Agent 返回工作区。'],
 connections:['连接管理','统一从详情，<br>管理每条连接。','先查看连接，再暂停、恢复或设为默认。暂停连接不会暂停电脑任务。','进入「查看连接」，体验暂停和默认目标设置。'],
 task:['任务控制','先确认暂停，<br>再按新指示继续。','新的指示绑定原任务。收到 Agent 回执后，才显示已暂停或已继续。','暂停并追加指示，查看回执，再按新指示继续。'],
 material:['保存与导出','原音保留三天，<br>重要内容存到手机。','远程原音固定保存 72 小时。文档可独立导出，手机副本不随远程到期删除。','分别体验保存原音和导出文档。']
};
function rememberScroll(){const body=$('#app .body-scroll');if(body)scrollPositions[state.route]=body.scrollTop;}
function go(route,options={}){rememberScroll();if(options.save!==false)stack.push(state.route);state.route=route;$('#overlay').innerHTML='';render();}
function navigate(route){rememberScroll();stack=[];state.route=route;$('#overlay').innerHTML='';render();}
function back(){rememberScroll();state.route=stack.pop()||'tasks';$('#overlay').innerHTML='';render();}
function minimize(){state.lastRoute=state.route;savedStack=[...stack];navigate('host');}
function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3300);}
function nav(active){return `<nav class="bottom-nav" aria-label="Agent 导航">${[['tasks','任务'],['materials','资料'],['settings','设置']].map(([r,l])=>`<button data-action="nav" data-route="${r}" class="${active===r?'active':''}" ${active===r?'aria-current="page"':''}><span class="${r==='tasks'&&!state.answered?'nav-badge':''}">${icon(r==='materials'?'file':r)}</span>${l}</button>`).join('')}</nav>`;}
function header(){return `<header class="app-header"><span class="app-brand"><span class="mini-mark">iO</span>Agent</span><div class="close-pill">${btn('workspace-info',icon('more'),'icon-button','aria-label="工作区信息"')}<span class="separator"></span>${btn('minimize',icon('minus'),'icon-button','aria-label="收起 Agent 工作区"')}</div></header>`;}
function subheader(title){return `<header class="sub-header">${btn('back',icon('back'),'icon-button','aria-label="返回"')}<h2 class="with-action">${title}</h2>${btn('minimize',icon('minus'),'icon-button','aria-label="收起 Agent 工作区"')}</header>`;}
function wrapper(content,active,dock=''){return header()+`<div class="body-scroll"><div class="main-padding">${content}</div></div>${dock}${nav(active)}`;}
function settingRow(name,title,value,action,small=''){return `<button class="setting-row" data-action="${action}">${icon(name)}<span class="setting-label">${title}${small?'<small>'+small+'</small>':''}</span>${value?'<span class="setting-value">'+value+'</span>':''}${icon('chevron','chevron')}</button>`;}
function timeline(title,copy,done){return `<div class="timeline-item"><span class="timeline-point ${done?'':'pending'}">${icon(done?'check':'clock')}</span><div><strong>${title}</strong><p>${copy}</p></div></div>`;}
const choices=['按议题整理','按时间顺序','先给一页摘要'];
function question(){return subheader('回复 Agent')+`<div class="body-scroll"><div class="main-padding"><div class="source-summary">${avatar('claude',true)}<div><strong>Claude Code</strong><p>工作 Mac / 明日会议准备</p></div></div><p class="question-label">需要你决定</p><h1 class="question-heading">会议材料按哪种方式整理？</h1><p class="body-copy">已收集今天的讨论记录。按议题整理，开会时更方便逐项确认。</p><div class="options" role="radiogroup" aria-label="整理方式">${choices.map((x,i)=>`<button class="option ${state.selected===i?'selected':''}" role="radio" aria-checked="${state.selected===i}" data-action="select" data-option="${i}"><span class="radio"></span><span class="option-title">${x}${i===0?'<small>推荐</small>':''}</span></button>`).join('')}</div><label class="field-label" for="extra">补充条件<span>选填</span></label><textarea id="extra" placeholder="例如：把需要我拍板的事项放最前面">${esc(state.extra)}</textarea><div class="reply-tools">${btn('glasses-demo',icon('glasses')+'在眼镜上回答','')}</div></div></div><div class="bottom-action">${btn('review-answer','确认回复','primary full',state.selected<0?'disabled':'')}<p>回复给 Claude Code 的「明日会议准备」</p></div>`;}
function receipt(){const queued=state.replyQueued,held=controlFor('meeting').phase!=='running';return subheader('回复进度')+`<div class="body-scroll"><div class="main-padding"><div class="success-emblem">${icon(queued?'clock':'check')}</div><h1 class="center-title">${queued?'回复已保存在手机':'你的回复已发送'}</h1><p class="center-copy">${queued?'连接恢复后会继续发送。':'已提交给「明日会议准备」'}<br>完整选择和补充条件会一起送达。</p><div class="answer-summary"><div class="eyebrow">你的回复</div><p>${choices[state.selected]||''}${state.extra?'。<br>'+esc(state.extra):''}</p></div><div class="timeline">${timeline(queued?'手机已保存':'手机已发送',queued?'等待网络恢复':'服务器已保存完整回复',true)}${timeline(state.receipt?'Agent 已收到':'等待 Agent 接收',state.receipt?'已回到 Claude Code 原对话':'等待电脑接收',state.receipt>0)}${timeline(state.receipt?(held?controlLabel('meeting','进行中'):'任务已继续'):'等待任务进展',state.receipt?(held?'答案已收到；任务仍按当前暂停或继续指示处理。':'正在按你的要求整理会议材料'):'收到新进展后会更新',state.receipt>0&&!held)}</div></div></div><div class="bottom-action">${state.receipt===0?btn('receipt-next',queued?'演示网络恢复并收到回执':'演示 Agent 接收回执','primary full'):btn('home-tasks','返回任务','primary full')}<p>演示数据，不会向真实 Agent 发送消息。</p></div>`;}
const materialData=[{title:'项目方案讨论',time:'08:20 – 08:48',text:'讨论了移动端入口与任务列表的安排。大家希望打开后先看到等待自己处理的问题，再看其他任务。',next:'下一步先完成可点击原型，再根据使用反馈确定界面。',minutes:'28 分钟'},{title:'晨间灵感记录',time:'07:36 – 07:41',text:'可以把手机上的任务回复收成一个清楚的流程：看问题、选方案、补充条件、确认发送。',next:'在正式使用前，先验证长文本、大字号和连接中断时的表现。',minutes:'5 分钟'}];
function host(){return `<div class="host-screen"><div class="host-header"><h2>眼镜</h2>${btn('host-setting',icon('settings'),'icon-button','aria-label="设备设置示意"')}</div><div class="host-content"><p class="host-caption">日常，轻一点。</p><div class="glasses-product"><img src="assets/glasses.png" alt="雷鸟 iO 眼镜原厂产品插图"></div><div class="host-device"><div><h3>雷鸟 iO</h3><p>已连接 · 76%</p></div><span class="host-chip">设备管理</span></div>${state.mode==='integrated'?`<button class="integrated-entry" data-action="open-agent">${icon('sparkle')}<span><h3>Agent 任务</h3><p>${state.answered?'2 个任务正在进行':'1 个问题需要你决定'}</p></span>${icon('chevron','chevron')}</button>`:''}<div class="host-grid">${[['mic','录音','随时记录灵感'],['book','智记','留下生活片段'],['file','提词器','从容表达'],['layers','应用','更多眼镜功能']].map(([i,t,s])=>`<button class="host-tile" data-action="host-feature" data-label="${t}">${icon(i)}<span>${t}</span><small>${s}</small></button>`).join('')}</div><p class="host-demo-label">原厂风格示意 · 非原厂页面截图</p></div>${state.mode==='floating'?`<button class="floating-entry" data-action="open-agent" aria-label="打开 Agent 工作区">${icon('sparkle')}Agent${!state.answered?'<span class="entry-badge">1</span>':''}</button>`:''}<nav class="host-nav" aria-label="宿主导航示意">${[['glasses','眼镜'],['book','智记'],['sparkle','AI'],['layers','发现']].map(([i,t])=>btn('host-feature',icon(i)+t,i==='glasses'?'active':'',`data-label="${t}"`)).join('')}</nav></div>`;}
function render(){
 $('#app').inert=!!$('#overlay').innerHTML;
 const pages={tasks,question,receipt,materials,settings,connections,task,material,host};$('#app').innerHTML=(pages[state.route]||tasks)();
 const body=$('#app .body-scroll');if(body)body.scrollTop=scrollPositions[state.route]||0;
 const n=notes[state.route]||notes.settings;$('#note-index').textContent=n[0];$('#note-title').innerHTML=n[1];$('#note-copy').textContent=n[2];$('#note-try').textContent=n[3];
 const scene=['question','receipt','task'].includes(state.route)?'tasks':state.route==='material'?'materials':state.route==='connections'?'settings':state.route;
 document.querySelectorAll('[data-scene]').forEach(b=>b.classList.toggle('active',b.dataset.scene===scene));
 for(const m of ['floating','integrated']){$('#mode-'+m).classList.toggle('active',state.mode===m);$('#mode-'+m).setAttribute('aria-pressed',state.mode===m);}
 $('#mode-caption').textContent=state.mode==='floating'?'Android：独立工作区，从原厂页面唤起。':'后续鸿蒙：相同工作区，可使用应用内入口。';
}
function sheet(title,body,footer=''){
 if(!$('#overlay').innerHTML)previousFocus=document.activeElement;
 $('#app').inert=true;
 $('#overlay').innerHTML=`<div class="modal-backdrop" data-backdrop="true"><section class="sheet" role="dialog" aria-modal="true" aria-label="${title}"><div class="sheet-handle"></div><header class="sheet-header"><h2>${title}</h2>${btn('close-sheet',icon('close'),'icon-button','aria-label="关闭弹层"')}</header><div class="sheet-body">${body}</div>${footer}</section></div>`;$('#overlay button, #overlay input, #overlay textarea')?.focus();
}
function closeSheet(){const action=previousFocus?.dataset.action;rememberScroll();$('#overlay').innerHTML='';render();if(action)document.querySelector('#app [data-action="'+action+'"]')?.focus({preventScroll:true});}
function toggleRow(key,title,copy){return `<div class="setting-row"><span class="setting-label">${title}<small>${copy}</small></span><button class="toggle ${state[key]?'on':''}" data-action="toggle" data-key="${key}" role="switch" aria-checked="${state[key]}" aria-label="${title}"></button></div>`;}
function reminderSheet(){sheet('眼镜提醒',`<p class="body-copy">重要问题在眼前，其他进展留在手机。</p><div class="setting-group" style="margin-top:16px">${toggleRow('notice','任务与问题提醒','需要你决定时，在眼镜上提醒')}${toggleRow('quiet','免打扰','开启后仅保留手机内提醒')}</div><p class="body-copy">提词问题最多显示 3 分钟；暂未回答的问题仍可在手机里继续处理。</p>`);}
const actions={
 nav:e=>navigate(e.dataset.route),back, 'home-tasks':()=>navigate('tasks'),connections:()=>go('connections'),minimize,
 'open-agent':()=>{state.route=state.lastRoute||'tasks';stack=[...savedStack];render();},
 'open-question':()=>go(state.answered?'receipt':'question'),receipt:()=>go('receipt'),
 filter:e=>{rememberScroll();state.tab=e.dataset.tab;render();},
 select:e=>{rememberScroll();state.selected=Number(e.dataset.option);render();},
 'review-answer':()=>{if(state.selected<0)return;sheet('确认这份回复',`<p class="body-copy">Claude Code / 明日会议准备</p><div class="answer-summary"><div class="eyebrow">你的选择与补充</div><p>${choices[state.selected]}${state.extra?'。<br>'+esc(state.extra):''}</p></div><p class="body-copy">这份完整回复将一起返回原任务。</p>`,btn('submit-answer','发送回复','primary full')+btn('close-sheet','继续修改','subtle-link'));},
 'submit-answer':()=>{if(state.selected<0)return;state.answered=true;state.receipt=0;state.replyQueued=state.offline;go('receipt',{save:false});},
 'receipt-next':()=>{state.offline=false;state.replyQueued=false;state.receipt=1;render();toast('演示：'+replyProgress()+'。');},
 'glasses-demo':()=>sheet('在眼镜上回答',`<div class="glasses-preview"><span>Claude Code 提问：明日会议准备</span><h3>会议材料按哪种方式整理？</h3><p>1. 按议题整理<br>2. 按时间顺序<br>3. 先给一页摘要</p></div><p class="body-copy">仅预览提词内容，不启动眼镜录音。</p>`,btn('close-sheet','返回手机回答','primary full')),
 'task-detail':e=>{state.taskId=e.dataset.id;go('task');},
 'task-control-open':e=>{state.taskId=e.dataset.id;go('task');if(controlFor(state.taskId).phase==='running')pauseInstruction();},
 'pause-instruction':()=>pauseInstruction(),'edit-instruction':()=>pauseInstruction(true),
 'request-pause':()=>{state.taskControls[state.taskId]={phase:state.offline?'pause_queued':'pause_requested',instruction:$('#task-instruction').value.trim()};closeSheet();},
 'save-instruction':()=>{state.taskControls[state.taskId].instruction=$('#task-instruction').value.trim();closeSheet();},
 'request-resume':()=>{state.taskControls[state.taskId].phase=state.offline?'resume_queued':'resume_requested';render();},
 'control-receipt':()=>{const c=state.taskControls[state.taskId];const task=state.newTasks.find(t=>t.id===state.taskId);if(task)task.received=true;state.offline=false;c.phase=c.phase.startsWith('pause')?'paused':'running';render();toast(c.phase==='paused'?'演示：Agent 已确认暂停。':'演示：Agent 已按新指示继续。');},
 'new-task':()=>beginNewTask(),
 'material-delegate':()=>{state.draft='根据「'+materialData[state.materialId].title+'」整理会议要点和待办。';state.delegateAgent=state.defaultTarget.id;state.delegateWorkspace=state.defaultTarget.workspace;newTask();},
 'send-task':()=>{const d=$('#task-draft').value.trim();if(!d){$('#task-error').textContent='先写下需要 Agent 完成的事情。';$('#task-draft').focus();return;}if(connectionPaused(state.delegateAgent))return;state.newTasks.unshift({id:'new-'+(++state.taskSequence),text:d,connectionId:state.delegateAgent,workspace:state.delegateWorkspace});state.draft='';state.tab='running';navigate('tasks');toast('演示：委托已保存，等待电脑接收。');},
 'connection-detail':e=>{state.connectionId=e.dataset.id||state.connectionId;connectionDetail();},
 'toggle-connection':()=>{state.connectionPauses[state.connectionId]=!connectionPaused(state.connectionId);connectionDetail();},
 defaults:()=>{state.defaultDraft=null;state.defaultReturn='';defaultsSheet();},
 'default-from-connection':()=>{const c=connection(state.connectionId);state.defaultDraft={id:c.id,workspace:c.workspaces[0]};state.defaultReturn='connection';defaultsSheet();},
 'defaults-from-task':()=>{state.defaultDraft=null;state.defaultReturn='task';defaultsSheet();},
 'save-default':()=>{state.defaultTarget={...state.defaultDraft};state.defaultDraft=null;if(state.defaultReturn==='task'){state.delegateAgent=state.defaultTarget.id;state.delegateWorkspace=state.defaultTarget.workspace;newTask();}else if(state.defaultReturn==='connection')connectionDetail();else closeSheet();toast('默认目标已更新；已有任务的归属保持不变。');},
 expired:()=>sheet('已到期连接',`<p class="body-copy">到期连接不再接收新任务，历史任务和回复仍保留。</p>${['上周资料整理','提词器主题确认','周会要点汇总'].map(x=>'<div class="development-item"><strong>'+x+'</strong>已到期 · 历史记录保留</div>').join('')}`,btn('close-sheet','返回','primary full')),
 'add-connection':()=>{state.importAsDefault=false;sheet('添加电脑连接',`<p class="body-copy">在电脑的 Agent 对话中生成连接文件，再导入手机。</p><div class="import-drop">${icon('laptop')}<strong>导入电脑登记文件</strong><span>核对 Agent、电脑和工作区后保存</span></div><p class="prototype-caption">模拟导入，不读取真实文件或凭据。</p>`,btn('import-demo','演示导入预览','primary full'));},
 'import-demo':()=>sheet('核对连接',`<div class="connection-summary"><p><span>Agent</span>Codex</p><p><span>电脑</span>个人 MacBook</p><p><span>工作区</span>出行计划</p><p><span>有效期</span>示例：24 小时</p></div><label class="check-row"><input id="import-default" type="checkbox">设为默认 Agent 与工作区</label><p class="prototype-caption">CLI 登记时也可指定默认目标；此处仅演示导入。</p>`,btn('save-connection','保存连接','primary full')),
 'save-connection':()=>{if(!state.extraConnections.some(c=>c.id==='personal'))state.extraConnections.push({id:'personal',agent:'Codex',avatar:'codex',computer:'个人 MacBook',topic:'出行计划',workspaces:['出行计划']});if(state.importAsDefault)state.defaultTarget={id:'personal',workspace:'出行计划'};closeSheet();toast('已添加示例连接。');},
 day:e=>{state.day=Number(e.dataset.day);render();},calendar:()=>calendarSheet(),
 'pick-day':e=>{state.day=Number(e.dataset.day);closeSheet();},'material-detail':e=>{state.materialId=Number(e.dataset.id);go('material');},
 sync:()=>{if(!state.syncEnabled||state.offline)return;state.synced=true;syncDetails();toast('演示：待同步文字与原音已保存到远程。');},
 'sync-status':()=>syncDetails(),'sync-settings':()=>syncSettings(),'show-materials':()=>navigate('materials'),
 'save-audio':()=>saveAudio(),
 'confirm-audio-save':()=>{state.audioExports[exportKey()]=true;closeSheet();toast('已演示保存到手机；没有下载真实音频。');},
 'export-document':()=>exportDocument(),'export-format':e=>{state.exportFormat=e.dataset.format;exportDocument();},
 'confirm-document-export':()=>{state.documentExports[exportKey()]=state.exportFormat;closeSheet();toast('已演示导出 '+state.exportFormat.toUpperCase()+' 文档到手机。');},
 reminders:()=>reminderSheet(),
 toggle:e=>{const k=e.dataset.key;state[k]=!state[k];e.classList.toggle('on',state[k]);e.setAttribute('aria-checked',state[k]);if(k==='syncEnabled')toast(state[k]?'自动同步已开启，继续处理保留的队列。':'自动同步已关闭；资料与队列仍保留。');},
 tools:()=>sheet('扩展工具',`<p class="body-copy">保留原有工具，统一进入和返回的路径。</p><div class="tool-grid">${[['book','微信读书'],['play','网易云音乐'],['clock','番茄时钟'],['layers','仪表盘'],['file','新闻提词'],['mic','字幕翻译']].map(([i,t])=>btn('tool-demo',icon(i)+t,'',`data-label="${t}"`)).join('')}</div>`),
 'tool-demo':e=>toast(e.dataset.label+'入口示意；真实功能仍在原 App。'),
 account:()=>sheet('账号与设备',`<div class="device-overview"><span class="device-icon">${icon('glasses')}</span><div><h3>雷鸟 iO</h3><p>沿用原厂登录和配对</p></div></div><p class="body-copy">设备连接、账号登录和眼镜基础功能继续由原厂页面管理。Agent 工作区只显示相关状态。</p>`,btn('vendor-demo','回到原厂 APP','primary full')),
 'vendor-demo':()=>minimize(),
 about:()=>sheet('关于 iO Agent',`<div class="about-mark">iO</div><h3 class="center-title">把电脑任务带到眼前。</h3><p class="center-copy">手机处理完整内容，眼镜带来及时提醒。</p><div class="development-item"><strong>批注修订版</strong>2026.10 · 可点击原型</div><p class="body-copy" style="margin-top:14px">所有连接、状态、内容和回执均为演示。</p>`),
 developer:()=>sheet('开发者选项',`<p class="body-copy">测试入口集中在这里，不出现在日常首页。</p><div class="development-item"><strong>连接诊断</strong>设备、网络与 Agent 状态</div><div class="development-item"><strong>任务卡测试</strong>一分钟卡与交互检查</div><div class="development-item"><strong>固件与兼容性</strong>宿主版本与适配情况</div><div class="setting-group" style="margin-top:18px">${toggleRow('offline','演示手机断网','只切换此原型的状态，不影响真实设备')}</div>`,btn('developer-done','返回任务查看状态','primary full')),
 'developer-done':()=>navigate('tasks'),
 'workspace-info':()=>sheet('Agent 工作区',`<p class="body-copy">收起后回到原厂页面，再打开时继续刚才的页面和草稿。</p><div class="banner">${icon('layers')}<p>任务、资料和设置共用同一个工作区。</p></div>`,btn('minimize','收起工作区','primary full')),
 'host-feature':e=>toast(e.dataset.label+'为原厂功能入口示意。'),'host-setting':()=>toast('设备设置为原厂入口示意。'),'close-sheet':()=>closeSheet()
};
document.addEventListener('click',event=>{const el=event.target.closest('[data-action]');if(el&&!el.disabled){actions[el.dataset.action]?.(el);return;}if(event.target.matches('[data-backdrop]'))closeSheet();});
document.addEventListener('input',event=>{if(event.target.id==='extra')state.extra=event.target.value;if(event.target.id==='task-draft')state.draft=event.target.value;if(event.target.id==='task-instruction')state.instructionDrafts[state.taskId]=event.target.value;});
document.addEventListener('change',event=>{
 const e=event.target;
 if(e.id==='task-agent'){state.delegateAgent=e.value;state.delegateWorkspace=connection(e.value).workspaces[0];newTask();}
 if(e.id==='task-workspace'){state.delegateWorkspace=e.value;newTask();}
 if(e.id==='default-agent'){state.defaultDraft.id=e.value;state.defaultDraft.workspace=connection(e.value).workspaces[0];defaultsSheet();}
 if(e.id==='default-workspace')state.defaultDraft.workspace=e.value;
 if(e.id==='import-default')state.importAsDefault=e.checked;
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if($('#overlay').innerHTML)closeSheet();else if(stack.length)back();return;}if(event.key==='Tab'&&$('#overlay').innerHTML){const items=[...$('#overlay').querySelectorAll('button:not([disabled]),input,textarea,select,[tabindex="0"]')];const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
document.querySelectorAll('[data-scene]').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.scene)));
for(const mode of ['floating','integrated'])$('#mode-'+mode).addEventListener('click',()=>{state.mode=mode;navigate('host');});
$('.wordmark').addEventListener('click',event=>{event.preventDefault();navigate('tasks');});
$('#reset').addEventListener('click',()=>{reset();toast('已重置示例数据。');});
reset();
