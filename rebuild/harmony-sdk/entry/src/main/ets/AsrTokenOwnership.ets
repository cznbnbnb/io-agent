// These are model token START times, never word-end times or speaker identity.
export function renderAsrTokens(tokens:string[]):string{return tokens.join('').replace(/▁/g,' ').trim();}
export function validAsrTokens(text:string,tokens:string[],starts:number[],start:number,end:number):boolean{
  if(!Array.isArray(tokens)||!Array.isArray(starts)||!tokens.length||tokens.length>65536||tokens.length!==starts.length||
    !Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start)return false;
  let previous=start,total=0;
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i],time=starts[i];
    if(typeof token!=='string'||!token.length||token.length>1024||/[\u0000-\u001f\u007f]/.test(token)||
      !Number.isFinite(time)||time<previous||time<start||time>end)return false;
    previous=time;total+=token.length;if(total>65536)return false;
  }
  return renderAsrTokens(tokens).replace(/\s/g,'')===text.replace(/\s/g,'');
}
export function ownsAsrToken(time:number,coreStart:number,coreEnd:number,sourceEnd:number):boolean{
  // Round only comparison precision; adjacent half-open cores share one boundary.
  const t=Math.round(time*1000000),a=Math.round(coreStart*1000000),b=Math.round(coreEnd*1000000);
  return Number.isFinite(time)&&t>=a&&(t<b||(t===b&&b===Math.round(sourceEnd*1000000)));
}
