// Local provenance for an explicitly authorized short recording. No server
// schema or ordinary-recording identity is replaced by this receipt.
export class TaskRecordingOrigin {
  schema:number=1;name:string='';uuid:string='';owner_id:string='';cleanup_id:string='';peer:string='';
  raw_bytes:number=0;raw_sha256:string='';result_sha256:string='';material_id:string='';material_revision:number=0;exit_evidence:string='none';
}
export class TaskRecordingResult {
  state:string='waiting';exitEvidence:string='none';text:string='';origin:TaskRecordingOrigin|null=null;
}
export function taskRecordingOriginValid(value:TaskRecordingOrigin):boolean{
  return !!value&&Object.keys(value).length===12&&value.schema===1&&typeof value.name==='string'&&/^take-[a-f0-9]{32}$/.test(value.name)&&
    typeof value.uuid==='string'&&/^[A-Za-z0-9-]{1,64}$/.test(value.uuid)&&typeof value.owner_id==='string'&&/^voice-[a-f0-9]{32}$/.test(value.owner_id)&&typeof value.cleanup_id==='string'&&/^[a-f0-9]{32}$/.test(value.cleanup_id)&&
    typeof value.peer==='string'&&value.peer.length>0&&value.peer.length<=128&&!/[\u0000-\u0020\u007f]/.test(value.peer)&&
    Number.isSafeInteger(value.raw_bytes)&&value.raw_bytes>0&&value.raw_bytes<=1048576&&value.raw_bytes%240===0&&
    typeof value.raw_sha256==='string'&&/^[a-f0-9]{64}$/.test(value.raw_sha256)&&typeof value.result_sha256==='string'&&/^[a-f0-9]{64}$/.test(value.result_sha256)&&
    typeof value.material_id==='string'&&value.material_id.length>0&&value.material_id.length<=128&&
    Number.isSafeInteger(value.material_revision)&&value.material_revision>0&&['device_event','user_confirmation'].includes(value.exit_evidence);
}
export function taskSameRecordingOrigin(a:TaskRecordingOrigin|null,b:TaskRecordingOrigin|null):boolean{
  if(a===null||b===null)return a===b;
  return taskRecordingOriginValid(a)&&taskRecordingOriginValid(b)&&a.schema===b.schema&&a.name===b.name&&a.uuid===b.uuid&&a.owner_id===b.owner_id&&
    a.cleanup_id===b.cleanup_id&&a.peer===b.peer&&a.raw_bytes===b.raw_bytes&&a.raw_sha256===b.raw_sha256&&a.result_sha256===b.result_sha256&&
    a.material_id===b.material_id&&a.material_revision===b.material_revision&&a.exit_evidence===b.exit_evidence;
}
