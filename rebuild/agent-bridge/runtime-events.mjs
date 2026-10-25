import {createHash} from 'node:crypto';
import {BridgeError} from './client.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const runtimeDigest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function runtimeSource(item){
  return structuredClone(Object.fromEntries(['kind','object_id','revision','event_id','state','body','expires_at','command_expires_at']
    .filter(key=>item[key]!==undefined).map(key=>[key,item[key]])));
}
// The runtime stores this immutable answer payload, independently of whether
// its original live wait has consumed it. Transport receipts are not input.
export function runtimeAnswer(item){
  return structuredClone({kind:item.kind,object_id:item.object_id,revision:item.revision,
    stored_at:item.stored_at,body:item.body});
}
export function runtimeEventBatch(value){
  const invalid=()=>{throw new BridgeError('RUNTIME_EVENT_INVALID',{permanent:true});};
  if(!Array.isArray(value)||value.length>20)invalid();
  const ids=new Set();
  for(const event of value){
    if(!object(event)||Object.keys(event).some(key=>!['event_id','delivery_id','actions'].includes(key))||
      typeof event.event_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(event.event_id)||
      typeof event.delivery_id!=='string'||!event.delivery_id||event.delivery_id.length>1024||
      // One complete 1 MiB native result may need ~28 JSON-safe chunks. Keep
      // result plus completion atomic in the journal; network writes remain
      // individual bounded envelopes. The stdio host has its own frame limit.
      !Array.isArray(event.actions)||event.actions.length>64||ids.has(event.event_id))invalid();
    ids.add(event.event_id);
  }
  return value;
}
