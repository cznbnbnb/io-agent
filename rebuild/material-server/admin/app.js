'use strict';
const $=id=>document.getElementById(id);
let profile=null;
import {AdminView} from './console.js';
const view=new AdminView({api:(...args)=>api(...args),error:showError});
const messages={ADMIN_LOGIN_FAILED:'账号或密码不正确。',ADMIN_LOGIN_REQUIRED:'登录已失效，请重新登录。',ADMIN_LOGIN_LIMITED:'尝试次数过多，请稍后再试；连续输错请等待 15 分钟。',ADMIN_USERNAME_INVALID:'账号需为 3–64 位字母、数字、点、下划线或短横线。',ADMIN_PASSWORD_INVALID:'密码需为 12–128 个字符。',ADMIN_PASSWORD_UNCHANGED:'新密码不能与当前密码相同。',ADMIN_PASSWORD_CHANGE_REQUIRED:'请先修改初始密码。',ADMIN_ORIGIN_REQUIRED:'请从原管理后台地址重新打开页面。',INVALID_ADMIN_INPUT:'填写的内容不完整，请检查后重试。'};
async function api(route,input,query={}){
 const url=new URL(`admin/${route}`,new URL('./',location.href));for(const [key,value] of Object.entries(query))if(value!==undefined&&value!=='')url.searchParams.set(key,value);
 const response=await fetch(url,{method:input===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:input===undefined?{}:{'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input),signal:AbortSignal.timeout(12000)});
 const value=await response.json();
 if(!response.ok){const error=new Error(messages[value.error.code]??`请求未完成（${response.status}），请重试。`);error.code=value.error.code;throw error;}
 return value;
}
function display(next){
 profile=next;$('login-panel').hidden=!!next;$('password-panel').hidden=!next?.must_change_password;$('dashboard').hidden=!next||next.must_change_password;
 $('connection').textContent=next?`已登录 · ${next.username}`:'尚未登录';$('account-name').textContent=next?.username??'';$('error').hidden=true;
 $('password-title').textContent=next?.must_change_password?'设置你的密码':'修改密码';
 $('password-description').textContent=next?.must_change_password?'首次登录，请将临时密码换成你自己的密码。':'修改后，其他浏览器的登录会同时退出。';
 $('cancel-password').textContent=next?.must_change_password?'退出登录':'返回';
 if(!next){view.clear();$('updated').textContent='';}
}
function showError(error){
 if(error.code==='ADMIN_LOGIN_REQUIRED')display(null);
 $('error').textContent=['TypeError','TimeoutError','AbortError'].includes(error.name)?'连接未完成，请检查网络后重试。':error.message;$('error').hidden=false;
}
async function refresh(){if(profile&&!profile.must_change_password)await view.refresh();}
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
