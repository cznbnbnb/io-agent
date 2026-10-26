import {materialWire} from './material-transfer.mjs';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {ApiError,parseStrict,reject} from './json.mjs';
import fs from 'node:fs';
import {trafficObservation} from './traffic.mjs';

const ADMIN_ASSETS=new Map([
  ['/v1/admin',['admin/index.html','text/html; charset=utf-8']],
  ['/v1/admin/app.js',['admin/app.js','text/javascript; charset=utf-8']],
  ['/v1/admin/style.css',['admin/style.css','text/css; charset=utf-8']]
].map(([route,[file,type]])=>[route,{data:fs.readFileSync(new URL(file,import.meta.url)),type}]));

function audioArchive(store){if(!store.audio)reject(503,'AUDIO_UNAVAILABLE');return store.audio;}

function decoded(value){try{return decodeURIComponent(value);}catch{reject(400,'INVALID_QUERY');}}
async function smallJson(req,observation,limit=8192){
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')||req.headers['content-encoding'])reject(415,'UNSUPPORTED_MEDIA_TYPE');
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;observation.request_bytes=size;if(size>limit)reject(413,'PAYLOAD_TOO_LARGE');chunks.push(chunk);}
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{reject(400,'INVALID_UNICODE');}
  return parseStrict(text);
}

// P40 queue intake paths and their object kinds.
const QUEUE_PATHS=new Map([['/v1/tasks','task'],['/v1/requests','request'],['/v1/answers','answer'],['/v1/messages','message'],['/v1/receipts','receipt']]);
const QUEUE_READS={tasks:'task',requests:'request',messages:'message'};

