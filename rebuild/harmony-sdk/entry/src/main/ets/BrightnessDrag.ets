export interface BrightnessDragPorts {
  send:(value:number)=>Promise<void>;
  change:()=>void;
  fail:(reason:string)=>void;
}

// Local dragging stays responsive. At most one send and the latest unsent value
// are retained; the device's final readback remains the source of truth.
export class BrightnessDrag {
  target:number=-1;
  private queued:number=-1;
  private timer:number=-1;
  private sending:boolean=false;
  private awaiting:boolean=false;
  private generation:number=0;
  private ports:BrightnessDragPorts;
  constructor(ports:BrightnessDragPorts){this.ports=ports;}
  get pending():boolean{return this.target>=0;}
  update(value:number,commit:boolean):void {
    if(!Number.isInteger(value)||value<1||value>17)throw new Error('亮度档位为1–17');
    this.target=value;this.queued=value;
    this.schedule(commit?0:120);this.ports.change();
  }
  reconcile(idle:boolean):void {
    if(idle&&this.awaiting&&!this.sending&&this.timer===-1&&this.queued<0){this.awaiting=false;this.target=-1;}
  }
  cancel():void {
    this.generation++;
    if(this.timer!==-1)clearTimeout(this.timer);
    this.timer=-1;this.target=-1;this.queued=-1;this.sending=false;this.awaiting=false;
  }
  private schedule(delay:number):void {
    if(this.timer!==-1)clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.timer=-1;this.flush();},delay);
  }
  private async flush():Promise<void> {
    if(this.sending||this.queued<0)return;
    const value=this.queued,generation=this.generation;
    this.queued=-1;this.sending=true;
    try {
      await this.ports.send(value);
      if(generation===this.generation)this.awaiting=true;
    } catch(error) {
      if(generation!==this.generation)return;
      this.cancel();this.ports.fail((error as Error).message||'亮度未发送，请重新读取');this.ports.change();
    } finally {
      if(generation===this.generation){
        this.sending=false;
        if(this.queued>=0)this.schedule(0);
        this.ports.change();
      }
    }
  }
}
