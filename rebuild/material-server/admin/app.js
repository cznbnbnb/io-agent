'use strict';
const $=id=>document.getElementById(id);
let profile=null,generation=0,refreshing=false;
const names={task:'任务',request:'问题',message:'消息',answer:'答案',receipt:'回执',queued:'排队',agent_received:'Agent 已接收',running:'执行中',waiting_answer:'等待回答',cancel_requested:'请求取消',cancelled:'已取消',completed:'已完成',failed:'失败',expired:'过期',execution_unknown:'执行状态不明',pending:'待处理',presented:'已展示',answered:'已回答',withdrawn:'已撤回',recorded:'已保存',server_stored:'服务器已存储',phone_received:'手机已接收',glasses_displayed:'眼镜已显示',user_answered:'用户已回答',task_resumed:'原任务已继续',task_completed:'任务已完成'};
const messages={ADMIN_LOGIN_FAILED:'账号或密码不正确。',ADMIN_LOGIN_REQUIRED:'登录已失效，请重新登录。',ADMIN_LOGIN_LIMITED:'尝试次数过多，请稍后再试；连续输错请等待 15 分钟。',ADMIN_USERNAME_INVALID:'账号需为 3–64 位字母、数字、点、下划线或短横线。',ADMIN_PASSWORD_INVALID:'密码需为 12–128 个字符。',ADMIN_PASSWORD_UNCHANGED:'新密码不能与当前密码相同。',ADMIN_PASSWORD_CHANGE_REQUIRED:'请先修改初始密码。',ADMIN_ORIGIN_REQUIRED:'请从原管理后台地址重新打开页面。',INVALID_ADMIN_INPUT:'填写的内容不完整，请检查后重试。'};
const label=value=>names[value]??String(value);
const number=value=>new Intl.NumberFormat('zh-CN').format(value);
function bytes(value){if(value<1024)return `${number(value)} B`;if(value<1024**2)return `${(value/1024).toFixed(1)} KiB`;return `${(value/1024**2).toFixed(1)} MiB`;}
const time=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
function rows(id,values,empty='暂无记录'){
 const body=$(id);body.replaceChildren();
 if(!values.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=10;cell.textContent=empty;row.append(cell);body.append(row);return;}
 for(const valuesOfRow of values){const row=document.createElement('tr');for(const value of valuesOfRow){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}body.append(row);}
}
async function api(route,input){
 const response=await fetch(new URL(`admin/${route}`,new URL('./',location.href)),{method:input===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:input===undefined?{}:{'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input),signal:AbortSignal.timeout(12000)});
 const value=await response.json();
 if(!response.ok){const error=new Error(messages[value.error.code]??`请求未完成（${response.status}），请重试。`);error.code=value.error.code;throw error;}
 return value;
}
function display(next){
 generation++;profile=next;$('login-panel').hidden=!!next;$('password-panel').hidden=!next?.must_change_password;$('dashboard').hidden=!next||next.must_change_password;
 $('connection').textContent=next?`已登录 · ${next.username}`:'尚未登录';$('account-name').textContent=next?.username??'';$('error').hidden=true;
 $('password-title').textContent=next?.must_change_password?'设置你的密码':'修改密码';
 $('password-description').textContent=next?.must_change_password?'首次登录，请将临时密码换成你自己的密码。':'修改后，其他浏览器的登录会同时退出。';
 $('cancel-password').textContent=next?.must_change_password?'退出登录':'返回';
 if(!next){for(const id of ['requests','upload','download','errors'])$(id).textContent='—';for(const id of ['producers','queue','receipts','recent','events'])rows(id,[],'尚未读取');$('updated').textContent='尚未读取';}
}
function showError(error){
 if(error.code==='ADMIN_LOGIN_REQUIRED')display(null);
 $('error').textContent=['TypeError','TimeoutError','AbortError'].includes(error.name)?'连接未完成，请检查网络后重试。':error.message;$('error').hidden=false;
}
async function refresh(){
 if(!profile||profile.must_change_password||refreshing)return;refreshing=true;$('refresh').disabled=true;const ticket=generation;
 try{
  const data=await api('summary');if(ticket!==generation)return;const traffic=data.traffic;
  for(const [id,key,formatter]of [['requests','requests',number],['upload','request_bytes',bytes],['download','response_bytes',bytes],['errors','errors',number]])$(id).textContent=traffic.available?formatter(traffic.totals[key]):'未采集';
  rows('producers',traffic.producers?.map(row=>[row.producer_id,number(row.requests),bytes(row.request_bytes),bytes(row.response_bytes),number(row.errors)])??[],traffic.available?'尚无已认证设备请求':'流量采集尚未启用');
  rows('queue',data.queue.map(row=>[label(row.kind),label(row.state),number(row.count)]));
  rows('receipts',data.receipts.map(row=>[label(row.stage),number(row.count)]));
  rows('recent',traffic.recent?.map(row=>[time(row.at),row.producer_id,`${row.method} ${row.route}`,row.status,bytes(row.request_bytes),bytes(row.response_bytes),`${row.duration_ms} ms`])??[]);
  rows('events',data.recent.map(row=>[time(row.stored_at),label(row.kind),row.object_id,row.revision,label(row.state)]));
  $('updated').textContent=`服务器更新时间：${time(data.server_time)}`;$('error').hidden=true;
  if(traffic.write_errors||traffic.initialization_failed){$('error').textContent='流量记录暂不完整，队列和回执仍可读取。';$('error').hidden=false;}
 }finally{refreshing=false;$('refresh').disabled=false;}
}
async function logout(){await api('logout',{});display(null);$('login-form').reset();$('password-form').reset();$('notice').hidden=true;}
for(const kind of ['login','password'])$(kind+'-form').addEventListener('submit',async event=>{
 event.preventDefault();const button=$(kind+'-submit');if(button.disabled)return;$('error').hidden=$('notice').hidden=true;
 if(kind==='password'&&$('new-password').value!==$('confirm-password').value){showError(new Error('两次输入的新密码不一致。'));return;}
 const input=kind==='login'?{username:$('username').value.trim(),password:$('password').value}:{current_password:$('current-password').value,new_password:$('new-password').value};
 const original=button.textContent;button.disabled=true;button.textContent='正在处理…';
 try{display(await api(kind,input));event.target.reset();if(kind==='password'){$('notice').textContent='密码已更新。';$('notice').hidden=false;}await refresh();}
 catch(error){showError(error);}finally{button.disabled=false;button.textContent=original;}
});
$('refresh').addEventListener('click',()=>{void refresh().catch(showError);});
$('disconnect').addEventListener('click',()=>{void logout().catch(showError);});
$('change-password').addEventListener('click',()=>{$('dashboard').hidden=true;$('password-panel').hidden=false;$('error').hidden=$('notice').hidden=true;$('current-password').focus();});
$('cancel-password').addEventListener('click',()=>{if(profile?.must_change_password)void logout().catch(showError);else{$('password-form').reset();display(profile);}});
void api('session').then(async value=>{display(value);await refresh();}).catch(error=>{display(null);if(error.code!=='ADMIN_LOGIN_REQUIRED')showError(error);});
