export class AsrWindowPlan {
  ready:boolean=false;done:boolean=false;
  coreStart:number=0;coreEnd:number=0;decodeStart:number=0;decodeEnd:number=0;totalFrames:number=0;
}
export class AsrWindowRequest {
  cursor:number=0;coreFrames:number=334;contextFrames:number=200;sealed:boolean=true;
  includeSpeakers:boolean=true;
  expectedPrefixBytes:number=0;expectedPrefixSha256:string='';
}
// Frame ownership is disjoint; context may overlap. All prefix packets are
// decoded to restore exact Opus state after a restart, with earlier PCM ignored.
// This trades bounded decode work for portable recovery (no native state dump).
export function planAsrWindow(total:number,cursor:number,core:number,context:number,sealed:boolean):AsrWindowPlan{
  if(![total,cursor,core,context].every((n:number):boolean=>Number.isSafeInteger(n))||total<0||total>60000||cursor<0||cursor>total||core<1||core>1500||context<0||context>600)throw new Error('ASR_WINDOW_INVALID');
  const plan=new AsrWindowPlan();plan.totalFrames=total;plan.coreStart=cursor;
  plan.coreEnd=Math.min(total,cursor+core);plan.decodeStart=Math.max(0,cursor-context);plan.decodeEnd=Math.min(total,plan.coreEnd+context);
  plan.done=sealed&&cursor===total;
  plan.ready=!plan.done&&plan.coreEnd>cursor&&(sealed||total>=cursor+core+context);return plan;
}
export function windowOwnsUtterance(start:number,end:number,plan:AsrWindowPlan,frameSeconds:number):boolean{
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||start<0||!Number.isFinite(frameSeconds)||frameSeconds<=0)return false;
  const middle=(start+end)/2;return middle>=plan.coreStart*frameSeconds&&middle<plan.coreEnd*frameSeconds;
}
