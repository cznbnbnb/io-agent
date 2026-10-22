// Isolated, fixed synthetic fixture. No microphone, task, todo or network ports.
export class ReadingView {
  connected:boolean=false;foreground:boolean=false;peer:string='';connection:number=0;idle:boolean=false;
  prompterPhase:string='idle';did:string='';resumeSequence:number=0;prompterActive:boolean=false;
  localBackSequence:number=0;localBackDid:string='';
  cardActive:boolean=false;uid:string='';cardPhase:string='idle';choice:number=0;
}
export class ReadingRecord {
  schema:number=1;operation:string='';phase:string='idle';outcome:string='pending';choice:number=0;
  peer:string='';connection:number=0;did:string='';uid:string='';deadline:number=0;
  readStarted:number=0;readEnded:number=0;resumeSequence:number=0;exitConfirmed:boolean=false;error:string='';
  localBackSequence:number=0;exitOrigin:string='none';
  checkOnly:boolean=false;
}
export interface ReadingPorts {
  now:()=>number;view:()=>ReadingView;save:(value:ReadingRecord)=>void;
  prepare:()=>Promise<void>;control:(type:number)=>Promise<void>;exit:()=>Promise<boolean>;
  show:()=>Promise<void>;ack:()=>Promise<void>;remove:()=>Promise<void>;
}
export class LongReadingProbe {
  record:ReadingRecord=new ReadingRecord();
  private ports:ReadingPorts;private busy:boolean=false;private disposed:boolean=false;
  private runningSince:number=-1;
  constructor(ports:ReadingPorts,prior?:ReadingRecord){
    this.ports=ports;
    if(prior){
      if(prior.schema!==1||!/^read-[a-f0-9]{32}$/.test(prior.operation)||
        typeof prior.peer!=='string'||typeof prior.did!=='string'||typeof prior.uid!=='string'||
        !Number.isSafeInteger(prior.connection)||![0,1,2].includes(prior.choice)||prior.checkOnly!==undefined&&typeof prior.checkOnly!=='boolean')throw new Error('READING_RECORD_INVALID');
      this.record=prior;
      if(!['done','pending','idle'].includes(prior.phase)){this.record.phase='interrupted';this.record.error='RESTART_NO_REPLAY';this.save();}
    }
  }
  private save():void{this.ports.save(this.record);}
  dispose():void{this.disposed=true;}
  private same(v:ReadingView):boolean{return v.connected&&v.peer===this.record.peer&&v.connection===this.record.connection;}
  private phase(value:string,deadline:number=0):void{this.record.phase=value;this.record.deadline=deadline;this.save();}
  async start(operation:string,checkOnly:boolean=false):Promise<void>{
    if(this.disposed||this.busy||!/^read-[a-f0-9]{32}$/.test(operation)||operation===this.record.operation)throw new Error('READING_NO_REPLAY');
    const v=this.ports.view();
    if(!['idle','done','pending'].includes(this.record.phase)||!v.connected||!v.foreground||!v.idle||v.prompterActive||v.cardActive)throw new Error('READING_NOT_IDLE');
    this.busy=true;
    try{
      this.record=new ReadingRecord();this.record.operation=operation;this.record.peer=v.peer;this.record.connection=v.connection;this.record.checkOnly=checkOnly;
      this.runningSince=-1;
      this.phase('preparing',this.ports.now()+45000);
      try{await this.ports.prepare();}finally{this.record.did=this.ports.view().did;this.save();}
    }catch(error){this.record.error='PREPARE_UNCERTAIN';this.phase('interrupted');throw new Error((error as Error).message);}finally{this.busy=false;}
  }
  async tick():Promise<void>{
    if(this.disposed||this.busy||['idle','done','pending','interrupted'].includes(this.record.phase))return;
    this.busy=true;
    try{
      const v=this.ports.view(),r=this.record,now=this.ports.now();
      if(!this.same(v)){r.error='CONNECTION_CHANGED';this.phase('interrupted');return;}
      if(!v.foreground){r.error='BACKGROUND_NO_CARD';await this.cleanup(false);return;}
      if(!r.checkOnly&&r.phase==='reading'&&now<r.deadline&&!v.prompterActive&&v.localBackDid===r.did&&v.localBackSequence>r.localBackSequence){
        r.readEnded=now;r.exitConfirmed=true;r.exitOrigin='device_local_back_candidate';
        // Allow the native navigation to settle. The delay is not home-screen
        // evidence; a joint mirror observation is still required.
        this.phase('returning',now+1000);return;
      }
      if(['preparing','starting','pausing','reading'].includes(r.phase)){
        if(!r.did||v.did!==r.did||!v.prompterActive){r.error='PROMPTER_CHANGED';this.phase('interrupted');return;}
        if(['error','cleanup','closing'].includes(v.prompterPhase)){
          r.error='PROMPTER_NOT_READY';
          // One bounded exit for this original connection. The cleanup path
          // retains ownership on failure and never opens a selection card.
          await this.cleanup(false);return;
        }
        if(now>=r.deadline){r.error=r.phase==='reading'?'':'READING_DEADLINE';await this.cleanup(false);return;}
      }
      if(r.phase==='preparing'&&v.prompterPhase==='ready'){
        this.phase('starting',now+25000);await this.ports.control(3);
      }else if(r.phase==='starting'){
        // Conservative client pacing based on the successful manual path,
        // not a proven firmware limit. Time alone never establishes running.
        if(v.prompterPhase!=='running'){this.runningSince=-1;return;}
        if(this.runningSince<0)this.runningSince=now;
        if(now-this.runningSince<6000)return;
        this.phase('pausing',now+12000);await this.ports.control(4);
      }else if(r.phase==='pausing'&&v.prompterPhase==='paused'){
        r.resumeSequence=v.resumeSequence;r.localBackSequence=v.localBackSequence;r.readStarted=now;this.phase('reading',now+120000);
      }else if(r.phase==='returning'&&now>=r.deadline){
        await this.cleanup(true);
      }else if(r.phase==='choosing'){
        if(v.uid===r.uid&&v.cardPhase==='observed'&&[1,2].includes(v.choice)){
          r.choice=v.choice;r.outcome=v.choice===1?'accepted_test_only':'modify_test_only';
          this.phase('acknowledging');await this.ports.ack();this.phase('settling',this.ports.now()+2500);
        }else if(!v.cardActive){this.phase('pending');}
        else if(v.uid!==r.uid){r.error='CARD_OWNER_CHANGED';this.phase('interrupted');}
        else if(now>=r.deadline){await this.cleanup(false);}
      }else if(r.phase==='settling'&&now>=r.deadline){await this.cleanup(false);}
    }catch(_){this.record.error='OPERATION_UNCERTAIN';this.phase('interrupted');}finally{this.busy=false;}
  }
  private async cleanup(showCard:boolean):Promise<void>{
    const r=this.record;let v=this.ports.view();
    if(!this.same(v))throw new Error('READING_CONNECTION_CHANGED');
    if(v.prompterActive){
      if(!r.did||v.did!==r.did)throw new Error('READING_OWNER_CHANGED');
      this.phase('exiting');const confirmed=await this.ports.exit();v=this.ports.view();
      if(!confirmed||v.prompterActive||!this.same(v)){r.error='EXIT_UNCONFIRMED';this.phase('interrupted');return;}
      r.exitConfirmed=true;r.exitOrigin='remote_stop_ack';
      // Device-confirmed completion time, not merely the requested deadline.
      // Neither timestamp establishes what the wearer could actually read.
      if(r.readStarted>0&&r.readEnded===0)r.readEnded=this.ports.now();
      this.save();
    }
    if(showCard){
      if(r.checkOnly){this.phase('pending');return;}
      v=this.ports.view();
      if(this.disposed||!r.exitConfirmed||r.exitOrigin!=='device_local_back_candidate'||!v.foreground||!this.same(v)||!v.idle||v.cardActive){r.error='CARD_NOT_IDLE';this.phase('pending');return;}
      this.phase('showing');
      try{await this.ports.show();}finally{r.uid=this.ports.view().uid;this.save();}
      if(!r.uid)throw new Error('READING_CARD_MISSING');this.phase('choosing',this.ports.now()+60000);return;
    }
    v=this.ports.view();
    if(v.cardActive){if(!r.uid||v.uid!==r.uid)throw new Error('READING_CARD_CHANGED');await this.ports.remove();}
    if(this.ports.view().cardActive){r.error='CARD_CLEANUP_PENDING';this.phase('interrupted');return;}
    this.phase(r.choice?'done':'pending');
  }
  async stop(operation:string):Promise<void>{
    if(this.busy)throw new Error('READING_BUSY');
    if(operation!==this.record.operation||!operation)throw new Error('READING_OWNER_CHANGED');
    const v=this.ports.view();
    // The ordinary cleanup UI may already have settled a restart/disconnect.
    // Retire only the local experiment; do not claim a new device exit event.
    if(v.idle&&!v.prompterActive&&!v.cardActive){this.phase(this.record.choice?'done':'pending');return;}
    this.busy=true;try{await this.cleanup(false);}finally{this.busy=false;}
  }
}
