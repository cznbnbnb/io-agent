'use strict';
const $=id=>document.getElementById(id);
let credential='',generation=0,busy=false,controller=null;
const names={task:'任务',request:'问题',message:'消息',answer:'答案',receipt:'回执',queued:'排队',agent_received:'Agent 已接收',running:'执行中',waiting_answer:'等待回答',cancel_requested:'请求取消',cancelled:'已取消',completed:'已完成',failed:'失败',expired:'过期',execution_unknown:'执行状态不明',pending:'待处理',presented:'已展示',answered:'已回答',withdrawn:'已撤回',recorded:'已保存',server_stored:'服务器已存储',phone_received:'手机已接收',glasses_displayed:'眼镜已显示',user_answered:'用户已回答',task_resumed:'原任务已继续',task_completed:'任务已完成'};
const label=value=>names[value]??String(value);
const number=value=>new Intl.NumberFormat('zh-CN').format(value);
function bytes(value){if(value<1024)return `${number(value)} B`;if(value<1024**2)return `${(value/1024).toFixed(1)} KiB`;return `${(value/1024**2).toFixed(1)} MiB`;}
const time=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
function rows(id,values,empty='暂无记录'){
 const body=$(id);body.replaceChildren();
 if(!values.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=10;cell.textContent=empty;row.append(cell);body.append(row);return;}
 for(const valuesOfRow of values){const row=document.createElement('tr');for(const value of valuesOfRow){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}body.append(row);}
}
function clear(){for(const id of ['requests','upload','download','errors'])$(id).textContent='—';for(const id of ['producers','queue','receipts','recent','events'])rows(id,[],'尚未读取');$('updated').textContent='尚未读取';}
function disconnect(){generation++;controller?.abort();controller=null;busy=false;credential='';$('token').value='';$('refresh').disabled=$('disconnect').disabled=true;$('connection').textContent='未连接';$('error').hidden=true;clear();}
async function refresh(){
 if(!credential||busy)return;busy=true;const ticket=generation,requestController=new AbortController();controller=requestController;const timeout=setTimeout(()=>requestController.abort(),10000);$('error').hidden=true;$('connection').textContent='读取中';
 try{
  const url=new URL('operations/summary',new URL('./',location.href));
  const response=await fetch(url,{headers:{Authorization:`Bearer ${credential}`},cache:'no-store',redirect:'error',signal:requestController.signal});
  if(!response.ok)throw new Error(response.status===401?'凭据无效或已过期':response.status===403?'该凭据没有只读管理权限':`接口返回 ${response.status}`);
  const data=await response.json();if(ticket!==generation)return;
  const traffic=data.traffic;
  for(const [id,key,formatter]of [['requests','requests',number],['upload','request_bytes',bytes],['download','response_bytes',bytes],['errors','errors',number]])$(id).textContent=traffic.available?formatter(traffic.totals[key]):'未采集';
  rows('producers',traffic.producers?.map(row=>[row.producer_id,number(row.requests),bytes(row.request_bytes),bytes(row.response_bytes),number(row.errors)])??[],traffic.available?'尚无已认证设备请求':'流量采集尚未启用');
  rows('queue',data.queue.map(row=>[label(row.kind),label(row.state),number(row.count)]));
  rows('receipts',data.receipts.map(row=>[label(row.stage),number(row.count)]));
  rows('recent',traffic.recent?.map(row=>[time(row.at),row.producer_id,`${row.method} ${row.route}`,row.status,bytes(row.request_bytes),bytes(row.response_bytes),`${row.duration_ms} ms`])??[]);
  rows('events',data.recent.map(row=>[time(row.stored_at),label(row.kind),row.object_id,row.revision,label(row.state)]));
  $('connection').textContent=!traffic.available?'已连接，流量采集未启用':traffic.write_errors?'已连接，流量记录有缺失':'已连接';
  $('updated').textContent=`服务器更新时间：${time(data.server_time)}`;
  if(traffic.write_errors){$('error').textContent=`流量账本写入失败 ${traffic.write_errors} 次，统计可能不完整。业务收据仍单独判断。`;$('error').hidden=false;}
  if(traffic.initialization_failed){$('error').textContent='流量账本启动失败，队列仍可读取；请检查服务端账本，统计不可用。';$('error').hidden=false;}
 }catch(error){if(ticket===generation){$('connection').textContent='连接失败';$('error').textContent=error.name==='AbortError'?'连接超时，请重试':error.message;$('error').hidden=false;}}
 finally{clearTimeout(timeout);if(ticket===generation){busy=false;controller=null;}}
}
$('connect').addEventListener('click',()=>{
 if(location.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(location.hostname)){$('error').textContent='请通过 HTTPS 打开管理入口。';$('error').hidden=false;return;}
 const value=$('token').value.trim();if(!/^[A-Za-z0-9_-]{43}$/.test(value)){$('error').textContent='请输入有效的只读管理凭据。';$('error').hidden=false;return;}
 disconnect();credential=value;$('refresh').disabled=$('disconnect').disabled=false;void refresh();
});
$('refresh').addEventListener('click',refresh);$('disconnect').addEventListener('click',disconnect);
