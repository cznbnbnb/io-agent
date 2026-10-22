// An immutable local source reference, not microphone consent or a server
// receipt. Freshness/taint is checked by the source store at every boundary.
export class TaskVoiceSourceRef {
  schema:number=1;attempt_id:string='';peer:string='';connection_epoch:string='';binding_sha256:string='';text_sha256:string='';
}
export function taskVoiceSourceValid(ref:TaskVoiceSourceRef):boolean{
  return !!ref&&Object.keys(ref).length===6&&ref.schema===1&&typeof ref.attempt_id==='string'&&/^voice-[a-f0-9]{32}$/.test(ref.attempt_id)&&
    typeof ref.peer==='string'&&ref.peer.length>0&&ref.peer.length<=256&&typeof ref.connection_epoch==='string'&&ref.connection_epoch.length>0&&ref.connection_epoch.length<=128&&
    typeof ref.binding_sha256==='string'&&/^[a-f0-9]{64}$/.test(ref.binding_sha256)&&typeof ref.text_sha256==='string'&&/^[a-f0-9]{64}$/.test(ref.text_sha256);
}
export function taskSameVoiceSource(a:TaskVoiceSourceRef|null|undefined,b:TaskVoiceSourceRef|null|undefined):boolean{
  // Only schema1 records may omit the field. Schema2 validation independently
  // requires an explicit null or valid reference, never undefined.
  if(a===null||a===undefined)return b===null||b===undefined;
  return !!b&&taskVoiceSourceValid(a)&&taskVoiceSourceValid(b)&&a.schema===b.schema&&a.attempt_id===b.attempt_id&&a.peer===b.peer&&
    a.connection_epoch===b.connection_epoch&&a.binding_sha256===b.binding_sha256&&a.text_sha256===b.text_sha256;
}
