export class FollowPosition { pageOffset:number=0;highLightOffset:number=0;confidence:number=0; }
// Retain original UTF-8 coordinates while matching punctuation-insensitive
// speech. The context window is not a claim of the firmware's font layout.
export class TeleprompterAlignment {
  private raw:string[]=[];private bytes:number[]=[0];private normalized:string[]=[];private ends:number[]=[];
  private cursor:number=0;private lastFinal:string='';
  constructor(text:string){
    let total=0;
    for(const point of text){const code=point.codePointAt(0)!;this.raw.push(point);total+=code<=127?1:code<=2047?2:code<=65535?3:4;this.bytes.push(total);
      if(/[A-Za-z0-9\u00c0-\u02ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(point)){this.normalized.push(point.toLowerCase());this.ends.push(total);}}
  }
  get total():number{return this.bytes[this.bytes.length-1];}
  boundary(value:number):boolean{return Number.isSafeInteger(value)&&value>=0&&value<=this.total&&this.bytes.includes(value);}
  reanchor(value:number):void{if(!this.boundary(value))return;this.cursor=this.ends.findIndex((end:number):boolean=>end>value);if(this.cursor<0)this.cursor=this.ends.length;this.lastFinal='';}
  private query(text:string):string[]{const out:string[]=[];for(const point of text){if(/[A-Za-z0-9\u00c0-\u02ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(point))out.push(point.toLowerCase());}return out.slice(-96);}
  private page(highlight:number):number{
    let index=this.bytes.findIndex((value:number):boolean=>value>=highlight);if(index<0)index=this.raw.length;
    let start=Math.max(0,index-24);
    // Prefer a nearby phrase boundary; do not split an ASCII word or UTF-8.
    for(let i=start;i>=Math.max(0,start-10);i--){if(i===0||/[\s，。！？；：、,.!?;:]/.test(this.raw[i-1])){start=i;break;}}
    while(start>0&&start<this.raw.length&&/[A-Za-z0-9]/.test(this.raw[start])&&/[A-Za-z0-9]/.test(this.raw[start-1]))start--;
    return this.bytes[start];
  }
  match(text:string,final:boolean):FollowPosition|undefined{
    const query=this.query(text),key=query.join('');if(query.length<5||!this.normalized.length||final&&key===this.lastFinal)return undefined;
    const from=Math.max(0,this.cursor-96),to=Math.min(this.normalized.length,this.cursor+320),doc=this.normalized.slice(from,to);
    let costs:number[]=[],starts:number[]=[];for(let j=0;j<=doc.length;j++){costs.push(0);starts.push(j);}
    for(let i=1;i<=query.length;i++){
      const next:number[]=[i],nextStarts:number[]=[0];
      for(let j=1;j<=doc.length;j++){
        const sub=costs[j-1]+(query[i-1]===doc[j-1]?0:1),del=costs[j]+1,insert=next[j-1]+1;
        if(sub<=del&&sub<=insert){next[j]=sub;nextStarts[j]=starts[j-1];}
        else if(del<=insert){next[j]=del;nextStarts[j]=starts[j];}else{next[j]=insert;nextStarts[j]=nextStarts[j-1];}
      }costs=next;starts=nextStarts;
    }
    let best=-1,bestCost=query.length+1;
    for(let j=1;j<=doc.length;j++){if(from+j<this.cursor)continue;if(costs[j]<bestCost){best=j;bestCost=costs[j];}}
    if(best<0||1-bestCost/query.length<0.80)return undefined;
    // Distinct repeated occurrences remain ambiguous, rather than jumping ahead.
    for(let j=1;j<=doc.length;j++){if(Math.abs(j-best)<Math.max(4,Math.floor(query.length/2)))continue;if(costs[j]<=bestCost&&from+j>=this.cursor)return undefined;}
    const end=from+best;if(end<=this.cursor)return undefined;this.cursor=end;if(final)this.lastFinal=key;
    const result=new FollowPosition();result.highLightOffset=this.ends[end-1];result.pageOffset=this.page(result.highLightOffset);result.confidence=1-bestCost/query.length;return result;
  }
}
