export interface DisplayPositionDragPorts {
  send:(height:number,distance:number)=>Promise<void>;
  change:()=>void;
  fail:(reason:string)=>void;
}

// Height and distance share one wire command. Keep their latest pair together;
// old readbacks must not replace a newer draft while it is waiting to be sent.
export class DisplayPositionDrag {
  height:number=-1;
  distance:number=-1;
  private queued:boolean=false;
  private timer:number=-1;
  private sending:boolean=false;
  private awaiting:boolean=false;
  private generation:number=0;
  private ports:DisplayPositionDragPorts;
  constructor(ports:DisplayPositionDragPorts){this.ports=ports;}
  get pending():boolean{return this.height>=0;}
  update(height:number,distance:number,commit:boolean):void {
    if(!Number.isInteger(height)||height<1||height>6||!Number.isInteger(distance)||distance<1||distance>3)throw new Error('显示高度为1–6，距离为1–3');
    this.height=height;this.distance=distance;this.queued=true;
    this.schedule(commit?0:120);this.ports.change();
  }
  reconcile(idle:boolean):void {
    if(idle&&this.awaiting&&!this.sending&&this.timer===-1&&!this.queued){this.awaiting=false;this.height=-1;this.distance=-1;}
  }
  cancel():void {
    this.generation++;
    if(this.timer!==-1)clearTimeout(this.timer);
    this.timer=-1;this.height=-1;this.distance=-1;this.queued=false;this.sending=false;this.awaiting=false;
  }
  private schedule(delay:number):void {
    if(this.timer!==-1)clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.timer=-1;this.flush();},delay);
  }
  private async flush():Promise<void> {
    if(this.sending||!this.queued)return;
    const height=this.height,distance=this.distance,generation=this.generation;
    this.queued=false;this.sending=true;
    try {
      await this.ports.send(height,distance);
      if(generation===this.generation)this.awaiting=true;
    } catch(error) {
      if(generation!==this.generation)return;
      this.cancel();this.ports.fail((error as Error).message||'显示位置未发送，请重新读取');this.ports.change();
    } finally {
      if(generation===this.generation){
        this.sending=false;
        if(this.queued)this.schedule(0);
        this.ports.change();
      }
    }
  }
}
