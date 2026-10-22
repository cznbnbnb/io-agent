import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {loadApp} from './load-app.mjs';
import {setupMaterialStore} from './material-fixture.mjs';

export const plain=value=>JSON.parse(JSON.stringify(value));
export const summaryId=n=>'rsum-'+n.toString(16).padStart(32,'0');
export const turn=()=>new Promise(setImmediate);
export async function summarySettled(service,id){for(let n=0;n<1200;n++){const v=service.status(id);if(!['running','queued'].includes(v.phase))return v;await new Promise(r=>setTimeout(r,2));}throw Error('synthetic job did not settle');}

// Actual MaterialStore, canonical references, summary service, checkpoint FS
// and SHA. Only external model/config/lifecycle ports and explicit IO faults
// are controlled. No model quality, native player or hardware is claimed.
export function summaryFixture(t,{text='不要发送报价，确认运费后再决定。',defer=false}={}){
 const cleanup=[],f=setupMaterialStore({after:fn=>cleanup.push(fn)}),handles=new Map(),events=[],requests=[],pending=[];
 assertD(f.root);let foreground=true,configError=false,sourceMissing=false,fault='',hook;
 const config={model:'synthetic-model',modelURL:'https://synthetic.invalid/v1',modelKey:'synthetic-key'},io=f.io;
 Object.assign(io,{OpenMode:{READ_ONLY:0,CREATE:1,WRITE_ONLY:2,TRUNC:4},lstatSync:fs.lstatSync,
  statSync:value=>typeof value==='number'?fs.fstatSync(value):fs.statSync(value),
  openSync(file,mode){const fd=fs.openSync(file,mode===0?'r':mode&4?'w':fs.existsSync(file)?'r+':'w');handles.set(fd,{file,mode});events.push(['open',file,mode]);return{fd};},
  closeSync(file){const fd=typeof file==='number'?file:file.fd;fs.closeSync(fd);handles.delete(fd);},
  readSync(fd,buffer,opt){return fs.readSync(fd,new Uint8Array(buffer),0,Math.min(opt.length,191),null);},
  writeSync(fd,buffer){const info=handles.get(fd);events.push(['write',info.file]);if(fault==='write'&&info.file.includes('state-'))throw Error('synthetic-write');return fs.writeSync(fd,new Uint8Array(buffer),0,Math.min(buffer.byteLength,127),null);},
  fsyncSync(fd){const info=handles.get(fd);events.push(['fsync',info.file]);if(hook){const run=hook;hook=undefined;run(info.file);}
    if(fault==='fsync'&&info.file.includes('state-'))throw Error('synthetic-fsync');fs.fsyncSync(fd);},
  renameSync(from,to){events.push(['rename',from,to]);if(fault==='rename-before'&&from.includes('state-'))throw Error('synthetic-rename');fs.renameSync(from,to);
    if(fault==='rename-after'&&from.includes('state-'))throw Error('synthetic-after-rename');}
 });
 t.after(()=>{for(const fd of handles.keys())try{fs.closeSync(fd);}catch{}handles.clear();for(const fn of cleanup)fn();});
 const platform={'@kit.CoreFileKit':{fileIo:io},'@kit.CryptoArchitectureKit':{cryptoFramework:{createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(randomBytes(n))})}),
  createMd:()=>{const hash=createHash('sha256');return{updateSync:b=>hash.update(b.data),digestSync:()=>({data:new Uint8Array(hash.digest())})};}}},
  '@kit.ArkTS':{util:{TextEncoder:class{encodeInto(value){return new TextEncoder().encode(value);}},TextDecoder:class{constructor(encoding,options){this.decoder=new TextDecoder(encoding,options);}decodeToString(bytes){return this.decoder.decode(bytes);}}}}};
 const core=loadApp('RecordingSummary',platform),plan=loadApp('RecordingSummaryPlan',platform);
 Object.assign(f.input,{text,transcriptionState:'complete',coveredMs:60000,sourceMs:60000});f.input.utterances[0].text=text;
 const base=f.store.ensure(f.source),head=f.store.appendTranscript(base.material_id,1,f.input,'synthetic-summary-source');
 const reference=plan.recordingSummaryReference(head);
 let responder=input=>JSON.stringify({entries:[{category:'fact',text:'合成模型结果：确认运费后再决定。',evidence_ids:[input.required_ids[0]]}],covered_ids:input.required_ids});
 const ports={root:()=>f.root,read:id=>sourceMissing?undefined:f.store.read(id),foreground:()=>foreground,
  config:async()=>{if(configError)throw Error('synthetic config unavailable');return{...config};},
  request:async(cfg,system,input)=>{const parsed=JSON.parse(input);requests.push({cfg:{...cfg},system,input:parsed});if(defer)return new Promise((resolve,reject)=>pending.push({resolve,reject,input:parsed}));return responder(parsed);},
  cancel:()=>events.push(['cancel']),now:()=>Date.UTC(2026,9,16,1,2,3)};
 const service=new core.RecordingSummaryService(ports),directory=id=>f.root+'/recording-summaries-v1/'+id;
 const release=(index=0,raw)=>{const item=pending[index];if(!item)throw Error('no pending synthetic response');item.resolve(raw===undefined?responder(item.input):raw);};
 function edit(next='人工更正：停止发送。'){const saved=f.store.read(head.material_id);return f.store.correctText(saved.material_id,saved.revision,saved.utterances[0].utterance_id,next);}
 return{...f,...core,plan,platform,ports,service,head,reference,config,requests,pending,events,handles,directory,release,edit,
  cold:()=>new core.RecordingSummaryService(ports),fault:value=>fault=value,onSync:fn=>hook=fn,
  foreground:value=>foreground=value,missing:value=>sourceMissing=value,configError:value=>configError=value,responder:fn=>responder=fn};
}
function assertD(root){if(!/^[Dd]:[\\/]/.test(path.resolve(root)))throw Error('owned D-drive TEMP required');}
