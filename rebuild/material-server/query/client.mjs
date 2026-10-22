import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import {createRequire} from 'node:module';
import {parseStrict} from '../json.mjs';
import {validateSpeakerMaterial} from '../validation.mjs';

export class QueryError extends Error {
  constructor(code,{status=null,retryable=false,resetRequired=false}={}){
    super(code);this.code=code;this.status=status;this.retryable=retryable;this.resetRequired=resetRequired;
  }
  toJSON(){return {code:this.code,status:this.status,retryable:this.retryable,reset_required:this.resetRequired};}
}
const fail=(code,details)=>{throw new QueryError(code,details);};
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const time=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
const principal=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const supportedErrors=new Set(['UNAUTHENTICATED','FORBIDDEN','INVALID_QUERY','MATERIAL_NOT_FOUND','MATERIAL_DELETED',
  'CURSOR_RESET_REQUIRED','UNAVAILABLE','INTERNAL','NOT_FOUND']);

// Bounded, explicit local files. No environment/argv bearer or ambient login.
export function readPrivateJson(filename,maxBytes=16384){
  let fd;
  try{
    fd=fs.openSync(filename,'r');if(!fs.fstatSync(fd).isFile())fail('INVALID_PRIVATE_FILE');
    const bytes=Buffer.alloc(maxBytes+1),length=fs.readSync(fd,bytes,0,bytes.length,0);
    if(length>maxBytes)fail('INVALID_PRIVATE_FILE');
    return parseStrict(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length)));
  }catch(e){if(e instanceof QueryError)throw e;fail('INVALID_PRIVATE_FILE');}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}

function materialValidators(){
  const require=createRequire(import.meta.url),Ajv=require('ajv/dist/2020.js'),formats=require('ajv-formats');
  const ajv=new Ajv({strict:false});formats(ajv);const result=new Map();
  for(const version of ['1','1.1','1.2']){
    const schema=JSON.parse(fs.readFileSync(new URL(`../../../docs/contracts/event-v${version}.schema.json`,import.meta.url),'utf8'));
    ajv.addSchema(schema);result.set(version==='1'?'1.0':version,ajv.getSchema(schema.$id+'#/$defs/material'));
  }
  return result;
}

