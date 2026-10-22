import { readLauncherEnvelope } from './LauncherStatus';
import { util } from '@kit.ArkTS';

export const MAX_PROMPTER_CATALOG_FRAME:number=2048;
function keys(value:Record<string,Object>,allowed:string[]):boolean{return Object.keys(value).length===allowed.length&&Object.keys(value).every((key:string):boolean=>allowed.includes(key));}
// Narrow transport exception for the owned completed-file publisher. This does
// not enable arbitrary type1, full sync, deletion, pinning, or bulk updates.
export function isPrompterCatalogAdd(payload:Uint8Array):boolean{
  if(payload.length>1800)return false;
  try{const envelope=readLauncherEnvelope(payload);
    try{
      if(envelope.type!==1||envelope.binary.length)return false;
      const body=JSON.parse(new util.TextDecoder('utf-8',{fatal:true}).decodeToString(envelope.json)) as Record<string,Object>;
      if(!body||!keys(body,['action','type','total','chunkinfo','items'])||body['action']!==2||body['type']!==3||!Number.isSafeInteger(body['total'])||Number(body['total'])<1||Number(body['total'])>500)return false;
      const chunk=body['chunkinfo'] as Record<string,Object>,items=body['items'] as Object[];
      if(!chunk||!keys(chunk,['chunkid','total','islast'])||chunk['chunkid']!==1||chunk['total']!==1||chunk['islast']!==true||!Array.isArray(items)||items.length!==1)return false;
      const row=items[0] as Record<string,Object>;
      if(!row||!keys(row,['did','pin','title','offset','scroll','total','timestamp','timezone','preview']))return false;
      return typeof row['did']==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row['did'] as string)&&row['pin']===false&&row['offset']===0&&[1,2].includes(Number(row['scroll']))&&typeof row['scroll']==='number'&&
        typeof row['title']==='string'&&(row['title'] as string).trim().length>0&&(row['title'] as string).length<=100&&!/[\u0000-\u001f\u007f]/.test(row['title'] as string)&&
        Number.isSafeInteger(row['total'])&&Number(row['total'])>=1&&Number(row['total'])<=48000&&Number.isSafeInteger(row['timestamp'])&&Number(row['timestamp'])>0&&
        Number.isSafeInteger(row['timezone'])&&Math.abs(Number(row['timezone']))<=50400&&typeof row['preview']==='string'&&(row['preview'] as string).length<=200;
    }finally{envelope.json.fill(0);envelope.binary.fill(0);}
  }catch(_){return false;}
}
