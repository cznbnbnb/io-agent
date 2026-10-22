import {createHash} from 'node:crypto';

const clone=value=>JSON.parse(JSON.stringify(value));
const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
// An explicit in-process synthetic SOURCE PORT, not TaskVoiceSources and not a
// disk/boot/connection validation fixture. It supplies controlled receipts to
// session tests; real source-store persistence/integration has separate tests.
export function syntheticTaskSources({connection=()=>({peer:'synthetic-peer',epoch:7})}={}){
 const receipts=new Map();let checks=0,origins=0;
 const bound=b=>digest(JSON.stringify(b));
 const make=(binding,attempt,peer,epoch,text)=>({schema:1,attempt_id:attempt,peer,connection_epoch:epoch,
  binding_sha256:bound(binding),text_sha256:digest(text)});
 const store=(binding,attempt,peer,epoch,text,state)=>{
  const ref=make(binding,attempt,peer,epoch,text),prior=receipts.get(attempt);
  if(prior){if(JSON.stringify(prior.ref)!==JSON.stringify(ref)||prior.state!==state)throw Error('SYNTHETIC_SOURCE_CONFLICT');return clone(prior.ref);}
  receipts.set(attempt,{ref:clone(ref),state});return clone(ref);
 };
 const register=(binding,attempt,peer,epoch,text)=>{
  const current=connection();if(!Number.isSafeInteger(epoch)||epoch<=0||current.epoch!==epoch||current.peer!==peer)throw Error('SYNTHETIC_SOURCE_CONNECTION');
  return store(binding,attempt,peer,'synthetic-live:'+epoch,text,'watching');
 };
 const restore=(binding,attempt,peer,text)=>{
  // Cold copying is allowed to retain words, but can never establish a fresh
  // source. A previously issued reference stays the same and becomes unknown.
  const prior=receipts.get(attempt);
  if(prior){if(prior.ref.binding_sha256!==bound(binding)||prior.ref.text_sha256!==digest(text)||prior.ref.peer!==peer)throw Error('SYNTHETIC_SOURCE_CONFLICT');prior.state='unknown';return clone(prior.ref);}
  return store(binding,attempt,peer,'synthetic-cold:unknown',text,'unknown');
 };
 const token=value=>{const parsed=JSON.parse(value);if(parsed?.format!=='turboio-task-voice/1'||Object.keys(parsed).length!==4||!/^voice-[a-f0-9]{32}$/.test(parsed.attempt_id))throw Error('SYNTHETIC_SOURCE_TOKEN');return parsed;};
 const source=(value,text,recover)=>{const parsed=token(value);return recover?restore(parsed.reply,parsed.attempt_id,parsed.peer,text):register(parsed.reply,parsed.attempt_id,parsed.peer,connection().epoch,text);};
 const assertAnswer=answer=>{
  checks++;if(answer.record_schema!==2)throw Error('SYNTHETIC_SOURCE_LEGACY');
  if(answer.input_source!=='voice'){if(!['phone','glasses_semantic'].includes(answer.input_source)||answer.voice_source!==null)throw Error('SYNTHETIC_SOURCE_INVALID');return;}
  const ref=answer.voice_source,row=ref&&receipts.get(ref.attempt_id),current=connection();
  if(!row||row.state!=='watching'||JSON.stringify(row.ref)!==JSON.stringify(ref)||ref.peer!==current.peer||ref.connection_epoch!=='synthetic-live:'+current.epoch||
   ref.binding_sha256!==bound(answer.binding)||ref.text_sha256!==digest(answer.text))throw Error('SYNTHETIC_SOURCE_UNVERIFIED');
 };
 const origin=(value,text,state)=>{
  origins++;const parsed=token(value),current=connection();
  if(state.active||state.phase!=='draft'||state.binding!==value||state.text!==text||!(state.valid===true||state.savedDraftValid===true)||
   state.transcriptStatus!=='complete'||!['device_event','user_confirmation'].includes(state.exitEvidence)||state.observationRestored||parsed.peer!==current.peer||current.epoch<=0)throw Error('SYNTHETIC_SOURCE_ORIGIN');
  return current.epoch;
 };
 return {register,restore,source,assertAnswer,origin,
  invalidate(){for(const row of receipts.values())row.state='tainted';},cold(){for(const row of receipts.values())row.state='unknown';},
  state:ref=>receipts.get(ref?.attempt_id)?.state||'missing',get checks(){return checks;},get origins(){return origins;}};
}