export function createServer(store,{traffic=null,trafficUnavailable=false}={}){
  const telemetry={write_errors:0};
  const server=http.createServer(async(req,res)=>{
    const observation=trafficObservation(req);
    const send=(status,body)=>{const data=JSON.stringify(body);
      try{observation.record(traffic,status,Buffer.byteLength(data));}catch{telemetry.write_errors++;}
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
      'Content-Length':Buffer.byteLength(data),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);};
    try{
      if((req.url?.length??0)>8192)reject(414,'INVALID_QUERY');
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&ADMIN_ASSETS.has(url.pathname)){
        if(url.search)reject(400,'INVALID_QUERY');
        const asset=ADMIN_ASSETS.get(url.pathname);
        res.writeHead(200,{'Content-Type':asset.type,'Content-Length':asset.data.length,'Cache-Control':'no-store',
          'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
          'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});
        res.end(asset.data);return;
      }
      if(req.method==='GET'&&url.pathname==='/health'&&!url.search){send(200,{service:'turboio-materials',database_version:1});return;}
      // One-time pairing code exchange: the only unauthenticated write (devices.mjs rate-limits it).
      if(req.method==='POST'&&url.pathname==='/v1/pair'){
        if(url.search||req.headers.authorization)reject(400,'INVALID_QUERY');observation.route='pair';
        send(200,store.devices.pair(await smallJson(req,observation,1024)));return;
      }
      // No credentials in query strings, duplicate Authorization or ambiguous queries.
      const headers=req.rawHeaders.filter((_,i)=>i%2===0).map(h=>h.toLowerCase());
      if(headers.filter(h=>h==='authorization').length!==1)reject(401,'UNAUTHENTICATED');
      const bearer=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'');if(!bearer)reject(401,'UNAUTHENTICATED');
      const token=bearer[1],query={};
      observation.principal=store.auth(token);
      const route=/^\/v1\/(identity|materials|material-events|material-uploads|material-content|changes|inbox|tasks|requests|answers|messages|receipts|events|watches|pairings|credentials|devices|agent-sessions|agent-default)(?:\/|$)/.exec(url.pathname)?.[1];
      observation.route=['material-events','material-uploads','material-content'].includes(route)?'materials':
        ['agent-sessions','agent-default'].includes(route)?'other':route??'other';
      for(const [key,value] of url.searchParams){if(Object.hasOwn(query,key))reject(400,'INVALID_QUERY');query[key]=value;}
      if(req.method==='GET'&&url.pathname==='/v1/operations/summary'){
        observation.principal=null; // 管理页面刷新不计入设备转发流量。
        if(Object.keys(query).some(key=>key!=='hours')||query.hours!==undefined&&!/^[1-9]\d*$/.test(query.hours))reject(400,'INVALID_QUERY');
        const hours=Number(query.hours??24);if(hours>168)reject(400,'INVALID_QUERY');
        const summary=store.operations(token);
        const flow=traffic?traffic.snapshot(summary.owner_id,hours):{available:false};
        send(200,{...summary,traffic:{...flow,write_errors:telemetry.write_errors,initialization_failed:trafficUnavailable}});return;
      }
      if(req.method==='GET'&&url.pathname==='/v1/identity'){
        if(url.search)reject(400,'INVALID_QUERY');send(200,store.identity(token));return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/pairings'){if(url.search)reject(400,'INVALID_QUERY');send(200,store.devices.createPairing(token,await smallJson(req,observation)));return;}
      if(req.method==='POST'&&url.pathname==='/v1/credentials/refresh'){if(url.search)reject(400,'INVALID_QUERY');send(200,store.devices.refresh(token));return;}
      if(req.method==='GET'&&url.pathname==='/v1/devices'){if(url.search)reject(400,'INVALID_QUERY');send(200,store.devices.list(token));return;}
      if(req.method==='GET'&&url.pathname==='/v1/agent-sessions'){if(url.search)reject(400,'INVALID_QUERY');send(200,store.agentSessions.list(token));return;}
      if(req.method==='POST'&&url.pathname==='/v1/agent-sessions'){if(url.search)reject(400,'INVALID_QUERY');send(200,store.agentSessions.publish(token,await smallJson(req,observation)));return;}
      if(req.method==='PUT'&&url.pathname==='/v1/agent-default'){if(url.search)reject(400,'INVALID_QUERY');send(200,store.agentSessions.setDefault(token,await smallJson(req,observation)));return;}
      const device=/^\/v1\/devices\/([^/]+)$/.exec(url.pathname);
      if(device&&req.method==='DELETE'){if(url.search)reject(400,'INVALID_QUERY');send(200,store.devices.revokeBy(token,decoded(device[1])));return;}
      const watch=/^\/v1\/watches\/([^/]+)$/.exec(url.pathname);
      if(watch&&req.method==='GET'){if(url.search)reject(400,'INVALID_QUERY');send(200,store.watchGet(token,decoded(watch[1])));return;}
      if(watch&&req.method==='PUT'){
        if(url.search)reject(400,'INVALID_QUERY');
        if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')||req.headers['content-encoding'])reject(415,'UNSUPPORTED_MEDIA_TYPE');
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;observation.request_bytes=size;if(size>8192)reject(413,'PAYLOAD_TOO_LARGE');chunks.push(chunk);}
        let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{reject(400,'INVALID_UNICODE');}
        send(200,store.watchSet(token,decoded(watch[1]),parseStrict(text)));return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/audio-uploads'){
        observation.route='materials';if(url.search)reject(400,'INVALID_QUERY');store.auth(token,'audio:write');
        send(200,audioArchive(store).begin(token,await smallJson(req,observation)));return;
      }
      const audioUpload=/^\/v1\/audio-uploads\/([a-f0-9]{64})(?:\/(finalize|parts\/(0|[1-9]\d*)))?$/.exec(url.pathname);
      if(audioUpload){
        observation.route='materials';if(url.search)reject(400,'INVALID_QUERY');store.auth(token,'audio:write');
        if(req.method==='GET'&&!audioUpload[2]){send(200,audioArchive(store).status(token,audioUpload[1]));return;}
        if(req.method==='POST'&&audioUpload[3]!==undefined){send(200,audioArchive(store).put(token,audioUpload[1],Number(audioUpload[3]),await smallJson(req,observation,262144)));return;}
        if(req.method==='POST'&&audioUpload[2]==='finalize'){
          const v=await smallJson(req,observation);if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).length)reject(400,'INVALID_AUDIO_MANIFEST');
          send(200,audioArchive(store).finalize(token,audioUpload[1]));return;
        }
      }
      const audio=/^\/v1\/audio\/([a-f0-9]{64})$/.exec(url.pathname);
      if(audio&&req.method==='GET'){
        store.auth(token,'audio:read');observation.route='materials';if(Object.keys(query).some(k=>k!=='index')||query.index!==undefined&&!/^(0|[1-9]\d*)$/.test(query.index))reject(400,'INVALID_QUERY');
        send(200,query.index===undefined?audioArchive(store).get(token,audio[1]):audioArchive(store).content(token,audio[1],Number(query.index)));return;
      }
      const materialAudio=/^\/v1\/material-audio\/([^/]+)$/.exec(url.pathname);
      if(materialAudio&&req.method==='GET'){
        store.auth(token,'audio:read');observation.route='materials';if(Object.keys(query).some(k=>!['after','limit'].includes(k))||query.limit!==undefined&&!/^[1-9]\d*$/.test(query.limit))reject(400,'INVALID_QUERY');
        send(200,audioArchive(store).list(token,decoded(materialAudio[1]),{after:query.after??null,limit:query.limit===undefined?50:Number(query.limit)}));return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/material-cancellations'){
        observation.route='materials';if(url.search)reject(400,'INVALID_QUERY');store.auth(token,'materials:write');
        send(200,store.cancelMaterial(token,await smallJson(req,observation)));return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/material-uploads'){
        if(url.search)reject(400,'INVALID_QUERY');store.auth(token,'materials:write');
        send(200,store.transfer.begin(token,await smallJson(req,observation)));return;
      }
      const upload=/^\/v1\/material-uploads\/([a-f0-9]{64})(?:\/(finalize|parts\/(0|[1-9]\d*)))?$/.exec(url.pathname);
      if(upload){
        if(url.search)reject(400,'INVALID_QUERY');store.auth(token,'materials:write');
        if(req.method==='GET'&&!upload[2]){send(200,store.transfer.status(token,upload[1]));return;}
        if(req.method==='POST'&&upload[3]!==undefined){send(200,store.transfer.put(token,upload[1],Number(upload[3]),await smallJson(req,observation,262144)));return;}
        if(req.method==='POST'&&upload[2]==='finalize'){
          const input=await smallJson(req,observation);
          if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)reject(400,'INVALID_UPLOAD');
          const result=store.transfer.finalize(token,upload[1]);send(result.status,result.body);return;
        }
      }
      const content=/^\/v1\/material-content\/([^/]+)$/.exec(url.pathname);
      if(content&&req.method==='GET'){
        if(Object.keys(query).sort().join()!=='index,revision'||!/^0$|^[1-9]\d*$/.test(query.index)||! /^[1-9]\d*$/.test(query.revision))reject(400,'INVALID_QUERY');
        send(200,store.transfer.content(token,decoded(content[1]),Number(query.revision),Number(query.index)));return;
      }
      const lifecycle=/^\/v1\/requests\/([^/]+)\/reconcile$/.exec(url.pathname);
      if(req.method==='POST'&&(url.pathname==='/v1/material-events'||QUEUE_PATHS.has(url.pathname)||lifecycle)){
        if(url.search)reject(400,'INVALID_QUERY');
        const kind=QUEUE_PATHS.get(url.pathname)??null;
        // Queue scope depends on the body (task revision, receipt stage); store enforces it.
        store.auth(token,lifecycle?'requests:write':kind?null:'materials:write');
        if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))reject(415,'UNSUPPORTED_MEDIA_TYPE');
        if(req.headers['content-encoding'])reject(415,'UNSUPPORTED_MEDIA_TYPE');
        if(Number(req.headers['content-length'])>262144)reject(413,'PAYLOAD_TOO_LARGE');
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;observation.request_bytes=size;if(size>262144)reject(413,'PAYLOAD_TOO_LARGE');chunks.push(chunk);}
        let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{reject(400,'INVALID_UNICODE');}
        const event=parseStrict(text);
        if(lifecycle){send(200,store.reconcileRequest(token,decoded(lifecycle[1]),event));return;}
        const result=kind?store.queueSubmit(token,event,kind):store.submit(token,event);send(result.status,result.body);return;
      }
      if(req.method==='GET'&&(url.pathname==='/v1/materials'||url.pathname==='/v1/changes')){
        send(200,store.page(token,url.pathname.endsWith('changes')?'changes':'materials',query));return;
      }
      if(req.method==='GET'&&url.pathname==='/v1/inbox'){send(200,store.inbox(token,query));return;}
      const queueObject=/^\/v1\/(tasks|requests|messages)\/([^/]+)$/.exec(url.pathname);
      if(req.method==='GET'&&queueObject){
        if(url.search)reject(400,'INVALID_QUERY');
        send(200,store.queueGet(token,QUEUE_READS[queueObject[1]],decoded(queueObject[2])));return;
      }
      const material=/^\/v1\/materials\/([^/]+)$/.exec(url.pathname),event=/^\/v1\/events\/([^/]+)$/.exec(url.pathname);
      if(req.method==='GET'&&material){
        if(Object.keys(query).some(k=>!['revision','content'].includes(k))||query.content!==undefined&&query.content!=='reference'||(query.revision!==undefined&&!/^[1-9]\d*$/.test(query.revision)))reject(400,'INVALID_QUERY');
        send(200,materialWire(store.get(token,decoded(material[1]),query.revision===undefined?null:Number(query.revision)),query.content));return;
      }
      if(req.method==='GET'&&event){if(url.search)reject(400,'INVALID_QUERY');send(200,store.event(token,decoded(event[1])));return;}
      reject(404,'NOT_FOUND');
    }catch(error){
      const busy=String(error?.code??'').includes('SQLITE_BUSY')||error?.errcode===5;
      const known=error instanceof ApiError,status=known?error.status:busy?503:500,code=known?error.code:busy?'UNAVAILABLE':'INTERNAL';
      if(!res.headersSent&&!res.destroyed)send(status,{schema_version:'1.0',error:{code,message:code,retryable:status===503,
        correlation_id:randomUUID(),...(known?error.details:{}),...(busy?{retry_after_ms:1000}:{})}});
      // Deliberately no request URL/body, credentials, SQL values or exception stack logging.
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=2000;server.maxHeadersCount=32;
  return server;
}

export async function listen(store,port=0,options={}){
  const server=createServer(store,options);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return server;
}