export class MaterialQueryClient {
  #config;#base;#clock;#validators;
  constructor(config,{clock=Date.now}={}){
    if(!record(config)||config.schema_version!=='1.0'||Object.keys(config).some(k=>!['schema_version','base_url','owner_id',
      'producer_id','server_id','credential_file','allow_loopback_http','timeout_ms'].includes(k)))fail('INVALID_CONFIG');
    if(!principal(config.owner_id)||!principal(config.producer_id)||!principal(config.server_id)||
      typeof config.credential_file!=='string'||!config.credential_file||
      (config.allow_loopback_http!==undefined&&typeof config.allow_loopback_http!=='boolean'))fail('INVALID_CONFIG');
    let base;try{base=new URL(config.base_url);}catch{fail('INVALID_CONFIG');}
    if(base.username||base.password||base.search||base.hash||!base.pathname.endsWith('/v1/'))fail('INVALID_CONFIG');
    const loopback=['127.0.0.1','[::1]'].includes(base.hostname);
    if(base.protocol!=='https:'&&!(base.protocol==='http:'&&loopback&&config.allow_loopback_http===true))fail('HTTPS_REQUIRED');
    const timeout=config.timeout_ms??10000;
    if(!Number.isSafeInteger(timeout)||timeout<100||timeout>30000)fail('INVALID_CONFIG');
    this.#config=Object.freeze({...config,timeout_ms:timeout});this.#base=base;this.#clock=clock;this.#validators=materialValidators();
  }
  async #request(relative,token,signal,maxBytes=1048576){
    if(signal?.aborted)fail('CANCELLED');
    const url=new URL(relative,this.#base);
    if(url.origin!==this.#base.origin||!url.pathname.startsWith(this.#base.pathname)||url.href.length>8192)fail('INVALID_QUERY');
    return new Promise((resolve,reject)=>{
      let settled=false,timer,req;
      const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
        if(error)reject(error);else resolve(value);};
      const cancel=()=>{done(new QueryError('CANCELLED'));req?.destroy();};
      try{
        req=(url.protocol==='https:'?https:http).request(url,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},agent:false},res=>{
          if(res.statusCode>=300&&res.statusCode<400){done(new QueryError('REDIRECT_REFUSED',{status:res.statusCode}));res.destroy();return;}
          if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(res.headers['content-type']??'')||res.headers['content-encoding']){
            done(new QueryError('INVALID_RESPONSE'));res.destroy();return;
          }
          if(Number(res.headers['content-length'])>maxBytes){done(new QueryError('RESPONSE_TOO_LARGE'));res.destroy();return;}
          const chunks=[];let size=0;
          res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){done(new QueryError('RESPONSE_TOO_LARGE'));res.destroy();}else chunks.push(chunk);});
          res.on('error',()=>done(new QueryError('NETWORK_UNAVAILABLE',{retryable:true})));
          res.on('end',()=>{
            if(settled)return;let value;
            try{value=parseStrict(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{done(new QueryError('INVALID_RESPONSE'));return;}
            if(res.statusCode!==200){
              const code=value?.schema_version==='1.0'&&supportedErrors.has(value.error?.code)?value.error.code:'HTTP_ERROR';
              done(new QueryError(code,{status:res.statusCode,retryable:res.statusCode===429||res.statusCode>=500,
                resetRequired:code==='CURSOR_RESET_REQUIRED'}));return;
            }
            done(null,value);
          });
        });
        req.on('error',()=>done(new QueryError('NETWORK_UNAVAILABLE',{retryable:true})));
        timer=setTimeout(()=>{done(new QueryError('TIMEOUT',{retryable:true}));req.destroy();},this.#config.timeout_ms);
        signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}req.end();
      }catch{done(new QueryError('NETWORK_UNAVAILABLE',{retryable:true}));req?.destroy();}
    });
  }
  async #authenticate(scope,signal){
    const credential=readPrivateJson(this.#config.credential_file,4096);
    if(!record(credential)||typeof credential.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(credential.token)||
      !time(credential.expires_at)||Date.parse(credential.expires_at)<=this.#clock())fail('CREDENTIAL_EXPIRED_OR_INVALID');
    const identity=await this.#request('identity',credential.token,signal,16384);
    if(identity?.schema_version!=='1.0'||identity.owner_id!==this.#config.owner_id||identity.producer_id!==this.#config.producer_id||
      identity.server_id!==this.#config.server_id)fail('IDENTITY_MISMATCH');
    if(!Array.isArray(identity.scopes)||!identity.scopes.includes(scope))fail('FORBIDDEN',{status:403});
    if(!time(identity.expires_at)||Date.parse(identity.expires_at)<=this.#clock())fail('CREDENTIAL_EXPIRED_OR_INVALID');
    return credential.token;
  }
  #source(body,utterance=null){
    return {server_id:this.#config.server_id,owner_id:this.#config.owner_id,material_id:body.material_id,revision:body.revision,
      text_revision:body.text_revision,utterance_id:utterance?.utterance_id??null,start_ms:utterance?.start_ms??null,end_ms:utterance?.end_ms??null,
      ...(utterance?.source_range?{source_range:{...utterance.source_range},parent_source_ref:{server_id:this.#config.server_id,
        owner_id:this.#config.owner_id,material_id:body.material_id,revision:utterance.source_range.parent_revision,
        utterance_id:utterance.source_range.parent_utterance_id,start_ms:utterance.source_range.start_ms,end_ms:utterance.source_range.end_ms}}:{})};
  }
  #item(item,keyword){
    const validate=this.#validators.get(item?.schema_version);
    if(!record(item)||!validate||!validate(item.body)||!positive(item.commit_seq)||!time(item.stored_at))fail('INVALID_RESPONSE');
    const body=item.body;
    if(item.schema_version==='1.2')try{validateSpeakerMaterial(body);}catch{fail('INVALID_RESPONSE');}
    if(body.operation==='delete')return {...item,source_ref:this.#source(body),matches:[],withdrawn:true};
    const matches=[];let count=0;
    const add=(text,kind,utterance)=>{
      if(!text)return;const at=keyword?text.toLowerCase().indexOf(keyword.toLowerCase()):0;if(at<0)return;count++;
      if(matches.length>=10)return;
      const chars=Array.from(text),index=Array.from(text.slice(0,at)).length,start=Math.max(0,index-80),end=Math.min(chars.length,index+160);
      const speaker=body.speakers?.find(s=>s.speaker_id===utterance?.speaker_id)??null;
      matches.push({kind,excerpt:chars.slice(start,end).join(''),excerpt_truncated:start>0||end<chars.length,
        source_ref:this.#source(body,utterance),speaker_id:utterance?.speaker_id??null,speaker_basis:utterance?.speaker_basis??'unknown',
        ...(item.schema_version==='1.2'?{speaker:speaker?{...speaker}:null}:{})});
    };
    add(body.full_text?.text,'full_text',null);
    for(const utterance of body.utterances)add(utterance.text,'utterance',utterance);
    return {...item,source_ref:this.#source(body),withdrawn:false,matches,matches_truncated:count>matches.length,
      evidence:{completeness:body.completeness,processing:body.processing??null,
        transcription_state:body.processing?.transcription_state??'unknown',speaker_processing:body.processing?.speaker??'unknown',
        audio_state:body.audio.state,audio_playback_available:false,content_role:'source_data'}};
  }
  #result(operation,items,freshness,pagination){
    return {tool_schema_version:'1.0',operation,service:{server_id:this.#config.server_id,owner_id:this.#config.owner_id,
      producer_id:this.#config.producer_id},retrieved_at:new Date(this.#clock()).toISOString(),
      freshness:{...freshness,scope:'server_stored_only',phone_sync_status:'unknown'},...pagination,items};
  }
  async #page(operation,options,signal){
    if(!record(options))fail('INVALID_QUERY');
    const allowed=operation==='changes'?['limit','cursor']:['from','to','keyword','speaker','limit','cursor'];
    if(Object.keys(options).some(k=>!allowed.includes(k)))fail('INVALID_QUERY');
    const query=new URLSearchParams();
    for(const [key,value] of Object.entries(options)){
      if(key==='limit'){if(!positive(value)||value>50)fail('INVALID_QUERY');}
      else if(typeof value!=='string'||!value||value.length>(key==='cursor'?4096:512))fail('INVALID_QUERY');
      query.set(key,String(value));
    }
    if((options.from&&!time(options.from))||(options.to&&!time(options.to))||
      (options.from&&options.to&&Date.parse(options.from)>Date.parse(options.to)))fail('INVALID_QUERY');
    const token=await this.#authenticate(operation==='changes'?'changes:read':'materials:read',signal);
    const page=await this.#request(`${operation==='changes'?'changes':'materials'}?${query}`,token,signal);
    if(!record(page)||!Array.isArray(page.items)||page.items.length>(options.limit??20)||typeof page.has_more!=='boolean'||
      typeof page.next_cursor!=='string'||!page.next_cursor||page.next_cursor.length>4096||!time(page.server_time)||
      !time(page.fresh_until)||Date.parse(page.fresh_until)>Date.parse(page.server_time)||
      (page.has_more&&page.items.length===0))fail('INVALID_RESPONSE');
    const items=page.items.map(item=>this.#item(item,options.keyword));
    if(operation==='search'&&items.some(item=>item.withdrawn))fail('INVALID_RESPONSE');
    if(items.some((item,index)=>index>0&&item.commit_seq<=items[index-1].commit_seq))fail('INVALID_RESPONSE');
    return this.#result(operation,items,{server_time:page.server_time,fresh_until:page.fresh_until},
      {has_more:page.has_more,next_cursor:page.next_cursor,filters:{...options,cursor:undefined,limit:undefined}});
  }
  search(options={},signal){return this.#page('search',options,signal);}
  changes(options={},signal){return this.#page('changes',options,signal);}
  async get(options={},signal){
    if(!record(options)||Object.keys(options).some(k=>!['material_id','revision'].includes(k)))fail('INVALID_QUERY');
    const {material_id,revision}=options;
    if(typeof material_id!=='string'||!material_id||['.','..'].includes(material_id)||material_id.length>128||revision!==undefined&&!positive(revision))fail('INVALID_QUERY');
    const token=await this.#authenticate('materials:read',signal);
    const value=await this.#request(`materials/${encodeURIComponent(material_id)}${revision===undefined?'':`?revision=${revision}`}`,token,signal);
    const item=this.#item(value);
    if(item.body.material_id!==material_id||(revision!==undefined&&item.body.revision!==revision)||item.withdrawn)fail('INVALID_RESPONSE');
    // Single-object endpoint exposes stored_at, not a server freshness clock.
    return this.#result('get',[item],{server_time:null,fresh_until:null},{has_more:false,next_cursor:null});
  }
}
