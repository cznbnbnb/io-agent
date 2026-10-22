import {createHash} from 'node:crypto';

export class ApiError extends Error {
  constructor(status,code,details={}){super(code);this.status=status;this.code=code;this.details=details;}
}
export const reject=(status,code,details)=>{throw new ApiError(status,code,details);};
function unicode(s){
  for(let i=0;i<s.length;i++){
    const c=s.charCodeAt(i);
    if(c>=0xd800&&c<=0xdbff){const d=s.charCodeAt(++i);if(!(d>=0xdc00&&d<=0xdfff))reject(400,'INVALID_UNICODE');}
    else if(c>=0xdc00&&c<=0xdfff)reject(400,'INVALID_UNICODE');
  }
  return JSON.stringify(s);
}
// RFC8785: ECMAScript primitive serialization and UTF-16 key order. Do not
// sort into an object then stringify: numeric-looking keys would be reordered.
export function canonical(value,depth=0){
  if(depth>64)reject(400,'JSON_TOO_DEEP');
  if(value===null)return 'null';
  if(typeof value==='string')return unicode(value);
  if(typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))reject(400,'INVALID_NUMBER');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>unicode(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
  reject(400,'INVALID_JSON');
}
export const sha=value=>createHash('sha256').update(value).digest('hex');
export function parseStrict(text){
  let value;try{value=JSON.parse(text);}catch{reject(400,'INVALID_JSON');}
  // JSON.parse silently discards duplicate keys. Scan the validated grammar
  // before canonicalization, including escaped names and nested objects.
  let i=0;
  const ws=()=>{while(/[\x20\t\r\n]/.test(text[i]||'!'))i++;};
  const string=()=>{const start=i++;while(i<text.length){const c=text[i++];if(c==='\\')i++;else if(c==='"')return JSON.parse(text.slice(start,i));}reject(400,'INVALID_JSON');};
  function scan(depth){
    if(depth>64)reject(400,'JSON_TOO_DEEP');ws();
    if(text[i]==='{'){
      i++;ws();const names=new Set();if(text[i]==='}'){i++;return;}
      while(i<text.length){const key=string();if(names.has(key))reject(400,'DUPLICATE_JSON_KEY');names.add(key);ws();i++;scan(depth+1);ws();if(text[i++]==='}')return;ws();}
    }else if(text[i]==='['){i++;ws();if(text[i]===']'){i++;return;}while(i<text.length){scan(depth+1);ws();if(text[i++]===']')return;}}
    else if(text[i]==='"')string();else while(i<text.length&&!/[\x20\t\r\n,}\]]/.test(text[i]))i++;
  }
  scan(0);canonical(value);return value;
}
