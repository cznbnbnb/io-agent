import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import qr from './vendor/qrcode.cjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
export const BASE='https://cznbnb.cn/io-api/v1/';
export async function exchange(base,action,input,{fetchImpl=fetch,allowLoopback=false}={}){
 const u=new URL(base);if(u.href!==BASE&&!(allowLoopback&&u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname)&&u.pathname==='/v1/'&&!u.search&&!u.hash&&!u.username&&!u.password))fail('PAIRING_SERVER_INVALID');
 if(!['start','claim'].includes(action))fail('PAIRING_ACTION_INVALID');
 const r=await fetchImpl(new URL('session-pairings/'+action,u),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(input)});
 if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(r.headers.get('content-type')??'')){await r.body?.cancel();fail('PAIRING_RESPONSE_INVALID');}
 const reader=r.body.getReader(),chunks=[];let size=0;try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();fail('PAIRING_RESPONSE_INVALID');}chunks.push(value);}}finally{reader.releaseLock();}
 const body=JSON.parse(Buffer.concat(chunks));if(!r.ok)fail(/^[A-Z_]+$/.test(body?.error?.code??'')?body.error.code:'PAIRING_HTTP_ERROR');return body;
}
export function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{fs.rmSync(temp,{force:true});}}
export function validateClaim(body,metadata,previous=null){
 if(body.pending!==false||!body.device_id||body.role!=='agent'||!['owner_id','producer_id','server_id','token_id'].every(k=>typeof body[k]==='string'&&body[k])||!/^[A-Za-z0-9_-]{43}$/.test(body.token??'')||!Number.isFinite(Date.parse(body.refresh_after))||Date.parse(body.expires_at)<=Date.now()||!isDeepStrictEqual(body.metadata,metadata)||previous&&['device_id','owner_id','producer_id','server_id'].some(k=>body[k]!==previous[k]))fail('PAIRING_BINDING_MISMATCH');
 return body;
}
export async function renewSession(credential,fetchImpl){
 const body=await exchange(credential.base_url,'claim',{id:credential.session_pairing.id,claim_secret:credential.session_pairing.claim_secret},{fetchImpl,allowLoopback:credential.allow_loopback_http===true});
 validateClaim(body,credential.session_pairing.metadata,credential);if(body.id!==credential.session_pairing.id)fail('PAIRING_BINDING_MISMATCH');return {...credential,...body};
}
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function pairingHtml(start,metadata){
 const computer=metadata.mode==='computer';
 const code=qr(0,'M');code.addData(start.qr_url);code.make();
 return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'"><title>连接 iO Agent</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#0d100f;color:#f0f3f1;margin:0;padding:32px 20px}main{max-width:480px;margin:auto}h1{font-size:26px}p{color:#a2afa5}.qr{background:white;border-radius:18px;padding:20px;width:260px;margin:24px auto}.qr svg{display:block;width:100%;height:auto}textarea{box-sizing:border-box;width:100%;resize:none;background:#1b2720;border:1px solid #34463b;border-radius:13px;color:#f0f3f1;padding:14px;font:14px/1.6 monospace}strong{color:#02a97b}small{overflow-wrap:anywhere}</style><main><strong>iO Agent</strong><h1>'+ (computer?'配对这台电脑':'绑定当前会话') +'</h1><p>'+escape(metadata.runtime+' · '+metadata.topic)+'</p><small>'+escape(metadata.route.session_id)+'</small><div class="qr">'+code.createSvgTag({cellSize:4,margin:16,scalable:true})+'</div><p>手机打开 iO Agent → 电脑连接 → 添加 Agent 会话。扫码，或复制下方配对字符串，核对'+(computer?'电脑授权范围':'会话')+'后保存。</p><textarea readonly rows="5" aria-label="配对字符串">'+escape(start.pairing_string)+'</textarea><p>'+(computer?'授权这台电脑上后续使用 iO CLI 的 Agent 会话自动接入，可在账号设备中撤销。':'仅绑定当前会话。')+'10 分钟内有效，保存后自动续期。</p><small>失效时间：'+escape(start.expires_at)+'</small></main></html>';
}
