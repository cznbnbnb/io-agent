import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { HarmonySha256 } from 'turbo_core';

export class WorkspaceTodoReference {
  id:number=0;revision:number=0;peer:string='';content_sha256:string='';
}
export class WorkspaceTodoItem {
  reference:WorkspaceTodoReference=new WorkspaceTodoReference();
  title:string='';completed:boolean=false;important:boolean=false;delivery:string='';created:number=0;modified:number=0;
}
export class WorkspaceTodoDeletionView {
  schema:number=1;operation_id:string='';state_sha256:string='';revision:number=0;phase:string='missing';note:string='未找到删除记录';
  todo:WorkspaceTodoItem=new WorkspaceTodoItem();attempts:number=0;max_attempts:number=3;can_cancel:boolean=false;can_send:boolean=false;
  receipt_observed:boolean=false;receipt_success_count:number=-1;receipt_failure_code:number=-1;receipt_at:string='';receipt_correlation:string='none';
  query_observation:string='not_queried';query_at:string='';
}
export class WorkspaceTodoPage {
  schema:number=1;scope:string='active';todos:WorkspaceTodoItem[]=[];deletions:WorkspaceTodoDeletionView[]=[];
  next_cursor:string='';has_more:boolean=false;snapshot_sha256:string='';scanned:number=0;incomplete:boolean=false;incomplete_reason:string='';
}
export class WorkspaceTodoQueryView {
  schema:number=1;query_id:string='';phase:string='idle';peer:string='';started_at:string='';deadline_at:string='';completed_at:string='';
  batches:number=0;received:number=0;todo_total:number=-1;schedule_total:number=-1;
  note:string='尚未查询眼镜';absence_is_confirmation:boolean=false;
}
export interface WorkspaceTodoTransport {
  peer:()=>string;ready:()=>boolean;foreground:()=>boolean;lease:()=>number;
  send:(business:number,payload:Uint8Array)=>Promise<void>;
}
export function todoHash(value:string):string {
  const bytes=new util.TextEncoder().encodeInto(value);
  try{return Array.from(new HarmonySha256().digest(bytes)).map((b:number):string=>b.toString(16).padStart(2,'0')).join('');}
  finally{bytes.fill(0);}
}
export function newWorkspaceTodoDeleteId():string {
  const bytes=cryptoFramework.createRandom().generateRandomSync(16).data;
  try{if(bytes.length!==16)throw new Error('TODO_INVALID');return 'tdel-'+Array.from(bytes).map((b:number):string=>b.toString(16).padStart(2,'0')).join('');}
  finally{bytes.fill(0);}
}
export function validWorkspaceTodoReference(ref:WorkspaceTodoReference):boolean {
  return ref!==null&&typeof ref==='object'&&Object.keys(ref).sort().join(',')==='content_sha256,id,peer,revision'&&
    Number.isSafeInteger(ref.id)&&ref.id>0&&Number.isSafeInteger(ref.revision)&&ref.revision>0&&
    typeof ref.peer==='string'&&(ref.peer===''||/^[0-9a-f]{12}$/.test(ref.peer))&&typeof ref.content_sha256==='string'&&/^[0-9a-f]{64}$/.test(ref.content_sha256);
}
export function sameWorkspaceTodoReference(a:WorkspaceTodoReference,b:WorkspaceTodoReference):boolean {
  return validWorkspaceTodoReference(a)&&validWorkspaceTodoReference(b)&&a.id===b.id&&a.revision===b.revision&&a.peer===b.peer&&a.content_sha256===b.content_sha256;
}
