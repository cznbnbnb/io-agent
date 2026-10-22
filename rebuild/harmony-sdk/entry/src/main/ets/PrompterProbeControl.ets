// Local debug boundary: observe or stop one exact existing prompter owner.
// No start, manuscript, microphone, catalog write or manual-exit confirmation.
export class PrompterProbeSnapshot {
  active:boolean=false;connected:boolean=false;foreground:boolean=false;phase:string='idle';
  binding:string='';can_stop:boolean=false;mode:number=2;progress:number=0;
  pending_writes:number=0;file_complete:boolean=false;business_ready:boolean=false;
  query_state:number=-1;query_failure:string='';exit_evidence:string='none';
}
class PrompterProbeCommand {
  schema:number=1;id:string='';action:string='';expires_at:number=0;expected_binding:string='';
}
class PrompterProbeReceipt {
  schema:number=1;id:string='';request_json:string='';state:string='running';error:string='';
  snapshot:PrompterProbeSnapshot=new PrompterProbeSnapshot();exit_wait_confirmed:boolean=false;lens_verified:boolean=false;
}
export interface PrompterProbePorts {
  now:()=>number;read:(name:string)=>string|undefined;write:(name:string,value:string)=>void;
  capacity:()=>void;view:()=>PrompterProbeSnapshot;stop:()=>Promise<boolean>;
}
export class PrompterProbeControl {
  private busy:boolean=false;private disposed:boolean=false;private lastSnapshot:string='';
  private ports:PrompterProbePorts;
  constructor(ports:PrompterProbePorts){this.ports=ports;}
  dispose():void{this.disposed=true;}
  private valid(r:PrompterProbeCommand):boolean{
    if(!r||r.schema!==1||!/^prm-[a-f0-9]{32}$/.test(r.id)||!['status','stop'].includes(r.action)||
      !Number.isSafeInteger(r.expires_at)||r.expires_at>this.ports.now()+30000)return false;
    const keys=['schema','id','action','expires_at'];
    if(r.action==='stop'){keys.push('expected_binding');if(!/^[a-f0-9]{64}$/.test(r.expected_binding))return false;}
    return Object.keys(r).length===keys.length&&Object.keys(r).every((key:string):boolean=>keys.includes(key));
  }
  private saveSnapshot(view:PrompterProbeSnapshot):void{
    const json=JSON.stringify(view);if(json===this.lastSnapshot)return;
    this.ports.write('prompter-state.json',json);this.lastSnapshot=json;
  }
  private command():string|undefined{
    const stop=this.ports.read('prompter-stop.json');
    if(stop&&stop.length<=1024){
      try{
        const request=JSON.parse(stop) as PrompterProbeCommand;
        if(this.valid(request)&&request.action==='stop'){
          const raw=this.ports.read(request.id+'.json');
          if(!raw)return stop;
          const prior=JSON.parse(raw) as PrompterProbeReceipt;
          if(prior.schema===1&&prior.id===request.id&&prior.request_json===stop&&prior.state==='running')return stop;
        }
      }catch(_){/* A malformed or completed stop never blocks status. */}
    }
    const status=this.ports.read('prompter-command.json');
    if(status&&status.length<=1024){try{if((JSON.parse(status) as PrompterProbeCommand).action==='status')return status;}catch(_){}}
    return undefined;
  }
  async poll():Promise<void>{
    if(this.disposed||this.busy)return;this.busy=true;
    try{
      this.saveSnapshot(this.ports.view());
      const raw=this.command();if(!raw)return;
      let r:PrompterProbeCommand;try{r=JSON.parse(raw) as PrompterProbeCommand;}catch(_){return;}
      if(!this.valid(r))return;
      const name=r.id+'.json',prior=this.ports.read(name);
      if(prior){
        const old=JSON.parse(prior) as PrompterProbeReceipt;
        if(old.schema!==1||old.id!==r.id||old.request_json!==raw)return;
        if(old.state==='running'){
          old.state='uncertain';old.error='INTERRUPTED_NO_REPLAY';old.snapshot=this.ports.view();this.ports.write(name,JSON.stringify(old));
        }
        return;
      }
      this.ports.capacity();
      const receipt=new PrompterProbeReceipt();receipt.id=r.id;receipt.request_json=raw;
      // Persist intent before invoking an existing stop. A failed write does
      // not authorize a command whose result could no longer be reconciled.
      this.ports.write(name,JSON.stringify(receipt));
      try{
        if(r.expires_at<=this.ports.now())throw new Error('PROMPTER_EXPIRED');
        if(r.action==='stop'){
          const before=this.ports.view();
          if(!before.active||!before.connected||!before.can_stop||before.binding!==r.expected_binding)throw new Error('PROMPTER_OWNER_CHANGED');
          // Recheck at the last synchronous boundary before stop takes its
          // own epoch/peer snapshot. No await or arbitrary code runs between.
          const current=this.ports.view();
          if(!current.can_stop||current.binding!==r.expected_binding||r.expires_at<=this.ports.now())throw new Error('PROMPTER_OWNER_CHANGED');
          receipt.exit_wait_confirmed=await this.ports.stop();
          if(this.disposed)return;
          receipt.state=receipt.exit_wait_confirmed?'complete':'uncertain';
          if(!receipt.exit_wait_confirmed)receipt.error='PROMPTER_EXIT_UNCONFIRMED';
        }else receipt.state='complete';
      }catch(error){
        receipt.state='error';const reason=(error as Error).message;
        receipt.error=/^[A-Z_]{1,64}$/.test(reason)?reason:'PROMPTER_STOP_UNCERTAIN';
      }
      if(this.disposed)return;
      receipt.snapshot=this.ports.view();this.saveSnapshot(receipt.snapshot);this.ports.write(name,JSON.stringify(receipt));
    }finally{this.busy=false;}
  }
}
