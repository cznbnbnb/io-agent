import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { TaskMailbox, TaskPrincipal } from './TaskMailbox';
import { TaskTransport, TaskTarget } from './TaskTransport';
import { TaskCommandBody, TaskRequestBody, TaskEnvelope, TaskObject, TaskInboxPage, TaskRoute } from './TaskWire';

export class TaskMailboxLabReport {
  schema:number=1;kind:string='synthetic_p43_filesystem_only';phase:string='';run_id:string='';at:number=0;
  status:string='failed';checks:string[]=[];error:string='';task_id:string='';request_id:string='';
  original_session:string='';queued:number=0;cursor:string='';
}
// Deliberately has no network target/credential, AppRuntime, recording or glasses.
// Native proof of filesystem recovery is separate from the local HTTP tests.
export class TaskMailboxLab {
  private check(ok:boolean,name:string,r:TaskMailboxLabReport):void {if(!ok)throw new Error(name);r.checks.push(name);}
  private write(path:string,text:string):void {
    const bytes=new util.TextEncoder().encodeInto(text),file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('LAB_WRITE');offset+=n;}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);bytes.fill(0);}fs.renameSync(path+'.partial',path);
  }
  async run(filesDir:string,phase:string,runId:string):Promise<TaskMailboxLabReport>{
    const r=new TaskMailboxLabReport();r.phase=phase;r.run_id=runId;r.at=Date.now();
    if(!['task-seed','task-resume'].includes(phase)||!/^\d{13}$/.test(runId)){r.error='LAB_PARAMETERS_INVALID';return r;}
    const parent=filesDir+'/p43-task-mailbox-lab';if(!fs.accessSync(parent))fs.mkdirSync(parent);
    const root=parent+'/task-'+runId;if(!fs.accessSync(root))fs.mkdirSync(root);
    try{
      const principal=new TaskPrincipal();principal.ownerId='synthetic-native-owner';principal.producerId='synthetic-native-phone';principal.serverId='synthetic-native-server';
      const m=new TaskMailbox();m.initialize(root,principal);
      const route=new TaskRoute();route.computer_id='synthetic-pc';route.agent_id='synthetic-hermes';route.project_id='synthetic-project';route.session_id='existing-synthetic-session';
      r.original_session=route.session_id;const now=Number(runId);
      if(phase==='task-seed'){
        this.check(m.pending().length===0&&m.objects().length===0,'fresh_isolated_fixture',r);
        const row=m.delegate('synthetic-user-tap',route,'合成委托，只测试本地保存，不发给 Agent',now,now+86400000),event=JSON.parse(row.payload) as TaskEnvelope;
        r.task_id=(event.body as TaskCommandBody).task_id;
        const task=new TaskObject();task.kind='task';task.object_id=r.task_id;task.revision=1;task.commit_seq=1;
        task.stored_at=new Date(now).toISOString();task.expires_at=event.expires_at;task.command_expires_at=event.expires_at;
        task.event_id=event.event_id;task.state='queued';task.body=event.body;
        const body=new TaskRequestBody();body.request_id='synthetic-native-question';body.task_id=r.task_id;body.route=route;body.question='合成问题，是否只生成预览？';
        const request=new TaskObject();request.kind='request';request.object_id=body.request_id;request.revision=1;request.commit_seq=2;
        request.stored_at=task.stored_at;request.expires_at=task.expires_at;request.event_id='synthetic-request-event';request.state='pending';request.body=body;
        const page=new TaskInboxPage();page.items=[task,request];page.next_cursor='synthetic-inbox-cursor';page.server_time=task.stored_at;page.fresh_until=task.stored_at;
        m.acceptPage(page,'');m.acceptDetail(task,now);m.acceptDetail(request,now);
        m.answer('synthetic-answer-tap',body.request_id,1,null,'仅生成预览，先不要执行',now);
        this.check(m.claim(now)?.action==='send','seed_interrupted_claim',r);
        this.check(m.pending().length===2,'command_and_answer_saved',r);
      }else{
        this.check(m.cursor()==='synthetic-inbox-cursor'&&m.objects().length===2,'objects_and_cursor_restored',r);
        const rows=m.pending();this.check(rows.length===2&&rows[0].state==='reconcile'&&rows[0].needs_lookup,'interrupted_claim_requires_lookup',r);
        const e=JSON.parse(rows[0].payload) as TaskEnvelope;r.task_id=(e.body as TaskCommandBody).task_id;
        this.check(m.delegate('synthetic-user-tap',route,'合成委托，只测试本地保存，不发给 Agent',now+1000,now+86400000).payload===rows[0].payload,'duplicate_keeps_original_bytes',r);
        this.check((e.body as TaskCommandBody).route.session_id===r.original_session&&!(e.body as TaskCommandBody).allow_create_session,'original_session_retained',r);
        this.check(rows[1].payload.indexOf('仅生成预览，先不要执行')>=0,'answer_condition_retained',r);
        this.check(m.claim(Date.now())?.action==='lookup','cold_restart_looks_up_before_replay',r);
      }
      const transport=new TaskTransport();this.check(!(await transport.pump(m,new TaskTarget())),'paused_transport_never_connects',r);
      r.queued=m.pending().length;r.cursor=m.cursor();r.request_id='synthetic-native-question';r.status='passed';
    }catch(error){const code=(error as Error).message;r.error=/^[A-Za-z0-9_]{1,128}$/.test(code)?code:'LAB_FAILED';}
    this.write(root+'/report-'+phase+'.json',JSON.stringify(r));return r;
  }
}
