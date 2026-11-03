const $=id=>document.getElementById(id);
const num=v=>new Intl.NumberFormat('zh-CN').format(v??0);
const time=v=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'暂无记录';
const bytes=n=>n>=1048576?(n/1048576).toFixed(1)+' MiB':n>=1024?(n/1024).toFixed(1)+' KiB':num(n)+' B';
const labels={queued:'排队中',agent_received:'Agent 已接收',running:'执行中',waiting_answer:'等待回答',completed:'已完成',cancelled:'已取消',failed:'失败',expired:'已过期',execution_unknown:'执行状态待确认',stop_requested:'正在请求停止',stop_unconfirmed:'尚未确认停止',stopped:'已停止',resume_requested:'请求继续',cancel_requested:'请求取消',pending:'待回答',presented:'已展示',answered:'已回答',withdrawn:'已撤回',server_stored:'服务器已保存',phone_received:'手机已接收',glasses_displayed:'眼镜已显示',user_answered:'用户已回答',task_resumed:'原任务继续',task_completed:'任务完成',inbox:'新消息检查',identity:'身份检查','agent-sessions':'会话心跳与目录','agent-default':'默认工作区','phone-presence':'主手机心跳',tasks:'任务',requests:'问题',answers:'回答',messages:'消息',receipts:'回执',materials:'资料',watches:'进度提醒',devices:'设备',pairings:'配对',credentials:'访问续期','todo-suggestions':'待办建议',other:'其他 / 旧版归类',rename:'设备改名',delivery:'投送开关',unpair:'解除配对',primary:'切换主手机',default:'默认工作区',mark:'整理后台记录',paused:'暂停',resumed:'恢复',revoked:'已解绑','favorite:true':'已收藏','favorite:false':'已取消收藏','archived:true':'已归档','archived:false':'已取消归档','trashed:true':'已移入回收站','trashed:false':'已恢复',claude:'Claude Code',codex:'Codex',acp:'ACP Agent'};
const label=v=>labels[v]??v??'—';
const issues={codex_session_not_loaded:'原生会话未加载',CODEX_SESSION_NOT_LOADED:'原生会话未加载',claude_plugin_reload_required:'等待插件重载',CLAUDE_PLUGIN_RELOAD_REQUIRED:'等待插件重载',lease_expired:'在线心跳已超时',lease_released:'会话已结束',device_revoked:'设备已解绑',native_disconnected:'原生连接已断开'};
const pages={overview:['总览','掌握设备、任务和交互的当前状态。'],devices:['设备与连接','查看配对关系、主手机和最近通信。'],sessions:['工作区与会话','在线不等于可执行；只有已接通的会话能接收指令。'],tasks:['任务与问答','按工作区整理任务，查看问题、回答和回执。'],daily:['日常智记','按日期查看总结、分段智记与转写，追溯订正。'],traffic:['API 与流量','把后台轮询与实际任务交互分开看。'],audit:['操作记录','追溯在此后台完成的管理操作。'],settings:['账号与设置','账号、登录和当前数据范围。']};
/* Lucide Static 1.66.0; selected official SVG geometry.
Source: https://registry.npmjs.org/lucide-static/-/lucide-static-1.66.0.tgz
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
const iconNodes={"overview":[["rect",{"width":"7","height":"9","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"5","x":"14","y":"3","rx":"1"}],["rect",{"width":"7","height":"9","x":"14","y":"12","rx":"1"}],["rect",{"width":"7","height":"5","x":"3","y":"16","rx":"1"}]],"devices":[["path",{"d":"M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"}],["path",{"d":"M10 19v-3.96 3.15"}],["path",{"d":"M7 19h5"}],["rect",{"width":"6","height":"10","x":"16","y":"12","rx":"2"}]],"sessions":[["path",{"d":"M20 5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.5a1.5 1.5 0 0 1 1.2.6l.6.8a1.5 1.5 0 0 0 1.2.6z"}],["path",{"d":"M3 8.268a2 2 0 0 0-1 1.738V19a2 2 0 0 0 2 2h11a2 2 0 0 0 1.732-1"}]],"tasks":[["path",{"d":"M13 5h8"}],["path",{"d":"M13 12h8"}],["path",{"d":"M13 19h8"}],["path",{"d":"m3 17 2 2 4-4"}],["rect",{"x":"3","y":"4","width":"6","height":"6","rx":"1"}]],"daily":[["path",{"d":"M2 6h4"}],["path",{"d":"M2 10h4"}],["path",{"d":"M2 14h4"}],["path",{"d":"M2 18h4"}],["rect",{"width":"16","height":"20","x":"4","y":"2","rx":"2"}],["path",{"d":"M9.5 8h5"}],["path",{"d":"M9.5 12H16"}],["path",{"d":"M9.5 16H14"}]],"traffic":[["path",{"d":"M12 16v5"}],["path",{"d":"M16 14.639V21"}],["path",{"d":"M20 10.656V21"}],["path",{"d":"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15"}],["path",{"d":"M4 18.463V21"}],["path",{"d":"M8 14.656V21"}]],"audit":[["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}],["path",{"d":"M12 7v5l4 2"}]],"settings":[["path",{"d":"M14 17H5"}],["path",{"d":"M19 7h-9"}],["circle",{"cx":"17","cy":"17","r":"3"}],["circle",{"cx":"7","cy":"7","r":"3"}]],"list":[["path",{"d":"M3 5h.01"}],["path",{"d":"M3 12h.01"}],["path",{"d":"M3 19h.01"}],["path",{"d":"M8 5h13"}],["path",{"d":"M8 12h13"}],["path",{"d":"M8 19h13"}]],"cards":[["rect",{"width":"7","height":"7","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"7","x":"14","y":"3","rx":"1"}],["rect",{"width":"7","height":"7","x":"14","y":"14","rx":"1"}],["rect",{"width":"7","height":"7","x":"3","y":"14","rx":"1"}]],"phone":[["rect",{"width":"14","height":"20","x":"5","y":"2","rx":"2","ry":"2"}],["path",{"d":"M12 18h.01"}]],"computer":[["rect",{"width":"20","height":"14","x":"2","y":"3","rx":"2"}],["line",{"x1":"8","x2":"16","y1":"21","y2":"21"}],["line",{"x1":"12","x2":"12","y1":"17","y2":"21"}]],"chevron":[["path",{"d":"m9 18 6-6-6-6"}]],"search":[["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],"refresh":[["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{"d":"M8 16H3v5"}]],"key":[["path",{"d":"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"}],["circle",{"cx":"16.5","cy":"7.5","r":".5","fill":"currentColor"}]],"logout":[["path",{"d":"m16 17 5-5-5-5"}],["path",{"d":"M21 12H9"}],["path",{"d":"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}]],"star":[["path",{"d":"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]],"archive":[["rect",{"width":"20","height":"5","x":"2","y":"3","rx":"1"}],["path",{"d":"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}],["path",{"d":"M10 12h4"}]],"trash":[["path",{"d":"M10 11v6"}],["path",{"d":"M14 11v6"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],"download":[["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],"check":[["path",{"d":"M20 6 9 17l-5-5"}]],"close":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"link":[["path",{"d":"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"}],["path",{"d":"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"}]],"play":[["path",{"d":"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]],"pause":[["rect",{"x":"14","y":"3","width":"5","height":"18","rx":"1"}],["rect",{"x":"5","y":"3","width":"5","height":"18","rx":"1"}]],"eye":[["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"server":[["rect",{"width":"20","height":"8","x":"2","y":"2","rx":"2","ry":"2"}],["rect",{"width":"20","height":"8","x":"2","y":"14","rx":"2","ry":"2"}],["line",{"x1":"6","x2":"6.01","y1":"6","y2":"6"}],["line",{"x1":"6","x2":"6.01","y1":"18","y2":"18"}]],"arrow":[["path",{"d":"M5 12h14"}],["path",{"d":"m12 5 7 7-7 7"}]],"exchange":[["path",{"d":"M8 3 4 7l4 4"}],["path",{"d":"M4 7h16"}],["path",{"d":"m16 21 4-4-4-4"}],["path",{"d":"M20 17H4"}]],"more":[["circle",{"cx":"12","cy":"12","r":"1"}],["circle",{"cx":"19","cy":"12","r":"1"}],["circle",{"cx":"5","cy":"12","r":"1"}]],"folder":[["path",{"d":"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"}]]};
function icon(name){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.75','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',class:'icon','data-icon':name}))svg.setAttribute(key,value);
 for(const [tag,attrs] of iconNodes[name]){const node=document.createElementNS(svg.namespaceURI,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);svg.append(node);}return svg;
}
const shortTime=value=>value?new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'暂无记录';
function downloadDaily(data){const url=URL.createObjectURL(new Blob([data.text],{type:'text/markdown;charset=utf-8'}));const a=el('a',{href:url,download:data.date+'-每日AI总结.md'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function el(tag,attrs={},...children){const node=document.createElement(tag);for(const [key,value] of Object.entries(attrs)){if(value===null||value===undefined||value===false)continue;if(key==='class')node.className=value;else if(key.startsWith('on'))node.addEventListener(key.slice(2),value);else if(key==='checked'||key==='disabled'||key==='open')node[key]=value;else node.setAttribute(key,String(value));}for(const child of children.flat(Infinity)){if(child===null||child===undefined||child===false)continue;node.append(child instanceof Node?child:document.createTextNode(String(child)));}return node;}
const button=(text,click,extra={})=>el('button',{type:'button',onclick:click,...extra},text);
const badge=(text,tone='muted')=>el('span',{class:'badge '+tone},text);
const empty=(title,description)=>el('div',{class:'empty-state'},icon('search'),el('h3',{},title),el('p',{},description));
const metric=(title,value,note)=>el('article',{class:'metric'},el('span',{},title),el('strong',{},value),el('small',{},note));
const option=(value,text)=>el('option',{value},text);
const block=(title,...children)=>el('section',{class:'card'},el('h2',{},title),children);
function table(headings,rows){return el('div',{class:'table-wrap'},el('table',{},el('thead',{},el('tr',{},headings.map(h=>el('th',{scope:'col'},h)))),el('tbody',{},rows.length?rows.map(row=>el('tr',{},row.map(cell=>el('td',{},cell)))):el('tr',{},el('td',{colspan:headings.length,class:'table-empty'},'没有符合条件的记录')))));}
function chart(data){
 const max=Math.max(1,...data.hourly.map(v=>v.requests)),start=Date.parse(data.window_from),hours=data.hours,byHour=new Map(data.hourly.map(v=>[v.hour,v]));
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 600 170');svg.setAttribute('class','chart-svg');svg.setAttribute('role','img');svg.setAttribute('aria-label',`近 ${hours} 小时合计 ${num(data.totals.requests)} 次请求`);
 for(let i=0;i<hours;i++){const hour=start+i*3600000,n=byHour.get(hour)?.requests??0,rect=document.createElementNS(svg.namespaceURI,'rect');
  for(const [key,value] of Object.entries({x:i*600/hours,y:140-(n?Math.max(2,140*n/max):1),width:Math.max(1,600/hours-3),height:n?Math.max(2,140*n/max):1,rx:2}))rect.setAttribute(key,String(value));
  const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=`${time(hour)}：${num(n)} 次`;rect.append(title);svg.append(rect);
  if(i%Math.max(1,Math.round(hours/6))===0){const text=document.createElementNS(svg.namespaceURI,'text');text.setAttribute('x',String(i*600/hours));text.setAttribute('y','162');text.textContent=new Date(hour).getHours()+'时';svg.append(text);}
 }
 return el('div',{class:'traffic-chart'},svg,el('div',{class:'chart-caption'},el('span',{},'按小时汇总'),el('span',{},`最高 ${num(max)} 次 / 小时`)));
}
function dailyContent(text,date){
 const lines=text.trim().split('\n');if(lines[0]?.includes(date)&&lines[0].includes('总结'))lines.shift();while(lines.length&&!lines[0].trim())lines.shift();
 const title=(lines.shift()??'').replace(/^#{1,6}\s+|^[-*]\s+/,'').trim()||'每日 AI 总结',body=lines.join('\n').trim();
 return{title,body,preview:body.replace(/^#{1,6}\s+|^[-*]\s+/gm,'').replace(/\s+/g,' ').trim()};
}
function summaryText(text){return el('div',{class:'summary-prose'},text.split('\n').map(line=>line.startsWith('# ')?el('h2',{},line.slice(2)):line.startsWith('## ')?el('h3',{},line.slice(3)):line.startsWith('### ')?el('h4',{},line.slice(4)):el('p',{},line||'\u00a0')));}
const errorText=e=>({CORRECTION_CONFLICT:'资料已更新，请关闭详情并刷新后核对。',CORRECTION_REVERT_CONFLICT:'同一段已有后续修改，不能直接撤销，请查看订正历史。',CORRECTION_REVERT_NOT_EDIT:'撤销记录不能再次撤销，请提交新的订正。',INVALID_ADMIN_QUERY:'筛选条件无效，请重置后重试。',ADMIN_TASK_ACTIVE:'所选任务仍在执行，不能移入回收站。可以先归档。',DEVICE_REVOKED:'设备已解绑，请刷新列表。',DEFAULT_SESSION_UNAVAILABLE:'这个会话暂时不能执行，请选择已接通的会话。',DEVICE_DELIVERY_PAUSED:'该设备暂停了投送，请先恢复。',DEFAULT_REVISION_CONFLICT:'默认工作区已在另一端更新，请刷新后重试。',PRIMARY_PHONE_CHANGED:'主手机已在另一端切换，请刷新后重试。',PHONE_ACCOUNT_REQUIRED:'这台手机尚未完成账号绑定，无法设为主手机。',TASK_NOT_FOUND:'任务已不可用，请刷新列表。',DEVICE_NOT_FOUND:'设备已不可用，请刷新列表。'}[e.code]??e.message);

export class AdminView{
 constructor({api,error}){this.api=api;this.error=error;this.page='overview';this.filters={};this.expandedTasks=new Map();this.expandedSessions=new Map();this.deviceFilter={q:'',state:'all'};this.selected=new Set();this.ticket=0;this.ready=false;this.data=null;this.dailyView=localStorage.getItem('io-admin-daily-view')==='cards'?'cards':'list';
  for(const [id,name] of [['refresh','refresh'],['change-password','key'],['disconnect','logout']])$(id).prepend(icon(name));
  document.querySelector('.flow-line').replaceChildren(icon('exchange'));
  for(const [key,[name]] of Object.entries(pages))$('navigation').append(el('a',{href:'#'+key,'data-page':key},icon(key),el('span',{},name)));
  window.addEventListener('hashchange',()=>{const page=location.hash.slice(1);if(this.ready&&Object.hasOwn(pages,page)){this.page=page;this.selected.clear();void this.refresh().catch(this.error);}});
  $('detail-dialog').addEventListener('click',event=>{if(event.target===$('detail-dialog'))$('detail-dialog').close();});
  $('cancel-action').addEventListener('click',()=>$('action-dialog').close());
 }
 clear(){this.ready=false;this.ticket++;this.data=null;this.selected.clear();$('workspace-content').replaceChildren();$('detail-dialog').close();$('action-dialog').close();}
 async refresh(){
  this.ready=true;const hash=location.hash.slice(1);if(Object.hasOwn(pages,hash))this.page=hash;
  const ticket=++this.ticket,page=this.page;const [title,subtitle]=pages[page];$('page-title').textContent=title;$('page-subtitle').textContent=subtitle;
  for(const link of $('navigation').children){const active=link.dataset.page===page;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
  $('refresh').disabled=true;$('workspace-content').setAttribute('aria-busy','true');
  if(this.lastPage!==page)$('workspace-content').replaceChildren(el('div',{class:'loading'},'正在读取…'));this.lastPage=page;
  try{const data=page==='settings'?{}:await this.api(page,undefined,this.filters[page]??{});if(ticket!==this.ticket)return;this.data=data;this.selected.clear();this.render(data);$('updated').textContent='更新于 '+new Date().toLocaleTimeString('zh-CN',{hour12:false});}
  catch(error){if(ticket===this.ticket){$('workspace-content').replaceChildren(empty('暂时无法读取',errorText(error)),button('重试',()=>void this.refresh().catch(this.error)));this.error(error);}}
  finally{if(ticket===this.ticket){$('refresh').disabled=false;$('workspace-content').removeAttribute('aria-busy');}}
 }
 filter(key,value){this.filters[this.page]={...this.filters[this.page],[key]:value,offset:0};this.selected.clear();void this.refresh();}
 toolbar({search=true,extra=[]}={}){const filter=this.filters[this.page]??{},form=el('form',{class:'toolbar',onsubmit:event=>{event.preventDefault();this.filter('q',form.querySelector('input').value.trim());}});if(search){const field=el('input',{type:'search',placeholder:this.page==='daily'?'搜索当前类型的智记':this.page==='sessions'?'搜索会话或工作区':'搜索任务内容或 ID','aria-label':'搜索',value:filter.q??''});form.append(el('div',{class:'search-field'},field,el('button',{type:'submit','aria-label':'搜索'},icon('search'))));}form.append(...extra);return form;}
 selectFilter(key,items){const select=el('select',{'aria-label':key==='state'?'任务状态':key==='hours'?'统计范围':key==='producer'?'请求设备':key==='route'?'请求类型':key==='workspace'?'工作区':key==='status'?'结果筛选':'筛选',onchange:event=>this.filter(key,event.target.value)},items.map(([v,l])=>option(v,l)));select.value=String(this.filters[this.page]?.[key]??items[0][0]);return select;}
 pager(data,size){const offset=Number(this.filters[this.page]?.offset??0);return el('div',{class:'pager'},el('span',{},data.total!==undefined?`共 ${num(data.total)} 条 · 第 ${Math.floor(offset/size)+1} 页`:`第 ${Math.floor(offset/size)+1} 页`),el('div',{},button('上一页',()=>{this.filters[this.page]={...this.filters[this.page],offset:Math.max(0,offset-size)};void this.refresh();},{disabled:offset===0}),button('下一页',()=>{this.filters[this.page]={...this.filters[this.page],offset:offset+size};void this.refresh();},{disabled:!data.has_more})));}
 async exportDaily(id){downloadDaily(await this.api('daily-detail',undefined,{id}));}
 async action(input){await this.api('action',input);$('detail-dialog').close();$('notice').replaceChildren(el('span',{},'已更新。'),button(icon('close'),()=>{$('notice').hidden=true;},{'aria-label':'关闭提示'}));$('notice').hidden=false;await this.refresh();}
 confirm(title,description,input,{label:fieldValue=null,danger=false}={}){
  $('action-title').textContent=title;$('action-description').textContent=description;$('action-error').hidden=true;$('action-fields').replaceChildren();
  if(fieldValue!==null)$('action-fields').append(el('label',{},'设备名称',el('input',{id:'new-device-label',value:fieldValue,required:true,maxlength:64,autocomplete:'off'})));
  $('confirm-action').textContent=title;$('confirm-action').className=danger?'danger':'primary';$('confirm-action').disabled=false;
  $('action-form').onsubmit=async event=>{event.preventDefault();$('confirm-action').disabled=true;$('action-error').hidden=true;
   try{await this.action(fieldValue===null?input:{...input,label:$('new-device-label').value.trim()});$('action-dialog').close();}
   catch(error){$('action-error').textContent=errorText(error);$('action-error').hidden=false;if(error.code==='ADMIN_LOGIN_REQUIRED')this.error(error);}
   finally{$('confirm-action').disabled=false;}
  };$('action-dialog').showModal();
 }
 async detail(kind,id){const ticket=this.ticket,dialog=$('detail-dialog');$('detail-content').replaceChildren(el('div',{class:'drawer-heading'},el('h2',{},'正在读取…'),button('关闭',()=>dialog.close())));dialog.showModal();
  try{const data=await this.api(kind==='task'?'task':'daily-detail',undefined,{id});if(ticket!==this.ticket||!dialog.open)return;
   const body=$('detail-content');body.replaceChildren(el('div',{class:'drawer-heading'},el('span',{class:'eyebrow'},kind==='task'?'任务详情':'智记详情'),button('关闭',()=>dialog.close())));
   if(kind==='daily'){
    const summary=dailyContent(data.text,data.date);body.append(el('h1',{},data.summary_stale?'总结待重新订正':summary.title),el('p',{class:'muted'},`${data.date} · 原文 v${data.revision} / 订正 v${data.correction_revision} · ${time(data.stored_at)}`));
    if(data.summary_stale)body.append(el('p',{class:'footnote'},'关联转写已经订正，旧总结暂不作为查询结果。Agent 可根据最新全文重新订正总结。'));
    if(data.needs_review)body.append(el('p',{class:'footnote'},'手机原文在订正后发生变化。当前仍保留订正版，请核对历史。'));
    body.append(button('导出当前文字',()=>downloadDaily(data),{class:'secondary'}),summaryText(summary.body));
    for(const note of data.notes)body.append(el('blockquote',{},note.text,el('small',{class:'cell-note'},`${note.agent} · ${time(note.at)} · 补充记录`)));
    const history=el('section',{class:'correction-history'});body.append(history);
    const loadHistory=async before=>{const h=await this.api('history',undefined,{id,...(before?{before}: {})});if(!dialog.open||ticket!==this.ticket)return;
     if(!before)history.append(el('details',{class:'technical'},el('summary',{},'查看手机原文（不含订正）'),summaryText(h.original.blocks.map(b=>b.text).join('\n'))),el('h3',{},'订正记录'));
     if(!h.items.length)history.append(el('p',{class:'muted'},'还没有订正。'));
     for(const entry of h.items){const details=el('details',{class:'technical'},el('summary',{},`v${entry.revision} · ${entry.agent} · ${time(entry.at)}`),el('p',{},entry.reason),el('p',{class:'muted'},'依据：'+entry.evidence.join('；')));
      for(const [key,change] of Object.entries(entry.changes.blocks))details.append(el('small',{class:'cell-note'},key),el('del',{},change.before?.text??change.after?.base_text??'原文'),el('ins',{},change.after?.text??'恢复原文'));
      for(const note of entry.changes.notes)details.append(el('p',{},note.text));
      if(entry.operation!=='revert')details.append(button('撤销这次修改',()=>this.confirm('撤销这次修改','仅撤销所选修改；其他修改会保留。若同一段已被再次修改，会提示刷新核对。',{action:'lifelog-revert',correction:{request_id:crypto.randomUUID(),material_id:id,expected_source_revision:data.revision,expected_revision:data.correction_revision,agent:'admin',reason:'用户在管理后台撤销订正',evidence:['后台核对订正记录 v'+entry.revision],revert_revision:entry.revision}},{danger:true}),{class:'text-button'}));history.append(details);
     }
     if(h.has_more)history.append(button('更早的订正',event=>{event.currentTarget.remove();void loadHistory(h.next_before).catch(this.error);},{class:'text-button'}));
    };body.append(button('原文与订正历史',event=>{event.currentTarget.remove();void loadHistory().catch(this.error);},{class:'secondary'}));return;
   }
   const task=data.task,session=data.sessions.find(s=>JSON.stringify(s.route)===JSON.stringify(task.body.route)||s.route.session_id===task.body.route.session_id);
   body.append(el('h1',{},task.body.command),el('div',{class:'detail-meta'},badge(label(task.state),task.state==='completed'?'good':'muted'),el('span',{},session?.label??task.body.route.agent_id)),el('p',{class:'muted'},`更新于 ${time(task.stored_at)} · 版本 ${task.revision}`));
   body.append(el('div',{class:'inline-note'},'下方分别记录服务器保存、设备接收、眼镜显示和用户回答；收到服务器回执不代表已在眼镜上看到。'));
   const children=data.children.slice().reverse();body.append(el('h2',{},'问题与消息'),children.length?el('div',{class:'conversation'},children.map(child=>el('article',{class:'conversation-item '+child.kind},el('header',{},label(child.kind==='request'?'requests':child.kind==='answer'?'answers':'messages'),badge(label(child.state))),el('p',{},child.body.question??child.body.text??child.body.option_id??'—'),child.body.options?.length?el('ul',{},child.body.options.map(o=>el('li',{},o.label))):null,el('small',{},time(child.stored_at))))):empty('还没有问答记录','新问题、回答和进度消息会显示在这里。'));
   body.append(el('h2',{},'回执时间线'),el('ol',{class:'timeline'},data.receipts.slice().reverse().map(r=>el('li',{},el('strong',{},label(r.stage)),el('span',{},time(r.stored_at)),el('small',{},`${r.subject_kind} · ${r.subject_id} · v${r.subject_revision}`)))));
   if(data.truncated)body.append(el('p',{class:'muted'},'此详情展示最近 100 条消息与 200 条回执。'));
   body.append(el('details',{class:'technical'},el('summary',{},'标识信息'),el('dl',{},el('dt',{},'任务 ID'),el('dd',{},task.object_id),el('dt',{},'会话 ID'),el('dd',{},task.body.route.session_id),el('dt',{},'工作区'),el('dd',{},session?.workspace??task.body.route.project_id))));
  }catch(error){$('detail-content').append(el('p',{class:'inline-error'},errorText(error)));if(error.code==='ADMIN_LOGIN_REQUIRED')this.error(error);}
 }
 render(data){const content=$('workspace-content');content.replaceChildren();const add=(...nodes)=>content.append(...nodes);
  if(this.page==='overview'){
   const active=data.sessions.items.filter(s=>s.online&&s.capabilities.can_execute&&!s.delivery_paused),pending=data.queue.queue.filter(q=>q.kind==='request'&&['pending','presented'].includes(q.state)).reduce((n,q)=>n+q.count,0),flow=data.traffic,primary=data.devices.items.find(d=>d.primary);
   add(el('section',{class:'connection-flow'},el('div',{},el('small',{},'主手机'),el('strong',{},primary?.label??'尚未指定'),badge(primary?.glasses_lease_live?'投送通道有效':primary?.recent_contact?'最近有通信':'等待手机连接',primary?.glasses_lease_live?'good':'muted')),el('span',{class:'flow-arrow','aria-hidden':'true'},icon('arrow')),el('div',{class:'flow-center'},el('small',{},'iO 资料空间'),el('strong',{},'服务器已连接'),el('span',{},'任务 · 问答 · 每日总结')),el('span',{class:'flow-arrow','aria-hidden':'true'},icon('exchange')),el('div',{},el('small',{},'电脑 Agent'),el('strong',{},`${active.length} 个会话可接收指令`),el('span',{},data.sessions.default.route?'已设置默认工作区':'还没有默认工作区'))));
   add(el('div',{class:'metrics'},metric('待回答问题',num(pending),'包含尚未完成关闭回执的旧问题'),metric('可执行会话',num(active.length),`${data.sessions.items.length} 个会话已登记`),metric('每日 AI 总结',num(data.daily.count),'仅统计服务器已保存内容'),metric('最近请求速率',flow.available?flow.per_second+' / 秒':'未采集','按最近可用的 60 秒估算')));
   const panels=el('div',{class:'overview-columns'});
   if(flow.available){const polling=flow.recent_rate.requests?Math.round(100*flow.recent_rate.polling/flow.recent_rate.requests):0;panels.append(block('交互流量',el('div',{class:'section-heading'},el('span',{class:'muted'},`最近24小时 ${num(flow.totals.requests)} 次 · ${num(flow.totals.errors)} 次失败`),button('查看来源',()=>{location.hash='traffic';},{class:'text-button'})),chart(flow),el('p',{class:'chart-note'},`最近采样约 ${polling}% 是消息、身份或在线状态检查。请求次数不等于模型调用次数。`)));}
   const notes=[];if(!primary?.glasses_lease_live)notes.push(['手机投送通道待连接','已配对不等于正在连接，请确认主手机 App 与网络状态。','devices']);const unavailable=data.sessions.items.filter(s=>s.online&&!s.capabilities.can_execute);if(unavailable.length)notes.push([`${unavailable.length} 个会话在线但不可执行`,'打开工作区查看具体原因。','sessions']);if(flow.available&&flow.per_second>5)notes.push(['后台检查较频繁','查看请求来源，定位空轮询或重复连接。','traffic']);if(pending)notes.push([`${pending} 个问题尚未完成`,'可在任务详情核对有效期与回答回执。','tasks']);
   panels.append(block('需要留意',notes.length?el('div',{class:'attention-list'},notes.map(([title,text,page])=>button(el('div',{},el('strong',{},title),el('p',{},text)),()=>{location.hash=page;},{class:'attention-row'}))):empty('当前没有明显异常','需要关注的连接与交互状态会集中在这里。')));add(panels);
   add(block('最近管理操作',data.recent_actions.length?table(['时间','操作','对象'],data.recent_actions.map(a=>[time(a.at),label(a.action),a.target])):el('p',{class:'muted'},'尚未进行管理操作。')));return;
  }
  if(this.page==='devices'){
   const count=el('span',{class:'results-meta'}),search=el('input',{type:'search',value:this.deviceFilter.q,placeholder:'查找设备名称','aria-label':'查找设备名称'}),state=el('select',{'aria-label':'设备状态'},[['all','全部设备'],['active','已配对'],['revoked','已解绑']].map(([value,name])=>option(value,name))),rows=[];
   state.value=this.deviceFilter.state;
   const apply=()=>{this.deviceFilter={q:search.value,state:state.value};let shown=0;for(const row of rows){row.hidden=!row.dataset.search.includes(search.value.trim().toLowerCase())||(state.value==='active'&&row.dataset.revoked==='true')||(state.value==='revoked'&&row.dataset.revoked!=='true');if(!row.hidden)shown++;}count.textContent=shown+' / '+data.items.length+' 台';noMatch.hidden=shown>0;};
   search.addEventListener('input',apply);state.addEventListener('change',apply);add(el('div',{class:'toolbar'},el('div',{class:'search-input'},icon('search'),search),state,count));
   const body=el('tbody');for(const d of data.items){
    const status=d.revoked?'已解绑':d.delivery_paused?'投送暂停':d.recent_contact?'最近通信':'未见近期通信',tone=d.revoked||d.delivery_paused?'warn':d.recent_contact?'good':'muted';
    const actions=()=>{const controls=el('div',{class:'device-actions'});if(!d.revoked){controls.append(button('改名',()=>this.confirm('保存名称','名称用于后台和设备目录，方便识别。',{action:'rename',device_id:d.device_id},{label:d.label})),button(d.delivery_paused?'恢复投送':'暂停投送',()=>this.confirm(d.delivery_paused?'恢复投送':'暂停投送',d.delivery_paused?'恢复后设备会继续读取未接收的消息。':'暂停新的投送，现有回答与身份续期仍可同步。',{action:'delivery',device_id:d.device_id,paused:!d.delivery_paused})));
     if(d.role==='phone'&&!d.primary&&d.account_bound&&data.primary)controls.append(button('设为主手机',()=>this.confirm('切换主手机','旧手机停止新投送，新手机等待租约结束后生效，最长约20秒。',{action:'primary',device_id:d.device_id,expected_revision:data.primary.revision})));
     controls.append(button('解除配对',()=>this.confirm('解除配对',`撤销“${d.label}”的访问授权，已有资料与会话文件保留。恢复需要重新配对。`,{action:'unpair',device_id:d.device_id},{danger:true}),{class:'text-danger'}));}return controls;};
    const open=()=>{const dialog=$('detail-dialog');$('detail-content').replaceChildren(el('div',{class:'drawer-heading'},el('span',{},'设备管理'),button([icon('close'),'关闭'],()=>dialog.close())),el('div',{class:'device-detail-title'},icon(d.role==='phone'?'phone':'computer'),el('h1',{},d.label)),el('div',{class:'detail-meta'},badge(status,tone),d.primary?badge('主手机','accent'):null),el('dl',{class:'fact-list'},el('dt',{},'设备类型'),el('dd',{},d.role==='phone'?'手机':'电脑 / Agent'),el('dt',{},'连接情况'),el('dd',{},d.role==='agent'?`${d.executable_sessions} 个可执行 / ${d.sessions} 个会话`:d.glasses_lease_live?'眼镜投送通道有效':'无有效眼镜投送通道'),el('dt',{},'最近通信'),el('dd',{},time(d.last_seen)),el('dt',{},'配对时间'),el('dd',{},time(d.created_at))),actions());dialog.showModal();};
    const row=el('tr',{'data-search':d.label.toLowerCase(),'data-revoked':String(d.revoked)},el('td',{},el('div',{class:'entity-name'},icon(d.role==='phone'?'phone':'computer'),el('div',{},button(d.label,open,{class:'entity-title',title:d.label}),el('small',{class:'cell-note'},d.role==='phone'?'手机':'电脑 / Agent')))),el('td',{},el('div',{class:'status-line'},badge(status,tone),d.primary?badge('主手机','accent'):null)),el('td',{},d.role==='agent'?`${d.executable_sessions} 可执行 / ${d.sessions} 会话`:d.glasses_lease_live?'眼镜通道有效':'—'),el('td',{},el('time',{title:time(d.last_seen)},shortTime(d.last_seen))),el('td',{},el('time',{title:time(d.created_at)},shortTime(d.created_at))),el('td',{},button('管理',open,{class:'text-button','aria-label':'管理 '+d.label})));rows.push(row);body.append(row);
   }
   const noMatch=el('tr',{},el('td',{colspan:6,class:'table-empty'},data.items.length?'没有匹配的设备':'还没有配对设备，请在手机与电脑 CLI 完成配对。'));body.append(noMatch);
   add(el('section',{class:'data-panel device-list','aria-label':'设备列表'},el('div',{class:'table-wrap'},el('table',{},el('thead',{},el('tr',{},['设备','状态','会话 / 眼镜','最近通信','配对时间','操作'].map(name=>el('th',{scope:'col'},name)))),body))),el('p',{class:'footnote'},'最近通信指90秒内有请求；主手机负责眼镜投送，其余手机可保留历史访问。'));apply();return;
  }
  if(this.page==='sessions'){
   const selected=data.default_session;
   add(this.toolbar({extra:[this.selectFilter('status',[['','全部会话'],['online','在线'],['executable','可执行'],['offline','离线']]),el('span',{class:'results-meta'},data.items.length+' 个会话')]}));
   add(el('div',{class:'default-strip'},icon('folder'),el('span',{},'默认工作区'),el('strong',{},selected?.label??'尚未指定'),el('small',{title:selected?.workspace??''},selected?.workspace??'选择一个可执行会话，用于主动唤起'),selected?button('清除默认',()=>this.confirm('清除默认','之后主动唤起时需要重新选择工作区。',{action:'default',key:null,expected_revision:data.default.revision}),{class:'text-button'}):null));
   const groups=new Map();for(const session of data.items){if(!groups.has(session.workspace))groups.set(session.workspace,[]);groups.get(session.workspace).push(session);}
   const list=el('table',{},el('thead',{},el('tr',{},['会话','状态','控制能力','操作'].map(name=>el('th',{scope:'col'},name)))));
   for(const [workspace,items] of groups){
    if(!this.expandedSessions.has(workspace))this.expandedSessions.set(workspace,items.some(s=>s.online));const open=this.expandedSessions.get(workspace),body=el('tbody'),rows=[],heading=button([icon('chevron'),el('strong',{},workspace.split(/[\\/]/).filter(Boolean).pop()??workspace),el('span',{class:'group-count'},items.length+' 个会话'),el('small',{},workspace)],()=>{const expanded=!this.expandedSessions.get(workspace);this.expandedSessions.set(workspace,expanded);heading.setAttribute('aria-expanded',String(expanded));for(const row of rows)row.hidden=!expanded;},{class:'group-toggle','aria-expanded':String(open),'aria-label':'展开或折叠 '+workspace});
    body.append(el('tr',{class:'workspace-divider'},el('th',{colspan:4,scope:'rowgroup'},heading)));
    for(const session of items){const reason=session.reason?issues[session.reason]??session.reason:null,row=el('tr',{hidden:!open},el('td',{},el('div',{class:'entity-name'},icon(session.host_kind==='claude'?'tasks':'computer'),el('div',{},el('strong',{class:'session-title',title:session.label},session.label),el('small',{class:'cell-note'},label(session.host_kind))))),el('td',{},el('div',{class:'status-line',title:reason??'心跳有效'},badge(session.delivery_paused?'投送暂停':!session.online?'离线':session.capabilities.can_execute?session.busy?'执行中':'可接收指令':'在线 · 不可执行',session.online&&session.capabilities.can_execute&&!session.delivery_paused?'good':'muted'),reason?el('small',{class:'status-reason'},reason):null)),el('td',{},session.capabilities.exact_turn_interrupt?el('span',{class:'capability'},icon('check'),'支持打断'):session.capabilities.can_execute?'可接收任务':'入口未就绪'),el('td',{},session.is_default?badge('默认','accent'):button('设为默认',()=>this.confirm('设为默认',`主动唤起时使用“${session.label}”，已有任务仍回到原会话。`,{action:'default',key:session.key,expected_revision:data.default.revision}),{class:'text-button',disabled:!session.online||!session.capabilities.can_execute||session.delivery_paused})));rows.push(row);body.append(row);}list.append(body);
   }
   add(data.items.length?el('section',{class:'data-panel session-list','aria-label':'工作区会话列表'},el('div',{class:'table-wrap'},list)):empty('没有匹配的会话','调整筛选条件，或让 Agent 使用 cz-iot-cli 接入。'));return;
  }
  if(this.page==='tasks'){
   const filters=this.filters.tasks??{},tabs=el('div',{class:'filter-tabs'},[['all','当前记录'],['favorite','收藏'],['archived','归档'],['trash','回收站']].map(([key,name])=>button(name,()=>this.filter('group',key),{class:(filters.group??'all')===key?'active':''})));
   const workspaces=new Map(data.sessions.map(s=>[s.route.project_id,s.workspace.split(/[\\/]/).filter(Boolean).pop()]));add(el('div',{class:'task-tools'},tabs,this.toolbar({extra:[this.selectFilter('state',[['','全部状态'],['active','进行中'],['waiting','等待回答'],['done','已结束'],['failed','需处理']]),this.selectFilter('workspace',[['','全部工作区'],...workspaces])]})));
   const bulk=el('div',{class:'bulk-bar',hidden:true}),count=el('span',{},'选择记录后可批量整理'),selectAll=el('input',{type:'checkbox','aria-label':'全选本页任务'});const update=()=>{count.textContent=this.selected.size?`已选择 ${this.selected.size} 条`:'选择记录后可批量整理';selectAll.checked=data.items.length>0&&this.selected.size===data.items.length;selectAll.indeterminate=this.selected.size>0&&!selectAll.checked;bulk.hidden=!this.selected.size;for(const b of bulk.querySelectorAll('button'))b.disabled=!this.selected.size;};
   selectAll.addEventListener('change',()=>{this.selected=new Set(selectAll.checked?data.items.map(t=>t.object_id):[]);for(const c of content.querySelectorAll('input[data-task]'))c.checked=selectAll.checked;update();});
   add(el('div',{class:'list-selection'},el('label',{class:'check-label'},selectAll,'全选本页'),el('span',{class:'results-meta'},'共 '+num(data.total)+' 条任务')));
   bulk.append(count,...(filters.group==='trash'?[['恢复','trashed',false]]:[['收藏','favorite',true],[filters.group==='archived'?'取消归档':'归档','archived',filters.group!=='archived'],['移入回收站','trashed',true]]).map(([name,field,value])=>button(name,()=>this.confirm(name,field==='trashed'?'只整理此后台的任务记录，不删除原会话、手机记录或资料，也不会停止执行。回收站支持恢复。':'只更新后台记录的整理状态，任务会继续按原计划执行。',{action:'mark',ids:[...this.selected],field,value},{danger:field==='trashed'&&value}),{disabled:true})));
   add(bulk);const groups=new Map();for(const t of data.items){const s=data.sessions.find(s=>s.route.session_id===t.route.session_id),key=s?.workspace??t.route.project_id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...t,session:s});}
   for(const [workspace,items] of groups){if(!this.expandedTasks.has(workspace))this.expandedTasks.set(workspace,this.expandedTasks.size===0);add(el('details',{class:'workspace-group task-group',open:this.expandedTasks.get(workspace),ontoggle:event=>this.expandedTasks.set(workspace,event.target.open)},el('summary',{},icon('chevron'),el('strong',{},workspace.split(/[\\/]/).filter(Boolean).pop()),el('span',{},items.length+' 条')),table(['选择','任务','会话 / 状态','更新时间','收藏'],items.map(t=>{const checkbox=el('input',{type:'checkbox','data-task':t.object_id,'aria-label':'选择 '+t.title,onchange:event=>{if(event.target.checked)this.selected.add(t.object_id);else this.selected.delete(t.object_id);update();}});return[checkbox,button(t.title||t.object_id,()=>void this.detail('task',t.object_id),{class:'task-title'}),el('div',{},el('small',{class:'cell-note'},t.session?.label??t.route.agent_id),badge(label(t.state),t.state==='completed'?'good':t.state==='failed'?'warn':'muted'),t.deadline_passed&&t.state==='queued'?el('small',{class:'cell-note'},'原指令已过有效期'):null),el('time',{title:time(t.stored_at)},shortTime(t.stored_at)),button(icon('star'),()=>void this.action({action:'mark',ids:[t.object_id],field:'favorite',value:!t.favorite}).catch(this.error),{'aria-label':t.favorite?'取消收藏':'收藏',class:'favorite-button'+(t.favorite?' selected':'')})];}))));}
   if(!data.items.length)add(empty('没有匹配的任务','可以调整搜索条件，或查看归档和回收站。'));add(this.pager(data,50));return;
  }
  if(this.page==='daily'){
   const filters=this.filters.daily??{},from=el('input',{type:'date',value:filters.from??'','aria-label':'开始日期',onchange:event=>this.filter('from',event.target.value)}),to=el('input',{type:'date',value:filters.to??'','aria-label':'结束日期',onchange:event=>this.filter('to',event.target.value)});
   add(this.toolbar({extra:[this.selectFilter('kind',[['summary','每日总结'],['segment','分段智记'],['transcript','逐字转写']]),el('div',{class:'date-range'},el('span',{class:'filter-label'},'日期'),from,el('span',{},'至'),to),...(filters.q||filters.from||filters.to?[button('清除筛选',()=>{this.filters.daily={};void this.refresh();},{class:'text-button'})]:[])]}));
   const switcher=el('div',{class:'view-switch',role:'group','aria-label':'智记展示形式'},[['list','列表'],['cards','卡片']].map(([mode,name])=>button([icon(mode),name],()=>{
    this.dailyView=mode;localStorage.setItem('io-admin-daily-view',mode);this.render(data);content.querySelector('[data-view="'+mode+'"]').focus();
   },{'aria-pressed':String(this.dailyView===mode),'data-view':mode})));
   add(el('div',{class:'result-heading'},el('div',{},el('strong',{},'智记记录'),el('span',{class:'result-count'},num(data.total)+' 份')),switcher));
   const items=data.items.map(d=>({...d,...dailyContent(d.text,d.date),...(d.summary_stale?{title:'总结待重新订正',preview:'关联转写已经更新，旧总结暂不展示。'}:{})}));
   if(!items.length)add(el('div',{class:'data-panel'},empty('这个范围还没有已同步文字','试试其他日期或关键词；若缺少近期记录，请确认手机已完成总结同步。')));
   else if(this.dailyView==='cards'){
    add(el('div',{class:'daily-grid'},items.map(d=>el('article',{class:'daily-card'},el('header',{},el('time',{class:'date-label',datetime:d.date},d.date),el('span',{class:'sync-state'},d.summary_stale?'待更新':d.needs_review?'需核对':d.corrected?'已订正':'已同步')),button(d.title,()=>void this.detail('daily',d.id),{class:'daily-title'}),el('p',{},d.preview.slice(0,220)),el('footer',{},el('span',{},'版本 '+d.revision),el('time',{title:time(d.stored_at)},shortTime(d.stored_at)),button('导出',()=>void this.exportDaily(d.id).catch(this.error),{class:'text-button','aria-label':'导出 '+d.date+' 智记'}))))));
   }else{
    const rows=items.map(d=>[el('div',{class:'daily-date'},el('time',{datetime:d.date},d.date),el('span',{class:'sync-state'},d.summary_stale?'待更新':d.needs_review?'需核对':d.corrected?'已订正':'已同步')),el('div',{class:'daily-topic'},button(d.title,()=>void this.detail('daily',d.id),{class:'daily-title'}),el('p',{title:d.preview.slice(0,250)},d.preview)),el('span',{class:'revision'},'v'+d.revision),el('time',{title:time(d.stored_at)},shortTime(d.stored_at)),el('div',{class:'row-actions'},button('查看',()=>void this.detail('daily',d.id),{class:'text-button','aria-label':'查看 '+d.date+' 智记'}),button('导出',()=>void this.exportDaily(d.id).catch(this.error),{class:'text-button','aria-label':'导出 '+d.date+' 智记'}))]);
    add(el('section',{class:'data-panel daily-list','aria-label':'日常智记列表'},table(['日期','主题与摘要','版本','同步时间','操作'],rows)));
   }
   add(this.pager(data,30),el('p',{class:'footnote daily-scope'},'默认展示当前订正版。原文和订正历史可在详情查看；音频只保留在手机。'));return;
  }
  if(this.page==='traffic'){
   if(!data.available){add(empty('流量采集暂不可用','任务、连接和每日总结仍可独立查看。'));return;}
   const name=id=>data.devices.find(d=>d.producer_id===id)?.label??id;
   add(this.toolbar({search:false,extra:[this.selectFilter('hours',[['24','最近24小时'],['1','最近1小时'],['6','最近6小时'],['168','最近7天']]),this.selectFilter('producer',[['','全部设备'],...data.devices.map(d=>[d.producer_id,d.label])]),this.selectFilter('route',[['','全部接口'],...Object.keys(labels).filter(k=>['inbox','identity','agent-sessions','phone-presence','tasks','requests','answers','messages','receipts','materials','watches','other'].includes(k)).map(k=>[k,label(k)])]),this.selectFilter('status',[['','全部结果'],['ok','成功'],['error','失败']])]}));
   add(el('div',{class:'metrics'},metric('API 请求',num(data.totals.requests),`当前筛选 · ${data.hours} 小时`),metric('失败比例',data.totals.requests?(100*data.totals.errors/data.totals.requests).toFixed(2)+'%':'0%',`${num(data.totals.errors)} 次失败`),metric('正文传输',bytes(data.totals.request_bytes+data.totals.response_bytes),'不含 HTTP / TLS 协议开销'),metric('当前请求速率',data.per_second+' / 秒',`最近约 ${data.recent_rate.seconds} 秒采样`)));
   add(block('请求趋势',chart(data)),el('div',{class:'overview-columns'},block('请求用在哪里',table(['用途','请求','失败'],data.routes.map(r=>[el('span',{},label(r.route),el('small',{class:'cell-note'},r.method)),num(r.requests),num(r.errors)]))),block('来自哪些设备',table(['设备','请求','正文传输'],data.producers.map(r=>[name(r.producer),num(r.requests),bytes(r.request_bytes+r.response_bytes)])))));
   add(block('最近请求',el('p',{class:'muted'},`逐条日志仅保留最近最多 10,000 条 / 2 天；当前最早可见 ${time(data.recent_available_from)}。小时汇总保留 30 天。`),table(['时间','设备','接口','结果','耗时','响应'],data.recent.map(r=>[time(r.at),name(r.producer),el('span',{},label(r.route),el('small',{class:'cell-note'},r.method)),badge(r.status,r.status>=400?'warn':'good'),r.duration_ms+' ms',bytes(r.response_bytes)])),this.pager(data,50)));
   add(el('p',{class:'footnote'},'这是已认证的手机 / Agent API 请求，不是模型调用或费用。空收件箱会短等最多1秒，耗时包含等待新消息。后台自身查询不计入这些数字。'));return;
  }
  if(this.page==='audit'){add(el('p',{class:'inline-note'},'这里记录后台成功完成的管理操作，包含操作者与对象。查看资料和登录失败不记作管理变更。'),block('操作历史',table(['时间','账号','操作','对象','变更'],data.items.map(a=>[time(a.at),a.username,label(a.action),a.target,label(a.detail)]))),this.pager(data,50));return;}
  if(this.page==='settings'){
   add(block('后台账号',el('div',{class:'settings-row'},el('div',{},el('strong',{},'登录账号'),el('p',{},$('account-name').textContent)),button('修改密码',()=>$('change-password').click())),el('div',{class:'settings-row'},el('div',{},el('strong',{},'登录有效期'),el('p',{},'每次登录保留7天。主动退出或修改密码后，旧登录失效。')),badge('7 天','accent'))),block('管理范围',table(['内容','支持的操作'],[['设备与连接','改名、暂停/恢复新投送、主手机切换、解除配对'],['工作区','查看原生执行能力、设置默认会话'],['任务记录','搜索、批量选择、收藏、归档和可恢复的后台回收站'],['每日总结','按日期查阅、搜索和导出已同步的 AI 总结'],['API 日志','查看请求来源、频率、结果和近期逐条记录']]),el('p',{class:'muted'},'后台账号与手机官方账号独立。整理后台任务不会删除原生会话或手机历史；暂停新投送不会终止正在运行的任务。')));return;
  }
 }
}
