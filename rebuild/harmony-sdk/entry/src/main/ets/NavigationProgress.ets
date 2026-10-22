// Pure GCJ-02 geometry. Native WGS84 fixes must pass the provider conversion first.
export class NavPoint { longitude: number = 0; latitude: number = 0; }
export class NavSegment { from: NavPoint = new NavPoint(); to: NavPoint = new NavPoint(); step: number = 0; length: number = 0; start: number = 0; }
export class NavProgress { step: number = 0; remaining: number = 0; toTurn: number = 0; offRoute: boolean = false; arrived: boolean = false; accepted: boolean = false; }
export function parseNavPoint(text: string): NavPoint {
  if(!/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(text))throw new Error('路线坐标格式错误');
  const parts=text.split(',').map((s:string)=>Number(s));
  if(Math.abs(parts[0])>180||Math.abs(parts[1])>90)throw new Error('路线坐标超出范围');
  const p=new NavPoint();p.longitude=parts[0];p.latitude=parts[1];return p;
}
export function navDistance(a: NavPoint,b: NavPoint): number {
  const rad=Math.PI/180,lat=(b.latitude-a.latitude)*rad,lon=(b.longitude-a.longitude)*rad;
  const h=Math.sin(lat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(lon/2)**2;
  return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
export class NavigationProgress {
  segments: NavSegment[] = [];
  total: number = 0;
  private progress: number = 0;
  private lastTime: number = 0;
  private initialized: boolean = false;
  load(lines: string[]): void {
    const segments: NavSegment[]=[];let total=0;
    if(!lines.length||lines.length>300)throw new Error('路线为空或过长');
    lines.forEach((line:string,step:number)=>{
      const points=line.split(';').map((s:string)=>parseNavPoint(s));
      if(points.length<2||points.length>10000)throw new Error('缺少路线几何');
      for(let i=1;i<points.length;i++) {
        const length=navDistance(points[i-1],points[i]);if(length<0.01)continue;
        const segment=new NavSegment();segment.from=points[i-1];segment.to=points[i];segment.length=length;segment.start=total;segment.step=step;
        total+=length;segments.push(segment);
        if(segments.length>20000)throw new Error('路线几何过长');
      }
    });
    if(!segments.length)throw new Error('路线没有有效线段');
    this.segments=segments;this.total=total;this.progress=0;this.lastTime=0;this.initialized=false;
  }
  sample(meters: number): NavPoint {
    const distance=Math.max(0,Math.min(this.total,meters));
    const segment=this.segments.find((s:NavSegment)=>s.start+s.length>=distance)||this.segments[this.segments.length-1];
    if(!segment)throw new Error('尚未规划路线');
    const t=Math.max(0,Math.min(1,(distance-segment.start)/segment.length));
    const point=new NavPoint();point.longitude=segment.from.longitude+(segment.to.longitude-segment.from.longitude)*t;point.latitude=segment.from.latitude+(segment.to.latitude-segment.from.latitude)*t;return point;
  }
  update(point: NavPoint, accuracy: number, stamp: number, now: number, maxSpeed: number = 55): NavProgress {
    const result=new NavProgress();
    if(!Number.isFinite(point.longitude)||!Number.isFinite(point.latitude)||Math.abs(point.longitude)>180||Math.abs(point.latitude)>90||!Number.isFinite(accuracy)||accuracy<0||accuracy>50||!Number.isFinite(stamp)||now-stamp>15000||stamp>now+2000||stamp<=this.lastTime)return result;
    let best=Infinity,index=-1,along=0;
    const maxAdvance=this.initialized?Math.max(50,(stamp-this.lastTime)/1000*maxSpeed+accuracy):Infinity;
    for(let i=0;i<this.segments.length;i++) {
      const s=this.segments[i];
      if(this.initialized&&(s.start+s.length<this.progress-35||s.start>this.progress+maxAdvance))continue;
      const scale=Math.cos(point.latitude*Math.PI/180),ax=(s.from.longitude-point.longitude)*scale,ay=s.from.latitude-point.latitude;
      const dx=(s.to.longitude-s.from.longitude)*scale,dy=s.to.latitude-s.from.latitude;
      const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy)));
      const p=new NavPoint();p.longitude=s.from.longitude+(s.to.longitude-s.from.longitude)*t;p.latitude=s.from.latitude+(s.to.latitude-s.from.latitude)*t;
      const distance=navDistance(point,p);
      if(distance<best){best=distance;index=i;along=s.start+t*s.length;}
    }
    if(index<0)return result;
    result.accepted=true;result.offRoute=best>Math.max(35,accuracy*1.5);
    if(result.offRoute)return result;
    if(this.initialized&&along>this.progress+maxAdvance){result.accepted=false;return result;}
    this.lastTime=stamp;this.initialized=true;this.progress=Math.max(this.progress,along);
    const segment=this.segments.find((s:NavSegment)=>s.start+s.length>=this.progress)||this.segments[this.segments.length-1];
    result.step=segment.step;result.remaining=Math.round(this.total-this.progress);
    let turn=segment.start+segment.length;
    for(const s of this.segments){if(s.step===segment.step)turn=s.start+s.length;}
    result.toTurn=Math.max(0,Math.round(turn-this.progress));
    result.arrived=result.remaining<15&&navDistance(point,this.segments[this.segments.length-1].to)<20;
    return result;
  }
}
