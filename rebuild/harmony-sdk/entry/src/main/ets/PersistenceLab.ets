import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { MaterialStore, MaterialSource, MaterialTextInput, MaterialUtterance } from './MaterialStore';
import { LocalAsrQueue } from './LocalAsrQueue';
import { MaterialEventIdentity, WireMaterialEvent, materialRevisionEvent } from './MaterialWire';
import { MaterialOutbox, MaterialOutboxClaim, MaterialOutboxRow, MaterialSyncPrincipal, MaterialStoredAck } from './MaterialOutbox';
import { MaterialSyncTransport, MaterialSyncTarget } from './MaterialSyncTransport';
import { MaterialSyncDiscovery } from './MaterialSyncDiscovery';
import { MaterialSyncCoordinator, MaterialSyncView } from './MaterialSyncCoordinator';
import { connection } from '@kit.NetworkKit';

export class PersistenceReport {
  schema:number=1;kind:string='isolated_p21_p22';phase:string='';at:number=0;
  status:string='failed';checks:string[]=[];error:string='';
  run_id:string='';events:WireMaterialEvent[]=[];
  outbox:MaterialOutboxRow[]=[];claim:MaterialOutboxClaim|null=null;
  // Live-transport observations only; the token itself is never copied here.
  target_host:string='';target_producer:string='';pump_notes:string[]=[];local_sync_state:string='';
  identity_status:number=0;transport_error:string='';
  sync_views:MaterialSyncView[]=[];
  default_network_before:boolean|null=null;default_network_after:boolean|null=null;coordinator_note:string='';
}
// Operator-pushed private file (<filesDir>/p31-material-outbox-lab/sync-target.json).
export class LiveSyncTargetFile {
  schema:number=1;base_url:string='';token:string='';owner_id:string='';producer_id:string='';server_id:string='';
}
export class PersistenceLab {
  private check(condition:boolean,name:string,report:PersistenceReport):void{
    if(!condition)throw new Error(name);report.checks.push(name);
  }
  private source(hex:string):MaterialSource{
    const source=new MaterialSource();source.name='take-'+hex.repeat(32);source.started=1000;source.ended=61000;source.complete=true;return source;
  }
  private write(path:string,report:PersistenceReport):void{
    const bytes=new util.TextEncoder().encodeInto(JSON.stringify(report));
    const file=fs.openSync(path+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
    try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('LAB_REPORT_WRITE');offset+=n;}fs.fsyncSync(file.fd);}
    finally{fs.closeSync(file);bytes.fill(0);}fs.renameSync(path+'.partial',path);
  }
  // Synthetic private fixture only. No recording, network, model or device code.
  run(filesDir:string,phase:string,runId:string=''):PersistenceReport{
    if(['outbox-seed','outbox-resume','outbox-check','outbox-transport-guard','discovery-seed','discovery-resume','renewal-seed','renewal-resume'].includes(phase))return this.runOutbox(filesDir,phase,runId);
    if(phase==='wire-seed'||phase==='wire-resume')return this.runWire(filesDir,phase,runId);
    const report=new PersistenceReport();report.phase=phase==='seed'||phase==='resume'?phase:'invalid';report.at=Date.now();
    const root=filesDir+'/p21-p22-persistence-lab';
    if(!fs.accessSync(root))fs.mkdirSync(root);
    try{
      if(!['seed','resume'].includes(phase))throw new Error('LAB_PHASE_INVALID');
      const store=new MaterialStore();store.initialize(root);
      const queue=new LocalAsrQueue();queue.initialize(root);
      const source=this.source('a');const id=store.idFor(source.kind,source.name);
      const input=new MaterialTextInput();input.text='合成测试原文';
      const part=new MaterialUtterance();part.start_ms=1000;part.end_ms=2000;part.text=input.text;input.utterances=[part];
      if(phase==='seed'){
        this.check(!store.read(id)&&queue.all().length===0,'fresh_isolated_fixture',report);
        const first=store.ensure(source,'合成旧文字');
        const next=store.appendTranscript(id,first.revision,input,'fixture-asr');
        const corrected=store.correctText(id,next.revision,next.utterances[0].utterance_id,'合成测试更正');
        this.check(corrected.revision===3&&corrected.user_edited,'immutable_correction_saved',report);
        for(const hex of ['a','b','c']){
          const directory=root+'/recordings/take-'+hex.repeat(32);
          const job=queue.enqueue(directory,directory+'/source.rawopus',1000,'recording',true);
          if(hex==='c')queue.cancel(job.jobId);
          else{
            queue.transition(job.jobId,'running');
            if(hex==='b')queue.sealResult(job.jobId,JSON.stringify({utterances:[],seconds:60}));
          }
        }
        this.check(queue.all().length===3,'queue_seeded_running_result_cancelled',report);
      }else{
        const saved=store.read(id);
        this.check(saved?.revision===3&&saved.text==='合成测试更正','correction_restored_after_restart',report);
        this.check(store.read(id,1)?.text==='合成旧文字','history_retained',report);
        this.check(store.ensure(source,'迟到旧文字').revision===3,'migration_does_not_overwrite_correction',report);
        const a=queue.get('asr-recording-'+'a'.repeat(32));
        this.check(a?.status==='queued'&&a.attempts===1&&a.lastError==='interrupted','running_job_recovered',report);
        const b=queue.get('asr-recording-'+'b'.repeat(32));
        this.check(b?.status==='result_ready'&&queue.readResult(b.jobId).indexOf('seconds')>=0,'sealed_result_restored',report);
        const directory=root+'/recordings/take-'+'c'.repeat(32);
        this.check(queue.enqueue(directory,directory+'/source.rawopus',1000,'recording',true).status==='cancelled','cancel_not_reactivated',report);
        let protectedEdit=false;
        try{store.appendTranscript(id,3,input,'late-job');}catch(error){protectedEdit=(error as Error).message==='USER_REVISION_PROTECTED';}
        this.check(protectedEdit,'late_asr_rejected',report);
      }
      report.status='passed';
    }catch(error){report.error=(error as Error).message;}
    this.write(root+'/'+report.phase+'-report.json',report);return report;
  }
  // Real network experiment. It reads an operator-pushed target file, performs the
  // authenticated pump against the deployed HTTPS service and records only what the
  // service really answered: no synthetic receipt, no claimed stage, no token in output.
  async runLive(filesDir:string,phase:string,runId:string,pushed:LiveSyncTargetFile|null=null):Promise<PersistenceReport>{
    const report=new PersistenceReport();report.kind='live_p31_transport';report.phase=phase;report.at=Date.now();report.run_id=runId;
    if(phase!=='transport-live'){report.error='LAB_PHASE_INVALID';return report;}
    if(!/^[0-9]{13}$/.test(runId)){report.error='LAB_RUN_ID_INVALID';return report;}
    const parent=filesDir+'/p31-material-outbox-lab';if(!fs.accessSync(parent))fs.mkdirSync(parent);
    const root=parent+'/live-'+runId;if(!fs.accessSync(root))fs.mkdirSync(root);
    try{
      const targetPath=parent+'/sync-target.json';
      // A pushed file wins; otherwise an operator-supplied target is persisted here
      // first, so the bearer stays in the app's private directory instead of argv.
      if(!fs.accessSync(targetPath)){
        if(!pushed||!pushed.base_url||!pushed.token||!pushed.owner_id||!pushed.producer_id||!pushed.server_id)throw new Error('LIVE_TARGET_MISSING');
        const bytes=new util.TextEncoder().encodeInto(JSON.stringify(pushed));
        const file=fs.openSync(targetPath+'.partial',fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
        try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(file.fd,bytes.slice(offset).buffer);if(n<=0)throw new Error('LIVE_TARGET_WRITE');offset+=n;}fs.fsyncSync(file.fd);}
        finally{fs.closeSync(file);bytes.fill(0);}
        fs.renameSync(targetPath+'.partial',targetPath);
      }
      if(fs.statSync(targetPath).size>8192)throw new Error('LIVE_TARGET_TOO_LARGE');
      const config=JSON.parse(fs.readTextSync(targetPath)) as LiveSyncTargetFile;
      const principal=new MaterialSyncPrincipal();
      principal.ownerId=config.owner_id;principal.producerId=config.producer_id;principal.serverId=config.server_id;
      const queue=new MaterialOutbox();queue.initialize(root,principal);
      const store=new MaterialStore();store.initialize(root);
      const source=new MaterialSource();let hex=runId;while(hex.length<32)hex+='0';
      source.name='take-'+hex.slice(0,32);source.started=report.at-60000;source.ended=report.at;source.complete=true;
      const id=store.idFor(source.kind,source.name);
      this.check(queue.all().length===0&&!store.read(id),'fresh_live_fixture',report);
      store.ensure(source,'真机联网自检：合成资料，不是用户内容');
      const identity=new MaterialEventIdentity();identity.eventId='live-'+runId+'-r1';identity.idempotencyKey='idem-live-'+runId+'-r1';
      identity.producerId=config.producer_id;identity.createdAt=report.at;identity.expiresAt=report.at+3600000;
      const event=materialRevisionEvent(store,id,1,identity);queue.enqueue(event);report.events=[event];
      const transport=new MaterialSyncTransport(),target=new MaterialSyncTarget();
      target.baseUrl=config.base_url;target.token=config.token;target.principal=principal;
      transport.validateTarget(target,queue);
      report.target_host=config.base_url;report.target_producer=config.producer_id;
      for(let attempt=0;attempt<3;attempt++){
        const processed=await transport.pump(queue,target);report.pump_notes.push(transport.note);
        report.identity_status=transport.lastIdentityStatus;report.transport_error=transport.lastErrorCode;
        const current=queue.all()[0];
        if(current.state==='server_stored')break;
        if(!processed)break;
        if(current.state!=='retry_wait'&&current.state!=='reconcile')break;
      }
      const row=queue.all()[0];report.outbox=queue.all();report.local_sync_state=store.read(id)?.sync_state??'';
      this.check(row.state==='server_stored'&&row.receipt_id.length>0,'live_server_stored_receipt',report);
      this.check(row.server_commit_seq>=1&&Number.isFinite(Date.parse(row.server_stored_at)),'live_server_commit_recorded',report);
      this.check(row.attempts===1&&row.needs_lookup===false,'live_single_attempt_settled',report);
      report.status='passed';
    }catch(error){report.error=(error as Error).message;}
    this.write(root+'/'+phase+'-report.json',report);return report;
  }
  // Real HTTPS, isolated synthetic material history. Reuses the operator file,
  // never the daily vault/store. Resume is a separate cold-process invocation.
  async runCoordinatedLive(filesDir:string,phase:string,runId:string):Promise<PersistenceReport>{
    const report=new PersistenceReport();report.kind='live_p31_coordinator';report.phase=phase;report.at=Date.now();report.run_id=runId;
    if(!['coordinator-live','coordinator-resume','coordinator-offline','coordinator-online'].includes(phase)||!/^[0-9]{13}$/.test(runId)){report.error='LAB_PHASE_INVALID';return report;}
    const parent=filesDir+'/p31-material-outbox-lab';if(!fs.accessSync(parent))fs.mkdirSync(parent);
    const root=parent+'/coordinated-'+runId;if(!fs.accessSync(root))fs.mkdirSync(root);
    let coordinator:MaterialSyncCoordinator|undefined=undefined;
    try{
      const configPath=parent+'/sync-target.json';if(!fs.accessSync(configPath)||fs.statSync(configPath).size>8192)throw new Error('LIVE_TARGET_MISSING');
      const config=JSON.parse(fs.readTextSync(configPath)) as LiveSyncTargetFile,target=new MaterialSyncTarget();
      target.baseUrl=config.base_url;target.token=config.token;target.principal.ownerId=config.owner_id;
      target.principal.producerId=config.producer_id;target.principal.serverId=config.server_id;
      report.target_host=config.base_url;report.target_producer=config.producer_id;
      const store=new MaterialStore();store.initialize(root);
      const source=new MaterialSource();source.name='take-'+runId.padEnd(32,'c');source.started=report.at-60000;source.ended=report.at;source.complete=true;
      const id=store.idFor(source.kind,source.name);
      if(['coordinator-offline','coordinator-online'].includes(phase)){
        report.default_network_before=await connection.hasDefaultNet();
        this.check(report.default_network_before===(phase==='coordinator-online'),'actual_default_network_precondition',report);
      }
      if(phase==='coordinator-live'||phase==='coordinator-offline'){
        this.check(!store.read(id),'fresh_coordinated_fixture',report);
        store.ensure(source,'自动同步合成原文，不是用户内容');
        const text=new MaterialTextInput();text.text='自动同步合成修订，不是用户内容';
        const part=new MaterialUtterance();part.start_ms=1000;part.end_ms=2000;part.text=text.text;text.utterances=[part];
        store.appendTranscript(id,1,text,'synthetic-coordinator');store.delete(id,2);
      }else this.check(store.read(id)?.revision===3&&store.read(id)?.operation==='delete','synthetic_history_after_process_restart',report);
      coordinator=new MaterialSyncCoordinator(root,store);await coordinator.configure(target);
      coordinator.setForeground(true);await coordinator.tick();
      report.coordinator_note=coordinator.summary().note;
      const view=coordinator.view(id);report.sync_views=[view];
      await coordinator.stop();coordinator=undefined;
      const queue=new MaterialOutbox();queue.initialize(root,target.principal);report.outbox=queue.all();
      if(['coordinator-offline','coordinator-online'].includes(phase)){
        report.default_network_after=await connection.hasDefaultNet();
        this.check(report.default_network_after===report.default_network_before,'actual_network_unchanged_during_turn',report);
      }
      if(phase==='coordinator-offline'){
        this.check(report.outbox.length===3&&report.outbox.every((row:MaterialOutboxRow):boolean=>row.state==='queued'&&row.attempts===0&&!row.receipt_id),
          'offline_history_durable_without_dispatch_or_receipts',report);
        this.check(report.coordinator_note==='IDENTITY_UNAVAILABLE'&&view.state==='queued'&&view.storedRevision===0,'offline_status_is_not_success',report);
        report.status='passed';this.write(root+'/'+phase+'-report.json',report);return report;
      }
      this.check(report.outbox.length===3&&report.outbox.every((row:MaterialOutboxRow):boolean=>row.state==='server_stored'&&row.receipt_id.length>0),
        'all_three_real_receipts_persisted',report);
      this.check(report.outbox.every((row:MaterialOutboxRow):boolean=>row.attempts===1),'no_resubmission_after_receipt',report);
      this.check(view.revision===3&&view.state==='server_stored'&&view.commitSeq===report.outbox[2].server_commit_seq,'latest_tombstone_view_matches_receipt',report);
      this.check(view.audioState==='not_scheduled'&&store.read(id)?.sync_state==='local','text_receipt_does_not_rewrite_content_or_audio',report);
      report.status='passed';
    }catch{report.error='COORDINATED_LIVE_FAILED';}
    finally{if(coordinator)await coordinator.stop();}
    this.write(root+'/'+phase+'-report.json',report);return report;
  }
  private identity(runId:string,revision:number,at:number):MaterialEventIdentity{
    const identity=new MaterialEventIdentity();identity.eventId='evt-lab-'+runId+'-r'+revision;
    identity.idempotencyKey='idem-lab-'+runId+'-r'+revision;identity.producerId='phone-synthetic-lab';
    identity.createdAt=at;identity.expiresAt=at+7*86400000;return identity;
  }
  private syntheticAck(event:WireMaterialEvent,runId:string):string{
    const ack=new MaterialStoredAck();ack.schema_version='1.1';ack.event_id=event.event_id;ack.material_id=event.body.material_id;
    ack.revision=event.body.revision;ack.commit_seq=event.body.revision;ack.stored_at=new Date().toISOString();
    ack.receipt.receipt_id='synthetic-receipt-'+runId+'-r'+event.body.revision;ack.receipt.subject_kind='material';
    ack.receipt.subject_id=event.body.material_id;ack.receipt.subject_revision=event.body.revision;ack.receipt.stage='server_stored';
    ack.receipt.actor_id='server-storage';ack.receipt.related_event_id=event.event_id;return JSON.stringify(ack);
  }
  // Native filesystem/hash/state verification with a synthetic receipt. This
  // fixture never contacts a server and cannot prove real server storage.
  private runOutbox(filesDir:string,phase:string,runId:string):PersistenceReport{
    const report=new PersistenceReport();report.kind='isolated_p31_outbox_filesystem';report.phase=phase;report.at=Date.now();report.run_id=runId;
    if(!/^[0-9]{13}$/.test(runId)){report.error='LAB_RUN_ID_INVALID';return report;}
    const parent=filesDir+'/p31-material-outbox-lab';if(!fs.accessSync(parent))fs.mkdirSync(parent);
    const root=parent+'/run-'+runId;if(!fs.accessSync(root))fs.mkdirSync(root);
    try{
      const principal=new MaterialSyncPrincipal();principal.ownerId='synthetic-lab-owner';principal.producerId='phone-synthetic-lab';principal.serverId='synthetic-filesystem-only';
      const queue=new MaterialOutbox();queue.initialize(root,principal);const store=new MaterialStore();store.initialize(root);
      const source=this.source('e'),id=store.idFor(source.kind,source.name);
      if(phase==='outbox-transport-guard'){
        const transport=new MaterialSyncTransport(),target=new MaterialSyncTarget();target.principal=principal;
        target.baseUrl='https://sync.invalid/io-api/v1';target.token='a'.repeat(43);
        transport.validateTarget(target,queue);this.check(queue.all().length===0&&transport.note==='idle','native_target_validated_without_dispatch',report);
        let rejected=false;target.baseUrl='http://sync.invalid/v1';try{transport.validateTarget(target,queue);}catch{rejected=true;}
        this.check(rejected,'native_insecure_target_rejected',report);
        rejected=false;target.baseUrl='https://user:secret@sync.invalid/v1';try{transport.validateTarget(target,queue);}catch{rejected=true;}
        this.check(rejected,'native_credential_url_rejected',report);
        rejected=false;target.baseUrl='https://sync.invalid/v1';target.principal=new MaterialSyncPrincipal();
        try{transport.validateTarget(target,queue);}catch{rejected=true;}
        this.check(rejected&&queue.all().length===0,'native_partition_mismatch_rejected_without_enqueue',report);
      }else if(phase==='renewal-seed'||phase==='renewal-resume'){
        if(phase==='renewal-seed'){
          this.check(queue.all().length===0&&!store.read(id),'fresh_isolated_renewal_fixture',report);
          store.ensure(source,'合成过期原文');const identity=this.identity(runId,1,report.at-2000);identity.expiresAt=report.at-1000;
          const original=materialRevisionEvent(store,id,1,identity),old=queue.enqueue(original);report.events=[original];
          this.check(queue.claim(report.at)===undefined&&queue.all()[0].state==='expired','native_expiry_does_not_send',report);
          let refused=false;try{queue.renewExpired(old.queue_id,report.at);}catch(error){refused=(error as Error).message==='OUTBOX_RENEWAL_REQUIRES_ABSENCE';}
          this.check(refused,'native_renewal_requires_absence',report);queue.recheckExpired(old.queue_id);
          const lookup=queue.claim(report.at);if(!lookup)throw new Error('LAB_CLAIM_MISSING');
          // Synthetic absence only, not an HTTP response or real server proof.
          queue.finish(lookup,404,'{"schema_version":"1.0","error":{"code":"EVENT_NOT_FOUND","message":"synthetic-only","retryable":false,"correlation_id":"synthetic-absence"}}',report.at);
          const renewed=queue.renewExpired(old.queue_id,report.at+1),claim=queue.claim(report.at+2);if(!claim)throw new Error('LAB_CLAIM_MISSING');
          const event=JSON.parse(claim.payload) as WireMaterialEvent;report.events.push(event);report.claim=claim;
          this.check(JSON.stringify(event.body)===JSON.stringify(original.body)&&renewed.history[0].event_id===original.event_id,'native_renewal_original_body_and_lineage',report);
          this.check(!queue.finish(lookup,200,this.syntheticAck(original,runId),report.at+3),'native_old_envelope_callback_rejected',report);
        }else{
          const path=root+'/renewal-seed-report.json';if(fs.statSync(path).size>1000000)throw new Error('LAB_SEED_TOO_LARGE');
          const seed=JSON.parse(fs.readTextSync(path)) as PersistenceReport;
          this.check(seed.status==='passed'&&seed.run_id===runId&&seed.events.length===2&&seed.outbox.length===1,'native_renewal_seed_restored',report);
          const row=queue.all()[0];this.check(row.event_id===seed.outbox[0].event_id&&row.payload_hash===seed.outbox[0].payload_hash&&
            row.expires_at===seed.outbox[0].expires_at&&row.history.length===1&&row.state==='reconcile','native_renewal_successor_and_history_restored',report);
          const lookup=queue.claim(report.at);this.check(lookup?.action==='lookup'&&lookup.eventId===seed.events[1].event_id,'native_renewal_reconciles_successor',report);
          const again=queue.renewExpired(row.history[0].queue_id,report.at);
          this.check(again.queue_id===row.queue_id&&again.history.length===1&&again.receipt_id==='','native_renewal_local_replay_no_second_successor',report);
          this.check(store.read(id)?.revision===1&&store.read(id)?.sync_state==='local','native_renewal_source_not_marked_uploaded',report);
          report.events=seed.events;report.claim=lookup||null;
        }
      }else if(phase==='discovery-seed'||phase==='discovery-resume'){
        const discovery=new MaterialSyncDiscovery(queue);
        if(phase==='discovery-seed'){
          this.check(queue.all().length===0&&!store.read(id),'fresh_isolated_discovery_fixture',report);
          store.ensure(source,'合成发现旧文字');const input=new MaterialTextInput();input.text='合成发现新版';
          store.appendTranscript(id,1,input,'synthetic-discovery');store.delete(id,2);
          const step=discovery.scan(store,report.at,1,1);
          this.check(step.inspected===1&&step.enqueued===1&&step.issues.length===0,'native_discovery_budget_and_first_revision',report);
          const first=queue.claim(report.at);if(!first)throw new Error('LAB_CLAIM_MISSING');report.claim=first;
          const event=JSON.parse(first.payload) as WireMaterialEvent;report.events=[event];
          this.check(event.body.revision===1&&event.body.full_text.text==='合成发现旧文字','native_history_not_latest_tombstone',report);
        }else{
          const path=root+'/discovery-seed-report.json';if(fs.statSync(path).size>1000000)throw new Error('LAB_SEED_TOO_LARGE');
          const seed=JSON.parse(fs.readTextSync(path)) as PersistenceReport;
          this.check(seed.status==='passed'&&seed.run_id===runId&&seed.outbox.length===1,'native_discovery_seed_restored',report);
          let complete=false;
          for(let n=0;n<5;n++){
            const step=discovery.scan(store,report.at,1,1);
            this.check(step.inspected<=1&&step.enqueued<=1&&step.issues.length===0,'native_discovery_resume_step_'+n,report);
            if(step.sweepComplete){complete=true;break;}
          }
          const rows=queue.all();this.check(complete&&rows.length===3&&rows[1].revision===2&&rows[2].revision===3,'native_discovery_full_history_queued',report);
          this.check(rows[0].event_id===seed.outbox[0].event_id&&rows[0].payload_hash===seed.outbox[0].payload_hash&&
            rows[0].expires_at===seed.outbox[0].expires_at,'native_discovery_original_identity_retained',report);
          const lookup=queue.claim(report.at);this.check(lookup?.action==='lookup'&&lookup.eventId===rows[0].event_id&&rows[1].attempts===0&&rows[2].attempts===0,'native_discovery_order_waits_for_storage_receipt',report);
          this.check(store.read(id)?.operation==='delete'&&store.read(id)?.sync_state==='local','native_discovery_tombstone_remains_local',report);
          report.claim=lookup||null;report.events=seed.events;
        }
      }else if(phase==='outbox-seed'){
        this.check(!store.read(id)&&queue.all().length===0,'fresh_isolated_outbox_fixture',report);
        store.ensure(source,'合成队列原文');
        const input=new MaterialTextInput();input.text='合成队列新版';store.appendTranscript(id,1,input,'synthetic-outbox-text');
        for(const revision of [1,2]){const event=materialRevisionEvent(store,id,revision,this.identity(runId,revision,report.at));queue.enqueue(event);report.events.push(event);}
        const claim=queue.claim(report.at);this.check(claim?.action==='send'&&claim.eventId===report.events[0].event_id,'first_revision_claim_persisted',report);
        report.claim=claim||null;
        this.check(queue.claim(report.at)===undefined&&queue.all()[1].attempts===0,'second_revision_waits',report);
      }else{
        const seedPath=root+'/outbox-seed-report.json';if(fs.statSync(seedPath).size>1000000)throw new Error('LAB_SEED_TOO_LARGE');
        const seed=JSON.parse(fs.readTextSync(seedPath)) as PersistenceReport;
        this.check(seed.status==='passed'&&seed.run_id===runId&&seed.events.length===2&&seed.claim!==null,'outbox_seed_restored',report);
        report.events=seed.events;
        if(phase==='outbox-resume'){
          this.check(queue.all()[0].state==='reconcile'&&queue.all()[0].needs_lookup,'sending_restored_as_reconcile',report);
          const lookup=queue.claim(report.at);this.check(lookup?.action==='lookup'&&lookup.eventId===seed.events[0].event_id,'original_event_looked_up_first',report);
          if(!lookup||!seed.claim)throw new Error('LAB_CLAIM_MISSING');
          this.check(!queue.finish(seed.claim,201,this.syntheticAck(seed.events[0],runId),report.at),'old_attempt_callback_rejected',report);
          queue.finish(lookup,404,'',report.at);
          const retry=queue.claim(report.at);this.check(retry?.action==='send'&&retry.payload===seed.claim.payload,'retry_bytes_identical_after_restart',report);
          if(!retry)throw new Error('LAB_CLAIM_MISSING');
          queue.finish(retry,200,this.syntheticAck(seed.events[0],runId),report.at);
          this.check(queue.all()[0].state==='server_stored','synthetic_receipt_saved',report);
          const next=queue.claim(report.at);this.check(next?.eventId===seed.events[1].event_id,'next_revision_released_after_receipt',report);
          if(!next)throw new Error('LAB_CLAIM_MISSING');queue.finish(next,0,'',report.at,0,1000);report.claim=next;
        }else{
          this.check(queue.all()[0].state==='server_stored'&&queue.all()[0].receipt_id==='synthetic-receipt-'+runId+'-r1','synthetic_receipt_restored_after_second_restart',report);
          this.check(queue.all()[1].state==='retry_wait'&&queue.all()[1].attempts===1&&queue.all()[1].needs_lookup&&queue.all()[1].next_attempt_at>0,'retry_deadline_and_lookup_restored',report);
          this.check(store.read(id)?.revision===2&&store.read(id)?.sync_state==='local','material_and_audio_not_marked_uploaded',report);
        }
      }
      report.outbox=queue.all();report.status='passed';
    }catch(error){report.error=(error as Error).message;}
    this.write(root+'/'+phase+'-report.json',report);return report;
  }
  // Two separate process lifetimes, confined to a fresh synthetic run directory.
  // No audio exists in this fixture and no collection or transport is started.
  private runWire(filesDir:string,phase:string,runId:string):PersistenceReport{
    const report=new PersistenceReport();report.kind='isolated_p21_material_wire';report.phase=phase;report.at=Date.now();report.run_id=runId;
    if(!/^[0-9]{13}$/.test(runId)){report.error='LAB_RUN_ID_INVALID';return report;}
    const parent=filesDir+'/p21-material-wire-lab';if(!fs.accessSync(parent))fs.mkdirSync(parent);
    const root=parent+'/run-'+runId;if(!fs.accessSync(root))fs.mkdirSync(root);
    try{
      const store=new MaterialStore();store.initialize(root);
      const source=this.source('d');source.audioFrames=3000;source.frameMs=20;
      const id=store.idFor(source.kind,source.name);
      if(phase==='wire-seed'){
        this.check(!store.read(id),'fresh_isolated_wire_fixture',report);
        const legacy=store.ensure(source,'# 合成历史文字\n\n没有逐句时间。');
        const legacyEvent=materialRevisionEvent(store,id,1,this.identity(runId,1,report.at));report.events.push(legacyEvent);
        this.check(legacyEvent.body.full_text.text===legacy.text&&legacyEvent.body.utterances.length===0&&
          legacyEvent.body.processing.transcription_state==='unknown','untimed_legacy_lossless_unknown',report);
        const input=new MaterialTextInput();input.text='合成窗口文字';input.transcriptionState='partial';input.coveredMs=10000;input.sourceMs=60000;
        input.speakerProcessing='pending';input.boundaryProcessing='token_starts';
        const part=new MaterialUtterance();part.start_ms=1000;part.end_ms=2000;part.text=input.text;input.utterances=[part];
        const partial=store.appendTranscript(id,1,input,'synthetic-prefix');
        report.events.push(materialRevisionEvent(store,id,2,this.identity(runId,2,report.at)));
        this.check(partial.source.complete&&partial.transcription_state==='partial'&&partial.covered_ms===10000,'sealed_audio_partial_text',report);
        const corrected=store.correctText(id,2,partial.utterances[0].utterance_id,'合成人工更正');
        this.check(corrected.user_edited&&corrected.transcription_state==='partial','correction_preserves_coverage',report);
        report.events.push(materialRevisionEvent(store,id,3,this.identity(runId,3,report.at)));
      }else{
        const seedPath=root+'/wire-seed-report.json';if(fs.statSync(seedPath).size>1000000)throw new Error('LAB_SEED_TOO_LARGE');
        const seed=JSON.parse(fs.readTextSync(seedPath)) as PersistenceReport;
        this.check(seed.status==='passed'&&seed.run_id===runId&&seed.events.length===3,'seed_report_restored',report);
        const saved=store.read(id);this.check(saved?.revision===3&&saved.user_edited&&saved.covered_ms===10000,'coverage_restored_after_restart',report);
        const retry=materialRevisionEvent(store,id,2,this.identity(runId,2,seed.at));
        this.check(JSON.stringify(retry)===JSON.stringify(seed.events[1]),'historical_retry_identical_after_restart',report);report.events.push(retry);
        source.audioFrames=3500;source.ended=71000;
        const grown=store.ensure(source,'迟到旧文字');
        this.check(grown.revision===4&&grown.text==='合成人工更正'&&grown.covered_ms===10000&&grown.transcription_source_ms===70000,'growth_preserves_correction_and_partial_coverage',report);
        report.events.push(materialRevisionEvent(store,id,4,this.identity(runId,4,report.at)));
        const tombstone=store.delete(id,4);const deletedEvent=materialRevisionEvent(store,id,tombstone.revision,this.identity(runId,5,report.at));
        this.check(deletedEvent.body.full_text.text===''&&deletedEvent.body.utterances.length===0,'tombstone_contains_no_text',report);report.events.push(deletedEvent);
        this.check(store.ensure(source,'旧文字').operation==='delete','migration_cannot_resurrect',report);
      }
      report.status='passed';
    }catch(error){report.error=(error as Error).message;}
    this.write(root+'/'+phase+'-report.json',report);return report;
  }
}
