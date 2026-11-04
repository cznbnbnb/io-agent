import {canonical,sha,reject} from './json.mjs';

const terminal=new Set(['created','declined','failed','unknown','expired']);
const text=(v,n)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=n&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v);

/** Suggestions are separate from Agent jobs. Only an authenticated phone may
 * accept a suggestion or report the native RayNeo write; posting is not adding. */
export class TodoSuggestions {
  constructor(store){
    this.store=store;store.db.exec(`CREATE TABLE IF NOT EXISTS todo_suggestions(
      owner TEXT NOT NULL,id TEXT NOT NULL,producer TEXT NOT NULL,todo_key TEXT NOT NULL,
      payload TEXT NOT NULL,state TEXT NOT NULL,phone_producer TEXT,native_id TEXT,error TEXT,
      created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires INTEGER NOT NULL,
      PRIMARY KEY(owner,id),UNIQUE(owner,producer,todo_key)) STRICT;`);
  }
  create(token,input){
    const p=this.store.auth(token,'requests:write'),device=this.store.devices.device(p);
    if(device.role!=='agent'||p.sessionRoute)reject(403,'COMPUTER_PAIRING_REQUIRED');
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['todo_key','content','source','expires_at'].includes(k))||
      typeof input.todo_key!=='string'||!/^[A-Za-z0-9_.-]{1,96}$/.test(input.todo_key)||!text(input.content,48)||input.source!==undefined&&!text(input.source,20))reject(400,'INVALID_TODO_SUGGESTION');
    const now=this.store.clock(),expires=input.expires_at===undefined?now+86400000:Date.parse(input.expires_at);
    if(!Number.isFinite(expires)||expires<=now||expires>now+86400000)reject(400,'INVALID_TODO_DEADLINE');
    const payload=canonical({content:input.content,source:input.source??'Agent 建议',...(input.expires_at===undefined?{}:{expires_at:input.expires_at})});
    return this.store.tx(()=>{
      const previous=this.store.db.prepare('SELECT * FROM todo_suggestions WHERE owner=? AND producer=? AND todo_key=?').get(p.owner,p.producer,input.todo_key);
      if(previous){if(previous.payload!==payload)reject(409,'TODO_KEY_CONFLICT');return this.view(previous);}
      const id='todo-'+sha(canonical([p.owner,p.producer,input.todo_key]));
      this.store.db.prepare("INSERT INTO todo_suggestions VALUES (?,?,?,?,?,'pending_confirmation',NULL,NULL,NULL,?,?,?)").run(p.owner,id,p.producer,input.todo_key,payload,now,now,expires);
      this.store.pendingInboxOwners.add(p.owner);
      return this.view(this.store.db.prepare('SELECT * FROM todo_suggestions WHERE owner=? AND id=?').get(p.owner,id));
    });
  }
  view(row){
    const expired=!terminal.has(row.state)&&row.state!=='creating'&&row.expires<=this.store.clock();
    if(expired){this.store.db.prepare("UPDATE todo_suggestions SET state='expired',updated_at=? WHERE owner=? AND id=?").run(this.store.clock(),row.owner,row.id);row={...row,state:'expired'};}
    const body=JSON.parse(row.payload);
    return{schema_version:'1.0',proposal_id:row.id,content:body.content,source:body.source,state:row.state,
      expires_at:new Date(row.expires).toISOString(),native_id:row.native_id,error:row.error,
      native_created:row.state==='created',glasses_display_confirmed:false};
  }
  get(token,id){
    const p=this.store.auth(token),scopes=JSON.parse(p.scopes);
    if(!scopes.includes('requests:write')&&!scopes.includes('receipts:phone'))reject(403,'FORBIDDEN');
    const row=this.store.db.prepare('SELECT * FROM todo_suggestions WHERE owner=? AND id=?').get(p.owner,id);
    if(!row)reject(404,'TODO_SUGGESTION_NOT_FOUND');return this.view(row);
  }
  pending(token){
    const p=this.store.auth(token,'receipts:phone'),device=this.store.devices.device(p);
    if(device.role!=='phone')reject(403,'PHONE_PAIRING_REQUIRED');
    if(!this.store.phones.permits(p))return {schema_version:'1.0',items:[]};
    const rows=this.store.db.prepare("SELECT * FROM todo_suggestions WHERE owner=? AND state IN ('pending_confirmation','shown','accepted','creating') AND (phone_producer IS NULL OR phone_producer=?) ORDER BY created_at,id LIMIT 20").all(p.owner,p.producer);
    return{schema_version:'1.0',items:rows.map(r=>this.view(r)).filter(r=>!terminal.has(r.state))};
  }
  phone(token,id,input){
    const p=this.store.auth(token,'receipts:phone'),device=this.store.devices.device(p);
    if(device.role!=='phone')reject(403,'PHONE_PAIRING_REQUIRED');
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['action','native_id','error'].includes(k))||
      !['show','accept','decline','begin','created','failed','unknown'].includes(input.action)||
      (input.action==='created'?!text(input.native_id,128):input.native_id!==undefined)||
      (['failed','unknown'].includes(input.action)?typeof input.error!=='string'||!/^[A-Z][A-Z0-9_]{1,63}$/.test(input.error):input.error!==undefined))reject(400,'INVALID_TODO_ACTION');
    if(['show','accept','begin'].includes(input.action)&&!this.store.phones.permits(p))reject(409,'PRIMARY_PHONE_REQUIRED');
    return this.store.tx(()=>{
      const row=this.store.db.prepare('SELECT * FROM todo_suggestions WHERE owner=? AND id=?').get(p.owner,id);
      if(!row)reject(404,'TODO_SUGGESTION_NOT_FOUND');this.view(row);
      if(row.phone_producer!==null&&row.phone_producer!==p.producer)reject(409,'TODO_OTHER_PHONE');
      const current=this.store.db.prepare('SELECT * FROM todo_suggestions WHERE owner=? AND id=?').get(p.owner,id),action=input.action;
      const target={show:'shown',accept:'accepted',decline:'declined',begin:'creating',created:'created',failed:'failed',unknown:'unknown'}[action];
      if(current.state===target){if(action==='created'&&current.native_id!==input.native_id)reject(409,'TODO_RESULT_CONFLICT');return{...this.view(current),may_create:false};}
      const allowed={show:['pending_confirmation'],accept:['shown'],decline:['shown'],begin:['accepted'],created:['creating','unknown'],failed:['shown','accepted','creating'],unknown:['accepted','creating']}[action];
      if(!allowed.includes(current.state))reject(409,'TODO_STATE_CONFLICT');
      this.store.db.prepare('UPDATE todo_suggestions SET state=?,phone_producer=?,native_id=?,error=?,updated_at=? WHERE owner=? AND id=?').run(target,p.producer,input.native_id??null,input.error??null,this.store.clock(),p.owner,id);
      this.store.pendingInboxOwners.add(p.owner);
      return{...this.view(this.store.db.prepare('SELECT * FROM todo_suggestions WHERE owner=? AND id=?').get(p.owner,id)),may_create:action==='begin'};
    });
  }
}
